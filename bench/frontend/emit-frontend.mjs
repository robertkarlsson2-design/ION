import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { decodeModule } = require('/tmp/ion-e2e/dist/src/wire/decoder.js');
const { emitHTML } = require('/tmp/ion-e2e/dist/skills/html/emit.js');
const { emitReact } = require('/tmp/ion-e2e/dist/skills/react/emit.js');
const { emitVue } = require('/tmp/ion-e2e/dist/skills/vue/emit.js');

// Ensure output directory exists
mkdirSync(join(__dirname, 'out'), { recursive: true });

const ion = readFileSync(join(__dirname, 'claims-ui.ion'), 'utf8');
const decoded = decodeModule(ion);
if ('error' in decoded) {
  console.error('Decode error:', decoded.error);
  process.exit(1);
}

const html = emitHTML(decoded);
const react = emitReact(decoded);
const vue = emitVue(decoded);

writeFileSync(join(__dirname, 'out/claims.html'), html);
writeFileSync(join(__dirname, 'out/ClaimsPage.tsx'), react);
writeFileSync(join(__dirname, 'out/ClaimsPage.vue'), vue);

console.log(`HTML:  ${html.length} bytes`);
console.log(`React: ${react.length} bytes`);
console.log(`Vue:   ${vue.length} bytes`);
console.log('Written to bench/frontend/out/');
