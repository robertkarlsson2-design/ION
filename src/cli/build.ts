import { readFile, writeFile, mkdir, glob } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lex } from '../lexer/index.js';
import { parseModule, ParseError } from '../parser/declarations.js';
import { buildModule } from '../ast/builder.js';
import { bindModule } from '../binder/index.js';
import type { BindError } from '../binder/index.js';
import { checkModule } from '../checker/index.js';
import type { CheckError } from '../checker/index.js';
import { desugarModule } from '../desugar/index.js';
import { emitJS } from '../../skills/javascript/emit.js';
import { loadConfig } from './config.js';
import type { IonConfig } from './config.js';
import { generateSourceMap } from '../emit/sourcemap.js';
import type { Span } from '../types.js';
import type { IonIRModule } from '../ir/nodes.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunResult {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ParsedArgs {
  configFile: string;
  targetOverride: string | null;
  watchMode: boolean;
  noSourcemap: boolean;
  json: boolean;
}

interface BuildDiagnostic {
  file: string;
  code: string;
  message: string;
  span: Span;
  suggestion: string | null;
}

interface JsonOutput {
  fileCount: number;
  errorCount: number;
  errors: {
    file: string;
    code: string;
    message: string;
    span: {
      file: string;
      startLine: number;
      startCol: number;
      endLine: number;
      endCol: number;
    };
    suggestion: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Target extension map
// ---------------------------------------------------------------------------

const TARGET_EXT: Record<string, string> = {
  javascript: '.js',
  typescript: '.ts',
};

type EmitFn = (module: IonIRModule) => string;

function getEmitter(target: string): EmitFn | null {
  if (target === 'javascript') return emitJS;
  return null;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  let configFile = 'ion.config.json';
  let targetOverride: string | null = null;
  let watchMode = false;
  let noSourcemap = false;
  let json = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--watch') {
      watchMode = true;
    } else if (arg === '--no-sourcemap') {
      noSourcemap = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--config') {
      i++;
      const val = args[i];
      if (val === undefined) return { error: '--config requires a path argument' };
      configFile = val;
    } else if (arg === '--target') {
      i++;
      const val = args[i];
      if (val === undefined) return { error: '--target requires a language argument' };
      targetOverride = val;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      return { error: `unexpected positional argument: ${arg}` };
    } else if (arg !== undefined) {
      return { error: `unknown flag: ${arg}` };
    }
    i++;
  }

  return { configFile, targetOverride, watchMode, noSourcemap, json };
}

// ---------------------------------------------------------------------------
// Output path computation
// ---------------------------------------------------------------------------

/**
 * Compute the output file path for a compiled .ion file.
 * Strips rootDir prefix, replaces the .ion extension with ext, and joins with outDir.
 */
export function resolveOutputPath(
  ionPath: string,
  rootDir: string,
  outDir: string,
  ext: string,
): string {
  const rel = relative(rootDir, ionPath);
  const withExt = rel.replace(/\.ion$/, ext);
  return join(outDir, withExt);
}

// ---------------------------------------------------------------------------
// Glob pattern matching
// ---------------------------------------------------------------------------

function globMatchesPattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  // Escape regex special chars, leaving * and ? untouched
  let r = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // **/ at the start or middle matches any path prefix including empty
  r = r.replace(/\*\*\//g, '\x00');
  // remaining ** matches anything
  r = r.replace(/\*\*/g, '.*');
  // single * matches within one path component
  r = r.replace(/\*/g, '[^/]*');
  // restore **/ as optional path prefix
  r = r.replace(/\x00/g, '(.*/)?');
  return new RegExp('^' + r + '$').test(normalized);
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

async function collectIonFiles(
  rootDir: string,
  includePatterns: string[],
  excludePatterns: string[],
): Promise<string[]> {
  const seen = new Set<string>();
  const files: string[] = [];

  for (const pattern of includePatterns) {
    for await (const rel of glob(pattern, { cwd: rootDir })) {
      const abs = resolve(rootDir, rel);
      if (seen.has(abs)) continue;
      seen.add(abs);
      const relNorm = rel.replace(/\\/g, '/');
      if (!excludePatterns.some(ex => globMatchesPattern(relNorm, ex))) {
        files.push(abs);
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapBindError(e: BindError, filePath: string): BuildDiagnostic {
  switch (e.kind) {
    case 'UndefinedName':
      return {
        file: filePath,
        code: 'BD003',
        message: e.message,
        span: e.span,
        suggestion: 'check the spelling or add a declaration',
      };
    case 'DuplicateBinding':
      return {
        file: filePath,
        code: 'BD003',
        message: e.message,
        span: e.span,
        suggestion: 'rename one of the conflicting bindings',
      };
    case 'CircularImport':
      return {
        file: filePath,
        code: 'BD003',
        message: e.message,
        span: e.span,
        suggestion: 'break the import cycle by extracting shared code into a common module',
      };
  }
}

function mapCheckError(e: CheckError): BuildDiagnostic {
  return {
    file: e.span.file,
    code: 'BD004',
    message: e.message,
    span: e.span,
    suggestion: e.suggestion,
  };
}

// ---------------------------------------------------------------------------
// Per-file compilation
// ---------------------------------------------------------------------------

interface CompileFileResult {
  outputPath: string;
  diagnostics: BuildDiagnostic[];
}

async function compileFile(
  ionPath: string,
  rootDir: string,
  outDir: string,
  emitter: EmitFn,
  target: string,
  noSourcemap: boolean,
): Promise<CompileFileResult> {
  const ext = TARGET_EXT[target] ?? '.js';
  const outputPath = resolveOutputPath(ionPath, rootDir, outDir, ext);

  let src: string;
  try {
    src = await readFile(ionPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outputPath,
      diagnostics: [{
        file: ionPath,
        code: 'BD001',
        message: `cannot read file: ${msg}`,
        span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: null,
      }],
    };
  }

  const tokens = lex(src, ionPath);

  let cst;
  try {
    cst = parseModule(tokens);
  } catch (err) {
    if (err instanceof ParseError) {
      return {
        outputPath,
        diagnostics: [{
          file: ionPath,
          code: 'BD002',
          message: err.message,
          span: err.span,
          suggestion: err.suggestion,
        }],
      };
    }
    throw err;
  }

  const ast = buildModule(cst);
  const bindResult = bindModule(ast, ionPath);
  const diagnostics: BuildDiagnostic[] = bindResult.errors.map(e => mapBindError(e, ionPath));

  const checkResult = checkModule(ast, bindResult, ionPath);
  for (const e of checkResult.errors) {
    diagnostics.push(mapCheckError(e));
  }

  if (diagnostics.length > 0) {
    return { outputPath, diagnostics };
  }

  let emitted: string;
  try {
    const ir = desugarModule(ast, bindResult, checkResult, ionPath, '0.0.0');
    emitted = emitter(ir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outputPath,
      diagnostics: [{
        file: ionPath,
        code: 'BD005',
        message: `emit error: ${msg}`,
        span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: null,
      }],
    };
  }

  await mkdir(dirname(outputPath), { recursive: true });

  if (!noSourcemap) {
    const mapName = basename(outputPath) + '.map';
    const mapContent = generateSourceMap({
      sourceFile: ionPath,
      outputFile: outputPath,
      sourceContent: src,
    });
    await writeFile(outputPath + '.map', mapContent, 'utf-8');
    emitted += `\n//# sourceMappingURL=${mapName}`;
  }

  await writeFile(outputPath, emitted, 'utf-8');
  return { outputPath, diagnostics: [] };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatHuman(diags: BuildDiagnostic[]): string {
  const lines: string[] = [];
  for (const d of diags) {
    const loc = `${d.span.file}:${d.span.startLine}:${d.span.startCol}`;
    lines.push(`error[${d.code}]: ${d.message} at ${loc}`);
    if (d.suggestion !== null) {
      lines.push(`  suggestion: ${d.suggestion}`);
    }
  }
  return lines.join('\n');
}

function formatJson(fileCount: number, diags: BuildDiagnostic[]): string {
  const output: JsonOutput = {
    fileCount,
    errorCount: diags.length,
    errors: diags.map(d => ({
      file: d.file,
      code: d.code,
      message: d.message,
      span: {
        file: d.span.file,
        startLine: d.span.startLine,
        startCol: d.span.startCol,
        endLine: d.span.endLine,
        endCol: d.span.endCol,
      },
      suggestion: d.suggestion,
    })),
  };
  return JSON.stringify(output, null, 2);
}

// ---------------------------------------------------------------------------
// Build execution
// ---------------------------------------------------------------------------

async function runBuildOnce(
  config: IonConfig,
  resolvedRootDir: string,
  resolvedOutDir: string,
  emitter: EmitFn,
  target: string,
  noSourcemap: boolean,
  json: boolean,
): Promise<{ fileCount: number; diagnostics: BuildDiagnostic[] }> {
  const includePatterns = config.include ?? ['**/*.ion'];
  const excludePatterns = config.exclude ?? ['**/*.test.ion'];

  let ionFiles: string[];
  try {
    ionFiles = await collectIonFiles(resolvedRootDir, includePatterns, excludePatterns);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      fileCount: 0,
      diagnostics: [{
        file: resolvedRootDir,
        code: 'BD001',
        message: `failed to enumerate .ion files: ${msg}`,
        span: { file: resolvedRootDir, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: null,
      }],
    };
  }

  if (ionFiles.length === 0) {
    if (!json) {
      process.stdout.write('warning: no .ion files found\n');
    }
    return { fileCount: 0, diagnostics: [] };
  }

  const results = await Promise.all(
    ionFiles.map(f => compileFile(f, resolvedRootDir, resolvedOutDir, emitter, target, noSourcemap)),
  );

  const allDiags = results.flatMap(r => r.diagnostics);

  if (!json) {
    const errCount = allDiags.length;
    const okCount = ionFiles.length - results.filter(r => r.diagnostics.length > 0).length;
    if (errCount > 0) {
      process.stdout.write(formatHuman(allDiags) + '\n');
    }
    process.stdout.write(`${okCount} file(s) compiled, ${errCount} error(s)\n`);
  } else {
    process.stdout.write(formatJson(ionFiles.length, allDiags) + '\n');
  }

  return { fileCount: ionFiles.length, diagnostics: allDiags };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const USAGE = 'usage: ion build [--config <path>] [--target <lang>] [--watch] [--no-sourcemap] [--json]\n';

/**
 * Runs the `ion build` command.
 * Returns { exitCode } where 0 = success, 1 = compile errors, 2 = config/arg error.
 * In watch mode, the returned promise never resolves (process stays alive until killed).
 */
export async function runBuild(args: string[]): Promise<RunResult> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.stderr.write(USAGE);
    return { exitCode: 2 };
  }

  const configPath = resolve(parsed.configFile);
  const config = await loadConfig(configPath);
  if ('error' in config) {
    process.stderr.write(`error: ${config.error}\n`);
    return { exitCode: 2 };
  }

  const target = parsed.targetOverride ?? config.target;
  const emitter = getEmitter(target);
  if (emitter === null) {
    process.stderr.write(`error: unsupported target: ${target}\n`);
    process.stderr.write('supported targets: javascript\n');
    return { exitCode: 2 };
  }

  const configDir = dirname(configPath);
  const resolvedRootDir = resolve(configDir, config.rootDir);
  const resolvedOutDir = resolve(configDir, config.outDir);

  if (!parsed.watchMode) {
    const { diagnostics } = await runBuildOnce(
      config,
      resolvedRootDir,
      resolvedOutDir,
      emitter,
      target,
      parsed.noSourcemap,
      parsed.json,
    );
    return { exitCode: diagnostics.length > 0 ? 1 : 0 };
  }

  // Watch mode: initial build then watch for changes
  await runBuildOnce(config, resolvedRootDir, resolvedOutDir, emitter, target, parsed.noSourcemap, false);

  // Return a promise that keeps the process alive via the fs.Watch handle
  return new Promise(() => {
    const watcher = watch(resolvedRootDir, { recursive: true }, (eventType, filename) => {
      if (typeof filename !== 'string') return;
      if (!filename.endsWith('.ion')) return;

      const ionPath = resolve(resolvedRootDir, filename);
      compileFile(ionPath, resolvedRootDir, resolvedOutDir, emitter, target, parsed.noSourcemap)
        .then(result => {
          if (result.diagnostics.length > 0) {
            process.stdout.write(`[watch] error in ${ionPath}\n`);
            process.stdout.write(formatHuman(result.diagnostics) + '\n');
          } else {
            process.stdout.write(`[watch] rebuilt ${ionPath}\n`);
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[watch] fatal error rebuilding ${ionPath}: ${msg}\n`);
        });
    });
    // Keep the watcher referenced so the process stays alive
    watcher.ref();
  });
}

// ---------------------------------------------------------------------------
// Binary entry point — only executes when this file is run directly
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runBuild(process.argv.slice(2))
    .then(({ exitCode }) => { process.exit(exitCode); })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`fatal: ${msg}\n`);
      process.exit(2);
    });
}
