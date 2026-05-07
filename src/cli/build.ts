import { readFile, writeFile, mkdir, glob } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, resolve, dirname, relative, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lex } from '../lexer/index.js';
import { parseModule, ParseError } from '../parser/declarations.js';
import { buildModule } from '../ast/builder.js';
import { bindModule } from '../binder/index.js';
import type { BindError } from '../binder/index.js';
import { checkModule } from '../checker/index.js';
import type { CheckError } from '../checker/index.js';
import { desugarModule } from '../desugar/index.js';
import { decodeModule } from '../wire/decoder.js';
import { deserializeModule, IonIRSerdeError } from '../ir/serde.js';
import { emitJS } from '../../emitters/javascript/emit.js';
import { emitTS } from '../../emitters/typescript/emit.js';
import { emitTsDts } from '../../emitters/typescript/emit-dts.js';
import { emitPython } from '../../emitters/python/emit.js';
import { emitJava } from '../../emitters/java/emit.js';
import { emitReact } from '../../emitters/react/emit.js';
import { emitHTML } from '../../emitters/html/emit.js';
import { emitVue } from '../../emitters/vue/emit.js';
import { emitApex } from '../../emitters/apex/emit.js';
import { emitLWC } from '../../emitters/lwc/emit.js';
import type { LwcOutput } from '../../emitters/lwc/emit.js';
import { emitReactNative } from '../../emitters/react-native/emit.js';
import { loadConfig } from './config.js';
import type { IonConfig } from './config.js';
import { generateSourceMap } from '../emit/sourcemap.js';
import { getPreludeDecls } from '../prelude/index.js';
import { countTokens } from './tokenizer.js';
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
  noTokenReport: boolean;
}

/** Per-file token measurement (cl100k_base). */
interface TokenStats {
  ion: number;
  out: number;
}

const TARGET_LABEL: Record<string, string> = {
  javascript: 'JS',
  typescript: 'TS',
  'typescript-dts': 'DTS',
  python: 'Py',
  java: 'Java',
  react: 'TSX',
  html: 'HTML',
  vue: 'Vue',
  apex: 'Apex',
  lwc: 'LWC',
  'react-native': 'TSX-RN',
};

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
  tokens?: {
    target: string;
    files: { file: string; ion: number; out: number; saved: number; pct: number }[];
    total: { ion: number; out: number; saved: number; pct: number };
  };
}

// ---------------------------------------------------------------------------
// Target extension map
// ---------------------------------------------------------------------------

const TARGET_EXT: Record<string, string> = {
  javascript: '.js',
  typescript: '.ts',
  'typescript-dts': '.d.ts',
  python: '.py',
  java: '.java',
  react: '.tsx',
  'react-native': '.tsx',
  html: '.html',
  vue: '.vue',
  apex: '.cls',
};

type EmitFn = (module: IonIRModule) => string;
type MultiFileEmitFn = (module: IonIRModule) => LwcOutput;

function getEmitter(target: string): EmitFn | null {
  if (target === 'javascript') return emitJS;
  if (target === 'typescript') return emitTS;
  if (target === 'typescript-dts') return emitTsDts;
  if (target === 'python') return emitPython;
  if (target === 'java') return emitJava;
  if (target === 'react') return emitReact;
  if (target === 'html') return emitHTML;
  if (target === 'vue') return emitVue;
  if (target === 'apex') return emitApex;
  if (target === 'react-native') return emitReactNative;
  return null;
}

/**
 * Multi-file emitter dispatch (parallel to getEmitter).
 *
 * Multi-file emitters (currently only LWC) return a structured object containing
 * multiple files for a single .ion module. The dispatcher in build.ts checks
 * getMultiFileEmitter first; if it returns non-null we route through the
 * multi-file write path, otherwise fall back to getEmitter for the single-file
 * case.
 *
 * LWC emits a 4-file bundle per component (.html, .js, .css, .js-meta.xml)
 * laid out in a directory named after the .ion module's basename, matching
 * Salesforce's expected SFDX layout.
 */
function getMultiFileEmitter(target: string): MultiFileEmitFn | null {
  if (target === 'lwc') return emitLWC;
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
  let noTokenReport = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--watch') {
      watchMode = true;
    } else if (arg === '--no-sourcemap') {
      noSourcemap = true;
    } else if (arg === '--no-token-report') {
      noTokenReport = true;
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

  return { configFile, targetOverride, watchMode, noSourcemap, json, noTokenReport };
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
      if (abs !== rootDir && !abs.startsWith(rootDir + sep)) continue;
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
// Wire / JSON format detection
// ---------------------------------------------------------------------------

function detectInputFormat(src: string): 'source' | 'wire' | 'json' {
  if (src.startsWith('I1\n') || src === 'I1') return 'wire';
  if (src.trimStart().startsWith('{') && src.includes('"ionir":')) return 'json';
  return 'source';
}

function loadIrFromPrecompiled(
  src: string,
  ionPath: string,
): IonIRModule | BuildDiagnostic {
  const fmt = detectInputFormat(src);
  if (fmt === 'wire') {
    const result = decodeModule(src);
    if ('error' in result) {
      return {
        file: ionPath,
        code: 'BD006',
        message: `wire decode error: ${result.error}`,
        span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: 'check that the file is a valid wire-format IonIR module',
      };
    }
    return result;
  }
  // JSON serde path
  try {
    return deserializeModule(src);
  } catch (err) {
    const msg = err instanceof IonIRSerdeError || err instanceof Error ? err.message : String(err);
    return {
      file: ionPath,
      code: 'BD006',
      message: `IR deserialize error: ${msg}`,
      span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
      suggestion: 'check that the file contains a valid IonIR JSON module',
    };
  }
}

// ---------------------------------------------------------------------------
// Per-file compilation
// ---------------------------------------------------------------------------

interface CompileFileResult {
  outputPath: string;
  diagnostics: BuildDiagnostic[];
  /** Token counts (cl100k_base). Absent when compilation failed before emit. */
  tokens?: TokenStats;
}

async function compileFile(
  ionPath: string,
  rootDir: string,
  outDir: string,
  emitter: EmitFn | null,
  multiEmitter: MultiFileEmitFn | null,
  target: string,
  noSourcemap: boolean,
): Promise<CompileFileResult> {
  // Multi-file path (LWC and similar): emit a bundle into a directory named
  // after the .ion module's basename. Source maps are not generated for the
  // multi-file path because the bundle is multi-target (template + script +
  // styles + metadata) and there is no canonical "main" output to map back.
  if (multiEmitter !== null) {
    return compileFileMulti(ionPath, rootDir, outDir, multiEmitter, target);
  }
  if (emitter === null) {
    return {
      outputPath: ionPath,
      diagnostics: [{
        file: ionPath,
        code: 'BD001',
        message: `internal error: no emitter for target ${target}`,
        span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: null,
      }],
    };
  }
  const ext = TARGET_EXT[target] ?? '.js';
  const outputPath = resolveOutputPath(ionPath, rootDir, outDir, ext);

  if (!outputPath.startsWith(outDir + sep)) {
    return {
      outputPath,
      diagnostics: [{
        file: ionPath,
        code: 'BD001',
        message: `output path escapes outDir: ${outputPath}`,
        span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: null,
      }],
    };
  }

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

  const fmt = detectInputFormat(src);
  if (fmt !== 'source') {
    const irOrDiag = loadIrFromPrecompiled(src, ionPath);
    if ('code' in irOrDiag) {
      return { outputPath, diagnostics: [irOrDiag] };
    }
    let emitted: string;
    try {
      emitted = emitter(irOrDiag);
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
    await writeFile(outputPath, emitted, 'utf-8');
    const tokenStats: TokenStats = {
      ion: countTokens(src, 'cl100k'),
      out: countTokens(emitted, 'cl100k'),
    };
    return { outputPath, diagnostics: [], tokens: tokenStats };
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

  const rawAst = buildModule(cst);
  // Prepend prelude declarations so every module sees map, filter, fold, etc.
  const ast = { ...rawAst, decls: [...getPreludeDecls(), ...rawAst.decls] };
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

  // Token-savings telemetry — measured against the actual emitted output
  // (without the source-map comment, which is metadata, not generated code).
  const tokenStats: TokenStats = {
    ion: countTokens(src, 'cl100k'),
    out: countTokens(emitted.replace(/\n\/\/# sourceMappingURL=.*$/, ''), 'cl100k'),
  };

  return { outputPath, diagnostics: [], tokens: tokenStats };
}

// ---------------------------------------------------------------------------
// Multi-file compilation (LWC)
// ---------------------------------------------------------------------------

/**
 * Compile a single .ion module to a multi-file bundle.
 *
 * Layout: <outDir>/<relPathWithoutExt>/<bundleName>.{html,js,css,js-meta.xml}
 *
 * The bundle directory is named after the .ion file's basename (which is the
 * LWC component name). Inside it, the four files use the same basename as
 * their stem. This mirrors the SFDX `force-app/main/default/lwc/<name>/`
 * convention.
 */
async function compileFileMulti(
  ionPath: string,
  rootDir: string,
  outDir: string,
  multiEmitter: MultiFileEmitFn,
  _target: string,
): Promise<CompileFileResult> {
  // Bundle directory: strip rootDir prefix, drop .ion extension, treat the
  // resulting path as the bundle dir under outDir. The bundle stem is the
  // basename of that dir.
  const rel = relative(rootDir, ionPath).replace(/\.ion$/, '');
  const bundleDir = join(outDir, rel);
  const bundleName = basename(bundleDir);

  if (!bundleDir.startsWith(outDir + sep) && bundleDir !== outDir) {
    return {
      outputPath: bundleDir,
      diagnostics: [{
        file: ionPath,
        code: 'BD001',
        message: `output path escapes outDir: ${bundleDir}`,
        span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: null,
      }],
    };
  }

  let src: string;
  try {
    src = await readFile(ionPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outputPath: bundleDir,
      diagnostics: [{
        file: ionPath,
        code: 'BD001',
        message: `cannot read file: ${msg}`,
        span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: null,
      }],
    };
  }

  // Resolve IR — supports the same wire/JSON/source detection as compileFile.
  let ir: IonIRModule;
  const fmt = detectInputFormat(src);
  if (fmt !== 'source') {
    const irOrDiag = loadIrFromPrecompiled(src, ionPath);
    if ('code' in irOrDiag) {
      return { outputPath: bundleDir, diagnostics: [irOrDiag] };
    }
    ir = irOrDiag;
  } else {
    const tokens = lex(src, ionPath);
    let cst;
    try {
      cst = parseModule(tokens);
    } catch (err) {
      if (err instanceof ParseError) {
        return {
          outputPath: bundleDir,
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
    const rawAst = buildModule(cst);
    const ast = { ...rawAst, decls: [...getPreludeDecls(), ...rawAst.decls] };
    const bindResult = bindModule(ast, ionPath);
    const diagnostics: BuildDiagnostic[] = bindResult.errors.map(e => mapBindError(e, ionPath));
    const checkResult = checkModule(ast, bindResult, ionPath);
    for (const e of checkResult.errors) {
      diagnostics.push(mapCheckError(e));
    }
    if (diagnostics.length > 0) {
      return { outputPath: bundleDir, diagnostics };
    }
    try {
      ir = desugarModule(ast, bindResult, checkResult, ionPath, '0.0.0');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        outputPath: bundleDir,
        diagnostics: [{
          file: ionPath,
          code: 'BD005',
          message: `desugar error: ${msg}`,
          span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
          suggestion: null,
        }],
      };
    }
  }

  let bundle: LwcOutput;
  try {
    bundle = multiEmitter(ir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      outputPath: bundleDir,
      diagnostics: [{
        file: ionPath,
        code: 'BD005',
        message: `emit error: ${msg}`,
        span: { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 },
        suggestion: null,
      }],
    };
  }

  await mkdir(bundleDir, { recursive: true });
  const htmlPath = join(bundleDir, bundleName + '.html');
  const jsPath = join(bundleDir, bundleName + '.js');
  const cssPath = join(bundleDir, bundleName + '.css');
  const metaPath = join(bundleDir, bundleName + '.js-meta.xml');
  await writeFile(htmlPath, bundle.html, 'utf-8');
  await writeFile(jsPath, bundle.js, 'utf-8');
  await writeFile(cssPath, bundle.css, 'utf-8');
  await writeFile(metaPath, bundle.meta, 'utf-8');

  // Token telemetry: count Ion source vs the concatenated bundle. The bundle
  // is multi-file, so we report the total emitted size as the sum of all four.
  const allOut = bundle.html + '\n' + bundle.js + '\n' + bundle.css + '\n' + bundle.meta;
  const tokenStats: TokenStats = {
    ion: countTokens(src, 'cl100k'),
    out: countTokens(allOut, 'cl100k'),
  };

  return { outputPath: bundleDir, diagnostics: [], tokens: tokenStats };
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

function formatJson(
  fileCount: number,
  diags: BuildDiagnostic[],
  results?: CompileFileResult[],
  target?: string,
): string {
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
  if (results !== undefined && target !== undefined) {
    const tokenStats = aggregateTokenStats(results);
    if (tokenStats !== null) {
      output.tokens = {
        target: TARGET_LABEL[target] ?? target,
        files: tokenStats.perFile,
        total: tokenStats.total,
      };
    }
  }
  return JSON.stringify(output, null, 2);
}

interface AggregatedTokenStats {
  perFile: { file: string; ion: number; out: number; saved: number; pct: number }[];
  total: { ion: number; out: number; saved: number; pct: number };
}

function aggregateTokenStats(results: CompileFileResult[]): AggregatedTokenStats | null {
  const withTokens = results.filter((r): r is CompileFileResult & { tokens: TokenStats } =>
    r.tokens !== undefined,
  );
  if (withTokens.length === 0) return null;
  const perFile = withTokens.map(r => {
    const saved = r.tokens.out - r.tokens.ion;
    const pct = r.tokens.out > 0 ? Math.round((saved / r.tokens.out) * 100) : 0;
    return { file: r.outputPath, ion: r.tokens.ion, out: r.tokens.out, saved, pct };
  });
  const totalIon = perFile.reduce((s, f) => s + f.ion, 0);
  const totalOut = perFile.reduce((s, f) => s + f.out, 0);
  const totalSaved = totalOut - totalIon;
  const totalPct = totalOut > 0 ? Math.round((totalSaved / totalOut) * 100) : 0;
  return {
    perFile,
    total: { ion: totalIon, out: totalOut, saved: totalSaved, pct: totalPct },
  };
}

function formatTokenSavings(results: CompileFileResult[], target: string): string | null {
  const stats = aggregateTokenStats(results);
  if (stats === null) return null;
  const label = TARGET_LABEL[target] ?? target;
  const { ion, out, saved, pct } = stats.total;
  if (saved <= 0) {
    return `tokens (cl100k): Ion ${ion} → ${label} ${out} — no savings on this batch`;
  }
  return `tokens (cl100k): Ion ${ion} → ${label} ${out} — saved ${saved} (${pct}%) vs writing ${label} directly`;
}

// ---------------------------------------------------------------------------
// Build execution
// ---------------------------------------------------------------------------

async function runBuildOnce(
  config: IonConfig,
  resolvedRootDir: string,
  resolvedOutDir: string,
  emitter: EmitFn | null,
  multiEmitter: MultiFileEmitFn | null,
  target: string,
  noSourcemap: boolean,
  json: boolean,
  noTokenReport: boolean,
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
    ionFiles.map(f => compileFile(f, resolvedRootDir, resolvedOutDir, emitter, multiEmitter, target, noSourcemap)),
  );

  const allDiags = results.flatMap(r => r.diagnostics);

  if (!json) {
    const errCount = allDiags.length;
    const okCount = ionFiles.length - results.filter(r => r.diagnostics.length > 0).length;
    if (errCount > 0) {
      process.stdout.write(formatHuman(allDiags) + '\n');
    }
    process.stdout.write(`${okCount} file(s) compiled, ${errCount} error(s)\n`);
    if (!noTokenReport) {
      const report = formatTokenSavings(results, target);
      if (report !== null) process.stdout.write(report + '\n');
    }
  } else {
    process.stdout.write(formatJson(ionFiles.length, allDiags, results, target) + '\n');
  }

  return { fileCount: ionFiles.length, diagnostics: allDiags };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const USAGE = 'usage: ion build [--config <path>] [--target <lang>] [--watch] [--no-sourcemap] [--no-token-report] [--json]\n  .ion files containing wire-format or JSON IonIR are detected automatically and skip frontend compilation.\n';

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
  const multiEmitter = getMultiFileEmitter(target);
  if (emitter === null && multiEmitter === null) {
    process.stderr.write(`error: unsupported target: ${target}\n`);
    process.stderr.write('supported targets: javascript, typescript, typescript-dts, python, java, react, html, vue, apex, lwc, react-native\n');
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
      multiEmitter,
      target,
      parsed.noSourcemap,
      parsed.json,
      parsed.noTokenReport,
    );
    return { exitCode: diagnostics.length > 0 ? 1 : 0 };
  }

  // Watch mode: initial build then watch for changes. Suppress the per-build
  // token report by default — it's noise on every keystroke. Users can opt in
  // by dropping --no-token-report.
  await runBuildOnce(
    config,
    resolvedRootDir,
    resolvedOutDir,
    emitter,
    multiEmitter,
    target,
    parsed.noSourcemap,
    false,
    true,
  );

  // Return a promise that keeps the process alive via the fs.Watch handle
  return new Promise(() => {
    const watcher = watch(resolvedRootDir, { recursive: true }, (eventType, filename) => {
      if (typeof filename !== 'string') return;
      if (!filename.endsWith('.ion')) return;

      const ionPath = resolve(resolvedRootDir, filename);
      if (!ionPath.startsWith(resolvedRootDir + sep)) return;
      compileFile(ionPath, resolvedRootDir, resolvedOutDir, emitter, multiEmitter, target, parsed.noSourcemap)
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
