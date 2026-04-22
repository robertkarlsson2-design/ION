import type { EffectTag } from '../ast/types.js';
import type { Span, SymbolId } from '../types.js';
import type { IonType } from './types.js';
/** A literal value appearing in source or IR. */
export type LiteralValue = {
    readonly kind: 'Int';
    readonly value: number;
} | {
    readonly kind: 'Float';
    readonly value: number;
} | {
    readonly kind: 'Str';
    readonly value: string;
} | {
    readonly kind: 'Bool';
    readonly value: boolean;
} | {
    readonly kind: 'Null';
};
/** A function / lambda parameter with its resolved type and symbol. */
export interface Param {
    readonly name: string;
    readonly symbolId: SymbolId;
    readonly type: IonType;
    readonly span: Span;
}
/** A pattern in a case arm or match expression. */
export type CasePattern = WildcardPattern | VarPattern | ConstructorPattern | LiteralPattern;
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
}
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
export type CoreNode = VarNode | LiteralNode | AppNode | AbsNode | LetNode | CaseNode | ConstructorNode | AccessorNode | ModuleRefNode | ForeignRefNode | EffectNode;
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
}
export interface OopInterfaceNode {
    readonly kind: 'OopInterface';
    readonly name: string;
    readonly symbolId: SymbolId;
    readonly members: readonly OopMember[];
    readonly span: Span;
    readonly type: IonType;
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
export type OopNode = OopClassNode | OopInterfaceNode | OopNewNode | OopVirtualCallNode | OopThisNode;
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
export type IonIRNode = CoreNode | OopNode | AsyncNode | AdtNode | EffectsNode;
/** Which extension dialects are active in a given module. */
export type IonIRDialect = 'core' | 'ion-oop' | 'ion-async' | 'ion-adt' | 'ion-effects';
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
