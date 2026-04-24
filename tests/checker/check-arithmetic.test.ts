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

describe('checkModule — arithmetic operand type checking', () => {
  it('Int + Int → no error', () => {
    const result = check('fn f() -> Int = 1 + 2');
    const e401 = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(e401).toHaveLength(0);
  });

  it('Float + Float → no error', () => {
    const result = check('fn f() -> Float = 1.0 + 2.0');
    const e401 = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(e401).toHaveLength(0);
  });

  it('Str + Str → TypeMismatch E0401', () => {
    const result = check('fn f(x: Str, y: Str) -> Int = x + y');
    const e401 = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(e401.length).toBeGreaterThanOrEqual(1);
    expect(e401[0]?.code).toBe('E0401');
  });

  it('Bool * Bool → TypeMismatch E0401', () => {
    const result = check('fn f(x: Bool, y: Bool) -> Int = x * y');
    const e401 = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(e401.length).toBeGreaterThanOrEqual(1);
    expect(e401[0]?.code).toBe('E0401');
  });

  it('unary neg on Str → TypeMismatch E0401', () => {
    const result = check('fn f(x: Str) -> Str = -x');
    const e401 = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(e401.length).toBeGreaterThanOrEqual(1);
    expect(e401[0]?.code).toBe('E0401');
  });
});
