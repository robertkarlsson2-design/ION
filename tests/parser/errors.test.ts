import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseExpression, ParseError, formatParseError } from '../../src/parser/expressions.js';
import { parseModule, parseDeclaration } from '../../src/parser/declarations.js';
import type { Span } from '../../src/types.js';

function parseExpr(src: string) {
  return parseExpression(lex(src, 'test.ion'));
}

function parseDecl(src: string) {
  return parseDeclaration(lex(src, 'test.ion'));
}

function parseMod(src: string) {
  return parseModule(lex(src, 'test.ion'));
}

// ---------------------------------------------------------------------------
// P0001 — UnexpectedToken (expect() fails)
// ---------------------------------------------------------------------------

describe('P0001 — UnexpectedToken', () => {
  it('fires when a required token is missing', () => {
    let caught: unknown;
    try {
      parseDecl('fn foo 42');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const err = caught as ParseError;
    expect(err.code).toBe('P0001');
    expect(err.span).toBeDefined();
    expect(err.suggestion).toBeDefined();
    expect(err.expected).toBeDefined();
    expect(err.found).toBeDefined();
    expect(err.message).not.toContain('internal');
  });

  it('fires for unrecognized declaration keyword', () => {
    let caught: unknown;
    try {
      parseDecl('bogus foo = 1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const err = caught as ParseError;
    expect(err.code).toBe('P0001');
    expect(err.expected).toBeDefined();
    expect(err.found).toBeDefined();
    expect(err.message).not.toContain('internal');
  });

  it('formatParseError includes expected and found lines', () => {
    let caught: unknown;
    try {
      parseDecl('fn foo 42');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const formatted = formatParseError(caught as ParseError);
    expect(formatted).toContain('error[P0001]');
    expect(formatted).toContain('expected:');
    expect(formatted).toContain('found:');
    expect(formatted).toContain('suggestion:');
  });
});

// ---------------------------------------------------------------------------
// P0002 — UnexpectedExprToken (nud fails)
// ---------------------------------------------------------------------------

describe('P0002 — UnexpectedExprToken', () => {
  it('fires when expression starts with non-expression token', () => {
    let caught: unknown;
    try {
      parseExpr('% 1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const err = caught as ParseError;
    expect(err.code).toBe('P0002');
    expect(err.span).toBeDefined();
    expect(err.suggestion).toBeDefined();
    expect(err.expected).toBeDefined();
    expect(err.found).toBeDefined();
    expect(err.message).not.toContain('internal');
  });

  it('formatParseError includes code and suggestion', () => {
    let caught: unknown;
    try {
      parseExpr('% 1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const formatted = formatParseError(caught as ParseError);
    expect(formatted).toContain('error[P0002]');
    expect(formatted).toContain('suggestion:');
  });
});

// ---------------------------------------------------------------------------
// P0003 — UnexpectedInfixToken (led defensive throw)
// ---------------------------------------------------------------------------

describe('P0003 — UnexpectedInfixToken', () => {
  it('has correct structure when constructed directly', () => {
    const span: Span = { file: 'test.ion', startLine: 1, startCol: 5, endLine: 1, endCol: 6 };
    const err = new ParseError(
      `unexpected infix token IDENT ('x')`,
      'P0003',
      span,
      `Remove or replace 'x' with a valid infix operator`,
      'a valid infix operator',
      `'IDENT'`,
    );
    expect(err.code).toBe('P0003');
    expect(err.span).toBeDefined();
    expect(err.suggestion).toBeDefined();
    expect(err.expected).toBeDefined();
    expect(err.found).toBeDefined();
    expect(err.message).not.toContain('internal');
  });

  it('formatParseError renders all fields', () => {
    const span: Span = { file: 'test.ion', startLine: 2, startCol: 3, endLine: 2, endCol: 4 };
    const err = new ParseError(
      `unexpected infix token RBRACE ('}')`,
      'P0003',
      span,
      `Remove or replace '}' with a valid infix operator`,
      'a valid infix operator',
      `'RBRACE'`,
    );
    const formatted = formatParseError(err);
    expect(formatted).toContain('error[P0003]');
    expect(formatted).toContain('expected:');
    expect(formatted).toContain('found:');
    expect(formatted).toContain('suggestion:');
  });
});

// ---------------------------------------------------------------------------
// P0004 — UnexpectedPatternToken (parsePattern fails)
// ---------------------------------------------------------------------------

describe('P0004 — UnexpectedPatternToken', () => {
  it('fires when a match arm has an invalid pattern token', () => {
    let caught: unknown;
    try {
      parseExpr('match x | % -> 1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const err = caught as ParseError;
    expect(err.code).toBe('P0004');
    expect(err.span).toBeDefined();
    expect(err.suggestion).toBeDefined();
    expect(err.expected).toBeDefined();
    expect(err.found).toBeDefined();
    expect(err.message).not.toContain('internal');
  });

  it('formatParseError includes code and suggestion', () => {
    let caught: unknown;
    try {
      parseMod('fn f() -> Int = match x | % -> 1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const formatted = formatParseError(caught as ParseError);
    expect(formatted).toContain('error[P0004]');
    expect(formatted).toContain('suggestion:');
  });
});

// ---------------------------------------------------------------------------
// P0005 — MaxDepthExceeded
// ---------------------------------------------------------------------------

describe('P0005 — MaxDepthExceeded', () => {
  it('has correct structure when constructed directly', () => {
    const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 0 };
    const err = new ParseError(
      'expression nesting exceeds maximum depth of 512',
      'P0005',
      span,
      'Reduce the nesting depth of your expression',
    );
    expect(err.code).toBe('P0005');
    expect(err.span).toBeDefined();
    expect(err.suggestion).toBeDefined();
    expect(err.expected).toBeUndefined();
    expect(err.found).toBeUndefined();
    expect(err.message).not.toContain('internal');
  });

  it('formatParseError omits expected/found lines when not set', () => {
    const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 0 };
    const err = new ParseError(
      'expression nesting exceeds maximum depth of 512',
      'P0005',
      span,
      'Reduce the nesting depth of your expression',
    );
    const formatted = formatParseError(err);
    expect(formatted).toContain('error[P0005]');
    expect(formatted).not.toContain('expected:');
    expect(formatted).not.toContain('found:');
    expect(formatted).toContain('suggestion:');
  });
});

// ---------------------------------------------------------------------------
// General: no error message uses 'internal'
// ---------------------------------------------------------------------------

describe('no "internal" in error messages', () => {
  const malformedInputs = [
    ['expr', '% 1'],
    ['expr', 'match x | % -> 1'],
    ['decl', 'fn foo 42'],
    ['decl', 'bogus foo = 1'],
    ['decl', 'data X = A |'],
  ] as const;

  for (const [kind, src] of malformedInputs) {
    it(`'${src}' does not produce "internal" in error message`, () => {
      let caught: unknown;
      try {
        if (kind === 'expr') {
          parseExpr(src);
        } else {
          parseDecl(src);
        }
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ParseError);
      expect((caught as ParseError).message).not.toContain('internal');
    });
  }
});
