import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import type { AstModule } from '../../src/ast/nodes.js';

function parse(src: string): AstModule {
  return buildModule(parseModule(lex(src, 'test.ion')));
}

function check(src: string) {
  const ast = parse(src);
  const bindResult = bindModule(ast, 'test.ion');
  return checkModule(ast, bindResult, 'test.ion');
}

describe('checkModule — arity checking (E0406)', () => {
  it('add(1, 2) with 2 params → no error', () => {
    const result = check(`
      fn add(a: Int, b: Int) -> Int = a + b
      fn test() -> Int = add(1, 2)
    `);
    const e406 = result.errors.filter(e => e.kind === 'ArityMismatch');
    expect(e406).toHaveLength(0);
  });

  it('add(1, 2, 3) with 2 params → ArityMismatch (expected 2, found 3)', () => {
    const result = check(`
      fn add(a: Int, b: Int) -> Int = a + b
      fn test() -> Int = add(1, 2, 3)
    `);
    const e406 = result.errors.filter(e => e.kind === 'ArityMismatch');
    expect(e406.length).toBeGreaterThanOrEqual(1);
    expect(e406[0]?.code).toBe('E0406');
    expect(e406[0]?.expected).toBe(2);
    expect(e406[0]?.found).toBe(3);
  });

  it('add(1) with 2 params → ArityMismatch (expected 2, found 1)', () => {
    const result = check(`
      fn add(a: Int, b: Int) -> Int = a + b
      fn test() -> Int = add(1)
    `);
    const e406 = result.errors.filter(e => e.kind === 'ArityMismatch');
    expect(e406.length).toBeGreaterThanOrEqual(1);
    expect(e406[0]?.code).toBe('E0406');
    expect(e406[0]?.expected).toBe(2);
    expect(e406[0]?.found).toBe(1);
  });
});
