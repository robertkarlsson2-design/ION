import type { Span } from '../../src/types.js';

export interface JsModule {
  readonly kind: 'JsModule';
  readonly helpers: readonly JsNode[];
  readonly dataDecls: readonly JsNode[];
  readonly bodyDecls: readonly JsNode[];
}

export interface JsConst {
  readonly kind: 'JsConst';
  readonly name: string;
  readonly value: JsNode;
  readonly ionSpan?: Span;
}

export interface JsClass {
  readonly kind: 'JsClass';
  readonly name: string;
  readonly superClass?: string;
  readonly ctor: JsMethod;
  readonly methods: readonly JsMethod[];
  readonly ionSpan?: Span;
}

export interface JsMethod {
  readonly kind: 'JsMethod';
  readonly name: string;
  readonly params: readonly string[];
  readonly body: readonly JsNode[];
  readonly isStatic: boolean;
  readonly ionSpan?: Span;
}

export interface JsArrow {
  readonly kind: 'JsArrow';
  readonly params: readonly string[];
  readonly body: JsNode;
  readonly ionSpan?: Span;
}

export interface JsCall {
  readonly kind: 'JsCall';
  readonly callee: JsNode;
  readonly args: readonly JsNode[];
  readonly ionSpan?: Span;
}

export interface JsNew {
  readonly kind: 'JsNew';
  readonly className: string;
  readonly args: readonly JsNode[];
  readonly ionSpan?: Span;
}

export interface JsIdent {
  readonly kind: 'JsIdent';
  readonly name: string;
  readonly ionSpan?: Span;
}

export interface JsNumber {
  readonly kind: 'JsNumber';
  readonly value: number;
  readonly ionSpan?: Span;
}

export interface JsString {
  readonly kind: 'JsString';
  readonly value: string;
  readonly ionSpan?: Span;
}

export interface JsBool {
  readonly kind: 'JsBool';
  readonly value: boolean;
  readonly ionSpan?: Span;
}

export interface JsNull {
  readonly kind: 'JsNull';
  readonly ionSpan?: Span;
}

export interface JsMember {
  readonly kind: 'JsMember';
  readonly receiver: JsNode;
  readonly member: string;
  readonly ionSpan?: Span;
}

export interface JsSubscript {
  readonly kind: 'JsSubscript';
  readonly receiver: JsNode;
  readonly index: JsNode;
  readonly ionSpan?: Span;
}

export interface JsObjectProp {
  readonly kind: 'JsObjectProp';
  readonly key: string;
  readonly value: JsNode;
  readonly shorthand: boolean;
}

export interface JsObject {
  readonly kind: 'JsObject';
  readonly props: readonly JsObjectProp[];
  readonly ionSpan?: Span;
}

export interface JsArray {
  readonly kind: 'JsArray';
  readonly elems: readonly JsNode[];
  readonly ionSpan?: Span;
}

export interface JsIife {
  readonly kind: 'JsIife';
  readonly body: readonly JsNode[];
  readonly ionSpan?: Span;
}

export interface JsIfElse {
  readonly kind: 'JsIfElse';
  readonly branches: readonly { readonly cond: JsNode; readonly body: readonly JsNode[] }[];
  readonly elseBranch?: readonly JsNode[];
  readonly ionSpan?: Span;
}

export interface JsReturn {
  readonly kind: 'JsReturn';
  readonly value: JsNode;
  readonly ionSpan?: Span;
}

export interface JsSwitch {
  readonly kind: 'JsSwitch';
  readonly expr: JsNode;
  readonly cases: readonly JsSwitchCase[];
  readonly ionSpan?: Span;
}

export interface JsSwitchCase {
  readonly kind: 'JsSwitchCase';
  readonly label: string;
  readonly body: readonly JsNode[];
  readonly ionSpan?: Span;
}

export interface JsThrow {
  readonly kind: 'JsThrow';
  readonly value: JsNode;
  readonly ionSpan?: Span;
}

export interface JsTryCatch {
  readonly kind: 'JsTryCatch';
  readonly tryBody: readonly JsNode[];
  readonly catchParam: string;
  readonly catchBody: readonly JsNode[];
  readonly ionSpan?: Span;
}

export interface JsBlock {
  readonly kind: 'JsBlock';
  readonly stmts: readonly JsNode[];
  readonly ionSpan?: Span;
}

export interface JsAssign {
  readonly kind: 'JsAssign';
  readonly lhs: JsNode;
  readonly rhs: JsNode;
  readonly ionSpan?: Span;
}

export interface JsLineComment {
  readonly kind: 'JsLineComment';
  readonly text: string;
  readonly ionSpan?: Span;
}

export interface JsTemplateLit {
  readonly kind: 'JsTemplateLit';
  readonly parts: readonly (string | JsNode)[];
  readonly ionSpan?: Span;
}

export interface JsBinary {
  readonly kind: 'JsBinary';
  readonly op: string;
  readonly left: JsNode;
  readonly right: JsNode;
  readonly ionSpan?: Span;
}

export interface JsInstanceof {
  readonly kind: 'JsInstanceof';
  readonly expr: JsNode;
  readonly className: string;
  readonly ionSpan?: Span;
}

export interface JsRaw {
  readonly kind: 'JsRaw';
  readonly code: string;
  readonly ionSpan?: Span;
}

export type JsNode =
  | JsModule
  | JsConst
  | JsClass
  | JsMethod
  | JsArrow
  | JsCall
  | JsNew
  | JsIdent
  | JsNumber
  | JsString
  | JsBool
  | JsNull
  | JsMember
  | JsSubscript
  | JsObject
  | JsObjectProp
  | JsArray
  | JsIife
  | JsIfElse
  | JsReturn
  | JsSwitch
  | JsSwitchCase
  | JsThrow
  | JsTryCatch
  | JsBlock
  | JsAssign
  | JsLineComment
  | JsTemplateLit
  | JsBinary
  | JsInstanceof
  | JsRaw;
