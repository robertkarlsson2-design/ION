import type { Span } from '../types.js';
import type { TypeAnnotation, EffectTag } from './types.js';

export type { TypeAnnotation, EffectTag } from './types.js';

// Re-export trivia-free, expression-free types from CST unchanged
export type {
  LiteralIntNode,
  LiteralFloatNode,
  LiteralBoolNode,
  LiteralNullNode,
  LambdaParam,
  FnParam,
  RecordField,
  DeclAttribute,
  DataVariant,
  BinopKind,
  UnaryKind,
} from '../parser/cst.js';

import type {
  LiteralIntNode,
  LiteralFloatNode,
  LiteralBoolNode,
  LiteralNullNode,
  LambdaParam,
  FnParam,
  DeclAttribute,
  DataVariant,
  BinopKind,
  UnaryKind,
} from '../parser/cst.js';

// ---------------------------------------------------------------------------
// String interpolation (redefined to reference AST ExprNode)
// ---------------------------------------------------------------------------

export type StringPart =
  | { readonly kind: 'TextPart'; readonly text: string; readonly span: Span }
  | { readonly kind: 'InterpPart'; readonly expr: ExprNode; readonly span: Span };

export interface StringLitNode {
  readonly kind: 'StringLit';
  readonly parts: readonly StringPart[];
  readonly span: Span;
}

export type LiteralNode =
  | LiteralIntNode
  | LiteralFloatNode
  | LiteralBoolNode
  | LiteralNullNode
  | StringLitNode;

// ---------------------------------------------------------------------------
// Patterns (redefined to reference AST LiteralNode)
// ---------------------------------------------------------------------------

export type PatternNode =
  | { readonly kind: 'WildcardPat'; readonly span: Span }
  | { readonly kind: 'IdentPat'; readonly name: string; readonly span: Span }
  | { readonly kind: 'ConstructorPat'; readonly tag: string; readonly fields: readonly PatternNode[]; readonly span: Span }
  | { readonly kind: 'LiteralPat'; readonly value: LiteralNode; readonly span: Span }
  | { readonly kind: 'TuplePat'; readonly elements: readonly PatternNode[]; readonly span: Span };

// ---------------------------------------------------------------------------
// Call arguments (redefined to reference AST ExprNode)
// ---------------------------------------------------------------------------

export interface CallArg {
  readonly label: string | null;
  readonly value: ExprNode;
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// Match arms (redefined to reference AST ExprNode/PatternNode)
// ---------------------------------------------------------------------------

export interface MatchArm {
  readonly pattern: PatternNode;
  readonly guard: ExprNode | null;
  readonly body: ExprNode;
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// IdentNode (no leadingTrivia)
// ---------------------------------------------------------------------------

export interface IdentNode {
  readonly kind: 'Ident';
  readonly name: string;
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// Expression nodes (all reference AST ExprNode; no GroupExprNode)
// ---------------------------------------------------------------------------

export interface BinopExprNode {
  readonly kind: 'BinopExpr';
  readonly op: BinopKind;
  readonly left: ExprNode;
  readonly right: ExprNode;
  readonly span: Span;
}

export interface UnaryExprNode {
  readonly kind: 'UnaryExpr';
  readonly op: UnaryKind;
  readonly operand: ExprNode;
  readonly span: Span;
}

export interface CallExprNode {
  readonly kind: 'CallExpr';
  readonly callee: ExprNode;
  readonly args: readonly CallArg[];
  readonly span: Span;
}

export interface LambdaExprNode {
  readonly kind: 'LambdaExpr';
  readonly params: readonly LambdaParam[];
  readonly body: ExprNode;
  readonly span: Span;
}

export interface PipelineExprNode {
  readonly kind: 'PipelineExpr';
  readonly left: ExprNode;
  readonly right: ExprNode;
  readonly span: Span;
}

export interface IfElseExprNode {
  readonly kind: 'IfElseExpr';
  readonly cond: ExprNode;
  readonly then: ExprNode;
  readonly else_: ExprNode;
  readonly span: Span;
}

export interface MatchExprNode {
  readonly kind: 'MatchExpr';
  readonly scrutinee: ExprNode;
  readonly arms: readonly MatchArm[];
  readonly span: Span;
}

export interface LetExprNode {
  readonly kind: 'LetExpr';
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly value: ExprNode;
  readonly body: ExprNode;
  readonly span: Span;
}

export interface AccessorExprNode {
  readonly kind: 'AccessorExpr';
  readonly receiver: ExprNode;
  readonly field: string;
  readonly span: Span;
}

export interface PropagateExprNode {
  readonly kind: 'PropagateExpr';
  readonly inner: ExprNode;
  readonly span: Span;
}

/** GroupExprNode is intentionally absent — collapsed to inner during AST build. */
export type ExprNode =
  | LiteralIntNode
  | LiteralFloatNode
  | LiteralBoolNode
  | LiteralNullNode
  | StringLitNode
  | IdentNode
  | BinopExprNode
  | UnaryExprNode
  | CallExprNode
  | LambdaExprNode
  | PipelineExprNode
  | IfElseExprNode
  | MatchExprNode
  | LetExprNode
  | AccessorExprNode
  | PropagateExprNode;

// ---------------------------------------------------------------------------
// Declaration nodes (no leadingTrivia)
// ---------------------------------------------------------------------------

export interface FnDeclNode {
  readonly kind: 'FnDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly params: readonly FnParam[];
  readonly effects: readonly EffectTag[];
  readonly returnType: TypeAnnotation | null;
  readonly body: ExprNode;
  readonly attributes: readonly DeclAttribute[];
  readonly span: Span;
}

export interface LetDeclNode {
  readonly kind: 'LetDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly value: ExprNode;
  readonly span: Span;
}

export interface DataDeclNode {
  readonly kind: 'DataDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly variants: readonly DataVariant[];
  readonly span: Span;
}

export interface TypeAliasDeclNode {
  readonly kind: 'TypeAliasDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly type_: TypeAnnotation;
  readonly span: Span;
}

export interface UseDeclNode {
  readonly kind: 'UseDecl';
  readonly path: readonly string[];
  readonly items: readonly string[] | null;
  readonly span: Span;
}

export interface ExternDeclNode {
  readonly kind: 'ExternDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly params: readonly FnParam[];
  readonly effects: readonly EffectTag[];
  readonly returnType: TypeAnnotation | null;
  readonly attributes: readonly DeclAttribute[];
  readonly span: Span;
}

export interface ModuleDeclNode {
  readonly kind: 'ModuleDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly decls: readonly DeclNode[];
  readonly span: Span;
}

export type DeclNode =
  | FnDeclNode
  | LetDeclNode
  | DataDeclNode
  | TypeAliasDeclNode
  | UseDeclNode
  | ExternDeclNode
  | ModuleDeclNode;

export interface ModuleNode {
  readonly kind: 'Module';
  readonly decls: readonly DeclNode[];
  readonly span: Span;
}
