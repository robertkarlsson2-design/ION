import type { Span } from '../types.js';

/** Machine-readable parser error codes. */
export type ParseErrorCode = 'P0001' | 'P0002' | 'P0003' | 'P0004' | 'P0005';

/** Thrown by the parser on the first syntactic error. */
export class ParseError extends Error {
  readonly code: ParseErrorCode;
  readonly span: Span;
  readonly suggestion: string;
  readonly expected?: string;
  readonly found?: string;

  constructor(
    message: string,
    code: ParseErrorCode,
    span: Span,
    suggestion: string,
    expected?: string,
    found?: string,
  ) {
    super(message);
    this.name = 'ParseError';
    this.code = code;
    this.span = span;
    this.suggestion = suggestion;
    if (expected !== undefined) this.expected = expected;
    if (found !== undefined) this.found = found;
  }
}

/**
 * Format a ParseError as a human-readable multiline string.
 * Output: `error[PXXXX]: <message> at <file>:<line>:<col>\n  expected: ...\n  found: ...\n  suggestion: ...`
 */
export function formatParseError(e: ParseError): string {
  const loc = `${e.span.file}:${e.span.startLine}:${e.span.startCol}`;
  let out = `error[${e.code}]: ${e.message} at ${loc}`;
  if (e.expected !== undefined) out += `\n  expected: ${e.expected}`;
  if (e.found !== undefined) out += `\n  found:    ${e.found}`;
  out += `\n  suggestion: ${e.suggestion}`;
  return out;
}
