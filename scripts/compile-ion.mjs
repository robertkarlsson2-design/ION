#!/usr/bin/env node
/**
 * compile-ion.mjs — compile all ION source files in ion/ to TypeScript in src/ion-generated/
 *
 * Supports two source formats:
 *   - Wire format  (starts with "I1"): decoded directly via decodeModule → emitTS
 *   - Surface syntax (.ion files):     full pipeline — lex → parse → build → bind →
 *                                      check → desugar → emitTS
 *
 * Run: node scripts/compile-ion.mjs
 * Automatically run as part of: npm run build
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, relative, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ION_SRC = join(ROOT, 'ion');
const GEN_OUT = join(ROOT, 'src', 'ion-generated');

// ---------------------------------------------------------------------------
// Load the stage-0 compiler from dist/
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

let decodeModule, emitTS;
let lex, parseModule, buildModule, bindModule, checkModule, desugarModule, getPreludeDecls;

try {
  ({ decodeModule } = require(join(ROOT, 'dist/src/wire/decoder.js')));
  ({ emitTS } = require(join(ROOT, 'dist/emitters/typescript/emit.js')));
} catch (e) {
  console.error('compile-ion: dist/ not found — run `tsc` first to build the stage-0 compiler');
  console.error('  (This only needs to happen once; after that `npm run build` handles everything)');
  process.exit(1);
}

// Surface-syntax pipeline — optional; loaded lazily on first surface-syntax file
let surfacePipelineLoaded = false;

function loadSurfacePipeline() {
  if (surfacePipelineLoaded) return true;
  try {
    ({ lex } = require(join(ROOT, 'dist/src/lexer/index.js')));
    ({ parseModule } = require(join(ROOT, 'dist/src/parser/declarations.js')));
    ({ buildModule } = require(join(ROOT, 'dist/src/ast/builder.js')));
    ({ bindModule } = require(join(ROOT, 'dist/src/binder/index.js')));
    ({ checkModule } = require(join(ROOT, 'dist/src/checker/index.js')));
    ({ desugarModule } = require(join(ROOT, 'dist/src/desugar/index.js')));
    ({ getPreludeDecls } = require(join(ROOT, 'dist/src/prelude/index.js')));
    surfacePipelineLoaded = true;
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findIonFiles(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      findIonFiles(full, results);
    } else if (extname(entry) === '.ion') {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Post-process emitted TypeScript
// ---------------------------------------------------------------------------

function postProcess(ts, sourceRel) {
  const lines = ts.split('\n');
  const out = lines
    .filter(line => !/^export\s*\{/.test(line))
    .map(line => {
      if (/^const /.test(line)) return 'export ' + line;
      if (/^type /.test(line)) return 'export ' + line;
      return line;
    });

  const header = [
    `/* @generated — do not edit */`,
    `/* source: ${sourceRel} */`,
    `// @ts-nocheck`,
    `/* eslint-disable */`,
    ``,
  ].join('\n');

  return header + out.join('\n');
}

// ---------------------------------------------------------------------------
// Output path: ion/src/prelude/shake.ion → src/ion-generated/prelude/shake.ts
// ---------------------------------------------------------------------------

function outputPath(ionFile) {
  const rel = relative(join(ION_SRC, 'src'), ionFile);
  const tsRel = rel.replace(/\.ion$/, '.ts');
  return join(GEN_OUT, tsRel);
}

// ---------------------------------------------------------------------------
// Compile a single file
// ---------------------------------------------------------------------------

function isWireFormat(src) {
  return src.startsWith('I1\n') || src.startsWith('I1\r\n');
}

function compileWire(src, relSrc) {
  const decoded = decodeModule(src);
  if (decoded && 'error' in decoded) {
    throw new Error(`decode error — ${decoded.error}`);
  }
  return emitTS(decoded);
}

function compileSurface(src, ionFile, relSrc) {
  if (!loadSurfacePipeline()) {
    throw new Error(
      'surface-syntax pipeline not available — dist/ may be missing checker/binder modules'
    );
  }

  const tokens = lex(src, ionFile);
  let cst;
  try {
    cst = parseModule(tokens);
  } catch (e) {
    throw new Error(`parse error — ${e.message}`);
  }

  const rawAst = buildModule(cst);
  const ast = { ...rawAst, decls: [...getPreludeDecls(), ...rawAst.decls] };

  const bindResult = bindModule(ast, ionFile);
  const bindErrors = bindResult.errors ?? [];
  if (bindErrors.length > 0) {
    const msgs = bindErrors.map(e => `  ${e.code}: ${e.message}`).join('\n');
    throw new Error(`bind errors:\n${msgs}`);
  }

  const checkResult = checkModule(ast, bindResult, ionFile);
  const checkErrors = checkResult.errors ?? [];
  if (checkErrors.length > 0) {
    const msgs = checkErrors.map(e => `  ${e.code}: ${e.message}`).join('\n');
    throw new Error(`type errors:\n${msgs}`);
  }

  const ir = desugarModule(ast, bindResult, checkResult, ionFile, '0.0.0');
  return emitTS(ir);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ionFiles = findIonFiles(ION_SRC);

if (ionFiles.length === 0) {
  console.log('compile-ion: no .ion files found in ion/');
  process.exit(0);
}

let ok = 0;
let fail = 0;
const failedFiles = [];

for (const ionFile of ionFiles) {
  const relSrc = relative(ROOT, ionFile);
  try {
    const src = readFileSync(ionFile, 'utf8');
    const wire = isWireFormat(src);

    const emitted = wire
      ? compileWire(src, relSrc)
      : compileSurface(src, ionFile, relSrc);

    const processed = postProcess(emitted, relSrc);

    const outFile = outputPath(ionFile);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, processed, 'utf8');

    const relOut = relative(ROOT, outFile);
    const fmt = wire ? 'wire' : 'surface';
    const ratio = (emitted.length / src.length).toFixed(1);
    console.log(`  ✓ [${fmt}] ${relSrc} → ${relOut} (${src.length}B → ${emitted.length}B, ${ratio}×)`);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${relSrc}: ${e.message}`);
    fail++;
    failedFiles.push(relSrc);
  }
}

console.log(`\ncompile-ion: ${ok} compiled, ${fail} failed`);

// Only the files actually imported by the hand-written runtime are required.
// The rest is dogfooding output of ion-on-ion self-hosting — failures there
// reflect compiler gaps (e.g. string interpolation, default exports), not a
// broken runtime. CI must still go green when only those gaps fail.
const REQUIRED = new Set([
  'ion/src/prelude/shake.ion',
]);
const failedRequired = failedFiles.filter(f => REQUIRED.has(f));
if (failedRequired.length > 0) {
  console.error(`compile-ion: required file(s) failed: ${failedRequired.join(', ')}`);
  process.exit(1);
}
