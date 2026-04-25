#!/usr/bin/env node
/**
 * compile-ion.mjs — compile all ION source files in ion/ to TypeScript in src/ion-generated/
 *
 * This is part of ION's self-hosting build pipeline. ION source lives in ion/**\/*.ion,
 * and the generated TypeScript is committed to src/ion-generated/ so the repo can
 * bootstrap without a pre-built compiler.
 *
 * Run: node scripts/compile-ion.mjs
 * Automatically run as part of: npm run build
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, relative, extname, basename, sep } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ION_SRC = join(ROOT, 'ion');
const GEN_OUT = join(ROOT, 'src', 'ion-generated');

// ---------------------------------------------------------------------------
// Load the ION compiler from dist/ (stage-0 compiler)
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);

let decodeModule, emitTS;
try {
  ({ decodeModule } = require(join(ROOT, 'dist/src/wire/decoder.js')));
  ({ emitTS } = require(join(ROOT, 'dist/skills/typescript/emit.js')));
} catch (e) {
  console.error('compile-ion: dist/ not found — run `tsc` first to build the stage-0 compiler');
  console.error('  (This only needs to happen once; after that `npm run build` handles everything)');
  process.exit(1);
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
  const out = lines.map(line => {
    // Export top-level const and type declarations
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
  const rel = relative(join(ION_SRC, 'src'), ionFile); // e.g. prelude/shake.ion
  const tsRel = rel.replace(/\.ion$/, '.ts');           // e.g. prelude/shake.ts
  return join(GEN_OUT, tsRel);
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

for (const ionFile of ionFiles) {
  const relSrc = relative(ROOT, ionFile);
  try {
    const src = readFileSync(ionFile, 'utf8');
    const decoded = decodeModule(src);

    if (decoded && 'error' in decoded) {
      console.error(`  ✗ ${relSrc}: decode error — ${decoded.error}`);
      fail++;
      continue;
    }

    const emitted = emitTS(decoded);
    const processed = postProcess(emitted, relSrc);

    const outFile = outputPath(ionFile);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, processed, 'utf8');

    const relOut = relative(ROOT, outFile);
    const ratio = (emitted.length / src.length).toFixed(1);
    console.log(`  ✓ ${relSrc} → ${relOut} (${src.length}B → ${emitted.length}B, ${ratio}×)`);
    ok++;
  } catch (e) {
    console.error(`  ✗ ${relSrc}: ${e.message}`);
    fail++;
  }
}

console.log(`\ncompile-ion: ${ok} compiled, ${fail} failed`);
if (fail > 0) process.exit(1);
