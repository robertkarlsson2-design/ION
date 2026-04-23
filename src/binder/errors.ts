import type { Span } from '../types.js';

export interface UndefinedNameError {
  readonly kind: 'UndefinedName';
  readonly name: string;
  readonly span: Span;
  readonly message: string;
}

export interface DuplicateBindingError {
  readonly kind: 'DuplicateBinding';
  readonly name: string;
  readonly span: Span;
  readonly message: string;
}

export interface CircularImportError {
  readonly kind: 'CircularImport';
  readonly cycle: readonly string[];
  readonly span: Span;
  readonly message: string;
}

export type BindError = UndefinedNameError | DuplicateBindingError | CircularImportError;
export type BindErrorKind = BindError['kind'];
