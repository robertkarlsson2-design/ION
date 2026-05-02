import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import type { CheckResult } from '../../src/checker/index.js';

function check(src: string): CheckResult {
  const tokens = lex(src, 'test.ion');
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bindResult = bindModule(ast, 'test');
  return checkModule(ast, bindResult, 'test');
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('checkModule — happy path', () => {
  it('fn add(a: Int, b: Int) -> Int = a + b → zero errors', () => {
    const result = check('fn add(a: Int, b: Int) -> Int = a + b');
    const typeErrors = result.errors.filter(e =>
      e.kind !== 'UnannotatedTopLevel',
    );
    expect(typeErrors).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('fn id(x: Int) -> Int = let y = x; y → zero errors, y inferred as Int', () => {
    const result = check('fn id(x: Int) -> Int = let y = x; y');
    expect(result.errors).toHaveLength(0);
  });

  it('fn choose(b: Bool, x: Int, y: Int) -> Int = if b then x else y → zero errors', () => {
    const result = check('fn choose(b: Bool, x: Int, y: Int) -> Int = if b then x else y');
    expect(result.errors).toHaveLength(0);
  });

  it('extern fn print(s: Str) -> Unit → zero errors', () => {
    const result = check('extern fn print(s: Str) -> Unit');
    expect(result.errors).toHaveLength(0);
  });

  it('data Color = Red | Green | Blue → zero errors', () => {
    const result = check('data Color = Red | Green | Blue');
    expect(result.errors).toHaveLength(0);
  });

  it('data + match exhaustive → zero errors', () => {
    const src = `
      data Color = Red | Green | Blue
      fn count(c: Color) -> Int = match c | Red -> 1 | Green -> 2 | Blue -> 3
    `;
    const result = check(src);
    expect(result.errors).toHaveLength(0);
  });

  it('match with wildcard covers remaining → zero errors', () => {
    const src = `
      data Color = Red | Green | Blue
      fn count(c: Color) -> Int = match c | Red -> 1 | _ -> 0
    `;
    const result = check(src);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe('checkModule — error cases', () => {
  it('fn bad(x: Int) -> Str = x → TypeMismatch (Int vs Str)', () => {
    const result = check('fn bad(x: Int) -> Str = x');
    const mm = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(mm.length).toBeGreaterThan(0);
    const err = mm[0];
    if (err?.kind === 'TypeMismatch') {
      // unify(bodyType=Int, declaredRet=Str) → expected=Int, found=Str
      expect(err.expected.kind).toBe('Int');
      expect(err.found.kind).toBe('Str');
    }
  });

  it('fn foo(x: Int) = x → infers without explicit return type (no error)', () => {
    // checker/index.ts infers a fresh TypeVar for missing return type; no error emitted
    const result = check('fn foo(x: Int) = x');
    expect(result.errors).toHaveLength(0);
  });

  it('fn op(x: Int) -> Int = x? → InvalidPropagate', () => {
    const result = check('fn op(x: Int) -> Int = x?');
    const ip = result.errors.filter(e => e.kind === 'InvalidPropagate');
    expect(ip.length).toBeGreaterThan(0);
    const err = ip[0];
    if (err?.kind === 'InvalidPropagate') {
      expect(err.found.kind).toBe('Int');
    }
  });

  it('non-exhaustive match without wildcard → NonExhaustiveMatch', () => {
    const src = `
      data Color = Red | Green | Blue
      fn nonexhaustive(c: Color) -> Int = match c | Red -> 1
    `;
    const result = check(src);
    const im = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(im.length).toBeGreaterThan(0);
    const err = im[0];
    if (err?.kind === 'NonExhaustiveMatch') {
      expect(err.missing).toContain('Green');
      expect(err.missing).toContain('Blue');
    }
  });

  it('top-level let without annotation → UnannotatedTopLevel', () => {
    const result = check('let x = 42');
    const ma = result.errors.filter(e => e.kind === 'UnannotatedTopLevel');
    expect(ma.length).toBeGreaterThan(0);
  });

  it('if-else branch type mismatch → TypeMismatch', () => {
    const result = check('fn bad(b: Bool) -> Int = if b then 1 else true');
    const mm = result.errors.filter(e => e.kind === 'TypeMismatch');
    expect(mm.length).toBeGreaterThan(0);
  });
});

describe('checkModule — raw() expression', () => {
  it('let x: Str = raw("`json`") → zero errors', () => {
    const result = check('let x: Str = raw("`json`")');
    expect(result.errors).toHaveLength(0);
  });

  it('fn f() -> Int = raw("42") → zero errors', () => {
    const result = check('fn f() -> Int = raw("42")');
    expect(result.errors).toHaveLength(0);
  });
});
