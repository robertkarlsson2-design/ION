import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule, bindProgram } from '../../src/binder/index.js';
import type { ModuleBindResult } from '../../src/binder/types.js';

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function bind(src: string): ModuleBindResult {
  const tokens = lex(src, 'test.ion');
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  return bindModule(ast, 'test.ion');
}

// ---------------------------------------------------------------------------
// Declaration registration
// ---------------------------------------------------------------------------

describe('declaration registration', () => {
  it('registers fn declaration', () => {
    const result = bind('fn foo(x: Int) -> Int = x');
    const fn_ = [...result.symbols.values()].find(s => s.name === 'foo');
    expect(fn_?.kind).toBe('fn');
  });

  it('registers let declaration', () => {
    const result = bind('let x = 42');
    const sym = [...result.symbols.values()].find(s => s.name === 'x');
    expect(sym?.kind).toBe('let');
  });

  it('registers data declaration', () => {
    const result = bind('data Color = Red | Green | Blue');
    const sym = [...result.symbols.values()].find(s => s.name === 'Color');
    expect(sym?.kind).toBe('data');
  });

  it('registers type alias declaration', () => {
    const result = bind('type MyInt = Int');
    const sym = [...result.symbols.values()].find(s => s.name === 'MyInt');
    expect(sym?.kind).toBe('type-alias');
  });

  it('registers extern declaration', () => {
    const result = bind('extern fn print(msg: Str)');
    const sym = [...result.symbols.values()].find(s => s.name === 'print');
    expect(sym?.kind).toBe('extern');
  });
});

// ---------------------------------------------------------------------------
// Pub / exports
// ---------------------------------------------------------------------------

describe('pub and exports', () => {
  it('pub fn appears in exports', () => {
    const result = bind('pub fn foo() = 1');
    expect(result.exports.has('foo')).toBe(true);
  });

  it('non-pub fn does not appear in exports', () => {
    const result = bind('fn foo() = 1');
    expect(result.exports.has('foo')).toBe(false);
  });

  it('pub let appears in exports', () => {
    const result = bind('pub let x = 1');
    expect(result.exports.has('x')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Name resolution — identifiers
// ---------------------------------------------------------------------------

describe('name resolution — identifiers', () => {
  it('fn body can reference a module-level fn', () => {
    const result = bind('fn bar() = 1\nfn foo() = bar()');
    expect(result.errors).toHaveLength(0);
  });

  it('fn body can reference a module-level let', () => {
    const result = bind('let x = 1\nfn foo() = x');
    expect(result.errors).toHaveLength(0);
  });

  it('ident resolves to the correct SymbolId', () => {
    const result = bind('fn bar() = 1\nfn foo() = bar()');
    const barSym = [...result.symbols.values()].find(s => s.name === 'bar' && s.kind === 'fn');
    expect(barSym).toBeDefined();
    const resolvedIds = [...result.resolution.values()];
    // Non-null: barSym is defined (asserted above)
    expect(resolvedIds).toContain(barSym!.id);
  });
});

// ---------------------------------------------------------------------------
// Name resolution — fn params
// ---------------------------------------------------------------------------

describe('name resolution — fn params', () => {
  it('param resolves inside fn body', () => {
    const result = bind('fn foo(x: Int) = x');
    expect(result.errors).toHaveLength(0);
    const xSym = [...result.symbols.values()].find(s => s.name === 'x' && s.kind === 'param');
    expect(xSym).toBeDefined();
  });

  it('param not visible outside fn body', () => {
    const result = bind('fn foo(x: Int) = 1\nfn bar() = x');
    expect(result.errors.some(e => e.kind === 'UndefinedName' && e.message.includes("'x'"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Name resolution — let expr
// ---------------------------------------------------------------------------

describe('name resolution — let expr', () => {
  it('let-bound name resolves in body', () => {
    const result = bind('fn foo() = let x = 1; x');
    expect(result.errors).toHaveLength(0);
    const xSym = [...result.symbols.values()].find(s => s.name === 'x' && s.kind === 'let');
    expect(xSym).toBeDefined();
  });

  it('let-bound name not visible outside the let expression', () => {
    const result = bind('fn foo() = let x = 1; 1\nfn bar() = x');
    expect(result.errors.some(e => e.kind === 'UndefinedName' && e.message.includes("'x'"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Name resolution — lambda
// ---------------------------------------------------------------------------

describe('name resolution — lambda', () => {
  it('lambda param resolves inside lambda body', () => {
    const result = bind('let f = x -> x');
    expect(result.errors).toHaveLength(0);
    const xSym = [...result.symbols.values()].find(s => s.name === 'x' && s.kind === 'param');
    expect(xSym).toBeDefined();
  });

  it('lambda param not visible outside lambda', () => {
    const result = bind('let f = x -> 1\nfn bar() = x');
    expect(result.errors.some(e => e.kind === 'UndefinedName' && e.message.includes("'x'"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Name resolution — match patterns
// ---------------------------------------------------------------------------

describe('name resolution — match patterns', () => {
  it('IdentPat variable resolves in arm body', () => {
    const result = bind('fn foo(c: Int) = match c | x -> x');
    expect(result.errors).toHaveLength(0);
    const xSym = [...result.symbols.values()].find(s => s.name === 'x' && s.kind === 'pattern-var');
    expect(xSym).toBeDefined();
  });

  it('pattern variable not visible outside arm', () => {
    const result = bind('fn foo(c: Int) = match c | x -> 1\nfn bar() = x');
    expect(result.errors.some(e => e.kind === 'UndefinedName' && e.message.includes("'x'"))).toBe(true);
  });

  it('ConstructorPat resolves constructor name in scope', () => {
    const result = bind('data Option = Some(Int) | None\nfn foo(o: Option) = match o | Some(v) -> v | _ -> 0');
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Forward references
// ---------------------------------------------------------------------------

describe('forward references', () => {
  it('fn A can call fn B declared after A', () => {
    const result = bind('fn a() = b()\nfn b() = 1');
    expect(result.errors).toHaveLength(0);
  });

  it('mutual recursion resolves without errors', () => {
    const result = bind('fn even(n: Int) = odd(n)\nfn odd(n: Int) = even(n)');
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Shadowing
// ---------------------------------------------------------------------------

describe('shadowing', () => {
  it('inner let binding shadows outer with same name without error', () => {
    const result = bind('fn foo() = let x = 1; let x = 2; x');
    expect(result.errors).toHaveLength(0);
  });

  it('fn param shadows module-level let', () => {
    const result = bind('let x = 1\nfn foo(x: Int) = x');
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Type parameters
// ---------------------------------------------------------------------------

describe('type parameters', () => {
  it('type params create type-param symbols inside fn', () => {
    const result = bind('fn foo<T>(x: T) -> T = x');
    const tSym = [...result.symbols.values()].find(s => s.name === 'T' && s.kind === 'type-param');
    expect(tSym).toBeDefined();
  });

  it('type params are not leaked to module scope', () => {
    const result = bind('fn foo<T>(x: T) -> T = x\nfn bar() = T');
    expect(result.errors.some(e => e.kind === 'UndefinedName' && e.message.includes("'T'"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('errors', () => {
  it('produces UndefinedName error for undeclared reference', () => {
    const result = bind('fn foo() = bar()');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.kind).toBe('UndefinedName');
    expect(result.errors[0]?.message).toContain("'bar'");
  });

  it('produces DuplicateBinding error for two top-level fns with same name', () => {
    const result = bind('fn foo() = 1\nfn foo() = 2');
    expect(result.errors.some(e => e.kind === 'DuplicateBinding' && e.message.includes("'foo'"))).toBe(true);
  });

  it('produces DuplicateBinding error for two top-level lets with same name', () => {
    const result = bind('let x = 1\nlet x = 2');
    expect(result.errors.some(e => e.kind === 'DuplicateBinding')).toBe(true);
  });

  it('error span points to the source location', () => {
    const result = bind('fn foo() = missing');
    const err = result.errors.find(e => e.kind === 'UndefinedName');
    expect(err).toBeDefined();
    expect(err?.span.file).toBe('test.ion');
  });
});

// ---------------------------------------------------------------------------
// use declarations
// ---------------------------------------------------------------------------

describe('use declarations', () => {
  it('use without items imports last segment as alias', () => {
    const result = bind('use std.http');
    expect(result.importedPaths).toContain('std.http');
    const sym = [...result.symbols.values()].find(s => s.name === 'http');
    expect(sym?.kind).toBe('import');
  });

  it('use with items imports each named identifier', () => {
    const result = bind('use std.http.{get, post}');
    expect(result.importedPaths).toContain('std.http');
    const names = [...result.symbols.values()].map(s => s.name);
    expect(names).toContain('get');
    expect(names).toContain('post');
  });

  it('imported name resolves in subsequent fn body', () => {
    const result = bind('use std.http.{fetch}\nfn handler() = fetch()');
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Nested modules
// ---------------------------------------------------------------------------

describe('nested modules', () => {
  it('nested module name is registered in outer scope', () => {
    const result = bind('module inner { fn foo() = 1 }');
    const sym = [...result.symbols.values()].find(s => s.name === 'inner');
    expect(sym?.kind).toBe('module');
  });

  it('nested module fn is registered as a symbol', () => {
    const result = bind('module inner { fn foo() = 1 }');
    const sym = [...result.symbols.values()].find(s => s.name === 'foo');
    expect(sym?.kind).toBe('fn');
  });

  it('names inside nested module do not leak to outer scope', () => {
    const result = bind('module inner { fn foo() = 1 }\nfn bar() = foo()');
    expect(result.errors.some(e => e.kind === 'UndefinedName' && e.message.includes("'foo'"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Variant constructors
// ---------------------------------------------------------------------------

describe('variant constructors', () => {
  it('unit variant constructors registered in module scope', () => {
    const result = bind('data Color = Red | Green | Blue');
    const names = [...result.symbols.values()].map(s => s.name);
    expect(names).toContain('Red');
    expect(names).toContain('Green');
    expect(names).toContain('Blue');
  });

  it('tuple variant constructors registered in module scope', () => {
    const result = bind('data Option<T> = Some(T) | None');
    const names = [...result.symbols.values()].map(s => s.name);
    expect(names).toContain('Some');
    expect(names).toContain('None');
  });

  it('constructor resolves in match pattern', () => {
    const result = bind('data Option = Some(Int) | None\nfn foo(o: Option) = match o | Some(v) -> v | _ -> 0');
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// bindProgram
// ---------------------------------------------------------------------------

describe('bindProgram', () => {
  it('single module has order of length 1', () => {
    const astA = buildModule(parseModule(lex('fn foo() = 1', 'a')));
    const result = bindProgram(new Map([['a', astA]]));
    expect(result.order).toEqual(['a']);
    expect(result.errors).toHaveLength(0);
  });

  it('dependency comes before dependent in order', () => {
    const astA = buildModule(parseModule(lex('use b\nfn foo() = 1', 'a')));
    const astB = buildModule(parseModule(lex('fn bar() = 1', 'b')));
    const result = bindProgram(new Map([['a', astA], ['b', astB]]));
    const bIdx = result.order.indexOf('b');
    const aIdx = result.order.indexOf('a');
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeGreaterThan(bIdx);
    expect(result.errors).toHaveLength(0);
  });

  it('circular import produces CircularImport errors', () => {
    const astA = buildModule(parseModule(lex('use b', 'a')));
    const astB = buildModule(parseModule(lex('use a', 'b')));
    const result = bindProgram(new Map([['a', astA], ['b', astB]]));
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every(e => e.kind === 'CircularImport')).toBe(true);
    const messages = result.errors.map(e => e.message);
    expect(messages.some(m => m.includes("'a'"))).toBe(true);
    expect(messages.some(m => m.includes("'b'"))).toBe(true);
  });
});
