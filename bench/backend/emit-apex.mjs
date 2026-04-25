import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { decodeModule } = require('/tmp/ion-e2e/dist/src/wire/decoder.js');
const { emitApex } = require('/tmp/ion-e2e/dist/emitters/apex/emit.js');

// Ensure output directory exists
mkdirSync(join(__dirname, 'out'), { recursive: true });

const ion = readFileSync(join(__dirname, 'claims-apex.ion'), 'utf8');
const decoded = decodeModule(ion);
if ('error' in decoded) {
  console.error('Decode error:', decoded.error);
  process.exit(1);
}

const apex = emitApex(decoded);
writeFileSync(join(__dirname, 'out/ClaimsController.cls'), apex);

console.log(`Apex: ${apex.length} bytes`);
console.log('Written to bench/backend/out/ClaimsController.cls');
