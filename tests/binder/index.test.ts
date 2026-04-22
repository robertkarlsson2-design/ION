import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule, bindProgram } from '../../src/binder/index.js';
import type { AstModule } from '../../src/ast/nodes.js';

function parse(src: string): AstModule {
  return buildModule(parseModule(lex(src, 'test.ion')));
}

describe('bindModule', () => {
  it('simple fn with typed params — all params resolve, zero errors', () => {
    const ast = parse('fn add(a: Int, b: Int) -> Int = a + b');
    const result = bindModule(ast, 'test');
    expect(result.errors).toHaveLength(0);
    // 'a' and 'b' each appear once in body
    expect(result.resolutions.size).toBe(2);
    for (const id of result.resolutions.values()) {
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

  it('duplicate top-level fn name — DuplicateBinding E0302', () => {
    const ast = parse('fn foo() = 1\nfn foo() = 2');
    const result = bindModule(ast, 'test');
    const dupes = result.errors.filter(e => e.kind === 'DuplicateBinding');
    expect(dupes).toHaveLength(1);
    const err = dupes[0];
    expect(err?.kind).toBe('DuplicateBinding');
    expect(err?.code).toBe('E0302');
    if (err?.kind === 'DuplicateBinding') {
      expect(err.name).toBe('foo');
      expect(err.previousSpan).toBeDefined();
    }
  });

  it('undefined name in fn body — UndefinedName E0301', () => {
    const ast = parse('fn foo() = bar');
    const result = bindModule(ast, 'test');
    const undef = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undef).toHaveLength(1);
    const err = undef[0];
    expect(err?.code).toBe('E0301');
    if (err?.kind === 'UndefinedName') {
      expect(err.name).toBe('bar');
    }
  });

  it('let expression scoping — binding visible in body, not outside', () => {
    const ast = parse('fn foo() = let x = 1; x\nfn bar() = x');
    const result = bindModule(ast, 'test');
    const undef = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undef).toHaveLength(1);
    if (undef[0]?.kind === 'UndefinedName') {
      expect(undef[0].name).toBe('x');
    }
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
    if (undef[0]?.kind === 'UndefinedName') {
      expect(undef[0].name).toBe('bar');
    }
    // Foo itself is in the symbol table
    const fooSymbol = [...result.symbolTable.values()].find(s => s.name === 'Foo');
    expect(fooSymbol).toBeDefined();
    expect(fooSymbol?.declKind).toBe('module');
  });

  it('use declaration — module graph edge collected correctly', () => {
    const ast = parse('use std.http\nfn foo() = 1');
    const result = bindModule(ast, 'myModule');
    expect(result.moduleGraph.edges).toHaveLength(1);
    const edge = result.moduleGraph.edges[0]!;
    expect(edge.fromModuleId).toBe('myModule');
    expect(edge.toModuleId).toBe('std.http');
    expect(edge.importedNames).toBeNull();
    expect(edge.alias).toBeNull();
  });

  it('use declaration with named imports — importedNames set correctly', () => {
    const ast = parse('use std.http.{get, post}\nfn foo() = 1');
    const result = bindModule(ast, 'myModule');
    expect(result.moduleGraph.edges).toHaveLength(1);
    const edge = result.moduleGraph.edges[0]!;
    expect(edge.toModuleId).toBe('std.http');
    expect(edge.importedNames).toEqual(['get', 'post']);
  });

  it('let decl value references declared fn — resolves correctly', () => {
    const ast = parse('fn compute() = 42\nlet result = compute()');
    const result = bindModule(ast, 'test');
    expect(result.errors).toHaveLength(0);
    // 'compute' in the let value resolves to the fn symbol
    const computeResolution = [...result.resolutions.entries()]
      .find(([node]) => node.name === 'compute');
    expect(computeResolution).toBeDefined();
  });

  it('type params in fn are phantom — do not pollute outer scope', () => {
    const ast = parse('fn id<T>(x: T) = x\nfn foo() = T');
    const result = bindModule(ast, 'test');
    const undef = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undef).toHaveLength(1);
    if (undef[0]?.kind === 'UndefinedName') {
      expect(undef[0].name).toBe('T');
    }
  });

  it('symbol table contains all declared symbols', () => {
    const ast = parse('fn foo(a: Int) -> Int = a\nlet x = 1');
    const result = bindModule(ast, 'test');
    const names = [...result.symbolTable.values()].map(s => s.name);
    expect(names).toContain('foo');
    expect(names).toContain('x');
    expect(names).toContain('a');
  });

  it('topological order for single module is [moduleId]', () => {
    const ast = parse('fn foo() = 1');
    const result = bindModule(ast, 'myMod');
    expect(result.moduleGraph.topologicalOrder).toEqual(['myMod']);
  });
});

describe('bindProgram', () => {
  it('topological order — dependency comes before dependent', () => {
    const astA = parse('fn foo() = 1');
    const astB = parse('use A\nfn bar() = 1');
    const results = bindProgram(new Map([['A', astA], ['B', astB]]));

    const bResult = results.get('B')!;
    const order = bResult.moduleGraph.topologicalOrder;
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
  });

  it('circular import A → B → A — CircularImport E0303 with both module IDs', () => {
    const astA = parse('use B\nfn foo() = 1');
    const astB = parse('use A\nfn bar() = 1');
    const results = bindProgram(new Map([['A', astA], ['B', astB]]));

    // At least one of the cycle participants should carry the error
    const aErrors = results.get('A')?.errors ?? [];
    const bErrors = results.get('B')?.errors ?? [];
    const allCircular = [...aErrors, ...bErrors].filter(e => e.kind === 'CircularImport');
    expect(allCircular.length).toBeGreaterThan(0);

    const err = allCircular[0]!;
    expect(err.kind).toBe('CircularImport');
    expect(err.code).toBe('E0303');
    if (err.kind === 'CircularImport') {
      expect(err.cycle).toContain('A');
      expect(err.cycle).toContain('B');
    }
  });

  it('independent modules — both bound, no errors', () => {
    const astA = parse('fn foo() = 1');
    const astB = parse('fn bar() = 2');
    const results = bindProgram(new Map([['A', astA], ['B', astB]]));
    expect(results.get('A')?.errors).toHaveLength(0);
    expect(results.get('B')?.errors).toHaveLength(0);
    expect(results.size).toBe(2);
  });
});
