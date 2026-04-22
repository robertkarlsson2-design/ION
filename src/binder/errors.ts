import type { Span } from '../types.js';

export type BindErrorKind = 'UndefinedName' | 'DuplicateBinding' | 'CircularImport';

export interface BindError {
  readonly kind: BindErrorKind;
  readonly message: string;
  readonly span: Span;
}
