import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule, detectCircularImports } from '../../src/binder/index.js';
import type { ModuleGraph } from '../../src/binder/index.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function bind(src: string, modulePath = 'test') {
  return bindModule(buildModule(parseModule(lex(src, 'test.ion'))), modulePath);
}

// ---------------------------------------------------------------------------
// 1. Basic top-level resolution
// ---------------------------------------------------------------------------

describe('basic top-level resolution', () => {
  it('fn declaration registers a symbol with no errors', () => {
    const { symbolTable, errors } = bind('fn foo() = 42');
    expect(errors).toHaveLength(0);
    expect(symbolTable.size()).toBe(1);
    const [entry] = [...symbolTable.all()];
    expect(entry?.name).toBe('foo');
    expect(entry?.declKind).toBe('Fn');
    expect(entry?.isPublic).toBe(false);
  });

  it('let declaration registers a symbol', () => {
    const { symbolTable, errors } = bind('let answer = 42');
    expect(errors).toHaveLength(0);
    const [entry] = [...symbolTable.all()];
    expect(entry?.name).toBe('answer');
    expect(entry?.declKind).toBe('Let');
  });

  it('fn body can reference a top-level let', () => {
    const { resolutionMap, errors, symbolTable } = bind(
      'let x = 1\nfn bar() = x',
    );
    expect(errors).toHaveLength(0);
    expect(symbolTable.size()).toBe(2);
    // resolutionMap must contain an entry for the `x` Ident in bar's body.
    expect(resolutionMap.size).toBeGreaterThan(0);
    const xEntry = [...symbolTable.all()].find(e => e.name === 'x');
    expect([...resolutionMap.values()]).toContain(xEntry?.id);
  });
});

// ---------------------------------------------------------------------------
// 2. Mutual recursion
// ---------------------------------------------------------------------------

describe('mutual recursion', () => {
  it('fn a calls b and fn b calls a — both resolve without errors', () => {
    const { errors, resolutionMap } = bind(
      'fn a() = b()\nfn b() = a()',
    );
    expect(errors).toHaveLength(0);
    // Two Ident references (`b` in a's body, `a` in b's body) resolved.
    expect(resolutionMap.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Undefined name
// ---------------------------------------------------------------------------

describe('undefined name', () => {
  it('referencing an unknown name emits UndefinedName error', () => {
    const { errors } = bind('fn foo() = unknownName');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('UndefinedName');
    expect(errors[0]?.message).toContain('unknownName');
  });

  it('no errors when name is defined in scope', () => {
    const { errors } = bind('let x = 1\nfn foo() = x');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Duplicate binding
// ---------------------------------------------------------------------------

describe('duplicate binding', () => {
  it('two fn decls with the same name emit DuplicateBinding', () => {
    const { errors } = bind('fn foo() = 1\nfn foo() = 2');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('DuplicateBinding');
    expect(errors[0]?.message).toContain('foo');
  });

  it('fn and let with same name emit DuplicateBinding', () => {
    const { errors } = bind('let x = 1\nfn x() = 2');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('DuplicateBinding');
  });
});

// ---------------------------------------------------------------------------
// 5. Parameter scoping
// ---------------------------------------------------------------------------

describe('parameter scoping', () => {
  it('param x in body resolves to the fn param, not an outer let x', () => {
    const { errors, resolutionMap, symbolTable } = bind(
      'let x = 99\nfn double(x: Int) = x * 2',
    );
    expect(errors).toHaveLength(0);
    const paramEntry = [...symbolTable.all()].find(
      e => e.name === 'x' && e.declKind === 'Param',
    );
    expect(paramEntry).toBeDefined();
    // The only resolved `x` reference (in double's body) must map to the param.
    expect([...resolutionMap.values()]).toContain(paramEntry?.id);
  });

  it('type params are in scope within fn signature and body', () => {
    const { errors } = bind('fn id<T>(x: T) -> T = x');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Lambda scoping
// ---------------------------------------------------------------------------

describe('lambda scoping', () => {
  it('lambda param x resolves within lambda body', () => {
    const { errors, resolutionMap, symbolTable } = bind(
      'fn f() = let n = 5; (x -> x + 1)(n)',
    );
    expect(errors).toHaveLength(0);
    const lambdaParam = [...symbolTable.all()].find(
      e => e.name === 'x' && e.declKind === 'Param',
    );
    expect(lambdaParam).toBeDefined();
    expect([...resolutionMap.values()]).toContain(lambdaParam?.id);
  });

  it('lambda param does not leak outside lambda', () => {
    // `x` inside the lambda is fine; but `x` in an outer context (after) is not.
    const { errors } = bind('fn f() = let _lam = (x -> x); x');
    const undefinedErrors = errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. LetExpr scoping
// ---------------------------------------------------------------------------

describe('LetExpr scoping', () => {
  it('let y = 10; y + 1 — y in body resolves correctly', () => {
    const { errors, resolutionMap, symbolTable } = bind(
      'fn f() = let y = 10; y + 1',
    );
    expect(errors).toHaveLength(0);
    const letEntry = [...symbolTable.all()].find(
      e => e.name === 'y' && e.declKind === 'Let',
    );
    expect(letEntry).toBeDefined();
    expect([...resolutionMap.values()]).toContain(letEntry?.id);
  });

  it('value of let is evaluated in outer scope', () => {
    // The value `z` is undefined — it should produce UndefinedName.
    const { errors } = bind('fn f() = let y = z; y');
    const undefinedErrors = errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors).toHaveLength(1);
    expect(undefinedErrors[0]?.message).toContain('z');
  });
});

// ---------------------------------------------------------------------------
// 8. UseDecl imports
// ---------------------------------------------------------------------------

describe('UseDecl imports', () => {
  it('use std.http → alias "http" is in scope', () => {
    const { errors } = bind('use std.http\nfn f() = http');
    expect(errors).toHaveLength(0);
  });

  it('use std.db.{query, insert} → selective names in scope', () => {
    const { errors } = bind(
      'use std.db.{query, insert}\nfn f() = query',
    );
    expect(errors).toHaveLength(0);
  });

  it('unimported name is still undefined', () => {
    const { errors } = bind('use std.http\nfn f() = missing');
    const undefinedErrors = errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Nested module
// ---------------------------------------------------------------------------

describe('nested module', () => {
  it('fn inside nested module gets a SymbolId', () => {
    const { symbolTable, errors } = bind(
      'module Inner { fn ping() = 1 }',
    );
    expect(errors).toHaveLength(0);
    const ping = [...symbolTable.all()].find(e => e.name === 'ping');
    expect(ping).toBeDefined();
    expect(ping?.declKind).toBe('Fn');
  });

  it('name in nested module does not clash with outer name', () => {
    // Both outer `x` and inner `x` can coexist in distinct scopes.
    const { errors } = bind('let x = 1\nmodule M { let x = 2 }');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Match arm pattern bindings
// ---------------------------------------------------------------------------

describe('match arm pattern bindings', () => {
  it('IdentPat v in arm resolves to PatternBinding SymbolId', () => {
    const { errors, symbolTable, resolutionMap } = bind(
      'data Option = Some(Int) | None\nfn f(opt: Option) = match opt | Some(v) -> v | _ -> 0',
    );
    const undefinedErrors = errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors).toHaveLength(0);
    const patEntry = [...symbolTable.all()].find(
      e => e.name === 'v' && e.declKind === 'PatternBinding',
    );
    expect(patEntry).toBeDefined();
    expect([...resolutionMap.values()]).toContain(patEntry?.id);
  });

  it('WildcardPat does not introduce a binding', () => {
    const { symbolTable } = bind(
      'fn f() = match 1 | _ -> 0',
    );
    const wildcard = [...symbolTable.all()].find(
      e => e.name === '_',
    );
    expect(wildcard).toBeUndefined();
  });

  it('ConstructorPat tag resolves to data variant', () => {
    const { errors } = bind(
      'data Color = Red | Green | Blue\nfn f(c: Color) = match c | Red -> 1 | _ -> 0',
    );
    const undefinedErrors = errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors).toHaveLength(0);
  });

  it('unknown ConstructorPat tag emits UndefinedName', () => {
    const { errors } = bind('fn f() = match 1 | Unknown(v) -> v | _ -> 0');
    const undefinedErrors = errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Module graph extraction
// ---------------------------------------------------------------------------

describe('module graph', () => {
  it('use a.b and use c.d → graph has both imported paths', () => {
    const { moduleGraph } = bind('use a.b\nuse c.d', 'mymod');
    const deps = moduleGraph.get('mymod');
    expect(deps).toBeDefined();
    expect(deps?.has('a.b')).toBe(true);
    expect(deps?.has('c.d')).toBe(true);
  });

  it('module with no use decls → graph entry is empty', () => {
    const { moduleGraph } = bind('fn foo() = 1', 'mymod');
    const deps = moduleGraph.get('mymod');
    expect(deps).toBeDefined();
    expect(deps?.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 12. Circular import detection (unit test on detectCircularImports)
// ---------------------------------------------------------------------------

describe('circular import detection', () => {
  it('A→B→A is detected as CircularImport', () => {
    const graph: ModuleGraph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    const errors = detectCircularImports(graph, new Map());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.kind).toBe('CircularImport');
  });

  it('A→B→C (linear) produces no circular import error', () => {
    const graph: ModuleGraph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set()],
    ]);
    const errors = detectCircularImports(graph, new Map());
    expect(errors).toHaveLength(0);
  });

  it('self-import A→A is detected', () => {
    const graph: ModuleGraph = new Map([['A', new Set(['A'])]]);
    const errors = detectCircularImports(graph, new Map());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.kind).toBe('CircularImport');
  });
});

// ---------------------------------------------------------------------------
// 13. Property test: no duplicate SymbolIds
// ---------------------------------------------------------------------------

describe('property: all SymbolIds are unique', () => {
  it('distinct function names produce distinct SymbolIds', () => {
    // Use `f<N>` names to avoid collisions with Ion keywords.
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.nat(9999).map(n => `f${n}`), { minLength: 1, maxLength: 8 }),
        (names) => {
          const src = names.map(n => `fn ${n}() = 1`).join('\n');
          const { symbolTable } = bind(src);
          const ids = [...symbolTable.all()].map(e => e.id);
          const uniqueIds = new Set(ids);
          return uniqueIds.size === ids.length;
        },
      ),
    );
  });
});
