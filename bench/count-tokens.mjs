/**
 * Token comparison: Ion vs JavaScript vs TypeScript vs Python.
 *
 * Uses the real cl100k_base tokenizer (the one GPT-4 and Claude use) via
 * `@dqbd/tiktoken`, which is already a dependency of the compiler. Run:
 *
 *   node bench/count-tokens.mjs
 *
 * Numbers reported here are what the README's token-efficiency table is
 * generated from.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encoding_for_model } from '@dqbd/tiktoken';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const enc = encoding_for_model('gpt-4'); // cl100k_base

function tokenize(src) {
  return enc.encode(src).length;
}

function read(f) {
  try { return readFileSync(join(DIR, f), 'utf-8'); } catch { return null; }
}

// ── Collect benchmark pairs ────────────────────────────────────────────────

const stems = [...new Set(
  readdirSync(DIR)
    .filter(f => /^\d\d-/.test(f))
    .map(f => f.replace(/\.(ion|js|ts|py|imperative\.js)$/, ''))
)].sort();

const rows = [];
for (const stem of stems) {
  const ion = read(stem + '.ion');
  const js  = read(stem + '.js');
  const ts  = read(stem + '.ts');
  const py  = read(stem + '.py');
  const imp = read(stem + '.imperative.js');
  if (!ion) continue;
  rows.push({ stem, ion, js, ts, py, imp });
}

// ── Print table ────────────────────────────────────────────────────────────

const pad  = (s, n) => String(s).padStart(n);
const padL = (s, n) => String(s).padEnd(n);
const W = 100;

function section(title) {
  console.log('\n' + '═'.repeat(W));
  console.log('  ' + title);
  console.log('═'.repeat(W));
}

// ── Table: Ion vs JS vs TS vs Python (cl100k_base) ─────────────────────────

section('Ion  vs  JavaScript  vs  TypeScript  vs  Python   —   tokenizer: cl100k_base');
console.log(
  padL('  Benchmark', 22),
  pad('Ion', 6), pad('JS', 6), pad('TS', 6), pad('Py', 6),
  pad('JS/Ion', 8), pad('TS/Ion', 8), pad('Py/Ion', 8),
);
console.log('─'.repeat(W));

let sIon = 0, sJs = 0, sTs = 0, sPy = 0;
for (const { stem, ion, js, ts, py } of rows) {
  const it = tokenize(ion);
  const jt = js ? tokenize(js) : null;
  const tt = ts ? tokenize(ts) : null;
  const pt = py ? tokenize(py) : null;
  sIon += it;
  if (jt) sJs += jt;
  if (tt) sTs += tt;
  if (pt) sPy += pt;
  const jR = jt ? (jt / it).toFixed(2) + 'x' : '—';
  const tR = tt ? (tt / it).toFixed(2) + 'x' : '—';
  const pR = pt ? (pt / it).toFixed(2) + 'x' : '—';
  console.log(
    padL('  ' + stem, 22),
    pad(it, 6), pad(jt ?? '—', 6), pad(tt ?? '—', 6), pad(pt ?? '—', 6),
    pad(jR, 8), pad(tR, 8), pad(pR, 8),
  );
}
console.log('─'.repeat(W));
const jTotal = sJs ? (sJs / sIon).toFixed(2) + 'x' : '—';
const tTotal = sTs ? (sTs / sIon).toFixed(2) + 'x' : '—';
const pTotal = sPy ? (sPy / sIon).toFixed(2) + 'x' : '—';
console.log(
  padL('  TOTAL', 22),
  pad(sIon, 6), pad(sJs, 6), pad(sTs, 6), pad(sPy, 6),
  pad(jTotal, 8), pad(tTotal, 8), pad(pTotal, 8),
);

// ── Optional: Ion vs imperative JS ────────────────────────────────────────

const impRows = rows.filter(r => r.imp);
if (impRows.length) {
  section('Ion  vs  imperative JS  (for-loops, no array methods)');
  console.log(
    padL('  Benchmark', 22),
    pad('Ion', 6), pad('imp.JS', 8), pad('Ratio', 8),
  );
  console.log('─'.repeat(W));
  let iIon = 0, iImp = 0;
  for (const { stem, ion, imp } of impRows) {
    const it = tokenize(ion);
    const jt = tokenize(imp);
    iIon += it; iImp += jt;
    console.log(
      padL('  ' + stem, 22),
      pad(it, 6), pad(jt, 8), pad((jt/it).toFixed(2)+'x', 8),
    );
  }
  console.log('─'.repeat(W));
  console.log(
    padL('  TOTAL', 22),
    pad(iIon, 6), pad(iImp, 8), pad((iImp/iIon).toFixed(2)+'x', 8),
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

section('Savings of generating Ion → compile vs. generating target directly');
const pct = (x) => ((1 - sIon / x) * 100).toFixed(0) + '%';
console.log(`
  vs JavaScript:  ${sJs ? pct(sJs) : 'n/a'} fewer tokens  (Ion ${sIon} → JS ${sJs})
  vs TypeScript:  ${sTs ? pct(sTs) : 'n/a'} fewer tokens  (Ion ${sIon} → TS ${sTs})
  vs Python:      ${sPy ? pct(sPy) : 'n/a'} fewer tokens  (Ion ${sIon} → Py ${sPy})

  These numbers reflect surface-syntax compression only. The wire format
  (.ionw) compresses further by pooling repeated symbols and types — see
  src/wire/ for the encoder.
`);

enc.free();
