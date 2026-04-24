import { readFile, writeFile, mkdir, stat, glob } from 'node:fs/promises';
import { extname, resolve, relative, dirname, join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import type { CSTNode, IngestPlugin, PatternMatcher, LLMFallbackHandler, LayerStats } from '../ingest/types.js';
import { loadPatterns } from '../ingest/patterns.js';
import { runPipeline } from '../ingest/pipeline.js';
import { AnthropicLLMFallbackHandler } from '../ingest/llm-fallback.js';
import { encodeModule } from '../wire/encoder.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunResult {
  exitCode: number;
}

/** Optional overrides for testing — bypasses real plugin/pattern loading and LLM. */
export interface IngestOverrides {
  plugin?: IngestPlugin;
  patterns?: readonly PatternMatcher[];
  llmFallback?: LLMFallbackHandler;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ParsedArgs {
  path: string;
  skill: string;
  batch: boolean;
  dryRun: boolean;
  report: boolean;
  noLlm: boolean;
}

interface IngestReport {
  files: number;
  constructs: number;
  auto: number;
  autoPercent: number;
  llm: number;
  llmPercent: number;
  flagged: number;
  flaggedPercent: number;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const USAGE = 'usage: ion ingest <path> --skill <name> [--batch] [--dry-run] [--report] [--no-llm]\n';

/**
 * Parse `ion ingest` CLI arguments.
 * Returns { error } on unknown flag, missing required arg, or duplicate positional.
 */
export function parseArgs(args: string[]): ParsedArgs | { error: string } {
  let path: string | undefined;
  let skill: string | undefined;
  let batch = false;
  let dryRun = false;
  let report = false;
  let noLlm = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--batch') {
      batch = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--report') {
      report = true;
    } else if (arg === '--no-llm') {
      noLlm = true;
    } else if (arg === '--skill') {
      i++;
      const next = args[i];
      if (next === undefined || next.startsWith('--')) {
        return { error: '--skill requires a value' };
      }
      skill = next;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      if (path !== undefined) {
        return { error: `unexpected positional argument: ${arg}` };
      }
      path = arg;
    } else if (arg !== undefined) {
      return { error: `unknown flag: ${arg}` };
    }
    i++;
  }

  if (skill === undefined) {
    return { error: '--skill is required' };
  }
  if (path === undefined) {
    return { error: 'path argument is required' };
  }

  return { path, skill, batch, dryRun, report, noLlm };
}

// ---------------------------------------------------------------------------
// Skill directory resolution
// ---------------------------------------------------------------------------

/**
 * Locate the skill plugin directory.
 * Tries `skills/<name>/` relative to CWD first, then relative to the CLI binary
 * (two levels up from `dist/cli/` → project root → `skills/<name>/`).
 */
async function resolveSkillDir(skillName: string): Promise<string | { error: string }> {
  const cwdPath = resolve(process.cwd(), 'skills', skillName);
  try {
    const s = await stat(cwdPath);
    if (s.isDirectory()) return cwdPath;
  } catch {
    // not found at CWD, try fallback
  }

  const fileDir = dirname(fileURLToPath(import.meta.url));
  const fallbackPath = resolve(fileDir, '..', '..', 'skills', skillName);
  try {
    const s = await stat(fallbackPath);
    if (s.isDirectory()) return fallbackPath;
  } catch {
    // not found
  }

  return {
    error: `skill directory not found: '${skillName}' (tried '${cwdPath}' and '${fallbackPath}')`,
  };
}

// ---------------------------------------------------------------------------
// Plugin construction
// ---------------------------------------------------------------------------

/**
 * Dynamically load the JavaScript parser from the compiled skills directory.
 * The parser module uses top-level await (WASM init) so this must be async.
 */
async function buildJsPlugin(skillDir: string): Promise<IngestPlugin | { error: string }> {
  // In the compiled output: dist/cli/ingest.js → ../skills/javascript/parser.js = dist/skills/...
  const cliDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(skillDir, 'parser.js'),
    resolve(cliDir, '..', 'skills', basename(skillDir), 'parser.js'),
    resolve(process.cwd(), 'dist', 'skills', basename(skillDir), 'parser.js'),
  ];

  for (const parserPath of candidates) {
    try {
      await stat(parserPath);
    } catch {
      continue;
    }

    const parserUrl = pathToFileURL(parserPath).href;
    try {
      // Dynamic import avoids static dependency on skills/ outside rootDir
      const mod = await import(parserUrl) as unknown;
      const parseJsRaw = (mod as Record<string, unknown>)['parseJavaScript'];
      if (typeof parseJsRaw !== 'function') continue;
      const parseJs = parseJsRaw as (source: string) => { root: unknown };

      return {
        language: 'javascript',
        parse(source: string): CSTNode {
          // JsTypedNode structurally satisfies CSTNode (same required fields)
          return parseJs(source).root as unknown as CSTNode;
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `failed to load JavaScript parser: ${msg}` };
    }
  }

  return { error: 'JavaScript parser not found. Run: tsc -p skills/tsconfig.json' };
}

/** Build the IngestPlugin for the given skill. Only 'javascript' is supported. */
async function buildPlugin(
  skillName: string,
  skillDir: string,
): Promise<IngestPlugin | { error: string }> {
  if (skillName === 'javascript') {
    return buildJsPlugin(skillDir);
  }
  return { error: `unsupported skill: '${skillName}'. Supported: javascript` };
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

function extensionsForSkill(skillName: string): string[] {
  if (skillName === 'javascript') {
    return ['.js', '.mjs', '.cjs'];
  }
  return [];
}

/**
 * Collect source files to process.
 * In batch mode: `path` must be a directory; glob recursively for skill file extensions.
 * In single mode: `path` must be a file.
 */
async function collectSourceFiles(
  inputPath: string,
  parsed: ParsedArgs,
): Promise<string[] | { error: string }> {
  if (parsed.batch) {
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(inputPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `cannot access path '${inputPath}': ${msg}` };
    }
    if (!s.isDirectory()) {
      return { error: `--batch requires a directory path, got file: '${inputPath}'` };
    }

    const exts = extensionsForSkill(parsed.skill);
    const found: string[] = [];
    for (const ext of exts) {
      try {
        for await (const file of glob(`**/*${ext}`, { cwd: inputPath })) {
          found.push(resolve(inputPath, file));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `failed to enumerate files: ${msg}` };
      }
    }
    return found;
  }

  // Single file mode
  try {
    const s = await stat(inputPath);
    if (!s.isFile()) {
      return { error: `path is not a file: '${inputPath}'` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `cannot access file '${inputPath}': ${msg}` };
  }
  return [resolve(inputPath)];
}

// ---------------------------------------------------------------------------
// Path and name helpers
// ---------------------------------------------------------------------------

/**
 * Derive a fully-qualified IonIR module name from a file path.
 * Strips `root` prefix and file extension, converts `/` separators to `.` and `-` to `_`.
 * Example: `src/utils/foo-bar.js` with root `src` → `utils.foo_bar`.
 */
export function deriveModuleName(filePath: string, root: string): string {
  const rel = relative(resolve(root), resolve(filePath));
  const withoutExt = rel.slice(0, rel.length - extname(rel).length);
  return withoutExt
    .split('/')
    .join('.')
    .replace(/-/g, '_');
}

/** Replace the source file extension with `.ion`, keeping the file in its original directory. */
function deriveOutputPath(inputPath: string): string {
  const dir = dirname(inputPath);
  const base = basename(inputPath, extname(inputPath));
  return join(dir, `${base}.ion`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Aggregate LayerStats across all processed files into a human-readable report.
 * Percentages are in [0, 100] and guard against divide-by-zero when total constructs = 0.
 */
export function buildReport(allStats: LayerStats[]): IngestReport {
  let pattern = 0;
  let llm = 0;
  let unhandled = 0;
  for (const s of allStats) {
    pattern += s.pattern;
    llm += s.llm;
    unhandled += s.unhandled;
  }
  const constructs = pattern + llm + unhandled;
  const pct = (n: number): number =>
    constructs === 0 ? 0 : (n / constructs) * 100;
  return {
    files: allStats.length,
    constructs,
    auto: pattern,
    autoPercent: pct(pattern),
    llm,
    llmPercent: pct(llm),
    flagged: unhandled,
    flaggedPercent: pct(unhandled),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Runs the `ion ingest` command.
 * Returns { exitCode } where 0 = success, 1 = partial errors, 2 = argument/I-O error.
 * `overrides` allows injecting a fake plugin/patterns/llmFallback for testing.
 */
export async function runIngest(args: string[], overrides?: IngestOverrides): Promise<RunResult> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.stderr.write(USAGE);
    return { exitCode: 2 };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(parsed.skill)) {
    process.stderr.write(`error: invalid skill name '${parsed.skill}' (only a-z, A-Z, 0-9, _, - allowed)\n`);
    return { exitCode: 2 };
  }

  // Resolve plugin and patterns, skipping skill dir lookup when both are injected
  let patterns: readonly PatternMatcher[];
  let plugin: IngestPlugin;

  if (overrides?.plugin !== undefined && overrides.patterns !== undefined) {
    plugin = overrides.plugin;
    patterns = overrides.patterns;
  } else {
    const r = await resolveSkillDir(parsed.skill);
    if (typeof r !== 'string') {
      process.stderr.write(`error: ${r.error}\n`);
      return { exitCode: 2 };
    }
    patterns = overrides?.patterns ?? await loadPatterns(r);
    if (overrides?.plugin !== undefined) {
      plugin = overrides.plugin;
    } else {
      const p = await buildPlugin(parsed.skill, r);
      if ('error' in p) {
        process.stderr.write(`error: ${p.error}\n`);
        return { exitCode: 2 };
      }
      plugin = p;
    }
  }

  // Build LLM fallback: use override if provided; otherwise use real handler when API key present
  let llmFallback: LLMFallbackHandler | undefined;
  if (overrides !== undefined) {
    llmFallback = overrides.llmFallback;
  } else if (parsed.noLlm) {
    // explicit opt-out
  } else if (process.env['ANTHROPIC_API_KEY'] !== undefined) {
    llmFallback = new AnthropicLLMFallbackHandler();
  } else {
    process.stderr.write('warning: ANTHROPIC_API_KEY not set, running without LLM fallback\n');
  }

  const files = await collectSourceFiles(parsed.path, parsed);
  if ('error' in files) {
    process.stderr.write(`error: ${files.error}\n`);
    return { exitCode: 2 };
  }

  const allStats: LayerStats[] = [];
  let anyError = false;

  for (const filePath of files) {
    let source: string;
    try {
      const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
      const fileInfo = await stat(filePath);
      if (fileInfo.size > MAX_BYTES) {
        process.stderr.write(`error: file too large (${fileInfo.size} bytes): '${filePath}'\n`);
        return { exitCode: 2 };
      }
      source = await readFile(filePath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error reading '${filePath}': ${msg}\n`);
      return { exitCode: 2 };
    }

    const rootDir = parsed.batch ? resolve(parsed.path) : dirname(filePath);
    const moduleName = deriveModuleName(filePath, rootDir);

    const result = await runPipeline(source, {
      plugin,
      patterns,
      ...(llmFallback !== undefined ? { llmFallback } : {}),
      moduleName,
      version: '0.0.0',
    });

    if (result.errors.length > 0) {
      anyError = true;
      for (const e of result.errors) {
        process.stderr.write(`warn [${filePath}]: ${e.message}\n`);
      }
    }

    if (!parsed.dryRun) {
      const outputPath = deriveOutputPath(filePath);
      const encoded = encodeModule(result.module);
      try {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, encoded, 'utf-8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error writing '${outputPath}': ${msg}\n`);
        return { exitCode: 2 };
      }
    }

    allStats.push(result.stats);
  }

  if (parsed.report) {
    process.stdout.write(JSON.stringify(buildReport(allStats), null, 2) + '\n');
  }

  return { exitCode: anyError ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Binary entry point — only executes when this file is run directly
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runIngest(process.argv.slice(2))
    .then(({ exitCode }) => { process.exit(exitCode); })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`fatal: ${msg}\n`);
      process.exit(2);
    });
}
