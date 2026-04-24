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
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface LiteralFloatNode {
  readonly kind: 'LiteralFloat';
  readonly value: number;
  readonly raw: string;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface LiteralBoolNode {
  readonly kind: 'LiteralBool';
  readonly value: boolean;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface LiteralNullNode {
  readonly kind: 'LiteralNull';
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
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
  readonly leadingTrivia: readonly TriviaNode[];
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
  readonly leadingTrivia: readonly TriviaNode[];
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
  readonly leadingTrivia: readonly TriviaNode[];
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
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface MatchExprNode {
  readonly kind: 'MatchExpr';
  readonly scrutinee: ExprNode;
  readonly arms: readonly MatchArm[];
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface LetExprNode {
  readonly kind: 'LetExpr';
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly value: ExprNode;
  readonly body: ExprNode;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
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
  readonly leadingTrivia: readonly TriviaNode[];
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

// ---------------------------------------------------------------------------
// Declaration nodes
// ---------------------------------------------------------------------------

export interface FnParam {
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly span: Span;
}

export interface DeclAttribute {
  readonly name: string;
  readonly args: readonly string[];
  readonly span: Span;
}

export interface FnDeclNode {
  readonly kind: 'FnDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly params: readonly FnParam[];
  readonly effects: readonly import('../ast/types.js').EffectTag[];
  readonly returnType: TypeAnnotation | null;
  readonly body: ExprNode;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
  readonly attributes: readonly DeclAttribute[];
}

export interface LetDeclNode {
  readonly kind: 'LetDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly value: ExprNode;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface RecordField {
  readonly name: string;
  readonly type_: TypeAnnotation;
  readonly span: Span;
}

export type DataVariant =
  | { readonly kind: 'UnitVariant'; readonly name: string; readonly span: Span }
  | { readonly kind: 'TupleVariant'; readonly name: string; readonly fields: readonly TypeAnnotation[]; readonly span: Span }
  | { readonly kind: 'RecordVariant'; readonly name: string; readonly fields: readonly RecordField[]; readonly span: Span };

export interface DataDeclNode {
  readonly kind: 'DataDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly variants: readonly DataVariant[];
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface TypeAliasDeclNode {
  readonly kind: 'TypeAliasDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly type_: TypeAnnotation;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface UseDeclNode {
  readonly kind: 'UseDecl';
  readonly path: readonly string[];
  readonly items: readonly string[] | null;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface ExternDeclNode {
  readonly kind: 'ExternDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly params: readonly FnParam[];
  readonly effects: readonly import('../ast/types.js').EffectTag[];
  readonly returnType: TypeAnnotation | null;
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
  readonly attributes: readonly DeclAttribute[];
}

export interface ExternBlockItemFn {
  readonly kind: 'ExternBlockItemFn';
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly params: readonly FnParam[];
  readonly effects: readonly import('../ast/types.js').EffectTag[];
  readonly returnType: TypeAnnotation | null;
  readonly template: string;
  readonly span: Span;
}

export interface ExternBlockItemType {
  readonly kind: 'ExternBlockItemType';
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly template: string;
  readonly span: Span;
}

export type ExternBlockItem = ExternBlockItemFn | ExternBlockItemType;

export interface ExternBlockDeclNode {
  readonly kind: 'ExternBlockDecl';
  readonly pub: boolean;
  readonly target: string;
  readonly items: readonly ExternBlockItem[];
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export interface ModuleDeclNode {
  readonly kind: 'ModuleDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly decls: readonly DeclNode[];
  readonly span: Span;
  readonly leadingTrivia: readonly TriviaNode[];
}

export type DeclNode =
  | FnDeclNode
  | LetDeclNode
  | DataDeclNode
  | TypeAliasDeclNode
  | UseDeclNode
  | ExternDeclNode
  | ExternBlockDeclNode
  | ModuleDeclNode;

export interface ModuleNode {
  readonly kind: 'Module';
  readonly decls: readonly DeclNode[];
  readonly span: Span;
}
