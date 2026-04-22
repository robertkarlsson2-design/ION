import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseExpression, parseDeclaration, parseModule } from '../../src/parser/index.js';
import { buildModule } from '../../src/ast/builder.js';
import type {
  ExprNode,
  DeclNode,
  ModuleNode,
  FnDeclNode,
  LetDeclNode,
  DataDeclNode,
  TypeAliasDeclNode,
  UseDeclNode,
  ExternDeclNode,
  ModuleDeclNode,
  BinopExprNode,
  IdentNode,
  MatchExprNode,
  StringLitNode,
} from '../../src/ast/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseExpr(src: string): ExprNode {
  const cstExpr = parseExpression(lex(src, 'test.ion'));
  const mod = buildModule({
    kind: 'Module',
    decls: [{ kind: 'LetDecl', pub: false, name: '_', type_: null, value: cstExpr, span: cstExpr.span, leadingTrivia: [] }],
    span: cstExpr.span,
  });
  const decl = mod.decls[0];
  if (decl?.kind !== 'LetDecl') throw new Error('unexpected');
  return decl.value;
}

function parseDecl(src: string): DeclNode {
  const cst = parseDeclaration(lex(src, 'test.ion'));
  const mod = buildModule({ kind: 'Module', decls: [cst], span: cst.span });
  const decl = mod.decls[0];
  if (decl === undefined) throw new Error('no decl');
  return decl;
}

function parseMod(src: string): ModuleNode {
  return buildModule(parseModule(lex(src, 'test.ion')));
}

function asKind<K extends ExprNode['kind']>(
  node: ExprNode,
  kind: K,
): Extract<ExprNode, { kind: K }> {
  expect(node.kind).toBe(kind);
  return node as Extract<ExprNode, { kind: K }>;
}

function asDeclKind<K extends DeclNode['kind']>(
  node: DeclNode,
  kind: K,
): Extract<DeclNode, { kind: K }> {
  expect(node.kind).toBe(kind);
  return node as Extract<DeclNode, { kind: K }>;
}

/** Recursively asserts no key named 'leadingTrivia' exists anywhere in the tree. */
function hasNoTrivia(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return true;
  if (Array.isArray(node)) return node.every(hasNoTrivia);
  const obj = node as Record<string, unknown>;
  if ('leadingTrivia' in obj) return false;
  return Object.values(obj).every(hasNoTrivia);
}

// ---------------------------------------------------------------------------
// Trivia stripping
// ---------------------------------------------------------------------------

describe('trivia stripping', () => {
  it('IdentNode has no leadingTrivia in AST', () => {
    const node = parseExpr('foo');
    expect(hasNoTrivia(node)).toBe(true);
    expect('leadingTrivia' in node).toBe(false);
  });

  it('fn decl with leading comment has no leadingTrivia in AST', () => {
    const node = parseDecl('// comment\nfn foo() = 1');
    expect(hasNoTrivia(node)).toBe(true);
    expect('leadingTrivia' in node).toBe(false);
  });

  it('full module has no trivia anywhere', () => {
    const mod = parseMod('fn a() = 1\nlet b = true');
    expect(hasNoTrivia(mod)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GroupExprNode collapse
// ---------------------------------------------------------------------------

describe('GroupExprNode collapse', () => {
  it('collapses single grouping to inner BinopExpr', () => {
    const node = parseExpr('(1 + 2)');
    const binop = asKind(node, 'BinopExpr') as BinopExprNode;
    expect(binop.op).toBe('Add');
  });

  it('collapses nested groupings to plain IdentNode', () => {
    const node = parseExpr('((x))');
    const ident = asKind(node, 'Ident') as IdentNode;
    expect(ident.name).toBe('x');
  });

  it('GroupExpr kind is absent from result', () => {
    const node = parseExpr('(42)');
    expect(node.kind).not.toBe('GroupExpr');
    expect(node.kind).toBe('LiteralInt');
  });

  it('collapsed group uses inner expression span (not outer parens)', () => {
    const grouped = parseExpr('(x)');
    const ident = asKind(grouped, 'Ident') as IdentNode;
    // Inner 'x' is at column 1 (inside the paren), not column 0
    expect(ident.span.startCol).toBe(1);
    expect(ident.span.startLine).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Declaration structure
// ---------------------------------------------------------------------------

describe('declaration structure', () => {
  it('fn double(x: Int) -> Int = x * 2', () => {
    const node = asDeclKind(parseDecl('fn double(x: Int) -> Int = x * 2'), 'FnDecl') as FnDeclNode;
    expect(node.name).toBe('double');
    expect(node.params).toHaveLength(1);
    expect(node.params[0]?.name).toBe('x');
    expect(node.params[0]?.type_?.kind).toBe('Named');
    expect(node.returnType?.kind).toBe('Named');
    expect(node.body.kind).toBe('BinopExpr');
    expect(hasNoTrivia(node)).toBe(true);
  });

  it('let x: Int = 42', () => {
    const node = asDeclKind(parseDecl('let x: Int = 42'), 'LetDecl') as LetDeclNode;
    expect(node.name).toBe('x');
    expect(node.type_?.kind).toBe('Named');
    expect(node.value.kind).toBe('LiteralInt');
    expect(hasNoTrivia(node)).toBe(true);
  });

  it('data Point = Point { x: Int; y: Int }', () => {
    const node = asDeclKind(parseDecl('data Point = Point { x: Int; y: Int }'), 'DataDecl') as DataDeclNode;
    expect(node.name).toBe('Point');
    expect(node.variants).toHaveLength(1);
    expect(node.variants[0]?.kind).toBe('RecordVariant');
    expect(hasNoTrivia(node)).toBe(true);
  });

  it('type Id = Int', () => {
    const node = asDeclKind(parseDecl('type Id = Int'), 'TypeAliasDecl') as TypeAliasDeclNode;
    expect(node.name).toBe('Id');
    expect(node.type_.kind).toBe('Named');
    expect(hasNoTrivia(node)).toBe(true);
  });

  it('use std.io.{read, write}', () => {
    const node = asDeclKind(parseDecl('use std.io.{read, write}'), 'UseDecl') as UseDeclNode;
    expect(node.path).toEqual(['std', 'io']);
    expect(node.items).toEqual(['read', 'write']);
    expect(hasNoTrivia(node)).toBe(true);
  });

  it('extern fn readFile(p: Str) !io -> Str', () => {
    const node = asDeclKind(parseDecl('extern fn readFile(p: Str) !io -> Str'), 'ExternDecl') as ExternDeclNode;
    expect(node.name).toBe('readFile');
    expect(node.effects).toContain('io');
    expect(node.returnType?.kind).toBe('Named');
    expect(hasNoTrivia(node)).toBe(true);
  });

  it('module Inner { fn foo() = 1 }', () => {
    const node = asDeclKind(parseDecl('module Inner { fn foo() = 1 }'), 'ModuleDecl') as ModuleDeclNode;
    expect(node.name).toBe('Inner');
    expect(node.decls).toHaveLength(1);
    expect(node.decls[0]?.kind).toBe('FnDecl');
    expect(hasNoTrivia(node)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Span preservation
// ---------------------------------------------------------------------------

describe('span preservation', () => {
  it('preserves span on fn decl', () => {
    const node = parseDecl('fn foo() = 1') as FnDeclNode;
    expect(node.span.startLine).toBeGreaterThan(0);
    expect(node.span.endLine).toBeGreaterThanOrEqual(node.span.startLine);
  });

  it('preserves span on let decl', () => {
    const node = parseDecl('let x = 42') as LetDeclNode;
    expect(node.span.startLine).toBeGreaterThan(0);
  });

  it('preserves span on expr', () => {
    const node = parseExpr('1 + 2');
    expect(node.span.startLine).toBeGreaterThan(0);
    expect(node.span.endCol).toBeGreaterThan(node.span.startCol);
  });
});

// ---------------------------------------------------------------------------
// String interpolation
// ---------------------------------------------------------------------------

describe('string interpolation', () => {
  it('builds StringLitNode with interp parts', () => {
    const node = parseExpr('"Hello, {name}!"');
    const str = asKind(node, 'StringLit') as StringLitNode;
    expect(str.parts.length).toBeGreaterThanOrEqual(3);
    const interp = str.parts.find(p => p.kind === 'InterpPart');
    expect(interp).toBeDefined();
    if (interp?.kind === 'InterpPart') {
      expect(interp.expr.kind).toBe('Ident');
      // InterpPart.expr is an AST node — no trivia
      expect(hasNoTrivia(interp.expr)).toBe(true);
    }
  });

  it('plain string has only TextPart', () => {
    const node = parseExpr('"hello"');
    const str = asKind(node, 'StringLit') as StringLitNode;
    expect(str.parts.every(p => p.kind === 'TextPart')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Match expression
// ---------------------------------------------------------------------------

describe('match expression', () => {
  it('builds MatchExprNode with arms', () => {
    const node = parseExpr('match x | 1 -> true | _ -> false');
    const match_ = asKind(node, 'MatchExpr') as MatchExprNode;
    expect(match_.scrutinee.kind).toBe('Ident');
    expect(match_.arms).toHaveLength(2);
    expect(match_.arms[0]?.pattern.kind).toBe('LiteralPat');
    expect(match_.arms[1]?.pattern.kind).toBe('WildcardPat');
    expect(hasNoTrivia(match_)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full module integration
// ---------------------------------------------------------------------------

describe('full module integration', () => {
  it('builds ModuleNode from multi-declaration source', () => {
    const src = [
      'fn add(a: Int, b: Int) -> Int = a + b',
      'let pi: Float = 3.14',
      'data Color = Red | Green | Blue',
    ].join('\n');
    const mod = parseMod(src);
    expect(mod.kind).toBe('Module');
    expect(mod.decls).toHaveLength(3);
    expect(mod.decls[0]?.kind).toBe('FnDecl');
    expect(mod.decls[1]?.kind).toBe('LetDecl');
    expect(mod.decls[2]?.kind).toBe('DataDecl');
    expect(hasNoTrivia(mod)).toBe(true);
  });
});
