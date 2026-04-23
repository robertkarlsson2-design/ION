import type { SymbolId, Span } from '../types.js';
import type { IonType } from '../ir/types.js';
import type { EffectTag } from '../ast/types.js';

export interface TypeMismatchError {
  readonly kind: 'TypeMismatch';
  readonly code: 'E0401';
  readonly expected: IonType;
  readonly actual: IonType;
  readonly span: Span;
  readonly message: string;
}

export interface InexhaustiveMatchError {
  readonly kind: 'InexhaustiveMatch';
  readonly code: 'E0402';
  readonly missingCases: readonly string[];
  readonly span: Span;
  readonly message: string;
}

export interface InvalidPropagateError {
  readonly kind: 'InvalidPropagate';
  readonly code: 'E0403';
  readonly actualType: IonType;
  readonly span: Span;
  readonly message: string;
}

export interface EffectViolationError {
  readonly kind: 'EffectViolation';
  readonly code: 'E0404';
  readonly declared: ReadonlySet<EffectTag>;
  readonly used: ReadonlySet<EffectTag>;
  readonly span: Span;
  readonly message: string;
}

export interface MissingAnnotationError {
  readonly kind: 'MissingAnnotation';
  readonly code: 'E0405';
  readonly name: string;
  readonly span: Span;
  readonly message: string;
}

export interface UnknownTypeError {
  readonly kind: 'UnknownType';
  readonly code: 'E0406';
  readonly name: string;
  readonly span: Span;
  readonly message: string;
}

export type CheckError =
  | TypeMismatchError
  | InexhaustiveMatchError
  | InvalidPropagateError
  | EffectViolationError
  | MissingAnnotationError
  | UnknownTypeError;

/** SymbolId → resolved IonType; consumed by the desugarer. */
export type TypeEnv = ReadonlyMap<SymbolId, IonType>;

/** spanKey(span) → IonType for every expression node. */
export type NodeTypeMap = ReadonlyMap<string, IonType>;

export interface CheckResult {
  readonly typeEnv: TypeEnv;
  readonly nodeTypes: NodeTypeMap;
  readonly errors: readonly CheckError[];
}
