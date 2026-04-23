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

describe('checkModule — functions', () => {
  it('fn double(x: Int) = x * 2 — infers body as Int, no errors', () => {
    const result = check('fn double(x: Int) = x * 2');
    expect(result.errors).toHaveLength(0);
  });

  it('fn greet(name: Str) -> Str = "Hello" — annotated return matches body, no errors', () => {
    const result = check('fn greet(name: Str) -> Str = "Hello"');
    expect(result.errors).toHaveLength(0);
  });

  it('fn bad(x: Int) -> Str = x — body Int vs declared Str → TypeMismatch', () => {
    const result = check('fn bad(x: Int) -> Str = x');
    const typeErrors = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(typeErrors.length).toBeGreaterThanOrEqual(1);
    expect(typeErrors[0]?.code).toBe('E0401');
  });

  it('top-level let x = 42 with no annotation → E0402', () => {
    const result = check('let x = 42');
    const e402 = result.errors.filter(e => e.kind === 'UnannotatedTopLevel');
    expect(e402.length).toBeGreaterThanOrEqual(1);
    expect(e402[0]?.code).toBe('E0402');
    expect(e402[0]?.name).toBe('x');
  });

  it('top-level let x: Int = 42 — no error', () => {
    const result = check('let x: Int = 42');
    const e402 = result.errors.filter(e => e.kind === 'UnannotatedTopLevel');
    expect(e402).toHaveLength(0);
    const typeMismatch = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(typeMismatch).toHaveLength(0);
  });

  it('fn with no params and Int body inferred — no errors', () => {
    const result = check('fn answer() = 42');
    expect(result.errors).toHaveLength(0);
  });

  it('fn with return type annotation matching inferred body — no errors', () => {
    const result = check('fn f() -> Int = 100');
    expect(result.errors).toHaveLength(0);
  });

  it('fn body type mismatches declared return → TypeMismatch', () => {
    const result = check('fn f() -> Bool = 42');
    const errs = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});
