import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseExpression } from '../../src/parser/expressions.js';
import { parseDeclaration, parseModule } from '../../src/parser/declarations.js';
import type { DeclNode } from '../../src/parser/index.js';
import {
  buildExpr,
  buildDecl,
  buildModule,
  buildPattern,
} from '../../src/ast/builder.js';
import type {
  AstExprNode,
  AstDeclNode,
  AstIdentNode,
  AstBinopExprNode,
  AstStringLitNode,
  AstInterpPart,
  AstFnDeclNode,
  AstLetDeclNode,
  AstDataDeclNode,
  AstTypeAliasDeclNode,
  AstUseDeclNode,
  AstExternDeclNode,
  AstModuleDeclNode,
} from '../../src/ast/nodes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseExpr(src: string): AstExprNode {
  return buildExpr(parseExpression(lex(src, 'test.ion')));
}

function parseDecl(src: string): AstDeclNode {
  return buildDecl(parseDeclaration(lex(src, 'test.ion')));
}

function asKind<K extends AstExprNode['kind']>(
  node: AstExprNode,
  kind: K,
): Extract<AstExprNode, { kind: K }> {
  expect(node.kind).toBe(kind);
  return node as Extract<AstExprNode, { kind: K }>;
}

function asDeclKind<K extends AstDeclNode['kind']>(
  node: AstDeclNode,
  kind: K,
): Extract<AstDeclNode, { kind: K }> {
  expect(node.kind).toBe(kind);
  return node as Extract<AstDeclNode, { kind: K }>;
}

function hasNoLeadingTrivia(node: object): void {
  expect('leadingTrivia' in node).toBe(false);
}

// ---------------------------------------------------------------------------
// Expressions — trivia stripped
// ---------------------------------------------------------------------------

describe('expressions — trivia stripped', () => {
  it('strips leadingTrivia from Ident', () => {
    const node = asKind(parseExpr('  foo'), 'Ident') as AstIdentNode;
    expect(node.name).toBe('foo');
    hasNoLeadingTrivia(node);
  });

  it('builds LiteralInt', () => {
    const node = asKind(parseExpr('42'), 'LiteralInt');
    expect(node.value).toBe(42n);
  });

  it('builds LiteralFloat', () => {
    const node = asKind(parseExpr('3.14'), 'LiteralFloat');
    expect(node.value).toBeCloseTo(3.14);
  });

  it('builds LiteralBool true', () => {
    const node = asKind(parseExpr('true'), 'LiteralBool');
    expect(node.value).toBe(true);
  });

  it('builds LiteralBool false', () => {
    const node = asKind(parseExpr('false'), 'LiteralBool');
    expect(node.value).toBe(false);
  });

  it('builds LiteralNull', () => {
    asKind(parseExpr('null'), 'LiteralNull');
  });

  it('builds BinopExpr', () => {
    const node = asKind(parseExpr('1 + 2'), 'BinopExpr') as AstBinopExprNode;
    expect(node.op).toBe('Add');
    expect(node.left.kind).toBe('LiteralInt');
    expect(node.right.kind).toBe('LiteralInt');
    hasNoLeadingTrivia(node);
  });

  it('builds UnaryExpr', () => {
    const node = asKind(parseExpr('-1'), 'UnaryExpr');
    expect(node.op).toBe('Neg');
    expect(node.operand.kind).toBe('LiteralInt');
  });

  it('builds CallExpr', () => {
    const node = asKind(parseExpr('f(1, 2)'), 'CallExpr');
    expect(node.callee.kind).toBe('Ident');
    expect(node.args).toHaveLength(2);
    expect(node.args[0]?.label).toBeNull();
    expect(node.args[0]?.value.kind).toBe('LiteralInt');
  });

  it('builds LambdaExpr', () => {
    const node = asKind(parseExpr('x -> x'), 'LambdaExpr');
    expect(node.params).toHaveLength(1);
    expect(node.params[0]?.name).toBe('x');
    expect(node.body.kind).toBe('Ident');
  });

  it('builds IfElseExpr', () => {
    const node = asKind(parseExpr('if true then 1 else 2'), 'IfElseExpr');
    expect(node.cond.kind).toBe('LiteralBool');
    expect(node.then.kind).toBe('LiteralInt');
    expect(node.else_.kind).toBe('LiteralInt');
  });

  it('builds MatchExpr', () => {
    const node = asKind(parseExpr('match x | _ -> 1'), 'MatchExpr');
    expect(node.scrutinee.kind).toBe('Ident');
    expect(node.arms).toHaveLength(1);
    expect(node.arms[0]?.pattern.kind).toBe('WildcardPat');
  });

  it('builds AccessorExpr', () => {
    const node = asKind(parseExpr('x.foo'), 'AccessorExpr');
    expect(node.receiver.kind).toBe('Ident');
    expect(node.field).toBe('foo');
  });

  it('builds PipelineExpr', () => {
    const node = asKind(parseExpr('x |> f'), 'PipelineExpr');
    expect(node.left.kind).toBe('Ident');
    expect(node.right.kind).toBe('Ident');
  });

  it('builds PropagateExpr', () => {
    const node = asKind(parseExpr('f()?'), 'PropagateExpr');
    expect(node.inner.kind).toBe('CallExpr');
  });

  it('builds LetExpr', () => {
    const node = asKind(parseExpr('let x = 1; x'), 'LetExpr');
    expect(node.name).toBe('x');
    expect(node.value.kind).toBe('LiteralInt');
    expect(node.body.kind).toBe('Ident');
  });
});

// ---------------------------------------------------------------------------
// GroupExprNode elision
// ---------------------------------------------------------------------------

describe('GroupExprNode elision', () => {
  it('elides group wrapper and produces inner node', () => {
    const node = asKind(parseExpr('(1 + 2)'), 'BinopExpr') as AstBinopExprNode;
    expect(node.op).toBe('Add');
  });

  it('span matches inner node after elision', () => {
    const raw = lex('(1 + 2)', 'test.ion');
    const cst = parseExpression(raw);
    expect(cst.kind).toBe('GroupExpr');
    const ast = buildExpr(cst);
    expect(ast.kind).toBe('BinopExpr');
    if (cst.kind === 'GroupExpr') {
      expect(ast.span).toEqual(cst.inner.span);
    }
  });

  it('nested group elision', () => {
    const node = asKind(parseExpr('((42))'), 'LiteralInt');
    expect(node.value).toBe(42n);
  });
});

// ---------------------------------------------------------------------------
// Literals pass-through
// ---------------------------------------------------------------------------

describe('literals pass-through', () => {
  it('LiteralInt value is bigint', () => {
    const node = asKind(parseExpr('99'), 'LiteralInt');
    expect(node.value).toBe(99n);
    expect(typeof node.value).toBe('bigint');
  });

  it('LiteralBool true', () => {
    const node = asKind(parseExpr('true'), 'LiteralBool');
    expect(node.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// String interpolation
// ---------------------------------------------------------------------------

describe('string interpolation', () => {
  it('builds AstStringLitNode with AstInterpPart', () => {
    const node = asKind(parseExpr('"Hello, {name}!"'), 'StringLit') as AstStringLitNode;
    expect(node.parts.length).toBeGreaterThan(0);
    const interp = node.parts.find(p => p.kind === 'InterpPart') as AstInterpPart | undefined;
    expect(interp).toBeDefined();
    expect(interp?.expr.kind).toBe('Ident');
    if (interp?.expr.kind === 'Ident') {
      expect(interp.expr.name).toBe('name');
      hasNoLeadingTrivia(interp.expr);
    }
  });

  it('builds plain string with only TextPart', () => {
    const node = asKind(parseExpr('"hello"'), 'StringLit') as AstStringLitNode;
    expect(node.parts.every(p => p.kind === 'TextPart')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Declarations — leadingTrivia stripped
// ---------------------------------------------------------------------------

describe('declarations — leadingTrivia stripped', () => {
  it('FnDecl has no leadingTrivia', () => {
    const node = asDeclKind(parseDecl('fn foo() = 42'), 'FnDecl') as AstFnDeclNode;
    hasNoLeadingTrivia(node);
    expect(node.name).toBe('foo');
    expect(node.body.kind).toBe('LiteralInt');
  });

  it('LetDecl has no leadingTrivia', () => {
    const node = asDeclKind(parseDecl('let x = 1'), 'LetDecl') as AstLetDeclNode;
    hasNoLeadingTrivia(node);
    expect(node.name).toBe('x');
  });

  it('DataDecl has no leadingTrivia', () => {
    const node = asDeclKind(parseDecl('data Option<T> = Some(T) | None'), 'DataDecl') as AstDataDeclNode;
    hasNoLeadingTrivia(node);
    expect(node.name).toBe('Option');
    expect(node.typeParams).toEqual(['T']);
    expect(node.variants).toHaveLength(2);
  });

  it('TypeAliasDecl has no leadingTrivia', () => {
    const node = asDeclKind(parseDecl('type Foo = Int'), 'TypeAliasDecl') as AstTypeAliasDeclNode;
    hasNoLeadingTrivia(node);
    expect(node.name).toBe('Foo');
  });

  it('UseDecl has no leadingTrivia', () => {
    const node = asDeclKind(parseDecl('use std.io'), 'UseDecl') as AstUseDeclNode;
    hasNoLeadingTrivia(node);
    expect(node.path).toEqual(['std', 'io']);
  });

  it('ExternDecl has no leadingTrivia', () => {
    const node = asDeclKind(parseDecl('extern fn print(x: Int)'), 'ExternDecl') as AstExternDeclNode;
    hasNoLeadingTrivia(node);
    expect(node.name).toBe('print');
  });

  it('ModuleDecl has no leadingTrivia', () => {
    const node = asDeclKind(parseDecl('module Foo { let x = 1 }'), 'ModuleDecl') as AstModuleDeclNode;
    hasNoLeadingTrivia(node);
    expect(node.name).toBe('Foo');
  });
});

// ---------------------------------------------------------------------------
// Recursive correctness
// ---------------------------------------------------------------------------

describe('recursive correctness', () => {
  it('inner decls of nested module are trivia-free', () => {
    const node = asDeclKind(
      parseDecl('module Outer { module Inner { let x = 1 } }'),
      'ModuleDecl',
    ) as AstModuleDeclNode;
    const inner = node.decls[0];
    expect(inner).toBeDefined();
    if (inner !== undefined) {
      hasNoLeadingTrivia(inner);
      const innerMod = inner as AstModuleDeclNode;
      expect(innerMod.kind).toBe('ModuleDecl');
      expect(innerMod.decls[0]).toBeDefined();
      if (innerMod.decls[0] !== undefined) {
        hasNoLeadingTrivia(innerMod.decls[0]);
      }
    }
  });

  it('fn body with nested let-expr is trivia-free', () => {
    const node = asDeclKind(
      parseDecl('fn foo() = let x = 1; x'),
      'FnDecl',
    ) as AstFnDeclNode;
    expect(node.body.kind).toBe('LetExpr');
    hasNoLeadingTrivia(node.body);
    if (node.body.kind === 'LetExpr') {
      hasNoLeadingTrivia(node.body.value);
      hasNoLeadingTrivia(node.body.body);
    }
  });

  it('match arms are trivia-free recursively', () => {
    const expr = asKind(parseExpr('match x | Some(v) -> v | _ -> 0'), 'MatchExpr');
    for (const arm of expr.arms) {
      hasNoLeadingTrivia(arm.body);
    }
  });
});

// ---------------------------------------------------------------------------
// Span preservation
// ---------------------------------------------------------------------------

describe('span preservation', () => {
  it('Ident span matches CST', () => {
    const src = 'foo';
    const raw = lex(src, 'test.ion');
    const cst = parseExpression(raw);
    const ast = buildExpr(cst);
    expect(ast.span).toEqual(cst.span);
  });

  it('BinopExpr span preserved', () => {
    const src = '1 + 2';
    const raw = lex(src, 'test.ion');
    const cst = parseExpression(raw);
    const ast = buildExpr(cst);
    expect(ast.span).toEqual(cst.span);
  });

  it('GroupExpr: ast span equals inner CST span', () => {
    const src = '(42)';
    const raw = lex(src, 'test.ion');
    const cst = parseExpression(raw);
    expect(cst.kind).toBe('GroupExpr');
    const ast = buildExpr(cst);
    if (cst.kind === 'GroupExpr') {
      expect(ast.span).toEqual(cst.inner.span);
    }
  });
});

// ---------------------------------------------------------------------------
// Pattern nodes
// ---------------------------------------------------------------------------

describe('pattern nodes', () => {
  it('WildcardPat', () => {
    const node = asKind(parseExpr('match x | _ -> 1'), 'MatchExpr');
    expect(node.arms[0]?.pattern.kind).toBe('WildcardPat');
  });

  it('IdentPat', () => {
    const node = asKind(parseExpr('match x | y -> y'), 'MatchExpr');
    const pat = node.arms[0]?.pattern;
    expect(pat?.kind).toBe('IdentPat');
    if (pat?.kind === 'IdentPat') {
      expect(pat.name).toBe('y');
    }
  });

  it('ConstructorPat', () => {
    const node = asKind(parseExpr('match x | Some(v) -> v'), 'MatchExpr');
    const pat = node.arms[0]?.pattern;
    expect(pat?.kind).toBe('ConstructorPat');
    if (pat?.kind === 'ConstructorPat') {
      expect(pat.tag).toBe('Some');
      expect(pat.fields).toHaveLength(1);
      expect(pat.fields[0]?.kind).toBe('IdentPat');
    }
  });

  it('TuplePat', () => {
    const node = asKind(parseExpr('match x | (a, b) -> a'), 'MatchExpr');
    const pat = node.arms[0]?.pattern;
    expect(pat?.kind).toBe('TuplePat');
    if (pat?.kind === 'TuplePat') {
      expect(pat.elements).toHaveLength(2);
    }
  });

  it('LiteralPat', () => {
    const node = asKind(parseExpr('match x | 42 -> true'), 'MatchExpr');
    const pat = node.arms[0]?.pattern;
    expect(pat?.kind).toBe('LiteralPat');
    if (pat?.kind === 'LiteralPat') {
      expect(pat.value.kind).toBe('LiteralInt');
    }
  });

  it('buildPattern standalone', () => {
    const cst = parseExpression(lex('match x | Some(v) -> v', 'test.ion'));
    expect(cst.kind).toBe('MatchExpr');
    if (cst.kind === 'MatchExpr') {
      const arm = cst.arms[0];
      expect(arm).toBeDefined();
      if (arm !== undefined) {
        const pat = buildPattern(arm.pattern);
        expect(pat.kind).toBe('ConstructorPat');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// buildModule
// ---------------------------------------------------------------------------

describe('buildModule', () => {
  it('builds a module from a CST module', () => {
    const src = 'fn foo() = 1\nlet bar = 2';
    const cst = parseModule(lex(src, 'test.ion'));
    const ast = buildModule(cst);
    expect(ast.kind).toBe('Module');
    expect(ast.decls).toHaveLength(2);
    for (const decl of ast.decls) {
      hasNoLeadingTrivia(decl);
    }
  });

  it('empty module', () => {
    const cst = parseModule(lex('', 'test.ion'));
    const ast = buildModule(cst);
    expect(ast.kind).toBe('Module');
    expect(ast.decls).toHaveLength(0);
  });
});
