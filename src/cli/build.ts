import { readFile, writeFile, mkdir, stat, glob } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { lex } from '../lexer/index.js';
import { parseModule, ParseError } from '../parser/declarations.js';
import { buildModule } from '../ast/builder.js';
import { bindModule } from '../binder/index.js';
import type { BindError } from '../binder/index.js';
import { checkModule } from '../checker/index.js';
import type { CheckError } from '../checker/index.js';
import { desugarModule } from '../desugar/index.js';
import { emitJS, emitJSWithSourceMap } from '../../skills/javascript/emit.js';
import type { Span } from '../types.js';

const MAX_FILE_SIZE = 64 * 1024 * 1024;
const SUPPORTED_TARGETS = ['javascript'] as const;
type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunResult {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface IonConfig {
  target: SupportedTarget;
  sources: string[];
  outDir: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  configPath: string;
  target: string | null;
  watch: boolean;
  noSourcemap: boolean;
}

/** Parse CLI args for `ion build`. Returns { error } on invalid input. */
export function parseArgs(args: string[]): ParsedArgs | { error: string } {
  let target: string | null = null;
  let watchMode = false;
  let noSourcemap = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--watch') {
      watchMode = true;
    } else if (arg === '--no-sourcemap') {
      noSourcemap = true;
    } else if (arg === '--target') {
      i++;
      const next = args[i];
      if (next === undefined || next.startsWith('--')) {
        return { error: '--target requires a value' };
      }
      target = next;
    } else if (arg !== undefined && arg.startsWith('--')) {
      return { error: `unknown flag: ${arg}` };
    } else if (arg !== undefined) {
      return { error: 'ion build takes no positional arguments' };
    }
    i++;
  }

  return {
    configPath: resolve(process.cwd(), 'ion.config.json'),
    target,
    watch: watchMode,
    noSourcemap,
  };
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function isSupportedTarget(t: string): t is SupportedTarget {
  return (SUPPORTED_TARGETS as readonly string[]).includes(t);
}

/**
 * Read and validate ion.config.json, applying targetOverride if provided.
 * Returns { error } if the file is missing, malformed, or has an unsupported target.
 */
export async function loadConfig(
  configPath: string,
  targetOverride: string | null,
): Promise<IonConfig | { error: string }> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `cannot read ion.config.json: ${msg}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `invalid JSON in ion.config.json: ${msg}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'ion.config.json must be a JSON object' };
  }

  const obj = parsed as Record<string, unknown>;

  const rawTarget = targetOverride ?? obj['target'];
  if (typeof rawTarget !== 'string') {
    return { error: 'ion.config.json: "target" field is required and must be a string' };
  }
  if (!isSupportedTarget(rawTarget)) {
    return {
      error: `ion.config.json: unsupported target "${rawTarget}". Supported targets: ${SUPPORTED_TARGETS.join(', ')}`,
    };
  }

  const sources: string[] = [];
  if (obj['sources'] === undefined) {
    sources.push('**/*.ion');
  } else if (Array.isArray(obj['sources'])) {
    for (const s of obj['sources']) {
      if (typeof s !== 'string') {
        return { error: 'ion.config.json: "sources" must be an array of strings' };
      }
      sources.push(s);
    }
  } else {
    return { error: 'ion.config.json: "sources" must be an array of strings' };
  }

  let outDir = 'out';
  if (obj['outDir'] !== undefined) {
    if (typeof obj['outDir'] !== 'string') {
      return { error: 'ion.config.json: "outDir" must be a string' };
    }
    outDir = obj['outDir'];
  }

  let version = '0.0.0';
  if (obj['version'] !== undefined) {
    if (typeof obj['version'] !== 'string') {
      return { error: 'ion.config.json: "version" must be a string' };
    }
    version = obj['version'];
  }

  return { target: rawTarget, sources, outDir, version };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Expand source glob patterns (relative to configDir) into absolute file paths.
 * Deduplicates results in case patterns overlap.
 */
export async function collectIonFiles(
  config: IonConfig,
  configDir: string,
): Promise<string[] | { error: string }> {
  const found: string[] = [];
  try {
    for (const pattern of config.sources) {
      for await (const file of glob(pattern, { cwd: configDir })) {
        found.push(resolve(configDir, file));
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `failed to enumerate .ion files: ${msg}` };
  }
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

interface Diagnostic {
  file: string;
  code: string;
  message: string;
  span: Span;
  suggestion: string | null;
}

function mapBindError(e: BindError, filePath: string): Diagnostic {
  switch (e.kind) {
    case 'UndefinedName':
      return {
        file: filePath,
        code: 'B0001',
        message: e.message,
        span: e.span,
        suggestion: 'check the spelling or add a declaration',
      };
    case 'DuplicateBinding':
      return {
        file: filePath,
        code: 'B0002',
        message: e.message,
        span: e.span,
        suggestion: 'rename one of the conflicting bindings',
      };
    case 'CircularImport':
      return {
        file: filePath,
        code: 'B0003',
        message: e.message,
        span: e.span,
        suggestion: 'break the import cycle by extracting shared code into a common module',
      };
  }
}

function mapCheckError(e: CheckError): Diagnostic {
  return {
    file: e.span.file,
    code: e.code,
    message: e.message,
    span: e.span,
    suggestion: e.suggestion,
  };
}

// ---------------------------------------------------------------------------
// Per-file compile result types
// ---------------------------------------------------------------------------

export interface CompileSuccess {
  inputPath: string;
  outputPath: string;
  mapPath: string | null;
}

export interface CompileDiagnostics {
  inputPath: string;
  diagnostics: Diagnostic[];
}

export interface CompileIoError {
  inputPath: string;
  ioError: string;
}

export type CompileResult = CompileSuccess | CompileDiagnostics | CompileIoError;

// ---------------------------------------------------------------------------
// Per-file compilation pipeline
// ---------------------------------------------------------------------------

/**
 * Lex → parse → bind → check → desugar → emit a single .ion file.
 * Writes .js (and optionally .js.map) to configDir/outDir/.
 */
export async function compileFile(
  inputPath: string,
  config: IonConfig,
  configDir: string,
  noSourcemap: boolean,
): Promise<CompileResult> {
  try {
    const { size } = await stat(inputPath);
    if (size > MAX_FILE_SIZE) {
      return {
        inputPath,
        ioError: `file too large: '${inputPath}' (${size} bytes, limit ${MAX_FILE_SIZE})`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { inputPath, ioError: `cannot read file '${inputPath}': ${msg}` };
  }

  let src: string;
  try {
    src = await readFile(inputPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { inputPath, ioError: `cannot read file '${inputPath}': ${msg}` };
  }

  const tokens = lex(src, inputPath);

  let jsSource: string;
  let mapSource: string | null = null;

  // Relative path from configDir (forward slashes, no .ion extension) used as module path
  const relPath = relative(configDir, inputPath);
  const modulePath = relPath.replace(/\.ion$/, '').replace(/\\/g, '/');

  try {
    const cst = parseModule(tokens);
    const ast = buildModule(cst);

    const bindResult = bindModule(ast, inputPath);
    const bindDiags = bindResult.errors.map(e => mapBindError(e, inputPath));
    const checkResult = checkModule(ast, bindResult, inputPath);
    const checkDiags = checkResult.errors.map(mapCheckError);

    const allDiags = [...bindDiags, ...checkDiags];
    if (allDiags.length > 0) {
      return { inputPath, diagnostics: allDiags };
    }

    const irModule = desugarModule(
      ast,
      bindResult,
      checkResult,
      modulePath,
      config.version,
    );

    if (!noSourcemap) {
      const result = emitJSWithSourceMap(irModule, inputPath, src);
      jsSource = result.source;
      mapSource = result.map;
    } else {
      jsSource = emitJS(irModule);
    }
  } catch (err) {
    if (err instanceof ParseError) {
      return {
        inputPath,
        diagnostics: [{
          file: inputPath,
          code: err.code,
          message: err.message,
          span: err.span,
          suggestion: err.suggestion,
        }],
      };
    }
    throw err;
  }

  // Compute output path: configDir/outDir/rel-path-with-.js
  const outputRelPath = relPath.replace(/\.ion$/, '.js');
  const outputPath = join(configDir, config.outDir, outputRelPath);

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, jsSource, 'utf-8');

    let mapPath: string | null = null;
    if (mapSource !== null) {
      mapPath = outputPath + '.map';
      await writeFile(mapPath, mapSource, 'utf-8');
    }

    return { inputPath, outputPath, mapPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { inputPath, ioError: `failed to write output '${outputPath}': ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Parallel build
// ---------------------------------------------------------------------------

function printDiagnostic(d: Diagnostic): void {
  const loc = `${d.span.file}:${d.span.startLine}:${d.span.startCol}`;
  process.stdout.write(`error[${d.code}]: ${d.message} at ${loc}\n`);
  if (d.suggestion !== null) {
    process.stdout.write(`  suggestion: ${d.suggestion}\n`);
  }
}

/**
 * Compile all files in parallel. Prints results to stdout/stderr.
 * Returns { hadErrors: true } if any file failed.
 */
export async function buildOnce(
  files: string[],
  config: IonConfig,
  configDir: string,
  noSourcemap: boolean,
): Promise<{ hadErrors: boolean }> {
  const results = await Promise.all(
    files.map(f => compileFile(f, config, configDir, noSourcemap)),
  );

  let hadErrors = false;

  for (const result of results) {
    if ('ioError' in result) {
      process.stderr.write(`error: ${result.ioError}\n`);
      hadErrors = true;
    } else if ('diagnostics' in result) {
      for (const d of result.diagnostics) {
        printDiagnostic(d);
      }
      hadErrors = true;
    } else {
      const relInput = relative(configDir, result.inputPath);
      const relOutput = relative(configDir, result.outputPath);
      process.stdout.write(`✓ ${relInput} → ${relOutput}\n`);
    }
  }

  if (hadErrors) {
    const errorCount = results.filter(r => 'diagnostics' in r || 'ioError' in r).length;
    process.stdout.write(`Build failed: ${errorCount} file(s) with errors\n`);
  }

  return { hadErrors };
}

// ---------------------------------------------------------------------------
// Watch mode
// ---------------------------------------------------------------------------

/**
 * Run an initial build, then watch configDir for changes and rebuild incrementally.
 * Debounces file-system events in a 50 ms window.
 * Never resolves — the process exits via signal or watcher error.
 *
 * Note: Node's fs.watch recursive mode has known reliability issues on Linux;
 * this is the same trade-off made by tsc --watch.
 */
export async function watchBuild(
  configDir: string,
  initialConfig: IonConfig,
  noSourcemap: boolean,
): Promise<never> {
  let currentConfig = initialConfig;

  const initFiles = await collectIonFiles(currentConfig, configDir);
  if ('error' in initFiles) {
    process.stderr.write(`error: ${initFiles.error}\n`);
    process.exit(2);
  }
  let currentFiles: string[] = initFiles;

  await buildOnce(currentFiles, currentConfig, configDir, noSourcemap);
  process.stdout.write('[watch] watching for changes...\n');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingFiles = new Set<string>();
  let pendingConfigReload = false;

  const watcher = fsWatch(
    configDir,
    { recursive: true },
    (eventType, filename: string | Buffer | null) => {
      if (filename === null || filename === undefined) return;
      const name = typeof filename === 'string' ? filename : filename.toString('utf-8');

      if (name === 'ion.config.json') {
        pendingConfigReload = true;
      } else if (name.endsWith('.ion')) {
        pendingFiles.add(resolve(configDir, name));
      } else {
        return;
      }

      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;

        if (pendingConfigReload) {
          pendingConfigReload = false;
          pendingFiles.clear();
          void (async () => {
            const configPath = resolve(configDir, 'ion.config.json');
            const reloaded = await loadConfig(configPath, null);
            if ('error' in reloaded) {
              process.stderr.write(`[watch] config error: ${reloaded.error}\n`);
              return;
            }
            currentConfig = reloaded;
            const files = await collectIonFiles(currentConfig, configDir);
            if ('error' in files) {
              process.stderr.write(`[watch] ${files.error}\n`);
              return;
            }
            currentFiles = files;
            process.stdout.write('[watch] config reloaded, rebuilding all...\n');
            await buildOnce(currentFiles, currentConfig, configDir, noSourcemap);
          })();
        } else if (pendingFiles.size > 0) {
          const toRebuild = [...pendingFiles];
          pendingFiles.clear();
          void (async () => {
            for (const f of toRebuild) {
              process.stdout.write(`[watch] rebuilding ${relative(configDir, f)}...\n`);
              const result = await compileFile(f, currentConfig, configDir, noSourcemap);
              if ('ioError' in result) {
                process.stderr.write(`[watch] error: ${result.ioError}\n`);
              } else if ('diagnostics' in result) {
                process.stdout.write(
                  `[watch] errors in ${relative(configDir, result.inputPath)}\n`,
                );
                for (const d of result.diagnostics) {
                  printDiagnostic(d);
                }
              } else {
                const relIn = relative(configDir, result.inputPath);
                const relOut = relative(configDir, result.outputPath);
                process.stdout.write(`[watch] rebuilt ${relIn} → ${relOut}\n`);
              }
            }
          })();
        }
      }, 50);
    },
  );

  watcher.on('error', (err: Error) => {
    process.stderr.write(`[watch] watcher error: ${err.message}\n`);
    process.exit(2);
  });

  return new Promise<never>(() => {
    // Intentionally never resolves; process exits via signal or watcher error
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const USAGE = 'usage: ion build [--target <lang>] [--watch] [--no-sourcemap]\n';

/**
 * Runs the `ion build` command.
 * Returns { exitCode } where 0 = success, 1 = compile errors, 2 = config/I-O error.
 */
export async function runBuild(args: string[]): Promise<RunResult> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.stderr.write(USAGE);
    return { exitCode: 2 };
  }

  const configDir = dirname(parsed.configPath);
  const config = await loadConfig(parsed.configPath, parsed.target);
  if ('error' in config) {
    process.stderr.write(`error: ${config.error}\n`);
    return { exitCode: 2 };
  }

  const files = await collectIonFiles(config, configDir);
  if ('error' in files) {
    process.stderr.write(`error: ${files.error}\n`);
    return { exitCode: 2 };
  }

  if (files.length === 0) {
    process.stdout.write('warning: no .ion files found\n');
    return { exitCode: 0 };
  }

  if (parsed.watch) {
    await watchBuild(configDir, config, parsed.noSourcemap);
    // unreachable: watchBuild returns Promise<never>
  }

  const { hadErrors } = await buildOnce(files, config, configDir, parsed.noSourcemap);
  return { exitCode: hadErrors ? 1 : 0 };
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
