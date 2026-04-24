import { type Token, TokenKind } from '../lexer/index.js';
import type { Span } from '../types.js';
import type { TypeAnnotation, EffectTag } from '../ast/types.js';
import type {
  ExprNode,
  TriviaNode,
  StringPart,
  CallArg,
  LambdaParam,
  MatchArm,
  BinopKind,
  FnParam,
  DeclAttribute,
  FnDeclNode,
  LetDeclNode,
  DataDeclNode,
  DataVariant,
  RecordField,
  TypeAliasDeclNode,
  UseDeclNode,
  ExternDeclNode,
  ExternBlockDeclNode,
  ExternBlockItem,
  ExternBlockItemFn,
  ExternBlockItemType,
  ModuleDeclNode,
  DeclNode,
  ModuleNode,
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
  PatternNode,
} from './cst.js';

export { ParseError, formatParseError } from './errors.js';
import { ParseError } from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function extractStringText(node: StringLitNode): string {
  return (node.parts as StringPart[])
    .filter((p): p is Extract<StringPart, { kind: 'TextPart' }> => p.kind === 'TextPart')
    .map(p => p.text)
    .join('');
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
// Precedence table (mirrored from expressions.ts)
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
  [TokenKind.DOT]: 9,
  [TokenKind.LPAREN]: 9,
  [TokenKind.QUESTION]: 9,
};

const MAX_PARSE_DEPTH = 512;

// ---------------------------------------------------------------------------
// DeclarationParser class
// ---------------------------------------------------------------------------

class DeclarationParser {
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
  // Module-level parsing
  // -------------------------------------------------------------------------

  /** Parse a full module (file) — all declarations until EOF. */
  parseModule(): ModuleNode {
    const startTok = this.peek();
    const decls: DeclNode[] = [];

    while (this.peekKind() !== TokenKind.EOF) {
      decls.push(this.parseDecl());
    }

    const endSpan = decls[decls.length - 1]?.span ?? startTok.span;
    return {
      kind: 'Module',
      decls,
      span: { ...endSpan, startLine: startTok.span.startLine, startCol: startTok.span.startCol },
    };
  }

  /** Parse a single top-level declaration (with optional leading attributes and `pub`). */
  parseDecl(): DeclNode {
    const trivia = this.leadingTrivia();
    const attrs = this.parseAttributes();

    let pub = false;
    if (this.peekKind() === TokenKind.KW_PUB) {
      pub = true;
      this.consume();
    }

    const tok = this.peek();

    switch (tok.kind) {
      case TokenKind.KW_FN:
        return this.parseFnDecl(pub, attrs, trivia);
      case TokenKind.KW_LET:
        return this.parseLetDecl(pub, trivia);
      case TokenKind.KW_DATA:
        return this.parseDataDecl(pub, trivia);
      case TokenKind.KW_TYPE:
        return this.parseTypeAliasDecl(pub, trivia);
      case TokenKind.KW_USE:
        return this.parseUseDecl(trivia);
      case TokenKind.KW_EXTERN:
        return this.parseExternDispatch(pub, attrs, trivia);
      case TokenKind.KW_MODULE:
        return this.parseModuleDecl(pub, trivia);
      default:
        throw new ParseError(
          `expected declaration keyword, got ${tok.kind} ('${tok.text}')`,
          'P0001',
          tok.span,
          `Replace '${tok.text}' with a declaration keyword (fn, let, data, type, use, extern, module)`,
          'a declaration keyword',
          `'${tok.kind}'`,
        );
    }
  }

  // -------------------------------------------------------------------------
  // Attributes
  // -------------------------------------------------------------------------

  /** Collect zero or more `@ident` or `@ident(arg, arg)` attributes. */
  private parseAttributes(): DeclAttribute[] {
    const attrs: DeclAttribute[] = [];
    while (this.peekKind() === TokenKind.AT) {
      const atTok = this.consume();
      const nameTok = this.expect(TokenKind.IDENT);
      const args: string[] = [];

      if (this.peekKind() === TokenKind.LPAREN) {
        this.consume();
        while (this.peekKind() !== TokenKind.RPAREN && this.peekKind() !== TokenKind.EOF) {
          const argTok = this.consume();
          args.push(argTok.text);
          if (this.peekKind() === TokenKind.COMMA) this.consume();
        }
        this.expect(TokenKind.RPAREN);
      }

      const endSpan = args.length > 0
        ? this.nonTrivia[this.pos - 1]?.span ?? nameTok.span
        : nameTok.span;

      attrs.push({
        name: nameTok.text,
        args,
        span: spanMerge(atTok.span, endSpan),
      });
    }
    return attrs;
  }

  // -------------------------------------------------------------------------
  // fn declaration
  // -------------------------------------------------------------------------

  /** `[pub] fn name[<T...>](params) [effects] [-> R] = body` */
  private parseFnDecl(
    pub: boolean,
    attributes: readonly DeclAttribute[],
    leadingTrivia: readonly TriviaNode[],
  ): FnDeclNode {
    const kwTok = this.expect(TokenKind.KW_FN);
    const nameTok = this.expect(TokenKind.IDENT);
    const typeParams = this.parseTypeParams();
    const params = this.parseFnParams();
    const effects = this.parseEffects();
    let returnType: TypeAnnotation | null = null;
    if (this.peekKind() === TokenKind.ARROW) {
      this.consume();
      returnType = this.parseTypeAnnotation();
    }
    this.expect(TokenKind.EQ);
    const body = this.parseExpr();

    const startSpan = pub
      ? spanMerge(kwTok.span, kwTok.span) // pub was consumed before fn kw
      : kwTok.span;

    return {
      kind: 'FnDecl',
      pub,
      name: nameTok.text,
      typeParams,
      params,
      effects,
      returnType,
      body,
      span: spanMerge(startSpan, body.span),
      leadingTrivia,
      attributes,
    };
  }

  // -------------------------------------------------------------------------
  // let declaration
  // -------------------------------------------------------------------------

  /** `[pub] let name [: T] = expr` */
  private parseLetDecl(pub: boolean, leadingTrivia: readonly TriviaNode[]): LetDeclNode {
    const kwTok = this.expect(TokenKind.KW_LET);
    const nameTok = this.expect(TokenKind.IDENT);
    let type_: TypeAnnotation | null = null;
    if (this.peekKind() === TokenKind.COLON) {
      this.consume();
      type_ = this.parseTypeAnnotation();
    }
    this.expect(TokenKind.EQ);
    const value = this.parseExpr();

    return {
      kind: 'LetDecl',
      pub,
      name: nameTok.text,
      type_,
      value,
      span: spanMerge(kwTok.span, value.span),
      leadingTrivia,
    };
  }

  // -------------------------------------------------------------------------
  // data declaration
  // -------------------------------------------------------------------------

  /** `[pub] data Name[<T...>] = Variant1 | Variant2(T)` */
  private parseDataDecl(pub: boolean, leadingTrivia: readonly TriviaNode[]): DataDeclNode {
    const kwTok = this.expect(TokenKind.KW_DATA);
    const nameTok = this.expect(TokenKind.IDENT);
    const typeParams = this.parseTypeParams();
    this.expect(TokenKind.EQ);
    const variants = this.parseDataVariants();
    const lastVariant = variants[variants.length - 1];
    const endSpan = lastVariant?.span ?? nameTok.span;

    return {
      kind: 'DataDecl',
      pub,
      name: nameTok.text,
      typeParams,
      variants,
      span: spanMerge(kwTok.span, endSpan),
      leadingTrivia,
    };
  }

  private parseDataVariants(): DataVariant[] {
    const variants: DataVariant[] = [];
    // First variant (no leading PIPE)
    if (this.peekKind() === TokenKind.IDENT) {
      variants.push(this.parseDataVariant());
    } else if (this.peekKind() === TokenKind.PIPE) {
      // Leading pipe is optional — skip it if present
      this.consume();
      variants.push(this.parseDataVariant());
    } else {
      const varTok = this.peek();
      throw new ParseError(
        `expected data variant, got ${varTok.kind} ('${varTok.text}')`,
        'P0001',
        varTok.span,
        `Add a variant name (identifier) after '='`,
        'a data variant name (identifier)',
        `'${varTok.kind}'`,
      );
    }

    while (this.peekKind() === TokenKind.PIPE) {
      this.consume();
      variants.push(this.parseDataVariant());
    }
    return variants;
  }

  private parseDataVariant(): DataVariant {
    const nameTok = this.expect(TokenKind.IDENT);

    // Tuple variant: `Name(T1, T2)`
    if (this.peekKind() === TokenKind.LPAREN) {
      this.consume();
      const fields: TypeAnnotation[] = [];
      if (this.peekKind() !== TokenKind.RPAREN) {
        fields.push(this.parseTypeAnnotation());
        while (this.peekKind() === TokenKind.COMMA) {
          this.consume();
          if (this.peekKind() === TokenKind.RPAREN) break;
          fields.push(this.parseTypeAnnotation());
        }
      }
      const closeTok = this.expect(TokenKind.RPAREN);
      return { kind: 'TupleVariant', name: nameTok.text, fields, span: spanMerge(nameTok.span, closeTok.span) };
    }

    // Record variant: `Name { field: T; ... }`
    if (this.peekKind() === TokenKind.LBRACE) {
      this.consume();
      const fields: RecordField[] = [];
      while (this.peekKind() !== TokenKind.RBRACE && this.peekKind() !== TokenKind.EOF) {
        const fieldName = this.expect(TokenKind.IDENT);
        this.expect(TokenKind.COLON);
        const fieldType = this.parseTypeAnnotation();
        fields.push({ name: fieldName.text, type_: fieldType, span: spanMerge(fieldName.span, fieldType.span) });
        if (this.peekKind() === TokenKind.SEMICOLON) this.consume();
      }
      const closeTok = this.expect(TokenKind.RBRACE);
      return { kind: 'RecordVariant', name: nameTok.text, fields, span: spanMerge(nameTok.span, closeTok.span) };
    }

    // Unit variant
    return { kind: 'UnitVariant', name: nameTok.text, span: nameTok.span };
  }

  // -------------------------------------------------------------------------
  // type alias declaration
  // -------------------------------------------------------------------------

  /** `[pub] type Name[<T...>] = TypeAnnotation` */
  private parseTypeAliasDecl(pub: boolean, leadingTrivia: readonly TriviaNode[]): TypeAliasDeclNode {
    const kwTok = this.expect(TokenKind.KW_TYPE);
    const nameTok = this.expect(TokenKind.IDENT);
    const typeParams = this.parseTypeParams();
    this.expect(TokenKind.EQ);
    const type_ = this.parseTypeAnnotation();

    return {
      kind: 'TypeAliasDecl',
      pub,
      name: nameTok.text,
      typeParams,
      type_,
      span: spanMerge(kwTok.span, type_.span),
      leadingTrivia,
    };
  }

  // -------------------------------------------------------------------------
  // use declaration
  // -------------------------------------------------------------------------

  /** `use a.b.C` or `use a.b.{Foo, Bar}` */
  private parseUseDecl(leadingTrivia: readonly TriviaNode[]): UseDeclNode {
    const kwTok = this.expect(TokenKind.KW_USE);
    const path: string[] = [];

    // Collect dotted path segments
    const firstIdent = this.expect(TokenKind.IDENT);
    path.push(firstIdent.text);

    while (this.peekKind() === TokenKind.DOT && this.peekAhead(1).kind === TokenKind.IDENT) {
      this.consume(); // DOT
      const seg = this.expect(TokenKind.IDENT);
      path.push(seg.text);
    }

    // Optional brace-set: `use a.b.{Foo, Bar}`
    let items: readonly string[] | null = null;
    let endSpan = path.length > 0
      ? (this.nonTrivia[this.pos - 1]?.span ?? kwTok.span)
      : kwTok.span;

    if (this.peekKind() === TokenKind.DOT && this.peekAhead(1).kind === TokenKind.LBRACE) {
      this.consume(); // DOT
      this.consume(); // LBRACE
      const itemList: string[] = [];
      while (this.peekKind() !== TokenKind.RBRACE && this.peekKind() !== TokenKind.EOF) {
        const itemTok = this.expect(TokenKind.IDENT);
        itemList.push(itemTok.text);
        if (this.peekKind() === TokenKind.COMMA) this.consume();
      }
      const closeTok = this.expect(TokenKind.RBRACE);
      items = itemList;
      endSpan = closeTok.span;
    }

    return {
      kind: 'UseDecl',
      path,
      items,
      span: spanMerge(kwTok.span, endSpan),
      leadingTrivia,
    };
  }

  // -------------------------------------------------------------------------
  // extern declaration
  // -------------------------------------------------------------------------

  /** Dispatches between inline `extern fn` and block `extern "target" { … }` forms. */
  private parseExternDispatch(
    pub: boolean,
    attributes: readonly DeclAttribute[],
    leadingTrivia: readonly TriviaNode[],
  ): ExternDeclNode | ExternBlockDeclNode {
    const kwTok = this.expect(TokenKind.KW_EXTERN);
    if (this.peekKind() === TokenKind.STRING_START) {
      return this.parseExternBlockDecl(pub, leadingTrivia, kwTok);
    }
    return this.parseExternInlineDecl(pub, attributes, leadingTrivia, kwTok);
  }

  /** `[pub] extern fn name(params) [effects] [-> R]` */
  private parseExternInlineDecl(
    pub: boolean,
    attributes: readonly DeclAttribute[],
    leadingTrivia: readonly TriviaNode[],
    kwTok: Token,
  ): ExternDeclNode {
    this.expect(TokenKind.KW_FN);
    const nameTok = this.expect(TokenKind.IDENT);
    const params = this.parseFnParams();
    const effects = this.parseEffects();
    let returnType: TypeAnnotation | null = null;
    let endSpan = nameTok.span;

    if (this.peekKind() === TokenKind.ARROW) {
      this.consume();
      returnType = this.parseTypeAnnotation();
      endSpan = returnType.span;
    } else if (params.length > 0) {
      endSpan = params[params.length - 1]?.span ?? nameTok.span;
    }

    return {
      kind: 'ExternDecl',
      pub,
      name: nameTok.text,
      params,
      effects,
      returnType,
      span: spanMerge(kwTok.span, endSpan),
      leadingTrivia,
      attributes,
    };
  }

  /** `[pub] extern "target" { fn name(params) [effects] [-> R] = "template" [;] … }` */
  private parseExternBlockDecl(
    pub: boolean,
    leadingTrivia: readonly TriviaNode[],
    kwTok: Token,
  ): ExternBlockDeclNode {
    const targetNode = this.parseStringInterp([]);
    const target = extractStringText(targetNode);
    this.expect(TokenKind.LBRACE);

    const items: ExternBlockItem[] = [];
    while (this.peekKind() !== TokenKind.RBRACE && this.peekKind() !== TokenKind.EOF) {
      if (this.peekKind() === TokenKind.KW_FN) {
        items.push(this.parseExternBlockItemFn());
      } else if (this.peekKind() === TokenKind.KW_TYPE) {
        items.push(this.parseExternBlockItemType());
      } else {
        const tok = this.peek();
        throw new ParseError(
          `expected 'fn' or 'type' in extern block, got ${tok.kind} ('${tok.text}')`,
          'P0001',
          tok.span,
          `Use 'fn' or 'type' to declare items inside an extern block`,
          "'fn' or 'type'",
          `'${tok.kind}'`,
        );
      }
    }

    const closeTok = this.expect(TokenKind.RBRACE);
    return {
      kind: 'ExternBlockDecl',
      pub,
      target,
      items,
      span: spanMerge(kwTok.span, closeTok.span),
      leadingTrivia,
    };
  }

  /** `fn name[<T…>](params) [effects] [-> R] = "template" [;]` inside an extern block. */
  private parseExternBlockItemFn(): ExternBlockItemFn {
    const kwTok = this.expect(TokenKind.KW_FN);
    const nameTok = this.expect(TokenKind.IDENT);
    const typeParams = this.parseTypeParams();
    const params = this.parseFnParams();
    const effects = this.parseEffects();
    let returnType: TypeAnnotation | null = null;
    if (this.peekKind() === TokenKind.ARROW) {
      this.consume();
      returnType = this.parseTypeAnnotation();
    }
    this.expect(TokenKind.EQ);
    const templateNode = this.parseStringInterp([]);
    const template = extractStringText(templateNode);
    if (this.peekKind() === TokenKind.SEMICOLON) this.consume();

    return {
      kind: 'ExternBlockItemFn',
      name: nameTok.text,
      typeParams,
      params,
      effects,
      returnType,
      template,
      span: spanMerge(kwTok.span, templateNode.span),
    };
  }

  /** `type Name[<T…>] = "template" [;]` inside an extern block. */
  private parseExternBlockItemType(): ExternBlockItemType {
    const kwTok = this.expect(TokenKind.KW_TYPE);
    const nameTok = this.expect(TokenKind.IDENT);
    const typeParams = this.parseTypeParams();
    this.expect(TokenKind.EQ);
    const templateNode = this.parseStringInterp([]);
    const template = extractStringText(templateNode);
    if (this.peekKind() === TokenKind.SEMICOLON) this.consume();

    return {
      kind: 'ExternBlockItemType',
      name: nameTok.text,
      typeParams,
      template,
      span: spanMerge(kwTok.span, templateNode.span),
    };
  }

  // -------------------------------------------------------------------------
  // module declaration
  // -------------------------------------------------------------------------

  /** `[pub] module Name { decls... }` */
  private parseModuleDecl(pub: boolean, leadingTrivia: readonly TriviaNode[]): ModuleDeclNode {
    this.depth++;
    if (this.depth > MAX_PARSE_DEPTH) {
      const tok = this.peek();
      this.depth--;
      throw new ParseError(
        `module nesting exceeds maximum depth of ${MAX_PARSE_DEPTH}`,
        'P0005',
        tok.span,
        'Reduce the nesting depth of your module declarations',
      );
    }
    try {
      const kwTok = this.expect(TokenKind.KW_MODULE);
      const nameTok = this.expect(TokenKind.IDENT);
      this.expect(TokenKind.LBRACE);

      const decls: DeclNode[] = [];
      while (this.peekKind() !== TokenKind.RBRACE && this.peekKind() !== TokenKind.EOF) {
        decls.push(this.parseDecl());
      }

      const closeTok = this.expect(TokenKind.RBRACE);
      return {
        kind: 'ModuleDecl',
        pub,
        name: nameTok.text,
        decls,
        span: spanMerge(kwTok.span, closeTok.span),
        leadingTrivia,
      };
    } finally {
      this.depth--;
    }
  }

  // -------------------------------------------------------------------------
  // Shared parsing helpers
  // -------------------------------------------------------------------------

  /** `[<Ident, Ident, ...>]` — returns string array of type param names. */
  private parseTypeParams(): string[] {
    if (this.peekKind() !== TokenKind.LT) return [];
    this.consume(); // <
    const params: string[] = [];
    if (this.peekKind() !== TokenKind.GT) {
      params.push(this.expect(TokenKind.IDENT).text);
      while (this.peekKind() === TokenKind.COMMA) {
        this.consume();
        if (this.peekKind() === TokenKind.GT) break;
        params.push(this.expect(TokenKind.IDENT).text);
      }
    }
    this.expect(TokenKind.GT);
    return params;
  }

  /** `(name: T, name2: T2, ...)` — returns FnParam array. */
  private parseFnParams(): FnParam[] {
    this.expect(TokenKind.LPAREN);
    const params: FnParam[] = [];

    if (this.peekKind() !== TokenKind.RPAREN) {
      params.push(this.parseFnParam());
      while (this.peekKind() === TokenKind.COMMA) {
        this.consume();
        if (this.peekKind() === TokenKind.RPAREN) break;
        params.push(this.parseFnParam());
      }
    }

    this.expect(TokenKind.RPAREN);
    return params;
  }

  private parseFnParam(): FnParam {
    const nameTok = this.expect(TokenKind.IDENT);
    let type_: TypeAnnotation | null = null;
    if (this.peekKind() === TokenKind.COLON) {
      this.consume();
      type_ = this.parseTypeAnnotation();
    }
    const endSpan = type_?.span ?? nameTok.span;
    return { name: nameTok.text, type_, span: spanMerge(nameTok.span, endSpan) };
  }

  /** Zero or more `!io | !async | !llm` effect tokens. */
  private parseEffects(): EffectTag[] {
    const effects: EffectTag[] = [];
    while (
      this.peekKind() === TokenKind.EFFECT_IO ||
      this.peekKind() === TokenKind.EFFECT_ASYNC ||
      this.peekKind() === TokenKind.EFFECT_LLM
    ) {
      const tok = this.consume();
      // Strip leading `!` from token text to get the tag name
      effects.push(tok.text.slice(1) as EffectTag);
    }
    return effects;
  }

  /**
   * Extended type annotation parser: Named, Generic, Fn `fn(T)->R`, Tuple `(T1,T2)`.
   * In declaration context, `<` after a name is always a generic bracket, never a comparison.
   */
  parseTypeAnnotation(): TypeAnnotation {
    this.depth++;
    if (this.depth > MAX_PARSE_DEPTH) {
      const tok = this.peek();
      this.depth--;
      throw new ParseError(
        `type annotation nesting exceeds maximum depth of ${MAX_PARSE_DEPTH}`,
        'P0005',
        tok.span,
        'Reduce the nesting depth of your type annotations',
      );
    }
    try {
      const tok = this.peek();

      // Fn type: `fn(T1, T2) !io -> R`
      if (tok.kind === TokenKind.KW_FN) {
        return this.parseFnTypeAnnotation();
      }

      // Tuple type: `(T1, T2)`
      if (tok.kind === TokenKind.LPAREN) {
        return this.parseTupleTypeAnnotation();
      }

      // Named or Generic
      const nameTok = this.expect(TokenKind.IDENT);
      if (this.peekKind() === TokenKind.LT) {
        this.consume(); // <
        const args: TypeAnnotation[] = [this.parseTypeAnnotation()];
        while (this.peekKind() === TokenKind.COMMA) {
          this.consume();
          if (this.peekKind() === TokenKind.GT) break;
          args.push(this.parseTypeAnnotation());
        }
        const closeTok = this.expect(TokenKind.GT);
        return { kind: 'Generic', name: nameTok.text, args, span: spanMerge(nameTok.span, closeTok.span) };
      }
      return { kind: 'Named', name: nameTok.text, span: nameTok.span };
    } finally {
      this.depth--;
    }
  }

  private parseFnTypeAnnotation(): TypeAnnotation {
    const kwTok = this.expect(TokenKind.KW_FN);
    this.expect(TokenKind.LPAREN);
    const paramTypes: TypeAnnotation[] = [];
    if (this.peekKind() !== TokenKind.RPAREN) {
      paramTypes.push(this.parseTypeAnnotation());
      while (this.peekKind() === TokenKind.COMMA) {
        this.consume();
        if (this.peekKind() === TokenKind.RPAREN) break;
        paramTypes.push(this.parseTypeAnnotation());
      }
    }
    this.expect(TokenKind.RPAREN);
    const effects = this.parseEffects();
    this.expect(TokenKind.ARROW);
    const ret = this.parseTypeAnnotation();
    return { kind: 'Fn', params: paramTypes, ret, effects, span: spanMerge(kwTok.span, ret.span) };
  }

  private parseTupleTypeAnnotation(): TypeAnnotation {
    const openTok = this.expect(TokenKind.LPAREN);
    const elements: TypeAnnotation[] = [];
    if (this.peekKind() !== TokenKind.RPAREN) {
      elements.push(this.parseTypeAnnotation());
      while (this.peekKind() === TokenKind.COMMA) {
        this.consume();
        if (this.peekKind() === TokenKind.RPAREN) break;
        elements.push(this.parseTypeAnnotation());
      }
    }
    const closeTok = this.expect(TokenKind.RPAREN);
    return { kind: 'Tuple', elements, span: spanMerge(openTok.span, closeTok.span) };
  }

  // -------------------------------------------------------------------------
  // Expression parsing (mirrored from expressions.ts)
  // -------------------------------------------------------------------------

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
        if (this.peekAhead(1).kind === TokenKind.ARROW) return this.parseLambda(trivia);
        return this.parseIdent(trivia);
      case TokenKind.MINUS: return this.parseUnaryMinus(trivia);
      case TokenKind.BANG: return this.parseUnaryNot(trivia);
      case TokenKind.KW_IF: return this.parseIfElse(trivia);
      case TokenKind.KW_MATCH: return this.parseMatch(trivia);
      case TokenKind.KW_LET: return this.parseLetExpr(trivia);
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

  private led(left: ExprNode, prec: number): ExprNode {
    const tok = this.peek();
    if (tok.kind === TokenKind.LPAREN) return this.parseCallArgs(left);
    if (tok.kind === TokenKind.DOT) {
      this.consume();
      const fieldTok = this.expect(TokenKind.IDENT);
      const node: AccessorExprNode = {
        kind: 'AccessorExpr',
        receiver: left,
        field: fieldTok.text,
        span: spanMerge(left.span, fieldTok.span),
      };
      return node;
    }
    if (tok.kind === TokenKind.QUESTION) {
      this.consume();
      const node: PropagateExprNode = { kind: 'PropagateExpr', inner: left, span: spanMerge(left.span, tok.span) };
      return node;
    }
    if (tok.kind === TokenKind.PIPE_GT) {
      this.consume();
      const right = this.parseExpr(prec);
      const node: PipelineExprNode = { kind: 'PipelineExpr', left, right, span: spanMerge(left.span, right.span) };
      return node;
    }
    const op = binopKindOf(tok.kind);
    if (op !== null) {
      this.consume();
      const right = this.parseExpr(prec);
      const node: BinopExprNode = { kind: 'BinopExpr', op, left, right, span: spanMerge(left.span, right.span) };
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

  private parseLiteralInt(trivia: readonly TriviaNode[]): LiteralIntNode {
    const tok = this.consume();
    return { kind: 'LiteralInt', value: BigInt(tok.text), raw: tok.text, span: tok.span, leadingTrivia: trivia };
  }

  private parseLiteralFloat(trivia: readonly TriviaNode[]): LiteralFloatNode {
    const tok = this.consume();
    return { kind: 'LiteralFloat', value: parseFloat(tok.text), raw: tok.text, span: tok.span, leadingTrivia: trivia };
  }

  private parseLiteralBool(trivia: readonly TriviaNode[]): LiteralBoolNode {
    const tok = this.consume();
    return { kind: 'LiteralBool', value: tok.text === 'true', span: tok.span, leadingTrivia: trivia };
  }

  private parseLiteralNull(trivia: readonly TriviaNode[]): LiteralNullNode {
    const tok = this.consume();
    return { kind: 'LiteralNull', span: tok.span, leadingTrivia: trivia };
  }

  private parseIdent(trivia: readonly TriviaNode[]): IdentNode {
    const tok = this.consume();
    return { kind: 'Ident', name: tok.text, span: tok.span, leadingTrivia: trivia };
  }

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
    return { kind: 'StringLit', parts, span: spanMerge(startTok.span, endTok.span), leadingTrivia: trivia };
  }

  private parseUnaryMinus(trivia: readonly TriviaNode[]): UnaryExprNode {
    const opTok = this.consume();
    const operand = this.parseExpr(8);
    return { kind: 'UnaryExpr', op: 'Neg', operand, span: spanMerge(opTok.span, operand.span), leadingTrivia: trivia };
  }

  private parseUnaryNot(trivia: readonly TriviaNode[]): UnaryExprNode {
    const opTok = this.consume();
    const operand = this.parseExpr(8);
    return { kind: 'UnaryExpr', op: 'Not', operand, span: spanMerge(opTok.span, operand.span), leadingTrivia: trivia };
  }

  private parseGroupOrLambda(trivia: readonly TriviaNode[]): ExprNode {
    if (this.isLambdaParamList()) return this.parseLambda(trivia);
    return this.parseGroup(trivia);
  }

  private isLambdaParamList(): boolean {
    let depth = 0;
    let i = this.pos;
    while (i < this.nonTrivia.length) {
      const k = this.nonTrivia[i]?.kind;
      if (k === TokenKind.LPAREN) { depth++; i++; }
      else if (k === TokenKind.RPAREN) { depth--; i++; if (depth === 0) break; }
      else { i++; }
    }
    return this.nonTrivia[i]?.kind === TokenKind.ARROW;
  }

  private parseGroup(trivia: readonly TriviaNode[]): GroupExprNode {
    const open = this.expect(TokenKind.LPAREN);
    const inner = this.parseExpr();
    const close = this.expect(TokenKind.RPAREN);
    return { kind: 'GroupExpr', inner, span: spanMerge(open.span, close.span), leadingTrivia: trivia };
  }

  private parseLambda(trivia: readonly TriviaNode[]): LambdaExprNode {
    const params = this.parseLambdaParams();
    this.expect(TokenKind.ARROW);
    const body = this.parseExpr();
    const startSpan = params[0]?.span ?? body.span;
    return { kind: 'LambdaExpr', params, body, span: spanMerge(startSpan, body.span), leadingTrivia: trivia };
  }

  private parseLambdaParams(): LambdaParam[] {
    if (this.peekKind() === TokenKind.LPAREN) return this.parseParenLambdaParams();
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
    return { name: nameTok.text, type_, span: spanMerge(nameTok.span, endSpan) };
  }

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
    return { kind: 'CallExpr', callee, args, span: spanMerge(callee.span, close.span) };
  }

  private parseCallArg(): CallArg {
    if (this.peekKind() === TokenKind.IDENT && this.peekAhead(1).kind === TokenKind.COLON) {
      const labelTok = this.consume();
      this.consume(); // COLON
      const value = this.parseExpr();
      return { label: labelTok.text, value, span: spanMerge(labelTok.span, value.span) };
    }
    const value = this.parseExpr();
    return { label: null, value, span: value.span };
  }

  private parseIfElse(trivia: readonly TriviaNode[]): IfElseExprNode {
    const kwTok = this.expect(TokenKind.KW_IF);
    const cond = this.parseExpr();
    this.expect(TokenKind.KW_THEN);
    const then = this.parseExpr();
    this.expect(TokenKind.KW_ELSE);
    const else_ = this.parseExpr();
    return { kind: 'IfElseExpr', cond, then, else_, span: spanMerge(kwTok.span, else_.span), leadingTrivia: trivia };
  }

  private parseMatch(trivia: readonly TriviaNode[]): MatchExprNode {
    const kwTok = this.expect(TokenKind.KW_MATCH);
    const scrutinee = this.parseExpr();
    const arms: MatchArm[] = [];
    while (this.peekKind() === TokenKind.PIPE) {
      arms.push(this.parseMatchArm());
    }
    const lastArm = arms[arms.length - 1];
    const endSpan = lastArm?.span ?? scrutinee.span;
    return { kind: 'MatchExpr', scrutinee, arms, span: spanMerge(kwTok.span, endSpan), leadingTrivia: trivia };
  }

  private parseMatchArm(): MatchArm {
    const pipeTok = this.expect(TokenKind.PIPE);
    const pattern = this.parsePattern();
    let guard: ExprNode | null = null;
    if (this.peekKind() === TokenKind.KW_IF) {
      this.consume();
      guard = this.parseExpr();
    }
    this.expect(TokenKind.ARROW);
    const body = this.parseExpr();
    return { pattern, guard, body, span: spanMerge(pipeTok.span, body.span) };
  }

  private parsePattern(): PatternNode {
    const tok = this.peek();

    if (tok.kind === TokenKind.IDENT) {
      const nameTok = this.consume();
      if (nameTok.text === '_') return { kind: 'WildcardPat', span: nameTok.span };
      if (/^[A-Z]/.test(nameTok.text)) {
        if (this.peekKind() === TokenKind.LPAREN) {
          this.consume();
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
          return { kind: 'ConstructorPat', tag: nameTok.text, fields, span: spanMerge(nameTok.span, close.span) };
        }
        return { kind: 'ConstructorPat', tag: nameTok.text, fields: [], span: nameTok.span };
      }
      return { kind: 'IdentPat', name: nameTok.text, span: nameTok.span };
    }

    if (tok.kind === TokenKind.INT_LIT) { const lit = this.parseLiteralInt([]); return { kind: 'LiteralPat', value: lit, span: lit.span }; }
    if (tok.kind === TokenKind.FLOAT_LIT) { const lit = this.parseLiteralFloat([]); return { kind: 'LiteralPat', value: lit, span: lit.span }; }
    if (tok.kind === TokenKind.BOOL_LIT) { const lit = this.parseLiteralBool([]); return { kind: 'LiteralPat', value: lit, span: lit.span }; }
    if (tok.kind === TokenKind.NULL_LIT) { const lit = this.parseLiteralNull([]); return { kind: 'LiteralPat', value: lit, span: lit.span }; }

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

  private parseLetExpr(trivia: readonly TriviaNode[]): LetExprNode {
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
    return { kind: 'LetExpr', name: nameTok.text, type_, value, body, span: spanMerge(kwTok.span, body.span), leadingTrivia: trivia };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a full Ion source file from a flat token array (trivia included).
 * Throws `ParseError` on the first syntactic error.
 */
export function parseModule(tokens: Token[]): ModuleNode {
  return new DeclarationParser(tokens).parseModule();
}

/**
 * Parse a single Ion declaration from a flat token array (trivia included).
 * Throws `ParseError` on the first syntactic error.
 */
export function parseDeclaration(tokens: Token[]): DeclNode {
  return new DeclarationParser(tokens).parseDecl();
}

// Re-export CST declaration types
export type {
  FnParam,
  DeclAttribute,
  FnDeclNode,
  LetDeclNode,
  DataDeclNode,
  DataVariant,
  RecordField,
  TypeAliasDeclNode,
  UseDeclNode,
  ExternDeclNode,
  ExternBlockDeclNode,
  ExternBlockItem,
  ExternBlockItemFn,
  ExternBlockItemType,
  ModuleDeclNode,
  DeclNode,
  ModuleNode,
} from './cst.js';
