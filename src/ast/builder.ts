import type * as Cst from '../parser/cst.js';
import type * as Ast from './nodes.js';

/**
 * Transform a CST module (with trivia) into a clean AST module (no trivia).
 * GroupExprNode wrappers are collapsed transparently.
 */
export function buildModule(cst: Cst.ModuleNode): Ast.ModuleNode {
  return {
    kind: 'Module',
    decls: cst.decls.map(buildDecl),
    span: cst.span,
  };
}

function buildDecl(cst: Cst.DeclNode): Ast.DeclNode {
  switch (cst.kind) {
    case 'FnDecl':
      return {
        kind: 'FnDecl',
        pub: cst.pub,
        name: cst.name,
        typeParams: cst.typeParams,
        params: cst.params,
        effects: cst.effects,
        returnType: cst.returnType,
        body: buildExpr(cst.body),
        attributes: cst.attributes,
        span: cst.span,
      };
    case 'LetDecl':
      return {
        kind: 'LetDecl',
        pub: cst.pub,
        name: cst.name,
        type_: cst.type_,
        value: buildExpr(cst.value),
        span: cst.span,
      };
    case 'DataDecl':
      return {
        kind: 'DataDecl',
        pub: cst.pub,
        name: cst.name,
        typeParams: cst.typeParams,
        variants: cst.variants,
        span: cst.span,
      };
    case 'TypeAliasDecl':
      return {
        kind: 'TypeAliasDecl',
        pub: cst.pub,
        name: cst.name,
        typeParams: cst.typeParams,
        type_: cst.type_,
        span: cst.span,
      };
    case 'UseDecl':
      return {
        kind: 'UseDecl',
        path: cst.path,
        items: cst.items,
        span: cst.span,
      };
    case 'ExternDecl':
      return {
        kind: 'ExternDecl',
        pub: cst.pub,
        name: cst.name,
        params: cst.params,
        effects: cst.effects,
        returnType: cst.returnType,
        attributes: cst.attributes,
        span: cst.span,
      };
    case 'ModuleDecl':
      return {
        kind: 'ModuleDecl',
        pub: cst.pub,
        name: cst.name,
        decls: cst.decls.map(buildDecl),
        span: cst.span,
      };
  }
}

function buildExpr(cst: Cst.ExprNode): Ast.ExprNode {
  switch (cst.kind) {
    case 'LiteralInt':
    case 'LiteralFloat':
    case 'LiteralBool':
    case 'LiteralNull':
      return cst;
    case 'StringLit':
      return {
        kind: 'StringLit',
        parts: cst.parts.map(buildStringPart),
        span: cst.span,
      };
    case 'Ident':
      return {
        kind: 'Ident',
        name: cst.name,
        span: cst.span,
        // leadingTrivia intentionally dropped
      };
    case 'BinopExpr':
      return {
        kind: 'BinopExpr',
        op: cst.op,
        left: buildExpr(cst.left),
        right: buildExpr(cst.right),
        span: cst.span,
      };
    case 'UnaryExpr':
      return {
        kind: 'UnaryExpr',
        op: cst.op,
        operand: buildExpr(cst.operand),
        span: cst.span,
      };
    case 'CallExpr':
      return {
        kind: 'CallExpr',
        callee: buildExpr(cst.callee),
        args: cst.args.map(buildCallArg),
        span: cst.span,
      };
    case 'LambdaExpr':
      return {
        kind: 'LambdaExpr',
        params: cst.params,
        body: buildExpr(cst.body),
        span: cst.span,
      };
    case 'PipelineExpr':
      return {
        kind: 'PipelineExpr',
        left: buildExpr(cst.left),
        right: buildExpr(cst.right),
        span: cst.span,
      };
    case 'IfElseExpr':
      return {
        kind: 'IfElseExpr',
        cond: buildExpr(cst.cond),
        then: buildExpr(cst.then),
        else_: buildExpr(cst.else_),
        span: cst.span,
      };
    case 'MatchExpr':
      return {
        kind: 'MatchExpr',
        scrutinee: buildExpr(cst.scrutinee),
        arms: cst.arms.map(buildMatchArm),
        span: cst.span,
      };
    case 'LetExpr':
      return {
        kind: 'LetExpr',
        name: cst.name,
        type_: cst.type_,
        value: buildExpr(cst.value),
        body: buildExpr(cst.body),
        span: cst.span,
      };
    case 'AccessorExpr':
      return {
        kind: 'AccessorExpr',
        receiver: buildExpr(cst.receiver),
        field: cst.field,
        span: cst.span,
      };
    case 'PropagateExpr':
      return {
        kind: 'PropagateExpr',
        inner: buildExpr(cst.inner),
        span: cst.span,
      };
    case 'GroupExpr':
      // Collapse: parentheses carry no semantic meaning beyond grouping
      return buildExpr(cst.inner);
  }
}

function buildStringPart(cst: Cst.StringPart): Ast.StringPart {
  if (cst.kind === 'TextPart') {
    return cst;
  }
  return {
    kind: 'InterpPart',
    expr: buildExpr(cst.expr),
    span: cst.span,
  };
}

function buildCallArg(cst: Cst.CallArg): Ast.CallArg {
  return {
    label: cst.label,
    value: buildExpr(cst.value),
    span: cst.span,
  };
}

function buildMatchArm(cst: Cst.MatchArm): Ast.MatchArm {
  return {
    pattern: buildPattern(cst.pattern),
    guard: cst.guard !== null ? buildExpr(cst.guard) : null,
    body: buildExpr(cst.body),
    span: cst.span,
  };
}

function buildPattern(cst: Cst.PatternNode): Ast.PatternNode {
  switch (cst.kind) {
    case 'WildcardPat':
    case 'IdentPat':
      return cst;
    case 'ConstructorPat':
      return {
        kind: 'ConstructorPat',
        tag: cst.tag,
        fields: cst.fields.map(buildPattern),
        span: cst.span,
      };
    case 'LiteralPat':
      return {
        kind: 'LiteralPat',
        value: buildLiteral(cst.value),
        span: cst.span,
      };
    case 'TuplePat':
      return {
        kind: 'TuplePat',
        elements: cst.elements.map(buildPattern),
        span: cst.span,
      };
  }
}

function buildLiteral(cst: Cst.LiteralNode): Ast.LiteralNode {
  if (cst.kind === 'StringLit') {
    return {
      kind: 'StringLit',
      parts: cst.parts.map(buildStringPart),
      span: cst.span,
    };
  }
  return cst;
}
