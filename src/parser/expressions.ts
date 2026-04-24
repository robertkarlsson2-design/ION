import { type Token, TokenKind } from '../lexer/index.js';
import type { Span } from '../types.js';
import type { TypeAnnotation } from '../ast/types.js';
import type {
  ExprNode,
  PatternNode,
  TriviaNode,
  StringPart,
  CallArg,
  LambdaParam,
  MatchArm,
  BinopKind,
  LiteralIntNode,
  LiteralFloatNode,
  LiteralBoolNode,
  LiteralNullNode,
  StringLitNode,
  IdentNode,
  BinopExprNode,
  UnaryExprNode,
  CallExprNode,
  LambdaExprNode,
  PipelineExprNode,
  IfElseExprNode,
  MatchExprNode,
  LetExprNode,
  AccessorExprNode,
  PropagateExprNode,
  GroupExprNode,
} from './cst.js';

// ---------------------------------------------------------------------------
// Public error type
// ---------------------------------------------------------------------------

export { ParseError, formatParseError } from './errors.js';
import { ParseError } from './errors.js';

// ---------------------------------------------------------------------------
// Precedence table
// ---------------------------------------------------------------------------

const INFIX_PREC: Partial<Record<TokenKind, number>> = {
  [TokenKind.PIPE_GT]: 1,
  [TokenKind.PIPE_PIPE]: 2,
  [TokenKind.AMP_AMP]: 3,
  [TokenKind.EQ_EQ]: 4,
  [TokenKind.BANG_EQ]: 4,
  [TokenKind.LT]: 5,
  [TokenKind.GT]: 5,
  [TokenKind.LT_EQ]: 5,
  [TokenKind.GT_EQ]: 5,
  [TokenKind.PLUS]: 6,
  [TokenKind.MINUS]: 6,
  [TokenKind.STAR]: 7,
  [TokenKind.SLASH]: 7,
  [TokenKind.PERCENT]: 7,
  // postfix / accessor / propagate: 9
  [TokenKind.DOT]: 9,
  [TokenKind.LPAREN]: 9,
  [TokenKind.QUESTION]: 9,
};

const TRIVIA_KINDS: ReadonlySet<TokenKind> = new Set([
  TokenKind.WHITESPACE,
  TokenKind.NEWLINE,
  TokenKind.LINE_COMMENT,
  TokenKind.BLOCK_COMMENT,
]);

function isTrivia(t: Token): boolean {
  return TRIVIA_KINDS.has(t.kind);
}

function spanMerge(a: Span, b: Span): Span {
  return {
    file: a.file,
    startLine: a.startLine,
    startCol: a.startCol,
    endLine: b.endLine,
    endCol: b.endCol,
  };
}

// ---------------------------------------------------------------------------
// Parser class (internal)
// ---------------------------------------------------------------------------

const MAX_PARSE_DEPTH = 512;

class Parser {
  private readonly nonTrivia: Token[];
  private readonly triviasBefore: ReadonlyArray<readonly TriviaNode[]>;
  private pos: number;
  private depth = 0;

  constructor(tokens: Token[]) {
    const nonTrivia: Token[] = [];
    const triviasBefore: TriviaNode[][] = [];
    let pending: TriviaNode[] = [];

    for (const tok of tokens) {
      if (isTrivia(tok)) {
        pending.push(triviaToken(tok));
      } else {
        nonTrivia.push(tok);
        triviasBefore.push(pending);
        pending = [];
      }
    }

    this.nonTrivia = nonTrivia;
    this.triviasBefore = triviasBefore;
    this.pos = 0;
  }

  // -------------------------------------------------------------------------
  // Cursor helpers
  // -------------------------------------------------------------------------

  peek(): Token {
    return this.nonTrivia[this.pos] ?? eofToken();
  }

  peekKind(): TokenKind {
    return this.peek().kind;
  }

  peekAhead(offset: number): Token {
    return this.nonTrivia[this.pos + offset] ?? eofToken();
  }

  consume(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }

  expect(kind: TokenKind): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new ParseError(
        `expected '${kind}', found '${tok.kind}'`,
        'P0001',
        tok.span,
        `Replace '${tok.text}' with the expected '${kind}' token`,
        `'${kind}'`,
        `'${tok.kind}'`,
      );
    }
    return this.consume();
  }

  leadingTrivia(): readonly TriviaNode[] {
    return this.triviasBefore[this.pos] ?? [];
  }

  // -------------------------------------------------------------------------
  // Pratt parser
  // -------------------------------------------------------------------------

  /** Parse an expression with minimum precedence `minPrec`. */
  parseExpr(minPrec = 0): ExprNode {
    this.depth++;
    if (this.depth > MAX_PARSE_DEPTH) {
      const tok = this.peek();
      this.depth--;
      throw new ParseError(
        `expression nesting exceeds maximum depth of ${MAX_PARSE_DEPTH}`,
        'P0005',
        tok.span,
        'Reduce the nesting depth of your expression',
      );
    }
    try {
      let left = this.nud();

      while (true) {
        const prec = INFIX_PREC[this.peekKind()];
        if (prec === undefined || prec <= minPrec) break;
        left = this.led(left, prec);
      }

      return left;
    } finally {
      this.depth--;
    }
  }

  /** Prefix / atomic parse. */
  private nud(): ExprNode {
    const trivia = this.leadingTrivia();
    const tok = this.peek();

    switch (tok.kind) {
      case TokenKind.INT_LIT: return this.parseLiteralInt(trivia);
      case TokenKind.FLOAT_LIT: return this.parseLiteralFloat(trivia);
      case TokenKind.BOOL_LIT: return this.parseLiteralBool(trivia);
      case TokenKind.NULL_LIT: return this.parseLiteralNull(trivia);
      case TokenKind.STRING_START: return this.parseStringInterp(trivia);
      case TokenKind.IDENT:
        // Single-param lambda: `x -> body`
        if (this.peekAhead(1).kind === TokenKind.ARROW) {
          return this.parseLambda(trivia);
        }
        return this.parseIdent(trivia);
      case TokenKind.MINUS: return this.parseUnaryMinus(trivia);
      case TokenKind.BANG: return this.parseUnaryNot(trivia);
      case TokenKind.KW_IF: return this.parseIfElse(trivia);
      case TokenKind.KW_MATCH: return this.parseMatch(trivia);
      case TokenKind.KW_LET: return this.parseLet(trivia);
      case TokenKind.LPAREN: return this.parseGroupOrLambda(trivia);
      default:
        throw new ParseError(
          `unexpected token ${tok.kind} ('${tok.text}') in expression position`,
          'P0002',
          tok.span,
          `Remove or replace '${tok.text}' with a valid expression`,
          'a valid expression start token',
          `'${tok.kind}'`,
        );
    }
  }

  /** Infix / postfix continuation. */
  private led(left: ExprNode, prec: number): ExprNode {
    const tok = this.peek();

    // postfix: call
    if (tok.kind === TokenKind.LPAREN) {
      return this.parseCallArgs(left);
    }

    // postfix: field accessor
    if (tok.kind === TokenKind.DOT) {
      this.consume(); // .
      const fieldTok = this.expect(TokenKind.IDENT);
      const node: AccessorExprNode = {
        kind: 'AccessorExpr',
        receiver: left,
        field: fieldTok.text,
        span: spanMerge(left.span, fieldTok.span),
      };
      return node;
    }

    // postfix: propagation
    if (tok.kind === TokenKind.QUESTION) {
      this.consume();
      const node: PropagateExprNode = {
        kind: 'PropagateExpr',
        inner: left,
        span: spanMerge(left.span, tok.span),
      };
      return node;
    }

    // pipeline |>
    if (tok.kind === TokenKind.PIPE_GT) {
      this.consume();
      const right = this.parseExpr(prec); // left-associative: pass same prec
      const node: PipelineExprNode = {
        kind: 'PipelineExpr',
        left,
        right,
        span: spanMerge(left.span, right.span),
      };
      return node;
    }

    // binary operators
    const op = binopKindOf(tok.kind);
    if (op !== null) {
      this.consume();
      const right = this.parseExpr(prec); // left-associative
      const node: BinopExprNode = {
        kind: 'BinopExpr',
        op,
        left,
        right,
        span: spanMerge(left.span, right.span),
      };
      return node;
    }

    throw new ParseError(
      `unexpected infix token ${tok.kind} ('${tok.text}')`,
      'P0003',
      tok.span,
      `Remove or replace '${tok.text}' with a valid infix operator`,
      'a valid infix operator',
      `'${tok.kind}'`,
    );
  }

  // -------------------------------------------------------------------------
  // Literal parsers
  // -------------------------------------------------------------------------

  private parseLiteralInt(trivia: readonly TriviaNode[]): LiteralIntNode {
    const tok = this.consume();
    return {
      kind: 'LiteralInt',
      value: BigInt(tok.text),
      raw: tok.text,
      span: tok.span,
      leadingTrivia: trivia,
    };
  }

  private parseLiteralFloat(trivia: readonly TriviaNode[]): LiteralFloatNode {
    const tok = this.consume();
    return {
      kind: 'LiteralFloat',
      value: parseFloat(tok.text),
      raw: tok.text,
      span: tok.span,
      leadingTrivia: trivia,
    };
  }

  private parseLiteralBool(trivia: readonly TriviaNode[]): LiteralBoolNode {
    const tok = this.consume();
    return {
      kind: 'LiteralBool',
      value: tok.text === 'true',
      span: tok.span,
      leadingTrivia: trivia,
    };
  }

  private parseLiteralNull(trivia: readonly TriviaNode[]): LiteralNullNode {
    const tok = this.consume();
    return { kind: 'LiteralNull', span: tok.span, leadingTrivia: trivia };
  }

  // -------------------------------------------------------------------------
  // Identifier
  // -------------------------------------------------------------------------

  private parseIdent(trivia: readonly TriviaNode[]): IdentNode {
    const tok = this.consume();
    return {
      kind: 'Ident',
      name: tok.text,
      span: tok.span,
      leadingTrivia: trivia,
    };
  }

  // -------------------------------------------------------------------------
  // String interpolation
  // -------------------------------------------------------------------------

  private parseStringInterp(trivia: readonly TriviaNode[]): StringLitNode {
    const startTok = this.expect(TokenKind.STRING_START);
    const parts: StringPart[] = [];

    while (this.peekKind() !== TokenKind.STRING_END && this.peekKind() !== TokenKind.EOF) {
      if (this.peekKind() === TokenKind.STRING_PART) {
        const partTok = this.consume();
        parts.push({ kind: 'TextPart', text: partTok.text, span: partTok.span });
      } else if (this.peekKind() === TokenKind.INTERP_OPEN) {
        const openTok = this.consume();
        const expr = this.parseExpr();
        const closeTok = this.expect(TokenKind.INTERP_CLOSE);
        parts.push({ kind: 'InterpPart', expr, span: spanMerge(openTok.span, closeTok.span) });
      } else {
        break;
      }
    }

    const endTok = this.expect(TokenKind.STRING_END);
    return {
      kind: 'StringLit',
      parts,
      span: spanMerge(startTok.span, endTok.span),
      leadingTrivia: trivia,
    };
  }

  // -------------------------------------------------------------------------
  // Unary
  // -------------------------------------------------------------------------

  private parseUnaryMinus(trivia: readonly TriviaNode[]): UnaryExprNode {
    const opTok = this.consume();
    const operand = this.parseExpr(8); // higher than any binary op
    return {
      kind: 'UnaryExpr',
      op: 'Neg',
      operand,
      span: spanMerge(opTok.span, operand.span),
      leadingTrivia: trivia,
    };
  }

  private parseUnaryNot(trivia: readonly TriviaNode[]): UnaryExprNode {
    const opTok = this.consume();
    const operand = this.parseExpr(8);
    return {
      kind: 'UnaryExpr',
      op: 'Not',
      operand,
      span: spanMerge(opTok.span, operand.span),
      leadingTrivia: trivia,
    };
  }

  // -------------------------------------------------------------------------
  // Group or lambda
  // -------------------------------------------------------------------------

  /**
   * Disambiguates between `(expr)` and `(p1, p2) -> body` or `(p: T) -> body`.
   * Looks ahead without recursing into a full parse.
   */
  private parseGroupOrLambda(trivia: readonly TriviaNode[]): ExprNode {
    // We need to decide: is this a lambda parameter list?
    // Strategy: scan tokens ahead looking for `->` before any operator that
    // could not appear in a parameter list. If we see `->` we treat it as lambda.
    if (this.isLambdaParamList()) {
      return this.parseLambda(trivia);
    }
    return this.parseGroup(trivia);
  }

  /**
   * Scan ahead from current `(` to determine if this is a lambda param list.
   * Returns true if we see `->` after the matching `)`.
   */
  private isLambdaParamList(): boolean {
    let depth = 0;
    let i = this.pos;
    // Skip through balanced parens
    while (i < this.nonTrivia.length) {
      const k = this.nonTrivia[i]?.kind;
      if (k === TokenKind.LPAREN) { depth++; i++; }
      else if (k === TokenKind.RPAREN) {
        depth--;
        i++;
        if (depth === 0) break;
      } else { i++; }
    }
    // After matching `)`, check for `->`
    return this.nonTrivia[i]?.kind === TokenKind.ARROW;
  }

  private parseGroup(trivia: readonly TriviaNode[]): GroupExprNode {
    const open = this.expect(TokenKind.LPAREN);
    const inner = this.parseExpr();
    const close = this.expect(TokenKind.RPAREN);
    return {
      kind: 'GroupExpr',
      inner,
      span: spanMerge(open.span, close.span),
      leadingTrivia: trivia,
    };
  }

  // -------------------------------------------------------------------------
  // Lambda
  // -------------------------------------------------------------------------

  private parseLambda(trivia: readonly TriviaNode[]): LambdaExprNode {
    // Two forms:
    // (1) `x -> body`  — single bare param (handled when nud sees IDENT + ARROW)
    // (2) `(p1, p2) -> body` or `(p: T) -> body`
    const params = this.parseLambdaParams();
    this.expect(TokenKind.ARROW);
    const body = this.parseExpr();
    const startSpan = params[0]?.span ?? body.span;
    return {
      kind: 'LambdaExpr',
      params,
      body,
      span: spanMerge(startSpan, body.span),
      leadingTrivia: trivia,
    };
  }

  private parseLambdaParams(): LambdaParam[] {
    // If next token is `(`, parse a parenthesised parameter list
    if (this.peekKind() === TokenKind.LPAREN) {
      return this.parseParenLambdaParams();
    }
    // Single bare identifier
    const tok = this.expect(TokenKind.IDENT);
    return [{ name: tok.text, type_: null, span: tok.span }];
  }

  private parseParenLambdaParams(): LambdaParam[] {
    this.expect(TokenKind.LPAREN);
    const params: LambdaParam[] = [];

    if (this.peekKind() !== TokenKind.RPAREN) {
      params.push(this.parseSingleLambdaParam());
      while (this.peekKind() === TokenKind.COMMA) {
        this.consume();
        if (this.peekKind() === TokenKind.RPAREN) break;
        params.push(this.parseSingleLambdaParam());
      }
    }

    this.expect(TokenKind.RPAREN);
    return params;
  }

  private parseSingleLambdaParam(): LambdaParam {
    const nameTok = this.expect(TokenKind.IDENT);
    let type_: TypeAnnotation | null = null;
    if (this.peekKind() === TokenKind.COLON) {
      this.consume();
      type_ = this.parseTypeAnnotation();
    }
    const endSpan = type_?.span ?? nameTok.span;
    return {
      name: nameTok.text,
      type_,
      span: spanMerge(nameTok.span, endSpan),
    };
  }

  // -------------------------------------------------------------------------
  // Type annotation (minimal — named and generic only for now)
  // -------------------------------------------------------------------------

  private parseTypeAnnotation(): TypeAnnotation {
    const nameTok = this.expect(TokenKind.IDENT);
    // Generic: Name<Arg, ...>  — represented with LT/GT tokens
    if (this.peekKind() === TokenKind.LT) {
      this.consume();
      const args: TypeAnnotation[] = [this.parseTypeAnnotation()];
      while (this.peekKind() === TokenKind.COMMA) {
        this.consume();
        args.push(this.parseTypeAnnotation());
      }
      const closeTok = this.expect(TokenKind.GT);
      return {
        kind: 'Generic',
        name: nameTok.text,
        args,
        span: spanMerge(nameTok.span, closeTok.span),
      };
    }
    return { kind: 'Named', name: nameTok.text, span: nameTok.span };
  }

  // -------------------------------------------------------------------------
  // Call arguments
  // -------------------------------------------------------------------------

  private parseCallArgs(callee: ExprNode): CallExprNode {
    this.expect(TokenKind.LPAREN);
    const args: CallArg[] = [];

    if (this.peekKind() !== TokenKind.RPAREN) {
      args.push(this.parseCallArg());
      while (this.peekKind() === TokenKind.COMMA) {
        this.consume();
        if (this.peekKind() === TokenKind.RPAREN) break;
        args.push(this.parseCallArg());
      }
    }

    const close = this.expect(TokenKind.RPAREN);
    return {
      kind: 'CallExpr',
      callee,
      args,
      span: spanMerge(callee.span, close.span),
    };
  }

  /**
   * A call argument is either `label: expr` (named) or just `expr` (positional).
   * Disambiguate: if we see `IDENT COLON` we treat it as a named arg.
   */
  private parseCallArg(): CallArg {
    if (
      this.peekKind() === TokenKind.IDENT &&
      this.peekAhead(1).kind === TokenKind.COLON
    ) {
      const labelTok = this.consume();
      this.consume(); // COLON
      const value = this.parseExpr();
      return { label: labelTok.text, value, span: spanMerge(labelTok.span, value.span) };
    }
    const value = this.parseExpr();
    return { label: null, value, span: value.span };
  }

  // -------------------------------------------------------------------------
  // If/else
  // -------------------------------------------------------------------------

  private parseIfElse(trivia: readonly TriviaNode[]): IfElseExprNode {
    const kwTok = this.expect(TokenKind.KW_IF);
    const cond = this.parseExpr();
    this.expect(TokenKind.KW_THEN);
    const then = this.parseExpr();
    this.expect(TokenKind.KW_ELSE);
    const else_ = this.parseExpr();
    return {
      kind: 'IfElseExpr',
      cond,
      then,
      else_,
      span: spanMerge(kwTok.span, else_.span),
      leadingTrivia: trivia,
    };
  }

  // -------------------------------------------------------------------------
  // Match
  // -------------------------------------------------------------------------

  private parseMatch(trivia: readonly TriviaNode[]): MatchExprNode {
    const kwTok = this.expect(TokenKind.KW_MATCH);
    const scrutinee = this.parseExpr();
    const arms: MatchArm[] = [];
    // Match arms: `| Pattern -> body`
    while (this.peekKind() === TokenKind.PIPE) {
      arms.push(this.parseMatchArm());
    }
    const lastArm = arms[arms.length - 1];
    const endSpan = lastArm?.span ?? scrutinee.span;
    return {
      kind: 'MatchExpr',
      scrutinee,
      arms,
      span: spanMerge(kwTok.span, endSpan),
      leadingTrivia: trivia,
    };
  }

  private parseMatchArm(): MatchArm {
    const pipeTok = this.expect(TokenKind.PIPE);
    const pattern = this.parsePattern();
    // Optional guard: `if expr`
    let guard: ExprNode | null = null;
    if (this.peekKind() === TokenKind.KW_IF) {
      this.consume();
      guard = this.parseExpr();
    }
    this.expect(TokenKind.ARROW);
    const body = this.parseExpr();
    return {
      pattern,
      guard,
      body,
      span: spanMerge(pipeTok.span, body.span),
    };
  }

  // -------------------------------------------------------------------------
  // Patterns
  // -------------------------------------------------------------------------

  private parsePattern(): PatternNode {
    const tok = this.peek();

    if (tok.kind === TokenKind.IDENT) {
      const nameTok = this.consume();
      // Wildcard: `_`
      if (nameTok.text === '_') {
        return { kind: 'WildcardPat', span: nameTok.span };
      }
      // Constructor: uppercase name, with optional field list `Tag(p1, p2)`
      if (/^[A-Z]/.test(nameTok.text)) {
        if (this.peekKind() === TokenKind.LPAREN) {
          this.consume(); // (
          const fields: PatternNode[] = [];
          if (this.peekKind() !== TokenKind.RPAREN) {
            fields.push(this.parsePattern());
            while (this.peekKind() === TokenKind.COMMA) {
              this.consume();
              if (this.peekKind() === TokenKind.RPAREN) break;
              fields.push(this.parsePattern());
            }
          }
          const close = this.expect(TokenKind.RPAREN);
          return {
            kind: 'ConstructorPat',
            tag: nameTok.text,
            fields,
            span: spanMerge(nameTok.span, close.span),
          };
        }
        // Zero-arg constructor: `None`, `True`, etc.
        return { kind: 'ConstructorPat', tag: nameTok.text, fields: [], span: nameTok.span };
      }
      return { kind: 'IdentPat', name: nameTok.text, span: nameTok.span };
    }

    // Literal patterns
    if (tok.kind === TokenKind.INT_LIT) {
      const lit = this.parseLiteralInt([]);
      return { kind: 'LiteralPat', value: lit, span: lit.span };
    }
    if (tok.kind === TokenKind.FLOAT_LIT) {
      const lit = this.parseLiteralFloat([]);
      return { kind: 'LiteralPat', value: lit, span: lit.span };
    }
    if (tok.kind === TokenKind.BOOL_LIT) {
      const lit = this.parseLiteralBool([]);
      return { kind: 'LiteralPat', value: lit, span: lit.span };
    }
    if (tok.kind === TokenKind.NULL_LIT) {
      const lit = this.parseLiteralNull([]);
      return { kind: 'LiteralPat', value: lit, span: lit.span };
    }

    // Tuple pattern: `(p1, p2)`
    if (tok.kind === TokenKind.LPAREN) {
      const open = this.consume();
      const elements: PatternNode[] = [];
      if (this.peekKind() !== TokenKind.RPAREN) {
        elements.push(this.parsePattern());
        while (this.peekKind() === TokenKind.COMMA) {
          this.consume();
          if (this.peekKind() === TokenKind.RPAREN) break;
          elements.push(this.parsePattern());
        }
      }
      const close = this.expect(TokenKind.RPAREN);
      return { kind: 'TuplePat', elements, span: spanMerge(open.span, close.span) };
    }

    throw new ParseError(
      `expected pattern, got ${tok.kind} ('${tok.text}')`,
      'P0004',
      tok.span,
      `Replace '${tok.text}' with a valid pattern`,
      'a valid pattern',
      `'${tok.kind}'`,
    );
  }

  // -------------------------------------------------------------------------
  // Let binding
  // -------------------------------------------------------------------------

  private parseLet(trivia: readonly TriviaNode[]): LetExprNode {
    const kwTok = this.expect(TokenKind.KW_LET);
    const nameTok = this.expect(TokenKind.IDENT);
    let type_: TypeAnnotation | null = null;
    if (this.peekKind() === TokenKind.COLON) {
      this.consume();
      type_ = this.parseTypeAnnotation();
    }
    this.expect(TokenKind.EQ);
    const value = this.parseExpr();
    this.expect(TokenKind.SEMICOLON);
    const body = this.parseExpr();
    return {
      kind: 'LetExpr',
      name: nameTok.text,
      type_,
      value,
      body,
      span: spanMerge(kwTok.span, body.span),
      leadingTrivia: trivia,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function triviaToken(tok: Token): TriviaNode {
  switch (tok.kind) {
    case TokenKind.WHITESPACE: return { kind: 'Whitespace', text: tok.text, span: tok.span };
    case TokenKind.NEWLINE: return { kind: 'Newline', text: tok.text, span: tok.span };
    case TokenKind.LINE_COMMENT: return { kind: 'LineComment', text: tok.text, span: tok.span };
    case TokenKind.BLOCK_COMMENT: return { kind: 'BlockComment', text: tok.text, span: tok.span };
    default: return { kind: 'Whitespace', text: tok.text, span: tok.span };
  }
}

const _EOF_SPAN: Span = { file: '<eof>', startLine: 1, startCol: 0, endLine: 1, endCol: 0 };

function eofToken(): Token {
  return { kind: TokenKind.EOF, text: '', span: _EOF_SPAN };
}

function binopKindOf(kind: TokenKind): BinopKind | null {
  switch (kind) {
    case TokenKind.PLUS: return 'Add';
    case TokenKind.MINUS: return 'Sub';
    case TokenKind.STAR: return 'Mul';
    case TokenKind.SLASH: return 'Div';
    case TokenKind.PERCENT: return 'Mod';
    case TokenKind.EQ_EQ: return 'EqEq';
    case TokenKind.BANG_EQ: return 'NotEq';
    case TokenKind.LT: return 'Lt';
    case TokenKind.GT: return 'Gt';
    case TokenKind.LT_EQ: return 'LtEq';
    case TokenKind.GT_EQ: return 'GtEq';
    case TokenKind.AMP_AMP: return 'And';
    case TokenKind.PIPE_PIPE: return 'Or';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a single Ion expression from a flat token array (trivia included).
 * Throws `ParseError` on the first syntactic error.
 */
export function parseExpression(tokens: Token[]): ExprNode {
  return new Parser(tokens).parseExpr();
}

// Re-export CST types needed by consumers
export type {
  ExprNode,
  PatternNode,
  LiteralNode,
  TriviaNode,
  StringPart,
  CallArg,
  LambdaParam,
  MatchArm,
  BinopKind,
} from './cst.js';
