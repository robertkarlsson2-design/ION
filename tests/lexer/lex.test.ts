import { describe, it, expect } from 'vitest';
import { lex, TokenKind } from '../../src/lexer/index.js';

function kinds(src: string): TokenKind[] {
  return lex(src, 'test.ion').map(t => t.kind);
}

describe('lex — plain braces', () => {
  it('emits LBRACE / RBRACE for {}', () => {
    const ks = kinds('{ }');
    expect(ks).toEqual([
      TokenKind.LBRACE,
      TokenKind.WHITESPACE,
      TokenKind.RBRACE,
      TokenKind.EOF,
    ]);
  });

  it('does not emit INTERP_OPEN for plain {', () => {
    expect(kinds('{}')).not.toContain(TokenKind.INTERP_OPEN);
  });
});

describe('lex — string interpolation', () => {
  it('emits correct token sequence for "hello {name}"', () => {
    const tokens = lex('"hello {name}"', 'test.ion');
    const ks = tokens.map(t => t.kind);
    expect(ks).toEqual([
      TokenKind.STRING_START,
      TokenKind.STRING_PART,
      TokenKind.INTERP_OPEN,
      TokenKind.IDENT,
      TokenKind.INTERP_CLOSE,
      TokenKind.STRING_END,
      TokenKind.EOF,
    ]);
    expect(tokens[1]!.text).toBe('hello ');
    expect(tokens[3]!.text).toBe('name');
  });

  it('handles nested braces inside interpolation', () => {
    // "{ {x} }" — outer string interp with nested block containing x
    const tokens = lex('"{{}}"', 'test.ion');
    const ks = tokens.map(t => t.kind);
    expect(ks).toContain(TokenKind.INTERP_OPEN);
    expect(ks).toContain(TokenKind.LBRACE);
    expect(ks).toContain(TokenKind.RBRACE);
    expect(ks).toContain(TokenKind.INTERP_CLOSE);
    expect(ks).toContain(TokenKind.STRING_END);
  });
});
