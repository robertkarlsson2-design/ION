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

describe('checkModule — effect checking', () => {
  it('fn f() !io -> Int = 42 — body has no effects, declared superset is OK', () => {
    const result = check('fn f() !io -> Int = 42');
    const e405 = result.errors.filter(e => e.kind === 'EffectMismatch');
    expect(e405).toHaveLength(0);
  });

  it('fn f() -> Int = someIoFn() where someIoFn has !io — E0405 unlisted io effect', () => {
    const result = check(`
      fn someIoFn() !io -> Int = 42
      fn f() -> Int = someIoFn()
    `);
    const e405 = result.errors.filter(e => e.kind === 'EffectMismatch');
    expect(e405.length).toBeGreaterThanOrEqual(1);
    expect(e405[0]?.code).toBe('E0405');
    expect(e405[0]?.unexpected).toBe('io');
  });

  it('fn f() !io -> Int = someIoFn() — declared effect matches used effect, no error', () => {
    const result = check(`
      fn someIoFn() !io -> Int = 42
      fn f() !io -> Int = someIoFn()
    `);
    const e405 = result.errors.filter(e => e.kind === 'EffectMismatch');
    expect(e405).toHaveLength(0);
  });

  it('fn with no effects calls pure function — no error', () => {
    const result = check(`
      fn add(x: Int, y: Int) -> Int = x + y
      fn f() -> Int = add(1, 2)
    `);
    const e405 = result.errors.filter(e => e.kind === 'EffectMismatch');
    expect(e405).toHaveLength(0);
  });
});
