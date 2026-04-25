#!/usr/bin/env node
/**
 * Round-trip benchmark:
 *   Ion source → Ion compiler → JS / TS / Python
 *
 * LLM token cost comparison:
 *   "LLM writes JS/TS/Python directly" vs "LLM writes Ion, compile to target"
 *
 * Usage: node bench/roundtrip.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT    = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BENCH   = resolve(ROOT, 'bench');
const OUT_DIR = resolve(BENCH, 'out');
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Ion compiler pipeline
// ---------------------------------------------------------------------------
const { lex }             = await import(`${ROOT}/dist/src/lexer/index.js`);
const { parseModule }     = await import(`${ROOT}/dist/src/parser/declarations.js`);
const { buildModule }     = await import(`${ROOT}/dist/src/ast/builder.js`);
const { bindModule }      = await import(`${ROOT}/dist/src/binder/index.js`);
const { checkModule }     = await import(`${ROOT}/dist/src/checker/index.js`);
const { desugarModule }   = await import(`${ROOT}/dist/src/desugar/index.js`);
const { emitJS }          = await import(`${ROOT}/dist/skills/javascript/emit.js`);
const { emitTS }          = await import(`${ROOT}/dist/skills/typescript/emit.js`);
const { emitPython }      = await import(`${ROOT}/dist/skills/python/emit.js`);
const { getPreludeDecls } = await import(`${ROOT}/dist/src/prelude/index.js`);

function compile(src, file) {
  const tokens = lex(src, file);
  const cst    = parseModule(tokens);
  const rawAst = buildModule(cst);
  const ast    = { ...rawAst, decls: [...getPreludeDecls(), ...rawAst.decls] };
  const br     = bindModule(ast, file);
  if (br.errors.length > 0) throw new Error(`Bind: ${br.errors.map(e => e.message).join(', ')}`);
  const cr = checkModule(ast, br, file);
  if (cr.errors.length > 0) throw new Error(`Check: ${cr.errors.map(e => e.message).join(', ')}`);
  return desugarModule(ast, br, cr, file, '0.0.0');
}

// ---------------------------------------------------------------------------
// Token approximation (cl100k-style)
// ---------------------------------------------------------------------------
function approxTokens(text) {
  return text
    .split(/[\s\(\)\[\]{},;=<>:\.!+\-\*\/&|^~@#%`'"\\]+/)
    .filter(t => t.length > 0).length;
}

// ---------------------------------------------------------------------------
// Benchmark files
// ---------------------------------------------------------------------------
const FILES = [
  '01-fibonacci',
  '02-list-pipeline',
  '03-stats',
  '04-primes',
  '05-string-ops',
];

console.log('='.repeat(72));
console.log('  ION ROUND-TRIP  +  LLM TOKEN BENCHMARK');
console.log('='.repeat(72));
console.log();
console.log('  Compiling Ion → JavaScript / TypeScript / Python ...\n');

const rows = [];

for (const name of FILES) {
  const ionSrc = readFileSync(resolve(BENCH, `${name}.ion`), 'utf-8');
  const jsSrc  = readFileSync(resolve(BENCH, `${name}.js`),  'utf-8');
  const tsSrc  = existsSync(resolve(BENCH, `${name}.ts`))
    ? readFileSync(resolve(BENCH, `${name}.ts`), 'utf-8') : null;
  const pySrc  = existsSync(resolve(BENCH, `${name}.py`))
    ? readFileSync(resolve(BENCH, `${name}.py`), 'utf-8') : null;

  let jsOut = null, tsOut = null, pyOut = null;
  let buildErr = null;

  try {
    const ir = compile(ionSrc, `${name}.ion`);
    jsOut = emitJS(ir);
    tsOut = emitTS(ir);
    pyOut = emitPython(ir);
    writeFileSync(resolve(OUT_DIR, `${name}.js`),  jsOut);
    writeFileSync(resolve(OUT_DIR, `${name}.ts`),  tsOut);
    writeFileSync(resolve(OUT_DIR, `${name}.py`),  pyOut);
  } catch (e) {
    buildErr = e.message;
  }

  rows.push({
    name,
    ionTok:  approxTokens(ionSrc),
    jsTok:   approxTokens(jsSrc),
    tsTok:   tsSrc ? approxTokens(tsSrc) : null,
    pyTok:   pySrc ? approxTokens(pySrc) : null,
    jsOutTok: jsOut ? approxTokens(jsOut) : null,
    tsOutTok: tsOut ? approxTokens(tsOut) : null,
    pyOutTok: pyOut ? approxTokens(pyOut) : null,
    ok: !buildErr,
    err: buildErr,
  });

  const status = buildErr ? `✗ ${buildErr.slice(0, 60)}` : '✓';
  console.log(`  ${name.padEnd(22)} ${status}`);
}

console.log();

// ---------------------------------------------------------------------------
// Show a compiled example
// ---------------------------------------------------------------------------
const good = rows.find(r => r.ok);
if (good) {
  const jsOut = readFileSync(resolve(OUT_DIR, `${good.name}.js`), 'utf-8');
  const tsOut = readFileSync(resolve(OUT_DIR, `${good.name}.ts`), 'utf-8');
  const pyOut = readFileSync(resolve(OUT_DIR, `${good.name}.py`), 'utf-8');
  const ionSrc = readFileSync(resolve(BENCH, `${good.name}.ion`), 'utf-8');

  console.log(`── ${good.name}.ion (source) ` + '─'.repeat(44 - good.name.length));
  console.log(ionSrc.trimEnd());
  console.log();
  console.log(`── Compiled → JavaScript ` + '─'.repeat(47));
  console.log(jsOut.trimEnd());
  console.log();
  console.log(`── Compiled → TypeScript ` + '─'.repeat(47));
  console.log(tsOut.trimEnd());
  console.log();
  console.log(`── Compiled → Python ` + '─'.repeat(51));
  console.log(pyOut.trimEnd());
  console.log();
}

// ---------------------------------------------------------------------------
// Per-file token table
// ---------------------------------------------------------------------------
console.log('='.repeat(72));
console.log('  TOKEN COUNTS  (approx. cl100k)');
console.log('='.repeat(72));
console.log();
console.log(
  'File'.padEnd(24) +
  'Ion'.padStart(6) +
  'JS src'.padStart(8) +
  'JS out'.padStart(8) +
  'TS src'.padStart(8) +
  'TS out'.padStart(8) +
  'Py src'.padStart(8) +
  'Py out'.padStart(8)
);
console.log('─'.repeat(80));

let totIon = 0, totJsSrc = 0, totJsOut = 0;
let totTsSrc = 0, totTsOut = 0, totPySrc = 0, totPyOut = 0;
let countTs = 0, countPy = 0;

for (const r of rows) {
  const fmt = (v) => v == null ? '—'.padStart(8) : String(v).padStart(8);
  console.log(
    r.name.padEnd(24) +
    String(r.ionTok).padStart(6) +
    fmt(r.jsTok) + fmt(r.jsOutTok) +
    fmt(r.tsTok) + fmt(r.tsOutTok) +
    fmt(r.pyTok) + fmt(r.pyOutTok)
  );
  totIon   += r.ionTok;
  totJsSrc += r.jsTok;
  totJsOut += r.jsOutTok ?? 0;
  if (r.tsTok  != null) { totTsSrc += r.tsTok;  countTs++; }
  if (r.tsOutTok != null) { totTsOut += r.tsOutTok; }
  if (r.pyTok  != null) { totPySrc += r.pyTok;  countPy++; }
  if (r.pyOutTok != null) { totPyOut += r.pyOutTok; }
}

console.log('─'.repeat(80));
const fmt = (v, n) => n === 0 ? '—'.padStart(8) : String(v).padStart(8);
console.log(
  'TOTAL'.padEnd(24) +
  String(totIon).padStart(6) +
  String(totJsSrc).padStart(8) + fmt(totJsOut, rows.filter(r=>r.ok).length) +
  fmt(totTsSrc, countTs) + fmt(totTsOut, rows.filter(r=>r.ok&&r.tsOutTok).length) +
  fmt(totPySrc, countPy) + fmt(totPyOut, rows.filter(r=>r.ok&&r.pyOutTok).length)
);

console.log();

// ---------------------------------------------------------------------------
// Savings summary
// ---------------------------------------------------------------------------
console.log('='.repeat(72));
console.log('  LLM OUTPUT TOKEN SAVINGS');
console.log('  Ion = what the LLM writes; target = what it would write instead');
console.log('='.repeat(72));
console.log();

const targets = [
  { label: 'JavaScript', srcTot: totJsSrc, outTot: totJsOut, count: FILES.length },
  { label: 'TypeScript',  srcTot: totTsSrc, outTot: totTsOut, count: countTs },
  { label: 'Python',      srcTot: totPySrc, outTot: totPyOut, count: countPy },
];

console.log(
  'Target'.padEnd(14) +
  'LLM writes target'.padStart(20) +
  'LLM writes Ion'.padStart(16) +
  'Savings'.padStart(10) +
  '%'.padStart(6)
);
console.log('─'.repeat(68));

for (const { label, srcTot, outTot, count } of targets) {
  if (count === 0) continue;
  const pctSrc = Math.round(((srcTot - totIon) / srcTot) * 100);
  const pctOut = Math.round(((outTot - totIon) / (outTot || 1)) * 100);
  console.log(
    label.padEnd(14) +
    String(srcTot).padStart(20) +
    String(totIon).padStart(16) +
    String(srcTot - totIon).padStart(10) +
    `${pctSrc}%`.padStart(6)
  );
}

console.log();

// Cost model: $15/M output tokens (Claude Sonnet)
const COST_PER_M = 15;
console.log(`Cost model: $${COST_PER_M}/M output tokens (Claude Sonnet), per 1M code generations:\n`);

for (const { label, srcTot, count } of targets) {
  if (count === 0) continue;
  const directCost = (srcTot   / 1_000_000) * COST_PER_M * 1_000_000;
  const ionCost    = (totIon   / 1_000_000) * COST_PER_M * 1_000_000;
  const saved      = directCost - ionCost;
  const pct        = Math.round((saved / directCost) * 100);
  console.log(
    `  ${label.padEnd(13)}  direct $${directCost.toFixed(2).padStart(7)}` +
    `  Ion $${ionCost.toFixed(2).padStart(7)}` +
    `  saves $${saved.toFixed(2).padStart(7)} (${pct}%)`
  );
}

console.log();
console.log(`Output written to: bench/out/`);
console.log();
