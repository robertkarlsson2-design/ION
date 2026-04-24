// Lean estree-subset JS AST types produced by the JS emitter (ION-22).
// Only nodes the emitter actually generates are defined here.

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface JsProgram {
  readonly type: 'Program';
  readonly sourceType: 'module';
  readonly body: JsStatement[];
}

export type JsStatement =
  | JsExpressionStatement
  | JsVariableDeclaration
  | JsFunctionDeclaration
  | JsReturnStatement
  | JsExportNamedDeclaration
  | JsIfStatement
  | JsBlockStatement;

export interface JsVariableDeclaration {
  readonly type: 'VariableDeclaration';
  readonly kind: 'const' | 'let';
  readonly declarations: JsVariableDeclarator[];
}

export interface JsVariableDeclarator {
  readonly type: 'VariableDeclarator';
  readonly id: JsIdentifier;
  readonly init: JsExpression;
}

export interface JsFunctionDeclaration {
  readonly type: 'FunctionDeclaration';
  readonly id: JsIdentifier;
  readonly params: JsIdentifier[];
  readonly body: JsBlockStatement;
}

export interface JsReturnStatement {
  readonly type: 'ReturnStatement';
  readonly argument: JsExpression | null;
}

export interface JsIfStatement {
  readonly type: 'IfStatement';
  readonly test: JsExpression;
  readonly consequent: JsStatement;
  readonly alternate: JsStatement | null;
}

export interface JsBlockStatement {
  readonly type: 'BlockStatement';
  readonly body: JsStatement[];
}

export interface JsExpressionStatement {
  readonly type: 'ExpressionStatement';
  readonly expression: JsExpression;
}

export interface JsExportNamedDeclaration {
  readonly type: 'ExportNamedDeclaration';
  readonly declaration: JsVariableDeclaration | JsFunctionDeclaration;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type JsExpression =
  | JsIdentifier
  | JsLiteral
  | JsCallExpression
  | JsArrowFunctionExpression
  | JsMemberExpression
  | JsObjectExpression
  | JsArrayExpression
  | JsConditionalExpression
  | JsSequenceExpression
  | JsAwaitExpression
  | JsTemplateLiteral
  | JsRawExpression;

export interface JsIdentifier {
  readonly type: 'Identifier';
  readonly name: string;
}

export interface JsLiteral {
  readonly type: 'Literal';
  readonly value: string | number | boolean | null;
  readonly raw?: string;
}

export interface JsCallExpression {
  readonly type: 'CallExpression';
  readonly callee: JsExpression;
  readonly arguments: JsExpression[];
}

export interface JsArrowFunctionExpression {
  readonly type: 'ArrowFunctionExpression';
  readonly params: JsIdentifier[];
  readonly body: JsExpression | JsBlockStatement;
  readonly async: boolean;
}

export interface JsMemberExpression {
  readonly type: 'MemberExpression';
  readonly object: JsExpression;
  readonly property: JsIdentifier;
  readonly computed: false;
}

export interface JsObjectExpression {
  readonly type: 'ObjectExpression';
  readonly properties: JsProperty[];
}

export interface JsProperty {
  readonly type: 'Property';
  readonly key: JsIdentifier;
  readonly value: JsExpression;
}

export interface JsArrayExpression {
  readonly type: 'ArrayExpression';
  readonly elements: JsExpression[];
}

export interface JsConditionalExpression {
  readonly type: 'ConditionalExpression';
  readonly test: JsExpression;
  readonly consequent: JsExpression;
  readonly alternate: JsExpression;
}

export interface JsSequenceExpression {
  readonly type: 'SequenceExpression';
  readonly expressions: JsExpression[];
}

export interface JsAwaitExpression {
  readonly type: 'AwaitExpression';
  readonly argument: JsExpression;
}

export interface JsTemplateLiteral {
  readonly type: 'TemplateLiteral';
  readonly quasis: JsTemplateElement[];
  readonly expressions: JsExpression[];
}

export interface JsTemplateElement {
  readonly type: 'TemplateElement';
  readonly value: string;
  readonly tail: boolean;
}

/** Escape hatch: pre-rendered JS source fragment from ForeignRef template expansion. */
export interface JsRawExpression {
  readonly type: 'RawExpression';
  readonly raw: string;
}

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Build a JsIdentifier. */
export function jsIdent(name: string): JsIdentifier {
  return { type: 'Identifier', name };
}

/** Build a numeric JsLiteral. */
export function jsNumLit(value: number): JsLiteral {
  return { type: 'Literal', value };
}

/** Build a string JsLiteral. */
export function jsStrLit(value: string): JsLiteral {
  return { type: 'Literal', value };
}

/** Build a boolean JsLiteral. */
export function jsBoolLit(value: boolean): JsLiteral {
  return { type: 'Literal', value };
}

/** Build a null JsLiteral. */
export function jsNullLit(): JsLiteral {
  return { type: 'Literal', value: null };
}

/** Build a JsCallExpression. */
export function jsCall(callee: JsExpression, args: JsExpression[]): JsCallExpression {
  return { type: 'CallExpression', callee, arguments: args };
}

/** Build a JsMemberExpression. */
export function jsMember(object: JsExpression, property: string): JsMemberExpression {
  return { type: 'MemberExpression', object, property: jsIdent(property), computed: false };
}

/** Build a const JsVariableDeclaration. */
export function jsConst(name: string, init: JsExpression): JsVariableDeclaration {
  return {
    type: 'VariableDeclaration',
    kind: 'const',
    declarations: [{ type: 'VariableDeclarator', id: jsIdent(name), init }],
  };
}

/** Build a JsArrowFunctionExpression. */
export function jsArrow(
  params: JsIdentifier[],
  body: JsExpression | JsBlockStatement,
  isAsync = false,
): JsArrowFunctionExpression {
  return { type: 'ArrowFunctionExpression', params, body, async: isAsync };
}

/** Build a JsRawExpression. */
export function jsRaw(raw: string): JsRawExpression {
  return { type: 'RawExpression', raw };
}

/** Build an IIFE: `((params) => body)(args)` */
export function jsIIFE(
  params: JsIdentifier[],
  body: JsExpression | JsBlockStatement,
  args: JsExpression[],
): JsCallExpression {
  return jsCall(jsArrow(params, body), args);
}
