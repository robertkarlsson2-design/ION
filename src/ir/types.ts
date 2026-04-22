import type { EffectTag } from '../ast/types.js';
import type { SymbolId } from '../types.js';

/** A fully resolved type produced by the type checker and carried by every IonIR node. */
export type IonType =
  | IntType
  | FloatType
  | StrType
  | BoolType
  | NullType
  | UnitType
  | ListType
  | MapType
  | OptionType
  | ResultType
  | FnType
  | UserType
  | TypeVar
  | NeverType;

export interface IntType {
  readonly kind: 'Int';
}

export interface FloatType {
  readonly kind: 'Float';
}

export interface StrType {
  readonly kind: 'Str';
}

export interface BoolType {
  readonly kind: 'Bool';
}

export interface NullType {
  readonly kind: 'Null';
}

export interface UnitType {
  readonly kind: 'Unit';
}

export interface ListType {
  readonly kind: 'List';
  readonly elem: IonType;
}

export interface MapType {
  readonly kind: 'Map';
  readonly key: IonType;
  readonly value: IonType;
}

export interface OptionType {
  readonly kind: 'Option';
  readonly inner: IonType;
}

export interface ResultType {
  readonly kind: 'Result';
  readonly ok: IonType;
  readonly err: IonType;
}

/** Empty set = pure function. */
export type EffectSet = ReadonlySet<EffectTag>;

export interface FnType {
  readonly kind: 'Fn';
  readonly params: readonly IonType[];
  readonly ret: IonType;
  readonly effects: EffectSet;
}

export interface UserType {
  readonly kind: 'User';
  readonly name: string;
  readonly symbolId: SymbolId;
  readonly args: readonly IonType[];
}

/** Hindley-Milner inference variable. */
export interface TypeVar {
  readonly kind: 'TypeVar';
  readonly id: string;
}

/** Bottom type; result type of match arms that never return. */
export interface NeverType {
  readonly kind: 'Never';
}
