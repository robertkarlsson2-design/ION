import { readFile, writeFile, mkdir, stat, glob } from 'node:fs/promises';
import { resolve, relative, dirname, extname, join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import type {
  CSTNode,
  IngestError,
  IngestPlugin,
  PatternMatcher,
  LLMFallbackHandler,
  LayerStats,
} from '../ingest/types.js';
import { loadPatterns } from '../ingest/patterns.js';
import { runPipeline } from '../ingest/pipeline.js';
import { AnthropicLLMFallbackHandler } from '../ingest/llm-fallback.js';
import { encodeModule } from '../wire/encoder.js';
import { parseJavaScript } from '../../skills/javascript/parser.js';

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

export interface IngestFileResult {
  inputPath: string;
  outputPath: string;
  stats: LayerStats;
  errors: readonly IngestError[];
  skipped: boolean;
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

interface JsonReport {
  files: number;
  errorCount: number;
  stats: { pattern: number; llm: number; unhandled: number };
  errors: Array<{ file: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024; // 10 MB

const USAGE = 'usage: ion ingest <path> --skill <name> [--batch] [--dry-run] [--report] [--no-llm]\n';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

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
    return { error: 'missing required positional argument: path' };
  }

  return { path, skill, batch, dryRun, report, noLlm };
}

// ---------------------------------------------------------------------------
// Skill validation and sync resolution (exported for direct testing)
// ---------------------------------------------------------------------------

/**
 * Rejects skill names containing path separators or '..' to prevent traversal.
 * Returns the name on success, { error } on rejection.
 */
export function validateSkillName(name: string): string | { error: string } {
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return { error: `invalid skill name (path traversal): ${name}` };
  }
  return name;
}

/**
 * Maps a skill name to its IngestPlugin synchronously (static dispatch).
 * Returns { error } for unsupported skill names.
 */
export function resolvePlugin(skillName: string): IngestPlugin | { error: string } {
  if (skillName === 'javascript') {
    return {
      language: 'javascript',
      parse: (source: string) => parseJavaScript(source).root,
    };
  }
  return { error: `unsupported skill: ${skillName}` };
}

// ---------------------------------------------------------------------------
// Async skill resolution (used by runIngest)
// ---------------------------------------------------------------------------

/**
 * Locate the skill plugin directory.
 * Tries `skills/<name>/` relative to CWD first, then relative to the CLI binary.
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

/** Resolve the absolute path to skills/<name> relative to this file. */
export function resolveSkillDirSync(skillName: string): string {
  return fileURLToPath(new URL(`../../../skills/${skillName}`, import.meta.url));
}

async function buildJsPlugin(skillDir: string): Promise<IngestPlugin | { error: string }> {
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
      const mod = await import(parserUrl) as unknown;
      const parseJsRaw = (mod as Record<string, unknown>)['parseJavaScript'];
      if (typeof parseJsRaw !== 'function') continue;
      const parseJs = parseJsRaw as (source: string) => { root: unknown };

      return {
        language: 'javascript',
        parse(source: string): CSTNode {
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

/**
 * Exported collection helper (glob-pattern based).
 * Single mode: returns [resolve(pathArg)].
 * Batch mode: expands pathArg as a glob relative to process.cwd().
 */
export async function collectSourceFiles(
  pathArg: string,
  batch: boolean,
): Promise<string[]> {
  if (!batch) {
    return [resolve(pathArg)];
  }
  const matches: string[] = [];
  for await (const f of glob(pathArg, { cwd: process.cwd() })) {
    matches.push(resolve(f));
  }
  return matches;
}

function extensionsForSkill(skillName: string): string[] {
  if (skillName === 'javascript') {
    return ['.js', '.mjs', '.cjs'];
  }
  return [];
}

/**
 * Internal collection for runIngest.
 * Batch mode: inputPath must be a directory; globs recursively for skill extensions.
 * Single mode: inputPath must be an existing file.
 */
async function collectFilesForRun(
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
// Module name derivation
// ---------------------------------------------------------------------------

/**
 * Converts a file path to a dotted module name.
 * With root: strips root prefix and converts `-` to `_` (e.g. `src/utils/foo-bar.js`, `src` → `utils.foo_bar`).
 * Without root: strips leading `./`, removes extension, replaces `/` and `\` with dots.
 */
export function deriveModuleName(filePath: string, root?: string): string {
  if (root !== undefined) {
    const rel = relative(resolve(root), resolve(filePath));
    const withoutExt = rel.slice(0, rel.length - extname(rel).length);
    return withoutExt
      .split('/')
      .join('.')
      .replace(/-/g, '_');
  }
  let name = filePath.replace(/^\.[\\/]/, '');
  const ext = extname(name);
  if (ext.length > 0) {
    name = name.slice(0, -ext.length);
  }
  return name.replace(/[/\\]/g, '.');
}

/** Replace the source file extension with `.ion`, keeping the file in its original directory. */
function deriveOutputPath(inputPath: string): string {
  const dir = dirname(inputPath);
  const base = basename(inputPath, extname(inputPath));
  return join(dir, `${base}.ion`);
}

// ---------------------------------------------------------------------------
// Single file ingestion (exported for direct testing)
// ---------------------------------------------------------------------------

/**
 * Ingest one source file through the pipeline and write wire-format output.
 * @param maxBytes - file size guard (defaults to MAX_SOURCE_BYTES; override in tests)
 */
export async function ingestSingleFile(
  filePath: string,
  plugin: IngestPlugin,
  patterns: PatternMatcher[],
  llmFallback: LLMFallbackHandler | undefined,
  dryRun: boolean,
  maxBytes = MAX_SOURCE_BYTES,
): Promise<IngestFileResult> {
  const ext = extname(filePath);
  const base = ext.length > 0 ? filePath.slice(0, -ext.length) : filePath;
  const outputPath = base + '.ion';
  const emptyStats: LayerStats = { pattern: 0, llm: 0, unhandled: 0 };

  let fileSize: number;
  try {
    const info = await stat(filePath);
    fileSize = info.size;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      inputPath: filePath,
      outputPath,
      stats: emptyStats,
      errors: [{ message, cstNode: makeDummyNode() }],
      skipped: false,
    };
  }

  if (fileSize > maxBytes) {
    return { inputPath: filePath, outputPath, stats: emptyStats, errors: [], skipped: true };
  }

  let source: string;
  try {
    source = await readFile(filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      inputPath: filePath,
      outputPath,
      stats: emptyStats,
      errors: [{ message, cstNode: makeDummyNode() }],
      skipped: false,
    };
  }

  const moduleName = deriveModuleName(relative(process.cwd(), filePath));
  const result = await runPipeline(source, {
    plugin,
    patterns,
    moduleName,
    ...(llmFallback !== undefined ? { llmFallback } : {}),
  });
  const wire = encodeModule(result.module);

  if (!dryRun) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, wire, 'utf-8');
  }

  return {
    inputPath: filePath,
    outputPath,
    stats: result.stats,
    errors: result.errors,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Aggregation and reporting
// ---------------------------------------------------------------------------

/** Sum pattern, llm, unhandled counts across all results. */
export function aggregateStats(results: IngestFileResult[]): LayerStats {
  let pattern = 0;
  let llm = 0;
  let unhandled = 0;
  for (const r of results) {
    pattern += r.stats.pattern;
    llm += r.stats.llm;
    unhandled += r.stats.unhandled;
  }
  return { pattern, llm, unhandled };
}

/** Serialize results as a JSON report string (2-space indent). */
export function formatReport(results: IngestFileResult[]): string {
  const errorItems = results.flatMap(r =>
    r.errors.map(e => ({ file: r.inputPath, message: e.message })),
  );
  const agg = aggregateStats(results);
  const report: JsonReport = {
    files: results.length,
    errorCount: errorItems.length,
    stats: { pattern: agg.pattern, llm: agg.llm, unhandled: agg.unhandled },
    errors: errorItems,
  };
  return JSON.stringify(report, null, 2);
}

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

  // Quick validation: reject unsupported skills before attempting async resolution.
  // This provides a clear "unsupported skill: X" message rather than a directory-not-found error.
  if (overrides?.plugin === undefined) {
    const pluginCheck = resolvePlugin(parsed.skill);
    if ('error' in pluginCheck) {
      process.stderr.write(`error: ${pluginCheck.error}\n`);
      return { exitCode: 2 };
    }
  }

  // Resolve plugin and patterns, skipping skill dir lookup when both are injected.
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

  // Build LLM fallback: use override if provided; otherwise use real handler when API key present.
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

  const files = await collectFilesForRun(parsed.path, parsed);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDummyNode(): CSTNode {
  return {
    type: 'error',
    text: '',
    isNamed: false,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
    children: [],
  };
}
