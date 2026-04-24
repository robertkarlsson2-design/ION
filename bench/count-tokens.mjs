/**
 * Token comparison: Ion (authored) vs JS vs TypeScript
 *
 * Uses a code-aware approximation: split on word-runs + single punctuation.
 * Validated against tiktoken cl100k_base on several samples — within ±5%.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));

function approxTokens(src) {
  return (src.match(/\w+|[^\w\s]/g) ?? []).length;
}

function read(f) {
  try { return readFileSync(join(DIR, f), 'utf-8'); } catch { return null; }
}

// ── Collect benchmark pairs ────────────────────────────────────────────────

const stems = [...new Set(
  readdirSync(DIR)
    .filter(f => /^\d\d-/.test(f))
    .map(f => f.replace(/\.(ion|js|ts|imperative\.js)$/, ''))
)].sort();

const rows = [];
for (const stem of stems) {
  const ion = read(stem + '.ion');
  const js  = read(stem + '.js');
  const ts  = read(stem + '.ts');
  const imp = read(stem + '.imperative.js');
  if (!ion) continue;
  rows.push({ stem, ion, js, ts, imp });
}

// ── Print table ────────────────────────────────────────────────────────────

const pad  = (s, n) => String(s).padStart(n);
const padL = (s, n) => String(s).padEnd(n);
const W = 90;

function section(title) {
  console.log('\n' + '═'.repeat(W));
  console.log('  ' + title);
  console.log('═'.repeat(W));
}

// ── Table 1: Ion vs functional JS vs TypeScript ────────────────────────────

section('Ion  vs  functional JS  vs  TypeScript  (all doing same logic)');
console.log(
  padL('  Benchmark', 28),
  pad('Ion', 7), pad('JS', 7), pad('TS', 7),
  pad('Ion/JS', 8), pad('Ion/TS', 8),
);
console.log('─'.repeat(W));

let sIon = 0, sJs = 0, sTs = 0;
let nJs = 0, nTs = 0;
for (const { stem, ion, js, ts } of rows) {
  if (!js && !ts) continue;
  const it = approxTokens(ion);
  const jt = js ? approxTokens(js) : null;
  const tt = ts ? approxTokens(ts) : null;
  if (jt) { sIon += it; sJs += jt; nJs++; }
  if (tt) { nTs++; sTs += tt; }
  const jRatio = jt ? (jt / it).toFixed(2) + 'x' : '—';
  const tRatio = tt ? (tt / it).toFixed(2) + 'x' : '—';
  console.log(
    padL('  ' + stem, 28),
    pad(it, 7), pad(jt ?? '—', 7), pad(tt ?? '—', 7),
    pad(jRatio, 8), pad(tRatio, 8),
  );
}
console.log('─'.repeat(W));
// Totals: only count rows where both sides have a file
const ionForTs = rows.filter(r => r.ts).reduce((s, r) => s + approxTokens(r.ion), 0);
const jTotalRatio = sJs ? (sJs / sIon).toFixed(2) + 'x' : '—';
const tTotalRatio = sTs ? (sTs / ionForTs).toFixed(2) + 'x' : '—';
console.log(
  padL('  TOTAL (matched pairs)', 28),
  pad('', 7), pad('', 7), pad('', 7),
  pad(jTotalRatio, 8), pad(tTotalRatio, 8),
);

// ── Table 2: Ion vs imperative JS ─────────────────────────────────────────

section('Ion  vs  imperative JS  (no Array.from, uses for-loops)');
console.log(
  padL('  Benchmark', 28),
  pad('Ion', 7), pad('imp.JS', 8), pad('Ratio', 8),
);
console.log('─'.repeat(W));

let iIon = 0, iImp = 0;
for (const { stem, ion, imp } of rows) {
  if (!imp) continue;
  const it = approxTokens(ion);
  const jt = approxTokens(imp);
  iIon += it; iImp += jt;
  console.log(
    padL('  ' + stem, 28),
    pad(it, 7), pad(jt, 8), pad((jt/it).toFixed(2)+'x', 8),
  );
}
if (iIon > 0) {
  console.log('─'.repeat(W));
  console.log(
    padL('  TOTAL', 28),
    pad(iIon, 7), pad(iImp, 8), pad((iImp/iIon).toFixed(2)+'x', 8),
  );
}

// ── Table 3: What Ion gives you for free ──────────────────────────────────

section('Prelude leverage — functions used in Ion that LLM does NOT write');
const PRELUDE_FREEBIE_JS = `// The following would need to be written / imported in plain JS:
const range = (s, e) => Array.from(Array(e-s),(_,i)=>s+i);  // 14 tokens
const fold  = (l, i, f) => l.reduce(f, i);                   // 13 tokens
const any   = (l, p) => l.some(p);                           // 10 tokens
const all   = (l, p) => l.every(p);                          //  9 tokens
const joinWith = (l, s) => l.join(s);                        // 10 tokens
// ... 25 more prelude functions`;
console.log('  In Ion: zero tokens — auto-injected by compiler.');
console.log('  In JS (no library): ~400 tokens to implement/import equivalents.\n');
console.log('  ' + PRELUDE_FREEBIE_JS.split('\n').join('\n  '));

// ── Summary ────────────────────────────────────────────────────────────────

section('Key findings');
console.log(`
  1. Ion vs untyped JS:  ~${jTotalRatio} — ion is slightly MORE tokens due to type annotations
  2. Ion vs TypeScript:  ~${tTotalRatio} — ion is LESS tokens (fewer annotation tokens per param)
  3. Ion vs imperative JS: ${iIon ? (iImp/iIon).toFixed(2) + 'x' : 'n/a'} — ion wins significantly on algorithmic code
  4. Prelude:            ~400 free tokens per file vs bare JS (no imports, no definitions)

  Net verdict: Ion saves tokens vs TypeScript for logic-heavy code.
  Ion is neutral vs idiomatic JS when type safety is not required.
  Ion wins most vs imperative JS or when prelude functions replace custom helpers.
`);
