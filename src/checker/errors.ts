import type { Span } from '../types.js';
import type { IonType } from '../ir/types.js';
import type { EffectTag } from '../ast/types.js';

export interface TypeMismatchError {
  readonly kind: 'TypeMismatch';
  readonly code: 'E0401';
  readonly expected: IonType;
  readonly found: IonType;
  readonly span: Span;
  readonly message: string;
  readonly suggestion: string;
}

export interface UnannotatedTopLevelError {
  readonly kind: 'UnannotatedTopLevel';
  readonly code: 'E0402';
  readonly name: string;
  readonly span: Span;
  readonly message: string;
  readonly suggestion: string;
}

export interface NonExhaustiveMatchError {
  readonly kind: 'NonExhaustiveMatch';
  readonly code: 'E0403';
  readonly missing: readonly string[];
  readonly span: Span;
  readonly message: string;
  readonly suggestion: string;
}

export interface InvalidPropagateError {
  readonly kind: 'InvalidPropagate';
  readonly code: 'E0404';
  readonly found: IonType;
  readonly span: Span;
  readonly message: string;
  readonly suggestion: string;
}

export interface EffectMismatchError {
  readonly kind: 'EffectMismatch';
  readonly code: 'E0405';
  readonly unexpected: EffectTag;
  readonly span: Span;
  readonly message: string;
  readonly suggestion: string;
}

export interface ArityMismatchError {
  readonly kind: 'ArityMismatch';
  readonly code: 'E0406';
  readonly expected: number;
  readonly found: number;
  readonly span: Span;
  readonly message: string;
  readonly suggestion: string;
}

export type CheckError =
  | TypeMismatchError
  | UnannotatedTopLevelError
  | NonExhaustiveMatchError
  | InvalidPropagateError
  | EffectMismatchError
  | ArityMismatchError;

/**
 * Format a CheckError as a human-readable string with error code, message, span, and suggestion.
 * Output: `error[EXXXX]: <message> at <file>:<line>:<col>\n  suggestion: <suggestion>`
 */
export function formatCheckError(e: CheckError): string {
  return `error[${e.code}]: ${e.message} at ${e.span.file}:${e.span.startLine}:${e.span.startCol}\n  suggestion: ${e.suggestion}`;
}
