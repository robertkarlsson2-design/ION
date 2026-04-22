import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseDeclaration, parseModule, ParseError } from '../../src/parser/declarations.js';
import type {
  DeclNode,
  ModuleNode,
  FnDeclNode,
  LetDeclNode,
  DataDeclNode,
  TypeAliasDeclNode,
  UseDeclNode,
  ExternDeclNode,
  ModuleDeclNode,
} from '../../src/parser/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDecl(src: string): DeclNode {
  return parseDeclaration(lex(src, 'test.ion'));
}

function parseMod(src: string): ModuleNode {
  return parseModule(lex(src, 'test.ion'));
}

function asKind<K extends DeclNode['kind']>(
  node: DeclNode,
  kind: K,
): Extract<DeclNode, { kind: K }> {
  expect(node.kind).toBe(kind);
  return node as Extract<DeclNode, { kind: K }>;
}

// ---------------------------------------------------------------------------
// fn declarations
// ---------------------------------------------------------------------------

describe('fn declarations', () => {
  it('bare fn with no params, no return type', () => {
    const node = asKind(parseDecl('fn foo() = 42'), 'FnDecl') as FnDeclNode;
    expect(node.pub).toBe(false);
    expect(node.name).toBe('foo');
    expect(node.typeParams).toHaveLength(0);
    expect(node.params).toHaveLength(0);
    expect(node.effects).toHaveLength(0);
    expect(node.returnType).toBeNull();
    expect(node.body.kind).toBe('LiteralInt');
    expect(node.attributes).toHaveLength(0);
  });

  it('fn with return type', () => {
    const node = asKind(parseDecl('fn add(a: Int, b: Int) -> Int = a + b'), 'FnDecl') as FnDeclNode;
    expect(node.name).toBe('add');
    expect(node.params).toHaveLength(2);
    expect(node.params[0]?.name).toBe('a');
    expect(node.params[0]?.type_?.kind).toBe('Named');
    expect(node.params[1]?.name).toBe('b');
    expect(node.returnType?.kind).toBe('Named');
    expect(node.body.kind).toBe('BinopExpr');
  });

  it('fn with type params', () => {
    const node = asKind(parseDecl('fn id<T>(x: T) -> T = x'), 'FnDecl') as FnDeclNode;
    expect(node.typeParams).toEqual(['T']);
    expect(node.returnType?.kind).toBe('Named');
  });

  it('fn with multiple type params', () => {
    const node = asKind(parseDecl('fn map<A, B>(f: A, x: A) -> B = f'), 'FnDecl') as FnDeclNode;
    expect(node.typeParams).toEqual(['A', 'B']);
  });

  it('fn with effect annotation', () => {
    const node = asKind(parseDecl('fn readFile(path: Str) !io -> Str = path'), 'FnDecl') as FnDeclNode;
    expect(node.effects).toEqual(['io']);
  });

  it('fn with multiple effects', () => {
    const node = asKind(parseDecl('fn fetch(url: Str) !io !async -> Str = url'), 'FnDecl') as FnDeclNode;
    expect(node.effects).toEqual(['io', 'async']);
  });

  it('pub fn', () => {
    const node = asKind(parseDecl('pub fn greet() = "hi"'), 'FnDecl') as FnDeclNode;
    expect(node.pub).toBe(true);
    expect(node.name).toBe('greet');
  });

  it('fn with expression body containing match', () => {
    const src = 'fn classify(n: Int) -> Str = match n | 0 -> "zero" | _ -> "other"';
    const node = asKind(parseDecl(src), 'FnDecl') as FnDeclNode;
    expect(node.body.kind).toBe('MatchExpr');
  });

  it('fn with generic return type', () => {
    const node = asKind(parseDecl('fn wrap<T>(x: T) -> Option<T> = x'), 'FnDecl') as FnDeclNode;
    expect(node.returnType?.kind).toBe('Generic');
  });
});

// ---------------------------------------------------------------------------
// @external attribute
// ---------------------------------------------------------------------------

describe('@external attribute', () => {
  it('@external on fn decl', () => {
    const node = asKind(parseDecl('@external fn native() = 0'), 'FnDecl') as FnDeclNode;
    expect(node.attributes).toHaveLength(1);
    expect(node.attributes[0]?.name).toBe('external');
    expect(node.attributes[0]?.args).toHaveLength(0);
  });

  it('@external with args on fn decl', () => {
    const node = asKind(parseDecl('@external(js) fn native() = 0'), 'FnDecl') as FnDeclNode;
    expect(node.attributes[0]?.name).toBe('external');
    expect(node.attributes[0]?.args).toEqual(['js']);
  });

  it('@external on extern fn', () => {
    const node = asKind(parseDecl('@external extern fn jsConsole(msg: Str) !io'), 'ExternDecl') as ExternDeclNode;
    expect(node.attributes).toHaveLength(1);
    expect(node.attributes[0]?.name).toBe('external');
  });
});

// ---------------------------------------------------------------------------
// let declarations
// ---------------------------------------------------------------------------

describe('let declarations', () => {
  it('bare let binding', () => {
    const node = asKind(parseDecl('let x = 42'), 'LetDecl') as LetDeclNode;
    expect(node.pub).toBe(false);
    expect(node.name).toBe('x');
    expect(node.type_).toBeNull();
    expect(node.value.kind).toBe('LiteralInt');
  });

  it('let with type annotation', () => {
    const node = asKind(parseDecl('let pi: Float = 3.14'), 'LetDecl') as LetDeclNode;
    expect(node.name).toBe('pi');
    expect(node.type_?.kind).toBe('Named');
    expect(node.value.kind).toBe('LiteralFloat');
  });

  it('pub let binding', () => {
    const node = asKind(parseDecl('pub let answer = 42'), 'LetDecl') as LetDeclNode;
    expect(node.pub).toBe(true);
  });

  it('let with complex expression', () => {
    const node = asKind(parseDecl('let result = if true then 1 else 0'), 'LetDecl') as LetDeclNode;
    expect(node.value.kind).toBe('IfElseExpr');
  });
});

// ---------------------------------------------------------------------------
// data declarations
// ---------------------------------------------------------------------------

describe('data declarations', () => {
  it('unit variant only', () => {
    const node = asKind(parseDecl('data Color = Red | Green | Blue'), 'DataDecl') as DataDeclNode;
    expect(node.pub).toBe(false);
    expect(node.name).toBe('Color');
    expect(node.variants).toHaveLength(3);
    expect(node.variants[0]?.kind).toBe('UnitVariant');
    expect(node.variants[0]?.name).toBe('Red');
    expect(node.variants[1]?.name).toBe('Green');
    expect(node.variants[2]?.name).toBe('Blue');
  });

  it('tuple variant', () => {
    const node = asKind(parseDecl('data Option<T> = Some(T) | None'), 'DataDecl') as DataDeclNode;
    expect(node.typeParams).toEqual(['T']);
    expect(node.variants).toHaveLength(2);
    const some = node.variants[0];
    expect(some?.kind).toBe('TupleVariant');
    if (some?.kind === 'TupleVariant') {
      expect(some.fields).toHaveLength(1);
      expect(some.fields[0]?.kind).toBe('Named');
    }
    expect(node.variants[1]?.kind).toBe('UnitVariant');
  });

  it('tuple variant with multiple fields', () => {
    const node = asKind(parseDecl('data Pair<A, B> = Pair(A, B)'), 'DataDecl') as DataDeclNode;
    expect(node.typeParams).toEqual(['A', 'B']);
    const v = node.variants[0];
    expect(v?.kind).toBe('TupleVariant');
    if (v?.kind === 'TupleVariant') expect(v.fields).toHaveLength(2);
  });

  it('record variant', () => {
    const node = asKind(parseDecl('data Point = Point { x: Float; y: Float }'), 'DataDecl') as DataDeclNode;
    const v = node.variants[0];
    expect(v?.kind).toBe('RecordVariant');
    if (v?.kind === 'RecordVariant') {
      expect(v.fields).toHaveLength(2);
      expect(v.fields[0]?.name).toBe('x');
      expect(v.fields[1]?.name).toBe('y');
    }
  });

  it('pub data declaration', () => {
    const node = asKind(parseDecl('pub data Bool = True | False'), 'DataDecl') as DataDeclNode;
    expect(node.pub).toBe(true);
  });

  it('generic data with multiple type params', () => {
    const node = asKind(parseDecl('data Result<T, E> = Ok(T) | Err(E)'), 'DataDecl') as DataDeclNode;
    expect(node.typeParams).toEqual(['T', 'E']);
    expect(node.variants).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// type alias declarations
// ---------------------------------------------------------------------------

describe('type alias declarations', () => {
  it('simple type alias', () => {
    const node = asKind(parseDecl('type Str = String'), 'TypeAliasDecl') as TypeAliasDeclNode;
    expect(node.pub).toBe(false);
    expect(node.name).toBe('Str');
    expect(node.typeParams).toHaveLength(0);
    expect(node.type_.kind).toBe('Named');
  });

  it('type alias with type params', () => {
    const node = asKind(parseDecl('type Pair<A, B> = Tuple<A, B>'), 'TypeAliasDecl') as TypeAliasDeclNode;
    expect(node.typeParams).toEqual(['A', 'B']);
    expect(node.type_.kind).toBe('Generic');
  });

  it('pub type alias', () => {
    const node = asKind(parseDecl('pub type Id = Int'), 'TypeAliasDecl') as TypeAliasDeclNode;
    expect(node.pub).toBe(true);
  });

  it('fn type annotation alias', () => {
    const node = asKind(parseDecl('type Callback = fn(Int) -> Bool'), 'TypeAliasDecl') as TypeAliasDeclNode;
    expect(node.type_.kind).toBe('Fn');
  });

  it('tuple type annotation alias', () => {
    const node = asKind(parseDecl('type Point = (Float, Float)'), 'TypeAliasDecl') as TypeAliasDeclNode;
    expect(node.type_.kind).toBe('Tuple');
  });
});

// ---------------------------------------------------------------------------
// use declarations
// ---------------------------------------------------------------------------

describe('use declarations', () => {
  it('single segment', () => {
    const node = asKind(parseDecl('use Foo'), 'UseDecl') as UseDeclNode;
    expect(node.path).toEqual(['Foo']);
    expect(node.items).toBeNull();
  });

  it('dotted path', () => {
    const node = asKind(parseDecl('use a.b.C'), 'UseDecl') as UseDeclNode;
    expect(node.path).toEqual(['a', 'b', 'C']);
    expect(node.items).toBeNull();
  });

  it('brace-set items', () => {
    const node = asKind(parseDecl('use a.b.{Foo, Bar}'), 'UseDecl') as UseDeclNode;
    expect(node.path).toEqual(['a', 'b']);
    expect(node.items).toEqual(['Foo', 'Bar']);
  });

  it('single brace item', () => {
    const node = asKind(parseDecl('use std.{List}'), 'UseDecl') as UseDeclNode;
    expect(node.path).toEqual(['std']);
    expect(node.items).toEqual(['List']);
  });
});

// ---------------------------------------------------------------------------
// extern declarations
// ---------------------------------------------------------------------------

describe('extern declarations', () => {
  it('extern fn with no params, no return type', () => {
    const node = asKind(parseDecl('extern fn noop()'), 'ExternDecl') as ExternDeclNode;
    expect(node.pub).toBe(false);
    expect(node.name).toBe('noop');
    expect(node.params).toHaveLength(0);
    expect(node.effects).toHaveLength(0);
    expect(node.returnType).toBeNull();
    expect(node.attributes).toHaveLength(0);
  });

  it('extern fn with params and return type', () => {
    const node = asKind(parseDecl('extern fn strlen(s: Str) -> Int'), 'ExternDecl') as ExternDeclNode;
    expect(node.params).toHaveLength(1);
    expect(node.params[0]?.name).toBe('s');
    expect(node.returnType?.kind).toBe('Named');
  });

  it('extern fn with effects', () => {
    const node = asKind(parseDecl('extern fn getEnv(key: Str) !io -> Option<Str>'), 'ExternDecl') as ExternDeclNode;
    expect(node.effects).toEqual(['io']);
    expect(node.returnType?.kind).toBe('Generic');
  });

  it('pub extern fn', () => {
    const node = asKind(parseDecl('pub extern fn log(msg: Str) !io'), 'ExternDecl') as ExternDeclNode;
    expect(node.pub).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// module declarations
// ---------------------------------------------------------------------------

describe('module declarations', () => {
  it('empty module body', () => {
    const node = asKind(parseDecl('module Foo {}'), 'ModuleDecl') as ModuleDeclNode;
    expect(node.pub).toBe(false);
    expect(node.name).toBe('Foo');
    expect(node.decls).toHaveLength(0);
  });

  it('module with single declaration', () => {
    const node = asKind(parseDecl('module Math { fn pi() = 3 }'), 'ModuleDecl') as ModuleDeclNode;
    expect(node.name).toBe('Math');
    expect(node.decls).toHaveLength(1);
    expect(node.decls[0]?.kind).toBe('FnDecl');
  });

  it('pub module', () => {
    const node = asKind(parseDecl('pub module Util {}'), 'ModuleDecl') as ModuleDeclNode;
    expect(node.pub).toBe(true);
  });

  it('nested module', () => {
    const src = 'module Outer { module Inner { fn x() = 1 } }';
    const outer = asKind(parseDecl(src), 'ModuleDecl') as ModuleDeclNode;
    expect(outer.decls).toHaveLength(1);
    const inner = asKind(outer.decls[0]!, 'ModuleDecl') as ModuleDeclNode;
    expect(inner.name).toBe('Inner');
    expect(inner.decls).toHaveLength(1);
  });

  it('module with mixed declarations', () => {
    const src = 'module M { let x = 1 fn f() = x }';
    const node = asKind(parseDecl(src), 'ModuleDecl') as ModuleDeclNode;
    expect(node.decls).toHaveLength(2);
    expect(node.decls[0]?.kind).toBe('LetDecl');
    expect(node.decls[1]?.kind).toBe('FnDecl');
  });
});

// ---------------------------------------------------------------------------
// Multi-declaration module
// ---------------------------------------------------------------------------

describe('parseModule — multi-declaration files', () => {
  it('empty file produces empty module', () => {
    const mod = parseMod('');
    expect(mod.kind).toBe('Module');
    expect(mod.decls).toHaveLength(0);
  });

  it('single fn declaration', () => {
    const mod = parseMod('fn main() = 0');
    expect(mod.decls).toHaveLength(1);
    expect(mod.decls[0]?.kind).toBe('FnDecl');
  });

  it('sequence of mixed declarations', () => {
    const src = [
      'use std.io',
      'let version = 1',
      'data Color = Red | Blue',
      'fn greet(name: Str) -> Str = "hello"',
    ].join('\n');
    const mod = parseMod(src);
    expect(mod.decls).toHaveLength(4);
    expect(mod.decls[0]?.kind).toBe('UseDecl');
    expect(mod.decls[1]?.kind).toBe('LetDecl');
    expect(mod.decls[2]?.kind).toBe('DataDecl');
    expect(mod.decls[3]?.kind).toBe('FnDecl');
  });

  it('span covers full module range', () => {
    const mod = parseMod('fn a() = 1\nfn b() = 2');
    expect(mod.span.startLine).toBe(1);
    expect(mod.span.endLine).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Leading trivia
// ---------------------------------------------------------------------------

describe('leading trivia', () => {
  it('line comment before fn is captured', () => {
    const src = '// greet the user\nfn hello() = "hi"';
    const node = asKind(parseDecl(src), 'FnDecl') as FnDeclNode;
    expect(node.leadingTrivia.length).toBeGreaterThan(0);
    const commentTrivia = node.leadingTrivia.find(t => t.kind === 'LineComment');
    expect(commentTrivia).toBeDefined();
  });

  it('whitespace before let is captured', () => {
    const src = '  let x = 1';
    const node = asKind(parseDecl(src), 'LetDecl') as LetDeclNode;
    expect(node.leadingTrivia.some(t => t.kind === 'Whitespace')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Span correctness
// ---------------------------------------------------------------------------

describe('span correctness', () => {
  it('fn declaration span covers name through body', () => {
    const node = asKind(parseDecl('fn foo() = 42'), 'FnDecl') as FnDeclNode;
    expect(node.span.startCol).toBeLessThan(node.span.endCol);
    expect(node.span.file).toBe('test.ion');
  });

  it('let declaration span starts at kw', () => {
    const node = asKind(parseDecl('let x = 1'), 'LetDecl') as LetDeclNode;
    expect(node.span.startLine).toBe(1);
    expect(node.span.startCol).toBe(0);
  });

  it('data declaration span is non-empty', () => {
    const node = asKind(parseDecl('data X = A | B'), 'DataDecl') as DataDeclNode;
    expect(node.span.endCol).toBeGreaterThan(node.span.startCol);
  });
});

// ---------------------------------------------------------------------------
// Type annotation forms in declaration context
// ---------------------------------------------------------------------------

describe('extended type annotations', () => {
  it('fn type in param', () => {
    const node = asKind(parseDecl('fn apply(f: fn(Int) -> Bool, x: Int) -> Bool = f'), 'FnDecl') as FnDeclNode;
    expect(node.params[0]?.type_?.kind).toBe('Fn');
  });

  it('tuple type as return', () => {
    const node = asKind(parseDecl('fn pair() -> (Int, Str) = 0'), 'FnDecl') as FnDeclNode;
    expect(node.returnType?.kind).toBe('Tuple');
  });

  it('fn type with effects', () => {
    const node = asKind(parseDecl('type Handler = fn(Str) !io -> Unit'), 'TypeAliasDecl') as TypeAliasDeclNode;
    expect(node.type_.kind).toBe('Fn');
    if (node.type_.kind === 'Fn') {
      expect(node.type_.effects).toEqual(['io']);
    }
  });

  it('nested generic types', () => {
    const node = asKind(parseDecl('let x: List<Option<Int>> = x'), 'LetDecl') as LetDeclNode;
    expect(node.type_?.kind).toBe('Generic');
    if (node.type_?.kind === 'Generic') {
      expect(node.type_.args[0]?.kind).toBe('Generic');
    }
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('error cases', () => {
  it('missing = in fn throws ParseError', () => {
    expect(() => parseDecl('fn foo() 42')).toThrow(ParseError);
  });

  it('missing variant name after | in data throws ParseError', () => {
    expect(() => parseDecl('data X = A |')).toThrow(ParseError);
  });

  it('unrecognized declaration keyword throws ParseError', () => {
    expect(() => parseDecl('bogus foo = 1')).toThrow(ParseError);
  });

  it('ParseError carries span', () => {
    try {
      parseDecl('fn foo() 42');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      const pe = e as ParseError;
      expect(pe.span).toBeDefined();
    }
  });

  it('extern without fn keyword throws ParseError', () => {
    expect(() => parseDecl('extern noop()')).toThrow(ParseError);
  });
});
