// Roundtrip: analytics.ion → decode → emit TypeScript → compare
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load compiled modules
const { decodeModule } = require(join(__dirname, '../../dist/src/wire/decoder.js'));
const { emitTS } = require(join(__dirname, '../../dist/emitters/typescript/emit.js'));

// ── 1. Read the wire file ────────────────────────────────────────────────────
const ionText = readFileSync(join(__dirname, 'analytics.ion'), 'utf8');
const originalTs = readFileSync(join(__dirname, 'analytics.ts'), 'utf8');

console.log('=== analytics.ion wire content ===');
console.log(ionText.trim());
console.log();

// ── 2. Decode wire → IonIR ───────────────────────────────────────────────────
const decoded = decodeModule(ionText);
if (decoded && 'error' in decoded) {
  console.error('Decode error:', decoded.error);
  process.exit(1);
}
const irModule = decoded;

console.log('=== Decoded IonIR module ===');
console.log('Module name:', irModule.name);
console.log('Version:', irModule.version);
console.log('Functions in IR:', irModule.sections?.flatMap(s => s.items ?? []).length ?? 0);
console.log();

// ── 3. Emit TypeScript from IonIR ────────────────────────────────────────────
let emittedTs;
try {
  emittedTs = emitTS(irModule);
} catch (e) {
  console.error('Emit error:', e.message);
  // Try to show what we can about the IR structure
  const items = irModule.sections?.flatMap(s => s.items ?? []) ?? [];
  console.log('IR items:', items.length);
  items.slice(0, 3).forEach((item, i) => {
    console.log(`  [${i}]`, JSON.stringify(item).slice(0, 200));
  });
  process.exit(1);
}

console.log('=== Emitted TypeScript (ION → TS) ===');
console.log(emittedTs);
console.log();

// ── 4. Compare logic preservation ───────────────────────────────────────────
const originalFunctions = [...originalTs.matchAll(/^function (\w+)/gm)].map(m => m[1]);
const emittedFunctions = [...emittedTs.matchAll(/\b(\w+)\s*[=:]/g)].map(m => m[1]);

console.log('=== Logic preservation check ===');
console.log('Original functions:', originalFunctions.length);
console.log('Original function names:', originalFunctions.join(', '));
console.log();

const found = originalFunctions.filter(fn => emittedTs.includes(fn));
const missing = originalFunctions.filter(fn => !emittedTs.includes(fn));

console.log(`Functions preserved in output: ${found.length}/${originalFunctions.length}`);
if (missing.length > 0) {
  console.log('Missing from output:', missing.join(', '));
}

console.log();
console.log('=== Line count comparison ===');
console.log('Original TS:', originalTs.split('\n').length, 'lines');
console.log('ION wire:   ', ionText.split('\n').length, 'lines (compact encoding)');
console.log('Emitted TS: ', emittedTs.split('\n').length, 'lines');
