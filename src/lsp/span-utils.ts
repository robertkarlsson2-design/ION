import { pathToFileURL } from 'node:url';
import type { Range, Position, Location } from 'vscode-languageserver';
import type { Span } from '../types.js';
import { type Token, TokenKind } from '../lexer/index.js';

/** Convert an ION Span to an LSP Range (both using 0-based lines). */
export function ionSpanToRange(span: Span): Range {
  return {
    start: { line: span.startLine - 1, character: span.startCol },
    end: { line: span.endLine - 1, character: span.endCol },
  };
}

/** Convert an ION Span to an LSP Location using a file:// URI. */
export function ionSpanToLocation(span: Span): Location {
  return {
    uri: pathToFileURL(span.file).href,
    range: ionSpanToRange(span),
  };
}

const TRIVIA: ReadonlySet<TokenKind> = new Set([
  TokenKind.WHITESPACE,
  TokenKind.NEWLINE,
  TokenKind.LINE_COMMENT,
  TokenKind.BLOCK_COMMENT,
]);

/**
 * Find the first non-trivia token covering the given LSP position.
 * Returns null if no token spans the position.
 */
export function findTokenAtPosition(
  tokens: Token[],
  filePath: string,
  pos: Position,
): Token | null {
  const ionLine = pos.line + 1;
  const ionCol = pos.character;
  for (const tok of tokens) {
    if (TRIVIA.has(tok.kind)) continue;
    const { file, startLine, startCol, endLine, endCol } = tok.span;
    if (file !== filePath) continue;
    if (startLine > ionLine || endLine < ionLine) continue;
    if (startLine === ionLine && endLine === ionLine) {
      if (startCol <= ionCol && ionCol < endCol) return tok;
    } else if (startLine === ionLine) {
      if (startCol <= ionCol) return tok;
    } else if (endLine === ionLine) {
      if (ionCol < endCol) return tok;
    } else {
      return tok;
    }
  }
  return null;
}
