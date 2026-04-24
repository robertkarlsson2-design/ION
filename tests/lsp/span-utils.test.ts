import { describe, it, expect } from 'vitest';
import { ionSpanToRange, ionSpanToLocation, findTokenAtPosition } from '../../src/lsp/span-utils.js';
import { lex } from '../../src/lexer/index.js';
import type { Span } from '../../src/types.js';

const FILE = '/tmp/test.ion';

describe('ionSpanToRange', () => {
  it('converts 1-based ION line to 0-based LSP line, passes columns through', () => {
    const span: Span = { file: FILE, startLine: 3, startCol: 4, endLine: 3, endCol: 9 };
    expect(ionSpanToRange(span)).toEqual({
      start: { line: 2, character: 4 },
      end: { line: 2, character: 9 },
    });
  });

  it('handles single-character spans', () => {
    const span: Span = { file: FILE, startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
    expect(ionSpanToRange(span)).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    });
  });

  it('handles multiline spans', () => {
    const span: Span = { file: FILE, startLine: 2, startCol: 5, endLine: 4, endCol: 3 };
    expect(ionSpanToRange(span)).toEqual({
      start: { line: 1, character: 5 },
      end: { line: 3, character: 3 },
    });
  });
});

describe('ionSpanToLocation', () => {
  it('generates a file:// URI from the span file path', () => {
    const span: Span = { file: '/tmp/foo.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 3 };
    const loc = ionSpanToLocation(span);
    expect(loc.uri).toMatch(/^file:\/\//);
    expect(loc.uri).toContain('foo.ion');
    expect(loc.range).toEqual(ionSpanToRange(span));
  });
});

describe('findTokenAtPosition', () => {
  const src = 'fn foo(x: Int) -> Int = x';
  const tokens = lex(src, FILE);

  it('returns the identifier token when cursor is on it', () => {
    // 'foo' starts at col 3, ends at col 6 on line 1 (0-based: line 0)
    const tok = findTokenAtPosition(tokens, FILE, { line: 0, character: 4 });
    expect(tok).not.toBeNull();
    expect(tok?.text).toBe('foo');
  });

  it('returns null when cursor is on whitespace between tokens', () => {
    // position 2 is the space between 'fn' and 'foo'
    const tok = findTokenAtPosition(tokens, FILE, { line: 0, character: 2 });
    expect(tok).toBeNull();
  });

  it('returns null when cursor is past EOF', () => {
    const tok = findTokenAtPosition(tokens, FILE, { line: 99, character: 0 });
    expect(tok).toBeNull();
  });

  it('returns the first token on a line when cursor is on it', () => {
    const src2 = 'fn bar() =\n  42';
    const tokens2 = lex(src2, FILE);
    // line 1 (0-based), char 2 → '42'
    const tok = findTokenAtPosition(tokens2, FILE, { line: 1, character: 2 });
    expect(tok).not.toBeNull();
    expect(tok?.text).toBe('42');
  });

  it('returns null for a wrong file path', () => {
    const tok = findTokenAtPosition(tokens, '/other.ion', { line: 0, character: 4 });
    expect(tok).toBeNull();
  });
});
