import type { Span } from '../types.js';
import type { TypeAnnotation } from '../ast/types.js';

export type { Span, TypeAnnotation };

// ---------------------------------------------------------------------------
// Trivia
// ---------------------------------------------------------------------------

export type TriviaNode =
  | { readonly kind: 'Whitespace'; readonly text: string; readonly span: Span }
  | { readonly kind: 'Newline'; readonly text: string; readonly span: Span }
  | { readonly kind: 'LineComment'; readonly text: string; readonly span: Span }
  | { readonly kind: 'BlockComment'; readonly text: string; readonly span: Span };

// ---------------------------------------------------------------------------
// Literal helpers
// ---------------------------------------------------------------------------

export type LiteralNode =
  | LiteralIntNode
  | LiteralFloatNode
  | LiteralBoolNode
  | LiteralNullNode
  | StringLitNode;

export interface LiteralIntNode {
  readonly kind: 'LiteralInt';
  readonly value: bigint;
  readonly raw: string;
  readonly span: Span;
}

export interface LiteralFloatNode {
  readonly kind: 'LiteralFloat';
  readonly value: number;
  readonly raw: string;
  readonly span: Span;
}

export interface LiteralBoolNode {
  readonly kind: 'LiteralBool';
  readonly value: boolean;
  readonly span: Span;
}

export interface LiteralNullNode {
  readonly kind: 'LiteralNull';
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// String interpolation
// ---------------------------------------------------------------------------

export type StringPart =
  | { readonly kind: 'TextPart'; readonly text: string; readonly span: Span }
  | { readonly kind: 'InterpPart'; readonly expr: ExprNode; readonly span: Span };

export interface StringLitNode {
  readonly kind: 'StringLit';
  readonly parts: readonly StringPart[];
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// Call arguments & lambda params
// ---------------------------------------------------------------------------

export interface CallArg {
  readonly label: string | null;
  readonly value: ExprNode;
  readonly span: Span;
}

export interface LambdaParam {
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export type PatternNode =
  | { readonly kind: 'WildcardPat'; readonly span: Span }
  | { readonly kind: 'IdentPat'; readonly name: string; readonly span: Span }
  | { readonly kind: 'ConstructorPat'; readonly tag: string; readonly fields: readonly PatternNode[]; readonly span: Span }
  | { readonly kind: 'LiteralPat'; readonly value: LiteralNode; readonly span: Span }
  | { readonly kind: 'TuplePat'; readonly elements: readonly PatternNode[]; readonly span: Span };

// ---------------------------------------------------------------------------
// Match arms
// ---------------------------------------------------------------------------

export interface MatchArm {
  readonly pattern: PatternNode;
  readonly guard: ExprNode | null;
  readonly body: ExprNode;
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// Operator kinds
// ---------------------------------------------------------------------------

export type BinopKind =
  | 'Add' | 'Sub' | 'Mul' | 'Div' | 'Mod'
  | 'EqEq' | 'NotEq' | 'Lt' | 'Gt' | 'LtEq' | 'GtEq'
  | 'And' | 'Or';

export type UnaryKind = 'Neg' | 'Not';

// ---------------------------------------------------------------------------
// Expression nodes
// ---------------------------------------------------------------------------

export interface IdentNode {
  readonly kind: 'Ident';
  readonly name: string;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

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

export interface GroupExprNode {
  readonly kind: 'GroupExpr';
  readonly inner: ExprNode;
  readonly span: Span;
}

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
  | PropagateExprNode
  | GroupExprNode;
