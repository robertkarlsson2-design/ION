import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseDeclaration, parseModule, ParseError } from '../../src/parser/declarations.js';
import { buildDecl } from '../../src/ast/builder.js';
import type {
  DeclNode,
  ExternBlockDeclNode,
  ExternBlockItemFn,
  ExternBlockItemType,
  ExternDeclNode,
} from '../../src/parser/index.js';
import type { AstExternBlockDeclNode } from '../../src/ast/nodes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDecl(src: string): DeclNode {
  return parseDeclaration(lex(src, 'test.ion'));
}

function parseMod(src: string) {
  return parseModule(lex(src, 'test.ion'));
}

function asExternBlock(node: DeclNode): ExternBlockDeclNode {
  expect(node.kind).toBe('ExternBlockDecl');
  return node as ExternBlockDeclNode;
}

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe('extern block — basic parsing', () => {
  it('parses an empty extern block', () => {
    const node = asExternBlock(parseDecl('extern "javascript" {}'));
    expect(node.target).toBe('javascript');
    expect(node.items).toHaveLength(0);
    expect(node.pub).toBe(false);
  });

  it('pub extern block sets pub flag', () => {
    const node = asExternBlock(parseDecl('pub extern "javascript" {}'));
    expect(node.pub).toBe(true);
    expect(node.target).toBe('javascript');
  });

  it('parses a single fn item', () => {
    const src = 'extern "javascript" { fn log(msg: Str) !io = "$1.log()" }';
    const node = asExternBlock(parseDecl(src));
    expect(node.items).toHaveLength(1);
    const item = node.items[0] as ExternBlockItemFn;
    expect(item.kind).toBe('ExternBlockItemFn');
    expect(item.name).toBe('log');
    expect(item.params).toHaveLength(1);
    expect(item.params[0]?.name).toBe('msg');
    expect(item.effects).toEqual(['io']);
    expect(item.template).toBe('$1.log()');
  });

  it('parses a fn item with return type', () => {
    const src = 'extern "javascript" { fn toUpperCase(s: Str) -> Str = "$1.toUpperCase()" }';
    const node = asExternBlock(parseDecl(src));
    const item = node.items[0] as ExternBlockItemFn;
    expect(item.returnType?.kind).toBe('Named');
    expect(item.template).toBe('$1.toUpperCase()');
  });

  it('parses a type item', () => {
    const src = 'extern "javascript" { type List<T> = "Array" }';
    const node = asExternBlock(parseDecl(src));
    expect(node.items).toHaveLength(1);
    const item = node.items[0] as ExternBlockItemType;
    expect(item.kind).toBe('ExternBlockItemType');
    expect(item.name).toBe('List');
    expect(item.typeParams).toEqual(['T']);
    expect(item.template).toBe('Array');
  });

  it('parses mixed fn and type items', () => {
    const src = `
      extern "javascript" {
        type List<T> = "Array"
        fn push<T>(arr: List<T>, val: T) !io -> Int = "$1.push($2)"
      }
    `;
    const node = asExternBlock(parseDecl(src));
    expect(node.items).toHaveLength(2);
    expect(node.items[0]?.kind).toBe('ExternBlockItemType');
    expect(node.items[1]?.kind).toBe('ExternBlockItemFn');
  });

  it('parses multiple fn items', () => {
    const src = `
      extern "javascript" {
        fn abs(x: Float) -> Float = "Math.abs($1)"
        fn ceil(x: Float) -> Float = "Math.ceil($1)"
        fn floor(x: Float) -> Float = "Math.floor($1)"
      }
    `;
    const node = asExternBlock(parseDecl(src));
    expect(node.items).toHaveLength(3);
    const names = node.items.map(i => i.name);
    expect(names).toEqual(['abs', 'ceil', 'floor']);
  });
});

// ---------------------------------------------------------------------------
// Generic type params
// ---------------------------------------------------------------------------

describe('extern block — type params', () => {
  it('parses fn with type params', () => {
    const src = 'extern "javascript" { fn map<T, U>(arr: List<T>, f: fn(T) -> U) -> List<U> = "$1.map($2)" }';
    const node = asExternBlock(parseDecl(src));
    const item = node.items[0] as ExternBlockItemFn;
    expect(item.typeParams).toEqual(['T', 'U']);
    expect(item.params).toHaveLength(2);
  });

  it('parses type item without type params', () => {
    const src = 'extern "javascript" { type Json = "any" }';
    const node = asExternBlock(parseDecl(src));
    const item = node.items[0] as ExternBlockItemType;
    expect(item.typeParams).toHaveLength(0);
    expect(item.name).toBe('Json');
  });
});

// ---------------------------------------------------------------------------
// Effect annotations
// ---------------------------------------------------------------------------

describe('extern block — effects', () => {
  it('parses !async effect', () => {
    const src = 'extern "javascript" { fn readFile(p: Str) !async -> Str = "readFile($1)" }';
    const node = asExternBlock(parseDecl(src));
    const item = node.items[0] as ExternBlockItemFn;
    expect(item.effects).toEqual(['async']);
  });

  it('parses multiple effects', () => {
    const src = 'extern "javascript" { fn fetch_(url: Str) !async !io -> a = "fetch($1)" }';
    const node = asExternBlock(parseDecl(src));
    const item = node.items[0] as ExternBlockItemFn;
    expect(item.effects).toContain('async');
    expect(item.effects).toContain('io');
  });

  it('fn with no effects has empty effects array', () => {
    const src = 'extern "javascript" { fn abs(x: Float) -> Float = "Math.abs($1)" }';
    const node = asExternBlock(parseDecl(src));
    const item = node.items[0] as ExternBlockItemFn;
    expect(item.effects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Optional semicolons
// ---------------------------------------------------------------------------

describe('extern block — optional semicolons', () => {
  it('parses items separated by semicolons', () => {
    const src = 'extern "javascript" { fn a() = "$1"; fn b() = "$1"; }';
    const node = asExternBlock(parseDecl(src));
    expect(node.items).toHaveLength(2);
  });

  it('parses items without semicolons', () => {
    const src = 'extern "javascript" { fn a() = "$1" fn b() = "$1" }';
    const node = asExternBlock(parseDecl(src));
    expect(node.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Inline extern fn still works after refactor
// ---------------------------------------------------------------------------

describe('inline extern fn — unchanged behavior', () => {
  it('parses inline extern fn', () => {
    const node = parseDecl('extern fn noop()');
    expect(node.kind).toBe('ExternDecl');
    const ext = node as ExternDeclNode;
    expect(ext.name).toBe('noop');
  });

  it('inline extern fn with attribute', () => {
    const src = '@foreign(fs, readFileSync) extern fn readFileSync(p: Str) !io -> Str';
    const node = parseDecl(src);
    expect(node.kind).toBe('ExternDecl');
  });
});

// ---------------------------------------------------------------------------
// Full module parsing
// ---------------------------------------------------------------------------

describe('extern block — in module context', () => {
  it('parses as a top-level declaration in a module', () => {
    const src = `
      fn hello() = "world"
      extern "javascript" {
        fn log(msg: Str) !io = "console.log($1)"
      }
      fn bye() = "ok"
    `;
    const mod = parseMod(src);
    expect(mod.decls).toHaveLength(3);
    expect(mod.decls[1]?.kind).toBe('ExternBlockDecl');
  });
});

// ---------------------------------------------------------------------------
// AST builder round-trip
// ---------------------------------------------------------------------------

describe('extern block — AST builder', () => {
  it('builds AstExternBlockDeclNode from CST', () => {
    const src = `
      extern "javascript" {
        type List<T> = "Array"
        fn push<T>(arr: List<T>, val: T) !io -> Int = "$1.push($2)"
      }
    `;
    const cst = parseDecl(src);
    const ast = buildDecl(cst) as AstExternBlockDeclNode;
    expect(ast.kind).toBe('ExternBlockDecl');
    expect(ast.target).toBe('javascript');
    expect(ast.items).toHaveLength(2);
    expect(ast.items[0]?.kind).toBe('ExternBlockItemType');
    expect(ast.items[1]?.kind).toBe('ExternBlockItemFn');
    const fnItem = ast.items[1];
    if (fnItem?.kind === 'ExternBlockItemFn') {
      expect(fnItem.name).toBe('push');
      expect(fnItem.typeParams).toEqual(['T']);
      expect(fnItem.template).toBe('$1.push($2)');
      expect(fnItem.effects).toEqual(['io']);
    }
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('extern block — error cases', () => {
  it('throws ParseError for unknown item keyword inside block', () => {
    expect(() => parseDecl('extern "javascript" { let x = "$1" }')).toThrow(ParseError);
  });

  it('throws ParseError when = is missing in fn item', () => {
    expect(() => parseDecl('extern "javascript" { fn log(msg: Str) }')).toThrow(ParseError);
  });

  it('throws ParseError for unclosed block', () => {
    expect(() => parseDecl('extern "javascript" { fn log(msg: Str) = "$1"')).toThrow(ParseError);
  });
});
