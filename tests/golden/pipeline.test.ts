import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import { desugarModule } from '../../src/desugar/index.js';
import { emitJS } from '../../emitters/javascript/emit.js';

const GOLDEN_DIR = new URL('./js', import.meta.url).pathname;

function compileIonToJs(ionPath: string): string {
  const src = readFileSync(ionPath, 'utf-8');
  const tokens = lex(src, ionPath);
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bindResult = bindModule(ast, ionPath);
  const checkResult = checkModule(ast, bindResult, ionPath);
  const ir = desugarModule(ast, bindResult, checkResult, ionPath, '0.0.0');
  return emitJS(ir);
}

const CASES = readdirSync(GOLDEN_DIR)
  .filter(f => f.endsWith('.ion'))
  .map(f => basename(f, '.ion'))
  .sort();

describe('golden: full pipeline lex → desugar → emitJS', () => {
  for (const name of CASES) {
    it(name, () => {
      const ionPath = join(GOLDEN_DIR, `${name}.ion`);
      const expectedPath = join(GOLDEN_DIR, `${name}.expected.js`);

      const actual = compileIonToJs(ionPath);

      if (!existsSync(expectedPath)) {
        writeFileSync(expectedPath, actual, 'utf-8');
        return;
      }

      const expected = readFileSync(expectedPath, 'utf-8');
      expect(actual).toBe(expected);
    });
  }
});
