import type { Span } from '../types.js';

export { type Span };

/** All token kinds produced by the Ion lexer. */
export const enum TokenKind {
  // literals
  INT_LIT = 'INT_LIT',
  FLOAT_LIT = 'FLOAT_LIT',
  STRING_START = 'STRING_START',
  STRING_PART = 'STRING_PART',
  INTERP_OPEN = 'INTERP_OPEN',
  INTERP_CLOSE = 'INTERP_CLOSE',
  STRING_END = 'STRING_END',
  BOOL_LIT = 'BOOL_LIT',
  NULL_LIT = 'NULL_LIT',
  // identifiers & keywords
  IDENT = 'IDENT',
  KW_FN = 'KW_FN',
  KW_LET = 'KW_LET',
  KW_IF = 'KW_IF',
  KW_ELSE = 'KW_ELSE',
  KW_MATCH = 'KW_MATCH',
  KW_THEN = 'KW_THEN',
  KW_DATA = 'KW_DATA',
  KW_MODULE = 'KW_MODULE',
  KW_USE = 'KW_USE',
  KW_PUB = 'KW_PUB',
  KW_EXTERN = 'KW_EXTERN',
  KW_TYPE = 'KW_TYPE',
  // effect markers
  EFFECT_IO = 'EFFECT_IO',
  EFFECT_ASYNC = 'EFFECT_ASYNC',
  EFFECT_LLM = 'EFFECT_LLM',
  // operators
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',
  PERCENT = 'PERCENT',
  EQ_EQ = 'EQ_EQ',
  BANG_EQ = 'BANG_EQ',
  LT = 'LT',
  GT = 'GT',
  LT_EQ = 'LT_EQ',
  GT_EQ = 'GT_EQ',
  AMP_AMP = 'AMP_AMP',
  PIPE_PIPE = 'PIPE_PIPE',
  BANG = 'BANG',
  ARROW = 'ARROW',   // ->
  PIPE_GT = 'PIPE_GT', // |>
  QUESTION = 'QUESTION',
  DOT = 'DOT',
  EQ = 'EQ',
  // punctuation
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  COMMA = 'COMMA',
  COLON = 'COLON',
  SEMICOLON = 'SEMICOLON',
  PIPE = 'PIPE',   // | (match arm separator)
  AT = 'AT',
  // trivia
  WHITESPACE = 'WHITESPACE',
  NEWLINE = 'NEWLINE',
  LINE_COMMENT = 'LINE_COMMENT',
  BLOCK_COMMENT = 'BLOCK_COMMENT',
  // control
  EOF = 'EOF',
}

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: Span;
}

const KEYWORDS: ReadonlyMap<string, TokenKind> = new Map([
  ['fn', TokenKind.KW_FN],
  ['let', TokenKind.KW_LET],
  ['if', TokenKind.KW_IF],
  ['else', TokenKind.KW_ELSE],
  ['match', TokenKind.KW_MATCH],
  ['then', TokenKind.KW_THEN],
  ['data', TokenKind.KW_DATA],
  ['module', TokenKind.KW_MODULE],
  ['use', TokenKind.KW_USE],
  ['pub', TokenKind.KW_PUB],
  ['extern', TokenKind.KW_EXTERN],
  ['type', TokenKind.KW_TYPE],
  ['true', TokenKind.BOOL_LIT],
  ['false', TokenKind.BOOL_LIT],
  ['null', TokenKind.NULL_LIT],
]);


/** Tokenise an Ion source file into a flat token array (trivia included). */
export function lex(source: string, file: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 0;

  // Stack to handle nested interpolations: tracks whether each open `{` is an
  // interp open or a regular brace, so we can emit the right close token.
  const interpDepthStack: number[] = [];
  // When > 0 we are inside a string; tracks regular-brace depth inside interp
  let braceDepth = 0;
  let inString = false;

  function peek(offset = 0): string {
    return source[pos + offset] ?? '';
  }

  function advance(): string {
    const ch = source[pos++] ?? '';
    if (ch === '\n') { line++; col = 0; } else { col++; }
    return ch;
  }

  function makeSpan(sl: number, sc: number): Span {
    return { file, startLine: sl, startCol: sc, endLine: line, endCol: col };
  }

  function push(kind: TokenKind, text: string, sl: number, sc: number): void {
    tokens.push({ kind, text, span: makeSpan(sl, sc) });
  }

  function lexStringContent(): void {
    // Called after STRING_START; emits STRING_PART / INTERP_OPEN tokens until " or EOF
    while (pos < source.length && peek() !== '"') {
      const sl = line; const sc = col;
      if (peek() === '{') {
        // begin interpolation
        advance();
        push(TokenKind.INTERP_OPEN, '{', sl, sc);
        interpDepthStack.push(braceDepth);
        braceDepth = 0;
        inString = false;
        return; // back to main loop in normal mode
      }
      // collect text characters
      let text = '';
      const tsl = line; const tsc = col;
      while (pos < source.length && peek() !== '"' && peek() !== '{') {
        if (peek() === '\\') {
          text += advance();
          if (pos < source.length) text += advance();
        } else {
          text += advance();
        }
      }
      if (text.length > 0) push(TokenKind.STRING_PART, text, tsl, tsc);
    }
    // closing quote
    if (pos < source.length) {
      const sl = line; const sc = col;
      advance();
      push(TokenKind.STRING_END, '"', sl, sc);
      inString = false;
    }
  }

  while (pos < source.length) {
    // If we are in string mode, lex string content
    if (inString) {
      lexStringContent();
      continue;
    }

    const sl = line;
    const sc = col;
    const ch = peek();

    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      let text = '';
      while (pos < source.length && (peek() === ' ' || peek() === '\t' || peek() === '\r')) text += advance();
      push(TokenKind.WHITESPACE, text, sl, sc);
      continue;
    }

    // newline
    if (ch === '\n') {
      advance();
      push(TokenKind.NEWLINE, '\n', sl, sc);
      continue;
    }

    // line comment
    if (ch === '/' && peek(1) === '/') {
      let text = '';
      while (pos < source.length && peek() !== '\n') text += advance();
      push(TokenKind.LINE_COMMENT, text, sl, sc);
      continue;
    }

    // block comment
    if (ch === '/' && peek(1) === '*') {
      let text = advance() + advance();
      while (pos < source.length && !(peek() === '*' && peek(1) === '/')) text += advance();
      if (pos < source.length) { text += advance(); text += advance(); }
      push(TokenKind.BLOCK_COMMENT, text, sl, sc);
      continue;
    }

    // string start
    if (ch === '"') {
      advance();
      push(TokenKind.STRING_START, '"', sl, sc);
      inString = true;
      continue;
    }

    // numbers
    if (ch >= '0' && ch <= '9') {
      let text = '';
      while (pos < source.length && peek() >= '0' && peek() <= '9') text += advance();
      if (peek() === '.' && peek(1) >= '0' && peek(1) <= '9') {
        text += advance();
        while (pos < source.length && peek() >= '0' && peek() <= '9') text += advance();
        push(TokenKind.FLOAT_LIT, text, sl, sc);
      } else {
        push(TokenKind.INT_LIT, text, sl, sc);
      }
      continue;
    }

    // effect markers: !io !async !llm
    if (ch === '!' && /[a-z]/.test(peek(1))) {
      let text = advance();
      while (pos < source.length && /[a-z]/.test(peek())) text += advance();
      if (text === '!io') { push(TokenKind.EFFECT_IO, text, sl, sc); }
      else if (text === '!async') { push(TokenKind.EFFECT_ASYNC, text, sl, sc); }
      else if (text === '!llm') { push(TokenKind.EFFECT_LLM, text, sl, sc); }
      else {
        // re-emit ! and push remaining chars back
        push(TokenKind.BANG, '!', sl, sc);
        // back up to re-lex the identifier part
        pos -= text.length - 1;
        col -= text.length - 1;
      }
      continue;
    }

    // identifiers & keywords
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let text = '';
      while (pos < source.length && /[a-zA-Z0-9_]/.test(peek())) text += advance();
      const kw = KEYWORDS.get(text);
      push(kw ?? TokenKind.IDENT, text, sl, sc);
      continue;
    }

    // two-char operators
    if (ch === '-' && peek(1) === '>') { advance(); advance(); push(TokenKind.ARROW, '->', sl, sc); continue; }
    if (ch === '|' && peek(1) === '>') { advance(); advance(); push(TokenKind.PIPE_GT, '|>', sl, sc); continue; }
    if (ch === '|' && peek(1) === '|') { advance(); advance(); push(TokenKind.PIPE_PIPE, '||', sl, sc); continue; }
    if (ch === '&' && peek(1) === '&') { advance(); advance(); push(TokenKind.AMP_AMP, '&&', sl, sc); continue; }
    if (ch === '=' && peek(1) === '=') { advance(); advance(); push(TokenKind.EQ_EQ, '==', sl, sc); continue; }
    if (ch === '!' && peek(1) === '=') { advance(); advance(); push(TokenKind.BANG_EQ, '!=', sl, sc); continue; }
    if (ch === '<' && peek(1) === '=') { advance(); advance(); push(TokenKind.LT_EQ, '<=', sl, sc); continue; }
    if (ch === '>' && peek(1) === '=') { advance(); advance(); push(TokenKind.GT_EQ, '>=', sl, sc); continue; }

    // braces — may close interpolations
    if (ch === '{') {
      advance();
      braceDepth++;
      push(TokenKind.LBRACE, '{', sl, sc);
      continue;
    }

    if (ch === '}') {
      advance();
      if (!inString && braceDepth === 0 && interpDepthStack.length > 0) {
        // closing an interpolation
        push(TokenKind.INTERP_CLOSE, '}', sl, sc);
        braceDepth = interpDepthStack.pop() ?? 0;
        inString = true;
      } else {
        if (braceDepth > 0) braceDepth--;
        push(TokenKind.RBRACE, '}', sl, sc);
      }
      continue;
    }

    // single-char tokens
    advance();
    switch (ch) {
      case '+': push(TokenKind.PLUS, '+', sl, sc); break;
      case '-': push(TokenKind.MINUS, '-', sl, sc); break;
      case '*': push(TokenKind.STAR, '*', sl, sc); break;
      case '/': push(TokenKind.SLASH, '/', sl, sc); break;
      case '%': push(TokenKind.PERCENT, '%', sl, sc); break;
      case '<': push(TokenKind.LT, '<', sl, sc); break;
      case '>': push(TokenKind.GT, '>', sl, sc); break;
      case '!': push(TokenKind.BANG, '!', sl, sc); break;
      case '?': push(TokenKind.QUESTION, '?', sl, sc); break;
      case '.': push(TokenKind.DOT, '.', sl, sc); break;
      case '=': push(TokenKind.EQ, '=', sl, sc); break;
      case '(': push(TokenKind.LPAREN, '(', sl, sc); break;
      case ')': push(TokenKind.RPAREN, ')', sl, sc); break;
      case '[': push(TokenKind.LBRACKET, '[', sl, sc); break;
      case ']': push(TokenKind.RBRACKET, ']', sl, sc); break;
      case ',': push(TokenKind.COMMA, ',', sl, sc); break;
      case ':': push(TokenKind.COLON, ':', sl, sc); break;
      case ';': push(TokenKind.SEMICOLON, ';', sl, sc); break;
      case '|': push(TokenKind.PIPE, '|', sl, sc); break;
      case '@': push(TokenKind.AT, '@', sl, sc); break;
      default: break;
    }
  }

  tokens.push({
    kind: TokenKind.EOF,
    text: '',
    span: { file, startLine: line, startCol: col, endLine: line, endCol: col },
  });
  return tokens;
}
