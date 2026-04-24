import type { Span } from '../types.js';
import type { IonType } from '../ir/types.js';
import type { EffectTag } from '../ast/types.js';
import { typeStr } from './unifier.js';

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
  readonly expectedAnnotation: string;
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
  readonly expected: 'Option | Result';
  readonly span: Span;
  readonly message: string;
  readonly suggestion: string;
}

export interface EffectMismatchError {
  readonly kind: 'EffectMismatch';
  readonly code: 'E0405';
  readonly unexpected: EffectTag;
  readonly expected: readonly EffectTag[];
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
 * Format a CheckError as a human-readable multiline string with code, message, span, structured
 * expected/actual fields, and a fix suggestion.
 */
export function formatCheckError(e: CheckError): string {
  const loc = `${e.span.file}:${e.span.startLine}:${e.span.startCol}`;
  let out = `error[${e.code}]: ${e.message} at ${loc}`;

  switch (e.kind) {
    case 'TypeMismatch':
      out += `\n  expected: ${typeStr(e.expected)}`;
      out += `\n  found:    ${typeStr(e.found)}`;
      break;
    case 'UnannotatedTopLevel':
      out += `\n  expected annotation: ${e.expectedAnnotation}`;
      break;
    case 'NonExhaustiveMatch':
      out += `\n  missing arms: ${e.missing.join(', ')}`;
      break;
    case 'InvalidPropagate':
      out += `\n  found:    ${typeStr(e.found)}`;
      out += `\n  expected: ${e.expected}`;
      break;
    case 'EffectMismatch':
      out += `\n  unexpected: ${e.unexpected}`;
      out += `\n  expected effects: ${e.expected.length === 0 ? '(none declared)' : e.expected.join(', ')}`;
      break;
    case 'ArityMismatch':
      out += `\n  expected: ${e.expected}`;
      out += `\n  found:    ${e.found}`;
      break;
  }

  out += `\n  suggestion: ${e.suggestion}`;
  return out;
}
