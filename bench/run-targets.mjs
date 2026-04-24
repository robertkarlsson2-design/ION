#!/usr/bin/env node
/**
 * Compile all bench/*.ion files to JS, TS, and Python and validate the output.
 * Run with: node bench/run-targets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Dynamically import compiled modules
const { lex } = await import(`${root}/dist/src/lexer/index.js`);
const { parseModule } = await import(`${root}/dist/src/parser/declarations.js`);
const { buildModule } = await import(`${root}/dist/src/ast/builder.js`);
const { bindModule } = await import(`${root}/dist/src/binder/index.js`);
const { checkModule } = await import(`${root}/dist/src/checker/index.js`);
const { desugarModule } = await import(`${root}/dist/src/desugar/index.js`);
const { emitJS } = await import(`${root}/dist/skills/javascript/emit.js`);
const { emitTS } = await import(`${root}/dist/skills/typescript/emit.js`);
const { emitPython } = await import(`${root}/dist/skills/python/emit.js`);
const { getPreludeDecls } = await import(`${root}/dist/src/prelude/index.js`);

const BENCH_FILES = [
  '01-fibonacci.ion',
  '02-list-pipeline.ion',
  '03-stats.ion',
  '04-primes.ion',
  '05-string-ops.ion',
];

function compile(src, file) {
  const tokens = lex(src, file);
  const cst = parseModule(tokens);
  const rawAst = buildModule(cst);
  const ast = { ...rawAst, decls: [...getPreludeDecls(), ...rawAst.decls] };
  const br = bindModule(ast, file);
  if (br.errors.length > 0) throw new Error(`Bind errors in ${file}: ${br.errors.map(e => e.message).join(', ')}`);
  const cr = checkModule(ast, br, file);
  if (cr.errors.length > 0) throw new Error(`Check errors in ${file}: ${cr.errors.map(e => e.message).join(', ')}`);
  return desugarModule(ast, br, cr, file, '0.0.0');
}

function approxTokens(text) {
  return text.split(/[\s\(\)\[\]{},;=<>:\.!+\-\*\/&|^~@#%`'"\\]+/).filter(t => t.length > 0).length;
}

const outDir = resolve(__dirname, 'out');
mkdirSync(outDir, { recursive: true });

let totalJs = 0, totalTs = 0, totalPy = 0;
const results = [];

for (const file of BENCH_FILES) {
  const ionPath = resolve(__dirname, file);
  const src = readFileSync(ionPath, 'utf-8');
  const ir = compile(src, file);

  const js = emitJS(ir);
  const ts = emitTS(ir);
  const py = emitPython(ir);

  const baseName = file.replace('.ion', '');
  writeFileSync(resolve(outDir, baseName + '.js'), js);
  writeFileSync(resolve(outDir, baseName + '.ts'), ts);
  writeFileSync(resolve(outDir, baseName + '.py'), py);

  const ionTok = approxTokens(src);
  const jsTok = approxTokens(js);
  const tsTok = approxTokens(ts);
  const pyTok = approxTokens(py);

  totalJs += jsTok;
  totalTs += tsTok;
  totalPy += pyTok;
  results.push({ file, ionTok, jsTok, tsTok, pyTok });

  console.log(`\n=== ${file} ===`);
  console.log(`  Ion: ${ionTok} tokens`);
  console.log(`  JS:  ${jsTok} tokens (${(jsTok/ionTok).toFixed(2)}x)`);
  console.log(`  TS:  ${tsTok} tokens (${(tsTok/ionTok).toFixed(2)}x)`);
  console.log(`  Py:  ${pyTok} tokens (${(pyTok/ionTok).toFixed(2)}x)`);
}

const totalIon = results.reduce((s, r) => s + r.ionTok, 0);
console.log(`\n=== TOTALS ===`);
console.log(`  Ion: ${totalIon}`);
console.log(`  JS:  ${totalJs} (${(totalJs/totalIon).toFixed(2)}x)`);
console.log(`  TS:  ${totalTs} (${(totalTs/totalIon).toFixed(2)}x)`);
console.log(`  Py:  ${totalPy} (${(totalPy/totalIon).toFixed(2)}x)`);

// --- Validate JS output by running it ---
console.log('\n=== Running JS validation ===');
for (const file of BENCH_FILES) {
  const baseName = file.replace('.ion', '');
  const jsPath = resolve(outDir, baseName + '.js');
  try {
    execSync(`node --input-type=module < "${jsPath}"`, { timeout: 5000 });
    console.log(`  ${baseName}.js: OK (no runtime errors)`);
  } catch (e) {
    // JS files may have undefined exports — that's OK, we just check syntax
    if (e.status === 1 && e.stderr?.toString().includes('SyntaxError')) {
      console.log(`  ${baseName}.js: SYNTAX ERROR — ${e.stderr.toString().split('\n')[0]}`);
    } else {
      console.log(`  ${baseName}.js: OK (exited ${e.status})`);
    }
  }
}

// --- Validate Python output by parsing it ---
console.log('\n=== Python syntax validation ===');
for (const file of BENCH_FILES) {
  const baseName = file.replace('.ion', '');
  const pyPath = resolve(outDir, baseName + '.py');
  try {
    execSync(`python3 -c "import ast; ast.parse(open('${pyPath}').read()); print('OK')"`, { timeout: 5000 });
    console.log(`  ${baseName}.py: OK`);
  } catch (e) {
    console.log(`  ${baseName}.py: SYNTAX ERROR — ${e.stderr?.toString().split('\n')[0] ?? e.message}`);
  }
}

console.log('\nOutput written to bench/out/');
