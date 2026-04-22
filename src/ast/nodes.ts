import type { Span } from '../types.js';
import type { TypeAnnotation, EffectTag } from './types.js';

export type { TypeAnnotation, EffectTag, Span };

// ---------------------------------------------------------------------------
// Re-exported from parser/cst (no trivia fields — shared between CST and AST)
// ---------------------------------------------------------------------------

export type { BinopKind, UnaryKind } from '../parser/cst.js';

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

export interface AstTextPart {
  readonly kind: 'TextPart';
  readonly text: string;
  readonly span: Span;
}

export interface AstInterpPart {
  readonly kind: 'InterpPart';
  readonly expr: AstExprNode;
  readonly span: Span;
}

export type AstStringPart = AstTextPart | AstInterpPart;

export interface AstStringLitNode {
  readonly kind: 'StringLit';
  readonly parts: readonly AstStringPart[];
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// Call arguments & lambda params
// ---------------------------------------------------------------------------

export interface AstCallArg {
  readonly label: string | null;
  readonly value: AstExprNode;
  readonly span: Span;
}

export interface AstLambdaParam {
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export type AstPatternNode =
  | { readonly kind: 'WildcardPat'; readonly span: Span }
  | { readonly kind: 'IdentPat'; readonly name: string; readonly span: Span }
  | { readonly kind: 'ConstructorPat'; readonly tag: string; readonly fields: readonly AstPatternNode[]; readonly span: Span }
  | { readonly kind: 'LiteralPat'; readonly value: LiteralIntNode | LiteralFloatNode | LiteralBoolNode | LiteralNullNode | AstStringLitNode; readonly span: Span }
  | { readonly kind: 'TuplePat'; readonly elements: readonly AstPatternNode[]; readonly span: Span };

// ---------------------------------------------------------------------------
// Match arms
// ---------------------------------------------------------------------------

export interface AstMatchArm {
  readonly pattern: AstPatternNode;
  readonly guard: AstExprNode | null;
  readonly body: AstExprNode;
  readonly span: Span;
}

// ---------------------------------------------------------------------------
// Expression nodes
// ---------------------------------------------------------------------------

export interface AstIdentNode {
  readonly kind: 'Ident';
  readonly name: string;
  readonly span: Span;
}

export interface AstBinopExprNode {
  readonly kind: 'BinopExpr';
  readonly op: import('../parser/cst.js').BinopKind;
  readonly left: AstExprNode;
  readonly right: AstExprNode;
  readonly span: Span;
}

export interface AstUnaryExprNode {
  readonly kind: 'UnaryExpr';
  readonly op: import('../parser/cst.js').UnaryKind;
  readonly operand: AstExprNode;
  readonly span: Span;
}

export interface AstCallExprNode {
  readonly kind: 'CallExpr';
  readonly callee: AstExprNode;
  readonly args: readonly AstCallArg[];
  readonly span: Span;
}

export interface AstLambdaExprNode {
  readonly kind: 'LambdaExpr';
  readonly params: readonly AstLambdaParam[];
  readonly body: AstExprNode;
  readonly span: Span;
}

export interface AstPipelineExprNode {
  readonly kind: 'PipelineExpr';
  readonly left: AstExprNode;
  readonly right: AstExprNode;
  readonly span: Span;
}

export interface AstIfElseExprNode {
  readonly kind: 'IfElseExpr';
  readonly cond: AstExprNode;
  readonly then: AstExprNode;
  readonly else_: AstExprNode;
  readonly span: Span;
}

export interface AstMatchExprNode {
  readonly kind: 'MatchExpr';
  readonly scrutinee: AstExprNode;
  readonly arms: readonly AstMatchArm[];
  readonly span: Span;
}

export interface AstLetExprNode {
  readonly kind: 'LetExpr';
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly value: AstExprNode;
  readonly body: AstExprNode;
  readonly span: Span;
}

export interface AstAccessorExprNode {
  readonly kind: 'AccessorExpr';
  readonly receiver: AstExprNode;
  readonly field: string;
  readonly span: Span;
}

export interface AstPropagateExprNode {
  readonly kind: 'PropagateExpr';
  readonly inner: AstExprNode;
  readonly span: Span;
}

// GroupExprNode is intentionally absent — elided by the builder.

export type AstExprNode =
  | LiteralIntNode
  | LiteralFloatNode
  | LiteralBoolNode
  | LiteralNullNode
  | AstStringLitNode
  | AstIdentNode
  | AstBinopExprNode
  | AstUnaryExprNode
  | AstCallExprNode
  | AstLambdaExprNode
  | AstPipelineExprNode
  | AstIfElseExprNode
  | AstMatchExprNode
  | AstLetExprNode
  | AstAccessorExprNode
  | AstPropagateExprNode;

// ---------------------------------------------------------------------------
// Declaration helpers
// ---------------------------------------------------------------------------

export interface AstFnParam {
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly span: Span;
}

export interface AstDeclAttribute {
  readonly name: string;
  readonly args: readonly string[];
  readonly span: Span;
}

export interface AstRecordField {
  readonly name: string;
  readonly type_: TypeAnnotation;
  readonly span: Span;
}

export type AstDataVariant =
  | { readonly kind: 'UnitVariant'; readonly name: string; readonly span: Span }
  | { readonly kind: 'TupleVariant'; readonly name: string; readonly fields: readonly TypeAnnotation[]; readonly span: Span }
  | { readonly kind: 'RecordVariant'; readonly name: string; readonly fields: readonly AstRecordField[]; readonly span: Span };

// ---------------------------------------------------------------------------
// Declaration nodes
// ---------------------------------------------------------------------------

export interface AstFnDeclNode {
  readonly kind: 'FnDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly params: readonly AstFnParam[];
  readonly effects: readonly EffectTag[];
  readonly returnType: TypeAnnotation | null;
  readonly body: AstExprNode;
  readonly attributes: readonly AstDeclAttribute[];
  readonly span: Span;
}

export interface AstLetDeclNode {
  readonly kind: 'LetDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly type_: TypeAnnotation | null;
  readonly value: AstExprNode;
  readonly span: Span;
}

export interface AstDataDeclNode {
  readonly kind: 'DataDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly variants: readonly AstDataVariant[];
  readonly span: Span;
}

export interface AstTypeAliasDeclNode {
  readonly kind: 'TypeAliasDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly typeParams: readonly string[];
  readonly type_: TypeAnnotation;
  readonly span: Span;
}

export interface AstUseDeclNode {
  readonly kind: 'UseDecl';
  readonly path: readonly string[];
  readonly items: readonly string[] | null;
  readonly span: Span;
}

export interface AstExternDeclNode {
  readonly kind: 'ExternDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly params: readonly AstFnParam[];
  readonly effects: readonly EffectTag[];
  readonly returnType: TypeAnnotation | null;
  readonly attributes: readonly AstDeclAttribute[];
  readonly span: Span;
}

export interface AstModuleDeclNode {
  readonly kind: 'ModuleDecl';
  readonly pub: boolean;
  readonly name: string;
  readonly decls: readonly AstDeclNode[];
  readonly span: Span;
}

export type AstDeclNode =
  | AstFnDeclNode
  | AstLetDeclNode
  | AstDataDeclNode
  | AstTypeAliasDeclNode
  | AstUseDeclNode
  | AstExternDeclNode
  | AstModuleDeclNode;

export interface AstModule {
  readonly kind: 'Module';
  readonly decls: readonly AstDeclNode[];
  readonly span: Span;
}
