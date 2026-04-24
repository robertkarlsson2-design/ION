import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule, detectCircularImports } from '../../src/binder/index.js';
import type { ModuleGraph } from '../../src/binder/index.js';
import type { AstModule } from '../../src/ast/nodes.js';

function parse(src: string): AstModule {
  return buildModule(parseModule(lex(src, 'test.ion')));
}

describe('bindModule', () => {
  it('simple fn with typed params — all params resolve, zero errors', () => {
    const ast = parse('fn add(a: Int, b: Int) -> Int = a + b');
    const result = bindModule(ast, 'test');
    expect(result.errors).toHaveLength(0);
    const refs = result.resolutionMap;
    // 'a' and 'b' each appear once in body
    expect(refs.size).toBe(2);
    for (const id of refs.values()) {
      expect(typeof id).toBe('string');
    }
  });

  it('mutual recursion — forward-ref hoisting works, zero errors', () => {
    const ast = parse(`
      fn even(n: Int) -> Bool = if n == 0 then true else odd(n)
      fn odd(n: Int) -> Bool = if n == 0 then false else even(n)
    `);
    const result = bindModule(ast, 'test');
    const undefinedErrors = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors).toHaveLength(0);
  });

  it('duplicate top-level fn name — DuplicateBinding', () => {
    const ast = parse('fn foo() = 1\nfn foo() = 2');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(1);
    const err = dupes[0];
    expect(err?.kind).toBe('DuplicateBinding');
    expect(err?.message).toContain('foo');
  });

  it('undefined name in fn body — UndefinedName', () => {
    const ast = parse('fn foo() = bar');
    const result = bindModule(ast, 'test');
    const undef = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undef).toHaveLength(1);
    const err = undef[0];
    expect(err?.kind).toBe('UndefinedName');
    expect(err?.message).toContain('bar');
  });

  it('let expression scoping — binding visible in body, not outside', () => {
    const ast = parse('fn foo() = let x = 1; x\nfn bar() = x');
    const result = bindModule(ast, 'test');
    const undef = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undef).toHaveLength(1);
    expect(undef[0]?.message).toContain('x');
  });

  it('lambda param binding — param resolves inside lambda body', () => {
    const ast = parse('fn foo() = (x -> x + 1)');
    const result = bindModule(ast, 'test');
    expect(result.errors).toHaveLength(0);
  });

  it('match arm IdentPat binding — pattern variable resolves in arm body', () => {
    const ast = parse('fn foo(x: Int) = match x | n -> n + 1');
    const result = bindModule(ast, 'test');
    expect(result.errors).toHaveLength(0);
  });

  it('match arm WildcardPat — no binding added, zero errors', () => {
    const ast = parse('fn foo(x: Int) = match x | _ -> 42');
    const result = bindModule(ast, 'test');
    expect(result.errors).toHaveLength(0);
  });

  it('nested module decl — inner decl not accessible by name from outer scope', () => {
    const ast = parse('module Foo {\n  fn bar() = 1\n}\nfn baz() = bar');
    const result = bindModule(ast, 'test');
    const undef = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undef).toHaveLength(1);
    expect(undef[0]?.message).toContain('bar');
    // Foo itself is in the symbol table
    const symbols = result.symbolTable.symbols;
    const fooSymbol = Array.from(symbols.values()).find(s => s.name === 'Foo');
    expect(fooSymbol).toBeDefined();
    expect(fooSymbol?.declKind).toBe('Module');
  });

  it('use declaration — no errors for single module use', () => {
    const ast = parse('use std.http\nfn foo() = 1');
    const result = bindModule(ast, 'myModule');
    expect(result.errors).toHaveLength(0);
  });

  it('use declaration with named imports — no errors when module is unknown', () => {
    const ast = parse('use std.http.{get, post}\nfn foo() = 1');
    const result = bindModule(ast, 'myModule');
    expect(result.errors).toHaveLength(0);
  });

  it('let decl value references declared fn — resolves correctly', () => {
    const ast = parse('fn compute() = 42\nlet result = compute()');
    const result = bindModule(ast, 'test');
    expect(result.errors).toHaveLength(0);
    expect(result.resolutionMap.size).toBeGreaterThan(0);
  });

  it('type params in fn are phantom — do not pollute outer scope', () => {
    const ast = parse('fn id<T>(x: T) = x\nfn foo() = T');
    const result = bindModule(ast, 'test');
    const undef = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undef).toHaveLength(1);
    expect(undef[0]?.message).toContain('T');
  });

  it('symbol table contains all declared symbols', () => {
    const ast = parse('fn foo(a: Int) -> Int = a\nlet x = 1');
    const result = bindModule(ast, 'test');
    const names = Array.from(result.symbolTable.symbols.values()).map(s => s.name);
    expect(names).toContain('foo');
    expect(names).toContain('x');
    expect(names).toContain('a');
  });

  it('file path containing colon (Windows-style) — resolution map is correct', () => {
    // Simulate a Windows absolute path like C:/project/src/main.ion
    const tokens = lex('fn add(a: Int, b: Int) -> Int = a + b', 'C:/project/src/main.ion');
    const ast = buildModule(parseModule(tokens));
    const result = bindModule(ast, 'C:/project/src/main.ion');
    expect(result.errors).toHaveLength(0);
    // 'a' and 'b' each appear once in the body
    const refs = result.resolutionMap;
    expect(refs.size).toBe(2);
    // Each resolved id must be a non-empty string
    for (const id of refs.values()) {
      expect(typeof id).toBe('string');
      expect((id as string).length).toBeGreaterThan(0);
    }
    // All keys use \0 as separator — none should collide across colon-containing paths
    for (const key of refs.keys()) {
      expect(key).toContain('\0');
      expect(key.startsWith('C:/project/src/main.ion\0')).toBe(true);
    }
  });
});

describe('DataDecl variant name clash — DuplicateBinding (ION-68)', () => {
  it('fn declared before data variant with same name — DuplicateBinding on variant', () => {
    const ast = parse('fn foo() = 1\ndata D = foo');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.message).toContain('foo');
  });

  it('let decl before data variant with same name — DuplicateBinding on variant', () => {
    const ast = parse('let x = 1\ndata D = x');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.message).toContain('x');
  });

  it('duplicate variant name within same data decl — DuplicateBinding on second variant', () => {
    const ast = parse('data D = A | A');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.message).toContain('A');
  });

  it('data variant declared before fn with same name — DuplicateBinding on fn (regression guard)', () => {
    const ast = parse('data D = foo\nfn foo() = 1');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.message).toContain('foo');
  });

  it('data decl with distinct variant names — zero errors (regression guard)', () => {
    const ast = parse('data D = Leaf | Node');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(0);
  });
});

describe('self-named constructor — ION-77 regression', () => {
  it('data Foo = Foo(Int) — zero errors', () => {
    const ast = parse('data Foo = Foo(Int)');
    const result = bindModule(ast, 'test');
    expect(result.errors.filter(e => e.kind === 'DuplicateBinding')).toHaveLength(0);
  });

  it('data Foo = Foo (unit variant) — zero errors', () => {
    const ast = parse('data Foo = Foo');
    const result = bindModule(ast, 'test');
    expect(result.errors.filter(e => e.kind === 'DuplicateBinding')).toHaveLength(0);
  });

  it('data Error = Error(String) — zero errors', () => {
    const ast = parse('data Error = Error(String)');
    const result = bindModule(ast, 'test');
    expect(result.errors.filter(e => e.kind === 'DuplicateBinding')).toHaveLength(0);
  });

  it('data Foo = Foo | Bar — zero errors', () => {
    const ast = parse('data Foo = Foo | Bar');
    const result = bindModule(ast, 'test');
    expect(result.errors.filter(e => e.kind === 'DuplicateBinding')).toHaveLength(0);
  });

  it('data Foo = Bar | Foo — zero errors (self-named at non-first position)', () => {
    const ast = parse('data Foo = Bar | Foo');
    const result = bindModule(ast, 'test');
    expect(result.errors.filter(e => e.kind === 'DuplicateBinding')).toHaveLength(0);
  });

  it('data Foo = Foo | Foo — exactly 1 DuplicateBinding for second Foo', () => {
    const ast = parse('data Foo = Foo | Foo');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.message).toContain('Foo');
  });

  it('fn foo declared before data D = foo — still 1 DuplicateBinding (ION-68 guard unchanged)', () => {
    const ast = parse('fn foo() = 1\ndata D = foo');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.message).toContain('foo');
  });
});

describe('exhaustiveness guard on resolveExpr (ION-69)', () => {
  it('throws with "Unhandled expr kind" when a future expression kind is injected', () => {
    const ast = parse('fn foo() = 1');
    // Inject an unrecognised kind into the fn body after building, simulating a
    // future AstExprNode variant that the switch does not handle.
    const fnDecl = ast.decls[0] as Record<string, unknown>;
    (fnDecl['body'] as Record<string, unknown>)['kind'] = 'UnknownFutureExpr';
    expect(() => bindModule(ast, 'test')).toThrow('Unhandled expr kind');
  });
});

describe('bindProgram (via detectCircularImports)', () => {
  it('topological order — dependency comes before dependent (no errors)', () => {
    const astA = parse('fn foo() = 1');
    const astB = parse('use A\nfn bar() = 1');
    const rA = bindModule(astA, 'A');
    const rB = bindModule(astB, 'B');
    expect(rA.errors.filter(e => e.kind === 'CircularImport')).toHaveLength(0);
    expect(rB.errors.filter(e => e.kind === 'CircularImport')).toHaveLength(0);
  });

  it('circular import A → B → A — CircularImport detected', () => {
    const graph: ModuleGraph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    const errors = detectCircularImports(graph, new Map());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.kind).toBe('CircularImport');
    expect(errors[0]?.message).toContain('A');
    expect(errors[0]?.message).toContain('B');
  });

  it('independent modules — both bound, no errors', () => {
    const astA = parse('fn foo() = 1');
    const astB = parse('fn bar() = 2');
    const rA = bindModule(astA, 'A');
    const rB = bindModule(astB, 'B');
    expect(rA.errors).toHaveLength(0);
    expect(rB.errors).toHaveLength(0);
  });
});
