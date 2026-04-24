import type {
  ModuleNode,
  DeclNode,
  ExprNode,
  PatternNode,
  StringPart,
  CallArg,
  LambdaParam,
  MatchArm,
  LiteralNode,
} from '../parser/cst.js';

import type {
  AstModule,
  AstDeclNode,
  AstExprNode,
  AstPatternNode,
  AstStringPart,
  AstCallArg,
  AstLambdaParam,
  AstMatchArm,
  AstDataVariant,
  AstStringLitNode,
  AstExternBlockItem,
  LiteralIntNode,
  LiteralFloatNode,
  LiteralBoolNode,
  LiteralNullNode,
} from './nodes.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildStringPart(part: StringPart): AstStringPart {
  if (part.kind === 'TextPart') {
    return { kind: 'TextPart', text: part.text, span: part.span };
  }
  return { kind: 'InterpPart', expr: buildExpr(part.expr), span: part.span };
}

function buildCallArg(arg: CallArg): AstCallArg {
  return { label: arg.label, value: buildExpr(arg.value), span: arg.span };
}

function buildLambdaParam(p: LambdaParam): AstLambdaParam {
  return { name: p.name, type_: p.type_, span: p.span };
}

function buildMatchArm(arm: MatchArm): AstMatchArm {
  return {
    pattern: buildPattern(arm.pattern),
    guard: arm.guard !== null ? buildExpr(arm.guard) : null,
    body: buildExpr(arm.body),
    span: arm.span,
  };
}

function buildLiteral(
  node: LiteralNode,
): LiteralIntNode | LiteralFloatNode | LiteralBoolNode | LiteralNullNode | AstStringLitNode {
  switch (node.kind) {
    case 'LiteralInt':
      return { kind: 'LiteralInt', value: node.value, raw: node.raw, span: node.span };
    case 'LiteralFloat':
      return { kind: 'LiteralFloat', value: node.value, raw: node.raw, span: node.span };
    case 'LiteralBool':
      return { kind: 'LiteralBool', value: node.value, span: node.span };
    case 'LiteralNull':
      return { kind: 'LiteralNull', span: node.span };
    case 'StringLit':
      return { kind: 'StringLit', parts: node.parts.map(buildStringPart), span: node.span };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Builds an AST pattern node from a CST pattern node (no trivia to strip). */
export function buildPattern(cst: PatternNode): AstPatternNode {
  switch (cst.kind) {
    case 'WildcardPat':
      return { kind: 'WildcardPat', span: cst.span };
    case 'IdentPat':
      return { kind: 'IdentPat', name: cst.name, span: cst.span };
    case 'ConstructorPat':
      return {
        kind: 'ConstructorPat',
        tag: cst.tag,
        fields: cst.fields.map(buildPattern),
        span: cst.span,
      };
    case 'LiteralPat':
      return { kind: 'LiteralPat', value: buildLiteral(cst.value), span: cst.span };
    case 'TuplePat':
      return { kind: 'TuplePat', elements: cst.elements.map(buildPattern), span: cst.span };
  }
}

/** Builds an AST expression node from a CST expression node, stripping trivia and eliding GroupExpr. */
export function buildExpr(cst: ExprNode): AstExprNode {
  switch (cst.kind) {
    case 'LiteralInt':
      return { kind: 'LiteralInt', value: cst.value, raw: cst.raw, span: cst.span };
    case 'LiteralFloat':
      return { kind: 'LiteralFloat', value: cst.value, raw: cst.raw, span: cst.span };
    case 'LiteralBool':
      return { kind: 'LiteralBool', value: cst.value, span: cst.span };
    case 'LiteralNull':
      return { kind: 'LiteralNull', span: cst.span };

    case 'StringLit':
      return {
        kind: 'StringLit',
        parts: cst.parts.map(buildStringPart),
        span: cst.span,
      };

    case 'Ident':
      return { kind: 'Ident', name: cst.name, span: cst.span };

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
        params: cst.params.map(buildLambdaParam),
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
      // Elide the group wrapper; use the inner node's span.
      return buildExpr(cst.inner);
  }
}

/** Builds an AST declaration node from a CST declaration node, stripping leadingTrivia. */
export function buildDecl(cst: DeclNode): AstDeclNode {
  switch (cst.kind) {
    case 'FnDecl':
      return {
        kind: 'FnDecl',
        pub: cst.pub,
        name: cst.name,
        typeParams: cst.typeParams,
        params: cst.params.map(p => ({ name: p.name, type_: p.type_, span: p.span })),
        effects: cst.effects,
        returnType: cst.returnType,
        body: buildExpr(cst.body),
        attributes: cst.attributes.map(a => ({ name: a.name, args: a.args, span: a.span })),
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
        variants: cst.variants.map((v): AstDataVariant => {
          if (v.kind === 'RecordVariant') {
            return {
              kind: 'RecordVariant',
              name: v.name,
              fields: v.fields.map(f => ({ name: f.name, type_: f.type_, span: f.span })),
              span: v.span,
            };
          }
          return v;
        }),
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
        params: cst.params.map(p => ({ name: p.name, type_: p.type_, span: p.span })),
        effects: cst.effects,
        returnType: cst.returnType,
        attributes: cst.attributes.map(a => ({ name: a.name, args: a.args, span: a.span })),
        span: cst.span,
      };

    case 'ExternBlockDecl':
      return {
        kind: 'ExternBlockDecl',
        pub: cst.pub,
        target: cst.target,
        items: cst.items.map((item): AstExternBlockItem => {
          if (item.kind === 'ExternBlockItemFn') {
            return {
              kind: 'ExternBlockItemFn',
              name: item.name,
              typeParams: item.typeParams,
              params: item.params.map(p => ({ name: p.name, type_: p.type_, span: p.span })),
              effects: item.effects,
              returnType: item.returnType,
              template: item.template,
              span: item.span,
            };
          }
          return {
            kind: 'ExternBlockItemType',
            name: item.name,
            typeParams: item.typeParams,
            template: item.template,
            span: item.span,
          };
        }),
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

/** Builds an AST module from a CST module node, stripping all trivia. */
export function buildModule(cst: ModuleNode): AstModule {
  return {
    kind: 'Module',
    decls: cst.decls.map(buildDecl),
    span: cst.span,
  };
}
