import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import { desugarModule } from '../../src/desugar/index.js';
import type { ForeignRefNode } from '../../src/ir/nodes.js';
import type { LetNode } from '../../src/ir/nodes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STDLIB_PATH = join(__dirname, '../../emitters/javascript/stdlib.ion');

const src = readFileSync(STDLIB_PATH, 'utf-8');

describe('js stdlib.ion — parse', () => {
  it('lexes and parses without errors', () => {
    expect(() => {
      const tokens = lex(src, 'stdlib.ion');
      parseModule(tokens);
    }).not.toThrow();
  });
});

describe('js stdlib.ion — pipeline', () => {
  const tokens = lex(src, 'stdlib.ion');
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bindResult = bindModule(ast, 'javascript.stdlib');
  const checkResult = checkModule(ast, bindResult, 'javascript.stdlib');
  const irModule = desugarModule(ast, bindResult, checkResult, 'javascript.stdlib', '0.1.0');

  it('binds with no errors', () => {
    expect(bindResult.errors).toHaveLength(0);
  });

  it('type-checks with no errors', () => {
    expect(checkResult.errors).toHaveLength(0);
  });

  it('desugars to an IonIRModule with correct metadata', () => {
    expect(irModule.module).toBe('javascript.stdlib');
    expect(irModule.version).toBe('0.1.0');
    expect(irModule.ionir).toBe('1.0');
  });

  it('desugars all extern decls to Let(ForeignRef) nodes', () => {
    for (const decl of irModule.decls) {
      expect(decl.kind).toBe('Let');
      if (decl.kind === 'Let') {
        expect(decl.value.kind).toBe('ForeignRef');
      }
    }
  });

  it('every ForeignRef has non-empty symbol and template', () => {
    for (const decl of irModule.decls) {
      if (decl.kind !== 'Let') continue;
      const ref = decl.value;
      if (ref.kind !== 'ForeignRef') continue;
      expect(ref.symbol.length).toBeGreaterThan(0);
      expect(ref.sig.template.length).toBeGreaterThan(0);
    }
  });

  it('has at least 140 ForeignRef declarations', () => {
    const foreignRefs = irModule.decls.filter(d => d.kind === 'Let' && d.value.kind === 'ForeignRef');
    expect(foreignRefs.length).toBeGreaterThanOrEqual(140);
  });

  it('spot-check: consoleLog has correct module and template', () => {
    const decl = irModule.decls.find(
      d => d.kind === 'Let' && d.name === 'consoleLog',
    ) as LetNode | undefined;
    expect(decl).toBeDefined();
    expect(decl?.kind).toBe('Let');
    const ref = decl?.value as ForeignRefNode;
    expect(ref.kind).toBe('ForeignRef');
    expect(ref.module).toBe('console');
    expect(ref.symbol).toBe('log');
    expect(ref.sig.template).toBe('console.log($1)');
  });

  it('spot-check: mathSqrt has correct module and template', () => {
    const decl = irModule.decls.find(
      d => d.kind === 'Let' && d.name === 'mathSqrt',
    ) as LetNode | undefined;
    expect(decl).toBeDefined();
    const ref = decl?.value as ForeignRefNode;
    expect(ref.module).toBe('Math');
    expect(ref.symbol).toBe('sqrt');
    expect(ref.sig.template).toBe('Math.sqrt($1)');
  });

  it('spot-check: fsReadFile has correct module and template', () => {
    const decl = irModule.decls.find(
      d => d.kind === 'Let' && d.name === 'fsReadFile',
    ) as LetNode | undefined;
    expect(decl).toBeDefined();
    const ref = decl?.value as ForeignRefNode;
    expect(ref.module).toBe('node:fs/promises');
    expect(ref.sig.template).toBe('fs.readFile($1, $2)');
  });

  it('spot-check: pathJoin has correct module and template', () => {
    const decl = irModule.decls.find(
      d => d.kind === 'Let' && d.name === 'pathJoin',
    ) as LetNode | undefined;
    expect(decl).toBeDefined();
    const ref = decl?.value as ForeignRefNode;
    expect(ref.module).toBe('node:path');
    expect(ref.sig.template).toBe('path.join($1, $2)');
  });

  it('spot-check: jsonStringifyIndented has three-arg template', () => {
    const decl = irModule.decls.find(
      d => d.kind === 'Let' && d.name === 'jsonStringifyIndented',
    ) as LetNode | undefined;
    expect(decl).toBeDefined();
    const ref = decl?.value as ForeignRefNode;
    expect(ref.sig.template).toBe('JSON.stringify($1, null, $2)');
  });

  it('spot-check: arrayPush template uses instance method syntax', () => {
    const decl = irModule.decls.find(
      d => d.kind === 'Let' && d.name === 'arrayPush',
    ) as LetNode | undefined;
    expect(decl).toBeDefined();
    const ref = decl?.value as ForeignRefNode;
    expect(ref.sig.template).toBe('$1.push($2)');
  });
});
