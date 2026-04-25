import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { decodeModule } = require('/tmp/ion-e2e/dist/src/wire/decoder.js');
const { emitLWC } = require('/tmp/ion-e2e/dist/emitters/lwc/emit.js');

// Ensure output directory exists
mkdirSync(join(__dirname, 'out'), { recursive: true });

const ion = readFileSync(join(__dirname, 'claims-lwc.ion'), 'utf8');
const decoded = decodeModule(ion);
if ('error' in decoded) {
  console.error('Decode error:', decoded.error);
  process.exit(1);
}

const lwcOut = emitLWC(decoded);
writeFileSync(join(__dirname, 'out/claimsApp.html'), lwcOut.html);
writeFileSync(join(__dirname, 'out/claimsApp.js'), lwcOut.js);
writeFileSync(join(__dirname, 'out/claimsApp.css'), lwcOut.css);
writeFileSync(join(__dirname, 'out/claimsApp.js-meta.xml'), lwcOut.meta);

console.log(`HTML:  ${lwcOut.html.length} bytes`);
console.log(`JS:    ${lwcOut.js.length} bytes`);
console.log(`CSS:   ${lwcOut.css.length} bytes`);
console.log(`Meta:  ${lwcOut.meta.length} bytes`);
console.log('Written to bench/frontend/out/');
