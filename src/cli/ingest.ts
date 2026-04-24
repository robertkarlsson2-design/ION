import { readFile, writeFile, mkdir, stat, glob } from 'node:fs/promises';
import { resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../ingest/pipeline.js';
import { loadPatterns } from '../ingest/patterns.js';
import { AnthropicLLMFallbackHandler } from '../ingest/llm-fallback.js';
import type {
  CSTNode,
  IngestError,
  IngestPlugin,
  LayerStats,
  LLMFallbackHandler,
  PatternMatcher,
} from '../ingest/types.js';
import { encodeModule } from '../wire/encoder.js';
import { parseJavaScript } from '../../skills/javascript/parser.js';

export interface RunResult {
  exitCode: number;
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

export interface IngestFileResult {
  inputPath: string;
  outputPath: string;
  stats: LayerStats;
  errors: readonly IngestError[];
  skipped: boolean;
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
 * Parse CLI arguments for `ion ingest`.
 * Returns ParsedArgs on success, { error } on validation failure.
 */
export function parseArgs(args: string[]): ParsedArgs | { error: string } {
  let path: string | undefined;
  let skill: string | undefined;
  let batch = false;
  let dryRun = false;
  let report = false;
  let noLlm = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--skill') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { error: '--skill requires a value' };
      }
      skill = next;
      i++;
    } else if (arg === '--batch') {
      batch = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--report') {
      report = true;
    } else if (arg === '--no-llm') {
      noLlm = true;
    } else if (arg.startsWith('--')) {
      return { error: `unknown flag: ${arg}` };
    } else {
      if (path !== undefined) {
        return { error: 'unexpected positional argument' };
      }
      path = arg;
    }
  }

  if (path === undefined) {
    return { error: 'missing required positional argument: path' };
  }
  if (skill === undefined) {
    return { error: 'missing required flag: --skill' };
  }

  return { path, skill, batch, dryRun, report, noLlm };
}

// ---------------------------------------------------------------------------
// Skill validation and resolution
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

/** Returns absolute path to skills/<name> relative to this file's location. */
export function resolveSkillDir(skillName: string): string {
  return fileURLToPath(new URL(`../../../skills/${skillName}`, import.meta.url));
}

/**
 * Maps a skill name to its IngestPlugin.
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
// File collection
// ---------------------------------------------------------------------------

/**
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

// ---------------------------------------------------------------------------
// Module name derivation
// ---------------------------------------------------------------------------

/**
 * Converts a file path to a dotted module name.
 * Strips leading ./, removes the extension, and replaces / and \ with dots.
 */
export function deriveModuleName(filePath: string): string {
  let name = filePath.replace(/^\.[\\/]/, '');
  const ext = extname(name);
  if (ext.length > 0) {
    name = name.slice(0, -ext.length);
  }
  return name.replace(/[/\\]/g, '.');
}

// ---------------------------------------------------------------------------
// Single file ingestion
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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Run `ion ingest` from parsed CLI args. Returns { exitCode: 0 | 1 | 2 }. */
export async function runIngest(args: string[]): Promise<RunResult> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    process.stderr.write(`error: ${parsed.error}\n${USAGE}`);
    return { exitCode: 2 };
  }

  const skillValidation = validateSkillName(parsed.skill);
  if (typeof skillValidation !== 'string') {
    process.stderr.write(`error: ${skillValidation.error}\n${USAGE}`);
    return { exitCode: 2 };
  }

  const pluginResult = resolvePlugin(parsed.skill);
  if ('error' in pluginResult) {
    process.stderr.write(`error: ${pluginResult.error}\n${USAGE}`);
    return { exitCode: 2 };
  }

  const skillDir = resolveSkillDir(parsed.skill);
  const patterns = await loadPatterns(skillDir);
  const llmFallback = parsed.noLlm ? undefined : new AnthropicLLMFallbackHandler();

  const files = await collectSourceFiles(parsed.path, parsed.batch);
  const results = await Promise.all(
    files.map(f => ingestSingleFile(f, pluginResult, patterns, llmFallback, parsed.dryRun)),
  );

  if (parsed.report) {
    process.stdout.write(formatReport(results) + '\n');
  } else {
    const errorCount = results.reduce((n, r) => n + r.errors.length, 0);
    const skipped = results.filter(r => r.skipped).length;
    const ingested = results.length - skipped;
    process.stdout.write(
      `${ingested} file(s) ingested, ${errorCount} error(s)` +
      (skipped > 0 ? `, ${skipped} skipped` : '') + '\n',
    );
  }

  const hasErrors = results.some(r => r.errors.length > 0);
  return { exitCode: hasErrors ? 1 : 0 };
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
