import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import type { BindProgramResult, BindError } from '../../src/binder/index.js';
import type { AstModule } from '../../src/ast/nodes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(src: string): AstModule {
  return buildModule(parseModule(lex(src, 'test.ion')));
}

function bind(src: string) {
  return bindModule(parse(src), 'test.ion');
}

function errorKinds(errors: readonly BindError[]): string[] {
  return errors.map(e => e.kind);
}

function allSymbols(result: BindProgramResult) {
  return [...(result.modules[0]?.symbolTable.symbols.values() ?? [])];
}

function publicNames(result: BindProgramResult): Set<string> {
  return new Set(result.modules[0]?.symbolTable.exports.keys() ?? []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bindModule — empty module', () => {
  it('produces no errors and no symbols', () => {
    const result = bind('');
    expect(result.errors).toHaveLength(0);
    expect(result.modules[0]?.symbolTable.symbols.size ?? 0).toBe(0);
  });
});

describe('bindModule — fn declaration', () => {
  it('registers pub fn and its param, resolves param reference in body', () => {
    const result = bind('pub fn foo(x: Int) -> Int = x');
    expect(result.errors).toHaveLength(0);

    // pub fn foo is in exports
    expect(publicNames(result).has('foo')).toBe(true);

    // foo is an Fn symbol and is pub
    const fooSym = allSymbols(result).find(s => s.name === 'foo');
    expect(fooSym?.kind).toBe('fn');
    expect(fooSym?.name).toBe('foo');
    expect(fooSym?.pub).toBe(true);

    // x is a Param symbol
    const xSym = allSymbols(result).find(s => s.name === 'x');
    expect(xSym?.kind).toBe('fnParam');

    // The Ident 'x' in the body resolves to x's id
    const refValues = Array.from(result.modules[0]?.symbolTable.references.values() ?? []);
    expect(refValues).toContain(xSym?.id);
  });

  it('non-pub fn is in symbols but not in exports', () => {
    const result = bind('fn hidden() = 42');
    expect(result.errors).toHaveLength(0);
    const hiddenSym = allSymbols(result).find(s => s.name === 'hidden');
    expect(hiddenSym?.kind).toBe('fn');
    expect(publicNames(result).has('hidden')).toBe(false);
  });
});

describe('bindModule — undefined name', () => {
  it('emits UndefinedName when a referenced name is not declared', () => {
    const result = bind('let a = b');
    expect(errorKinds(result.errors)).toContain('UndefinedName');
    const err = result.errors.find(e => e.kind === 'UndefinedName');
    expect(err?.kind).toBe('UndefinedName');
    expect(err?.message).toContain('b');
  });
});

describe('bindModule — duplicate binding', () => {
  it('emits DuplicateBinding for two top-level fns with the same name', () => {
    const result = bind('fn foo() = 1\nfn foo() = 2');
    expect(errorKinds(result.errors)).toContain('DuplicateBinding');
    const err = result.errors.find(e => e.kind === 'DuplicateBinding');
    expect(err?.kind).toBe('DuplicateBinding');
    expect(err?.message).toContain('foo');
  });
});

describe('bindModule — LetExpr sequential binding', () => {
  it('resolves inner LetExpr referencing the outer binding', () => {
    const result = bind('fn test() -> Int = let x = 42; let y = x; y');
    expect(result.errors).toHaveLength(0);

    const xSym = allSymbols(result).find(s => s.name === 'x');
    const ySym = allSymbols(result).find(s => s.name === 'y');

    expect(xSym?.kind).toBe('letExprBinding');
    expect(ySym?.kind).toBe('letExprBinding');

    // Both x and y should appear as reference targets
    const refValues = Array.from(result.modules[0]?.symbolTable.references.values() ?? []);
    expect(refValues).toContain(xSym?.id);
    expect(refValues).toContain(ySym?.id);
  });
});

describe('bindModule — forward reference', () => {
  it('resolves forward references via two-pass hoisting', () => {
    const result = bind('pub fn a() -> Int = b()\npub fn b() -> Int = 42');
    expect(result.errors).toHaveLength(0);

    expect(publicNames(result).has('a')).toBe(true);
    expect(publicNames(result).has('b')).toBe(true);

    const bSym = allSymbols(result).find(s => s.name === 'b');
    // The reference to b inside a's body should resolve to b's id
    expect(Array.from(result.modules[0]?.symbolTable.references.values() ?? [])).toContain(bSym?.id);
  });
});

describe('bindModule — match pattern binding', () => {
  it('binds IdentPat as PatternBinding and resolves it in the arm body', () => {
    const result = bind('fn test(e: Int) -> Int = match e | x -> x');
    expect(result.errors).toHaveLength(0);

    const xSym = allSymbols(result).find(s => s.name === 'x' && s.kind === 'patternBinding');
    expect(xSym).toBeDefined();

    // The body reference 'x' resolves to the pattern binding
    expect(Array.from(result.modules[0]?.symbolTable.references.values() ?? [])).toContain(xSym?.id);
  });
});

describe('bindModule — nested module', () => {
  it('registers inner module symbols and makes module name visible in outer scope', () => {
    const src = 'module Inner { pub fn baz() = 42 }\npub fn outer() -> Int = 0';
    const result = bind(src);
    expect(result.errors).toHaveLength(0);

    // 'Inner' is a Module symbol in the outer scope
    const innerModuleSym = allSymbols(result).find(s => s.name === 'Inner');
    expect(innerModuleSym?.kind).toBe('module');

    // 'baz' is an Fn symbol in the overall symbol table
    const bazSym = allSymbols(result).find(s => s.name === 'baz');
    expect(bazSym?.kind).toBe('fn');

    // 'outer' is a top-level pub export
    expect(publicNames(result).has('outer')).toBe(true);
  });
});

describe('bindModule — type parameters', () => {
  it('registers type params as TypeParam symbols', () => {
    const result = bind('fn id<T>(x: T) -> T = x');
    expect(result.errors).toHaveLength(0);

    const tSym = allSymbols(result).find(s => s.name === 'T');
    expect(tSym?.kind).toBe('typeParam');
  });
});
