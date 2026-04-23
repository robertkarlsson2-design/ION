import type { Span } from '../types.js';

export interface UndefinedNameError {
  readonly kind: 'UndefinedName';
  readonly name: string;
  readonly message: string;
  readonly span: Span;
}

export interface DuplicateBindingError {
  readonly kind: 'DuplicateBinding';
  readonly name: string;
  readonly message: string;
  readonly span: Span;
  readonly previousSpan: Span;
}

export interface CircularImportError {
  readonly kind: 'CircularImport';
  readonly cycle: readonly string[];
  readonly message: string;
  readonly span: Span;
}

export type BindError = UndefinedNameError | DuplicateBindingError | CircularImportError;
export type BindErrorKind = BindError['kind'];
