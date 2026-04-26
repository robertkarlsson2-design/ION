import type { EffectTag } from '../ast/types.js';
import type { Span, SymbolId } from '../types.js';
import type { IonType } from './types.js';

// ---------------------------------------------------------------------------
// Shared helper types
// ---------------------------------------------------------------------------

/** A literal value appearing in source or IR. */
export type LiteralValue =
  | { readonly kind: 'Int'; readonly value: number }
  | { readonly kind: 'Float'; readonly value: number }
  | { readonly kind: 'Str'; readonly value: string }
  | { readonly kind: 'Bool'; readonly value: boolean }
  | { readonly kind: 'Null' };

/** Visibility modifier for OOP members (hoisted here so Param can reference it). */
export type OopVisibility = 'public' | 'private' | 'protected';

/** A function / lambda parameter with its resolved type and symbol. */
export interface Param {
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly type: IonType;
  readonly span: Span;
  // NEW (for class fields):
  readonly isReadonly?: boolean;
  readonly isStatic?: boolean;
  readonly visibility?: OopVisibility;
}

/** A pattern in a case arm or match expression. */
export type CasePattern =
  | WildcardPattern
  | VarPattern
  | ConstructorPattern
  | LiteralPattern
  | TuplePattern;

export interface WildcardPattern {
  readonly kind: 'Wildcard';
  readonly span: Span;
}

export interface VarPattern {
  readonly kind: 'Var';
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly span: Span;
}

export interface ConstructorPattern {
  readonly kind: 'Constructor';
  readonly ctorName: string;
  readonly symbolId: SymbolId;
  readonly fields: readonly CasePattern[];
  readonly span: Span;
}

export interface LiteralPattern {
  readonly kind: 'Literal';
  readonly value: LiteralValue;
  readonly span: Span;
}

export interface TuplePattern {
  readonly kind: 'Tuple';
  readonly elements: readonly CasePattern[];
  readonly span: Span;
}

/** A single arm in a case/match expression. */
export interface CaseArm {
  readonly pattern: CasePattern;
  /** Optional `if` guard; must be a boolean expression. */
  readonly guard?: IonIRNode;
  readonly body: IonIRNode;
  readonly span: Span;
}

/** An extern declaration's call template and type signature. */
export interface ForeignSignature {
  readonly params: readonly IonType[];
  readonly ret: IonType;
  /** Call template with positional placeholders, e.g. `"$1.push($2)"`. */
  readonly template: string;
  /** Original parameter names from the `extern fn` declaration, used in emitters. */
  readonly paramNames: readonly string[];
}

// ---------------------------------------------------------------------------
// Core dialect nodes
// ---------------------------------------------------------------------------

export interface VarNode {
  readonly kind: 'Var';
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly span: Span;
  readonly type: IonType;
}

export interface LiteralNode {
  readonly kind: 'Literal';
  readonly value: LiteralValue;
  readonly span: Span;
  readonly type: IonType;
}

export interface AppNode {
  readonly kind: 'App';
  readonly callee: IonIRNode;
  readonly args: readonly IonIRNode[];
  readonly span: Span;
  readonly type: IonType;
}

export interface AbsNode {
  readonly kind: 'Abs';
  readonly params: readonly Param[];
  readonly body: IonIRNode;
  /** Free variables captured from outer scope. */
  readonly captures: readonly SymbolId[];
  readonly span: Span;
  readonly type: IonType;
}

export interface LetNode {
  readonly kind: 'Let';
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly bindingType: IonType;
  readonly value: IonIRNode;
  readonly body: IonIRNode;
  readonly span: Span;
  readonly type: IonType;
}

export interface CaseNode {
  readonly kind: 'Case';
  readonly scrutinee: IonIRNode;
  readonly arms: readonly CaseArm[];
  readonly span: Span;
  readonly type: IonType;
}

export interface ConstructorNode {
  readonly kind: 'Constructor';
  readonly ctorName: string;
  readonly symbolId: SymbolId;
  readonly args: readonly IonIRNode[];
  readonly span: Span;
  readonly type: IonType;
}

export interface AccessorNode {
  readonly kind: 'Accessor';
  readonly receiver: IonIRNode;
  readonly member: string;
  readonly span: Span;
  readonly type: IonType;
}

export interface ListLitIRNode {
  readonly kind: 'ListLit';
  readonly elements: readonly IonIRNode[];
  readonly span: Span;
  readonly type: IonType;
}

export interface TupleLitIRNode {
  readonly kind: 'TupleLit';
  readonly elements: readonly IonIRNode[];
  readonly span: Span;
  readonly type: IonType;
}

export interface MapLitIRNode {
  readonly kind: 'MapLit';
  readonly entries: readonly { readonly key: IonIRNode; readonly value: IonIRNode }[];
  readonly span: Span;
  readonly type: IonType;
}

export interface ModuleRefNode {
  readonly kind: 'ModuleRef';
  readonly modulePath: readonly string[];
  readonly symbolId: SymbolId;
  readonly span: Span;
  readonly type: IonType;
}

export interface ForeignRefNode {
  readonly kind: 'ForeignRef';
  readonly target: string;
  readonly module: string;
  readonly symbol: string;
  readonly sig: ForeignSignature;
  readonly span: Span;
  readonly type: IonType;
}

export interface EffectNode {
  readonly kind: 'Effect';
  readonly effectTag: EffectTag;
  readonly body: IonIRNode;
  readonly span: Span;
  readonly type: IonType;
}

export type CoreNode =
  | VarNode
  | LiteralNode
  | AppNode
  | AbsNode
  | LetNode
  | CaseNode
  | ConstructorNode
  | AccessorNode
  | ListLitIRNode
  | TupleLitIRNode
  | MapLitIRNode
  | ModuleRefNode
  | ForeignRefNode
  | EffectNode;

// ---------------------------------------------------------------------------
// ion-oop dialect nodes
// ---------------------------------------------------------------------------

/** A decorator/annotation on a class or method. */
export interface OopAnnotation {
  readonly name: string;
  readonly args: readonly string[];
}

/** An explicit constructor on an OOP class. */
export interface OopConstructor {
  readonly params: readonly Param[];
  readonly body?: IonIRNode;
  readonly visibility?: OopVisibility;
  readonly span: Span;
}

/** A method member on an OOP class or interface. */
export interface OopMethod {
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly params: readonly Param[];
  readonly retType: IonType;
  readonly body?: IonIRNode;
  readonly isAbstract: boolean;
  readonly isStatic: boolean;
  readonly span: Span;
  // NEW:
  readonly visibility?: OopVisibility;
  readonly accessorKind?: 'get' | 'set';
  readonly annotations?: readonly OopAnnotation[];
}

/** An abstract member on an OOP interface. */
export interface OopMember {
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly type: IonType;
  readonly span: Span;
}

export interface OopClassNode {
  readonly kind: 'OopClass';
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly superClass?: SymbolId;
  readonly interfaces: readonly SymbolId[];
  readonly fields: readonly Param[];
  readonly methods: readonly OopMethod[];
  readonly span: Span;
  readonly type: IonType;
  // NEW:
  readonly typeParams?: readonly string[];
  readonly annotations?: readonly OopAnnotation[];
  readonly constructors?: readonly OopConstructor[];
}

export interface OopInterfaceNode {
  readonly kind: 'OopInterface';
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly members: readonly OopMember[];
  readonly span: Span;
  readonly type: IonType;
  // NEW:
  readonly typeParams?: readonly string[];
  readonly annotations?: readonly OopAnnotation[];
}

export interface OopNewNode {
  readonly kind: 'OopNew';
  readonly ctorSymbolId: SymbolId;
  readonly args: readonly IonIRNode[];
  readonly span: Span;
  readonly type: IonType;
}

export interface OopVirtualCallNode {
  readonly kind: 'OopVirtualCall';
  readonly receiver: IonIRNode;
  readonly method: string;
  readonly args: readonly IonIRNode[];
  readonly span: Span;
  readonly type: IonType;
}

export interface OopThisNode {
  readonly kind: 'OopThis';
  readonly span: Span;
  readonly type: IonType;
}

export type OopNode =
  | OopClassNode
  | OopInterfaceNode
  | OopNewNode
  | OopVirtualCallNode
  | OopThisNode;

// ---------------------------------------------------------------------------
// ion-async dialect nodes
// ---------------------------------------------------------------------------

export interface AsyncBlockNode {
  readonly kind: 'AsyncBlock';
  readonly body: IonIRNode;
  readonly span: Span;
  readonly type: IonType;
}

export interface AwaitNode {
  readonly kind: 'Await';
  readonly expr: IonIRNode;
  readonly span: Span;
  readonly type: IonType;
}

export type AsyncNode = AsyncBlockNode | AwaitNode;

// ---------------------------------------------------------------------------
// ion-adt dialect nodes
// ---------------------------------------------------------------------------

/** A single variant of an algebraic data type. */
export interface AdtVariant {
  readonly tag: string;
  readonly symbolId: SymbolId;
  readonly fields: readonly Param[];
  readonly span: Span;
}

/** A single arm in an ADT match expression. */
export interface AdtArm {
  readonly tag: string;
  readonly bindings: readonly Param[];
  readonly body: IonIRNode;
  readonly span: Span;
}

export interface AdtDeclNode {
  readonly kind: 'AdtDecl';
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly variants: readonly AdtVariant[];
  readonly span: Span;
  readonly type: IonType;
}

export interface AdtMatchNode {
  readonly kind: 'AdtMatch';
  readonly scrutinee: IonIRNode;
  readonly arms: readonly AdtArm[];
  readonly span: Span;
  readonly type: IonType;
}

export type AdtNode = AdtDeclNode | AdtMatchNode;

// ---------------------------------------------------------------------------
// ion-effects dialect nodes (Koka-style algebraic effects)
// ---------------------------------------------------------------------------

/** A single operation declared in an effect. */
export interface EffectOp {
  readonly name: string;
  readonly params: readonly Param[];
  readonly retType: IonType;
  readonly span: Span;
}

/** A handler clause for one operation within a Handle node. */
export interface EffectHandler {
  readonly operation: string;
  readonly params: readonly Param[];
  readonly body: IonIRNode;
  readonly span: Span;
}

export interface EffectDeclNode {
  readonly kind: 'EffectDecl';
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly operations: readonly EffectOp[];
  readonly span: Span;
  readonly type: IonType;
}

export interface PerformNode {
  readonly kind: 'Perform';
  readonly effectSymbolId: SymbolId;
  readonly operation: string;
  readonly args: readonly IonIRNode[];
  readonly span: Span;
  readonly type: IonType;
}

export interface HandleNode {
  readonly kind: 'Handle';
  readonly body: IonIRNode;
  readonly handlers: readonly EffectHandler[];
  readonly returnClause?: IonIRNode;
  readonly span: Span;
  readonly type: IonType;
}

export interface ResumeNode {
  readonly kind: 'Resume';
  readonly value: IonIRNode;
  readonly span: Span;
  readonly type: IonType;
}

export type EffectsNode = EffectDeclNode | PerformNode | HandleNode | ResumeNode;

// ---------------------------------------------------------------------------
// Top-level unions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Escape hatch — raw target-language code injection
// ---------------------------------------------------------------------------

/**
 * Injects a verbatim string of target-language code into the output.
 * Every emitter MUST handle this node with a single line: `return node.code`.
 * Use this when a pattern is not yet natively supported by the emitter —
 * the LLM can always fall back to writing the exact output it needs.
 */
export interface RawInjectNode {
  readonly kind: 'RawInject';
  /** Verbatim target-language code to emit as-is. */
  readonly code: string;
  readonly span: Span;
  readonly type: IonType;
}

export type IonIRNode = CoreNode | OopNode | AsyncNode | AdtNode | EffectsNode | RawInjectNode;

/** All valid `kind` strings for IonIR nodes, for runtime validation. */
export const VALID_IR_KINDS: ReadonlySet<string> = new Set<string>([
  'Var', 'Literal', 'App', 'Abs', 'Let', 'Case', 'Constructor', 'Accessor', 'ListLit', 'TupleLit', 'MapLit',
  'ModuleRef', 'ForeignRef', 'Effect',
  'OopClass', 'OopInterface', 'OopNew', 'OopVirtualCall', 'OopThis',
  'AsyncBlock', 'Await',
  'AdtDecl', 'AdtMatch',
  'EffectDecl', 'Perform', 'Handle', 'Resume',
  'RawInject',
]);

/** Which extension dialects are active in a given module. */
export type IonIRDialect = 'core' | 'ion-oop' | 'ion-async' | 'ion-adt' | 'ion-effects';

// ---------------------------------------------------------------------------
// IonIRModule — the stability boundary and top-level document type
// ---------------------------------------------------------------------------

export interface IonIRModule {
  /** Version sentinel for serde; must equal '1.0'. */
  readonly ionir: '1.0';
  /** Fully-qualified module name, e.g. `'org.acme.users'`. */
  readonly module: string;
  /** Semver version string. */
  readonly version: string;
  /** Extension dialects used in this module. */
  readonly dialects: readonly IonIRDialect[];
  /** Module-level imports. */
  readonly imports: readonly ModuleRefNode[];
  /** Top-level algebraic data type declarations. */
  readonly data: readonly AdtDeclNode[];
  /** Top-level function / let / extern declarations. */
  readonly decls: readonly IonIRNode[];
}
