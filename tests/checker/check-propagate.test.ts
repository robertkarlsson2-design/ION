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

describe('checkModule — propagate operator (?)', () => {
  it('? on Option<Int> — infers inner Int, no error', () => {
    const result = check('fn f(x: Option<Int>) -> Int = x?');
    const e404 = result.errors.filter(e => e.kind === 'InvalidPropagate');
    expect(e404).toHaveLength(0);
    expect(result.errors.filter(e => e.kind === 'TypeMismatch')).toHaveLength(0);
  });

  it('? on Result<Str, Str> — infers ok type Str, no error', () => {
    const result = check('fn f(x: Result<Str, Str>) -> Str = x?');
    const e404 = result.errors.filter(e => e.kind === 'InvalidPropagate');
    expect(e404).toHaveLength(0);
    expect(result.errors.filter(e => e.kind === 'TypeMismatch')).toHaveLength(0);
  });

  it('? on Int — E0404 InvalidPropagate', () => {
    const result = check('fn f(x: Int) -> Int = x?');
    const e404 = result.errors.filter(e => e.kind === 'InvalidPropagate');
    expect(e404.length).toBeGreaterThanOrEqual(1);
    expect(e404[0]?.code).toBe('E0404');
  });

  it('? on Str — E0404 InvalidPropagate', () => {
    const result = check('fn f(x: Str) = x?');
    const e404 = result.errors.filter(e => e.kind === 'InvalidPropagate');
    expect(e404.length).toBeGreaterThanOrEqual(1);
    expect(e404[0]?.code).toBe('E0404');
  });
});
