import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule, detectCircularImports } from '../../src/binder/index.js';
import { buildModuleGraph } from '../../src/binder/module-graph.js';
import type { ModuleGraph } from '../../src/binder/index.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function bind(src: string, modulePath = 'test') {
  return bindModule(buildModule(parseModule(lex(src, 'test.ion'))), modulePath);
}

function symbols(src: string, modulePath = 'test') {
  return Array.from(bind(src, modulePath).modules[0]!.symbolTable.symbols.values());
}

function refs(src: string, modulePath = 'test') {
  return bind(src, modulePath).modules[0]!.symbolTable.references;
}

// ---------------------------------------------------------------------------
// 1. Basic top-level resolution
// ---------------------------------------------------------------------------

describe('basic top-level resolution', () => {
  it('fn declaration registers a symbol with no errors', () => {
    const result = bind('fn foo() = 42');
    expect(result.errors).toHaveLength(0);
    const syms = Array.from(result.modules[0]!.symbolTable.symbols.values());
    expect(syms).toHaveLength(1);
    const [entry] = syms;
    expect(entry?.name).toBe('foo');
    expect(entry?.kind).toBe('fn');
    expect(entry?.pub).toBe(false);
  });

  it('let declaration registers a symbol', () => {
    const result = bind('let answer = 42');
    expect(result.errors).toHaveLength(0);
    const syms = Array.from(result.modules[0]!.symbolTable.symbols.values());
    const [entry] = syms;
    expect(entry?.name).toBe('answer');
    expect(entry?.kind).toBe('let');
  });

  it('fn body can reference a top-level let', () => {
    const result = bind('let x = 1\nfn bar() = x');
    const { symbols: syms, references } = result.modules[0]!.symbolTable;
    expect(result.errors).toHaveLength(0);
    expect(syms.size).toBe(2);
    expect(references.size).toBeGreaterThan(0);
    const xEntry = Array.from(syms.values()).find(e => e.name === 'x');
    expect(Array.from(references.values())).toContain(xEntry?.id);
  });
});

// ---------------------------------------------------------------------------
// 2. Mutual recursion
// ---------------------------------------------------------------------------

describe('mutual recursion', () => {
  it('fn a calls b and fn b calls a — both resolve without errors', () => {
    const result = bind('fn a() = b()\nfn b() = a()');
    expect(result.errors).toHaveLength(0);
    expect(result.modules[0]!.symbolTable.references.size).toBe(2);
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
    const result = bind('let x = 99\nfn double(x: Int) = x * 2');
    const { symbols: syms, references } = result.modules[0]!.symbolTable;
    expect(result.errors).toHaveLength(0);
    const paramEntry = Array.from(syms.values()).find(
      e => e.name === 'x' && e.kind === 'fnParam',
    );
    expect(paramEntry).toBeDefined();
    expect(Array.from(references.values())).toContain(paramEntry?.id);
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
    const result = bind('fn f() = let n = 5; (x -> x + 1)(n)');
    const { symbols: syms, references } = result.modules[0]!.symbolTable;
    expect(result.errors).toHaveLength(0);
    const lambdaParam = Array.from(syms.values()).find(
      e => e.name === 'x' && e.kind === 'fnParam',
    );
    expect(lambdaParam).toBeDefined();
    expect(Array.from(references.values())).toContain(lambdaParam?.id);
  });

  it('lambda param does not leak outside lambda', () => {
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
    const result = bind('fn f() = let y = 10; y + 1');
    const { symbols: syms, references } = result.modules[0]!.symbolTable;
    expect(result.errors).toHaveLength(0);
    const letEntry = Array.from(syms.values()).find(
      e => e.name === 'y' && e.kind === 'letExprBinding',
    );
    expect(letEntry).toBeDefined();
    expect(Array.from(references.values())).toContain(letEntry?.id);
  });

  it('value of let is evaluated in outer scope', () => {
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
    const { errors } = bind('use std.db.{query, insert}\nfn f() = query');
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
    const result = bind('module Inner { fn ping() = 1 }');
    expect(result.errors).toHaveLength(0);
    const syms = Array.from(result.modules[0]!.symbolTable.symbols.values());
    const ping = syms.find(e => e.name === 'ping');
    expect(ping).toBeDefined();
    expect(ping?.kind).toBe('fn');
  });

  it('name in nested module does not clash with outer name', () => {
    const { errors } = bind('let x = 1\nmodule M { let x = 2 }');
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Match arm pattern bindings
// ---------------------------------------------------------------------------

describe('match arm pattern bindings', () => {
  it('IdentPat v in arm resolves to PatternBinding SymbolId', () => {
    const result = bind(
      'data Option = Some(Int) | None\nfn f(opt: Option) = match opt | Some(v) -> v | _ -> 0',
    );
    const { symbols: syms, references } = result.modules[0]!.symbolTable;
    const undefinedErrors = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors).toHaveLength(0);
    const patEntry = Array.from(syms.values()).find(
      e => e.name === 'v' && e.kind === 'patternBinding',
    );
    expect(patEntry).toBeDefined();
    expect(Array.from(references.values())).toContain(patEntry?.id);
  });

  it('WildcardPat does not introduce a binding', () => {
    const result = bind('fn f() = match 1 | _ -> 0');
    const syms = Array.from(result.modules[0]!.symbolTable.symbols.values());
    const wildcard = syms.find(e => e.name === '_');
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
// 11. Module graph extraction (via buildModuleGraph directly)
// ---------------------------------------------------------------------------

describe('module graph', () => {
  it('use a.b and use c.d → graph has both imported paths', () => {
    const ast = buildModule(parseModule(lex('use a.b\nuse c.d', 'test.ion')));
    const graph = buildModuleGraph('mymod', ast.decls);
    const deps = graph.get('mymod');
    expect(deps).toBeDefined();
    expect(deps?.has('a.b')).toBe(true);
    expect(deps?.has('c.d')).toBe(true);
  });

  it('module with no use decls → graph entry is empty', () => {
    const ast = buildModule(parseModule(lex('fn foo() = 1', 'test.ion')));
    const graph = buildModuleGraph('mymod', ast.decls);
    const deps = graph.get('mymod');
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
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.nat(9999).map(n => `f${n}`), { minLength: 1, maxLength: 8 }),
        (names) => {
          const src = names.map(n => `fn ${n}() = 1`).join('\n');
          const result = bind(src);
          const ids = Array.from(result.modules[0]!.symbolTable.symbols.values()).map(e => e.id);
          const uniqueIds = new Set(ids);
          return uniqueIds.size === ids.length;
        },
      ),
    );
  });
});
