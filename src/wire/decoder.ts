import type {
  IonIRModule,
  IonIRNode,
  IonIRDialect,
  ModuleRefNode,
  AdtDeclNode,
  AdtVariant,
  AdtArm,
  CasePattern,
  CaseArm,
  LiteralValue,
  Param,
  OopMethod,
  OopMember,
  EffectOp,
  EffectHandler,
  ForeignSignature,
} from '../ir/nodes.js';
import type { IonType } from '../ir/types.js';
import type { Span, SymbolId } from '../types.js';
import { makeSymbolId } from '../types.js';

// ---------------------------------------------------------------------------
// Public error type
// ---------------------------------------------------------------------------

export class WireDecodeError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(`WireDecodeError at pos ${pos}: ${message}`);
    this.name = 'WireDecodeError';
  }
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const WIRE_SPAN: Span = { file: '<wire>', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const UNIT_TYPE: IonType = { kind: 'Unit' };

const STUB_SIG: ForeignSignature = { params: [], ret: { kind: 'Unit' }, template: '' };

// ---------------------------------------------------------------------------
// Decoder context
// ---------------------------------------------------------------------------

interface DecoderContext {
  readonly symPool: ReadonlyMap<string, string>;
  readonly typPool: ReadonlyMap<string, string>;
}

const EMPTY_CTX: DecoderContext = { symPool: new Map(), typPool: new Map() };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class WireParser {
  pos = 0;
  private symCounter = 0;
  private depth = 0;
  private readonly MAX_DEPTH = 500;
  readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  // -------------------------------------------------------------------------
  // Primitives
  // -------------------------------------------------------------------------

  peek(): string {
    return this.input[this.pos] ?? '';
  }

  peekAt(offset: number): string {
    return this.input[this.pos + offset] ?? '';
  }

  /** Consume one char (optionally assert it equals `ch`). */
  consume(ch?: string): string {
    const c = this.input[this.pos];
    if (c === undefined) this.error('unexpected end of input');
    if (ch !== undefined && c !== ch) this.error(`expected '${ch}', got '${c}'`);
    this.pos++;
    return c;
  }

  /** Consume a literal string. */
  consumeStr(s: string): void {
    for (const ch of s) this.consume(ch);
  }

  skipWs(): void {
    while (this.pos < this.input.length && this.input[this.pos] === ' ') this.pos++;
  }

  atEol(): boolean {
    return this.pos >= this.input.length || this.input[this.pos] === '\n';
  }

  consumeEol(): void {
    if (this.pos < this.input.length) {
      if (this.input[this.pos] === '\n') this.pos++;
      else this.error('expected newline');
    }
  }

  error(msg: string): never {
    throw new WireDecodeError(msg, this.pos);
  }

  /** Fresh synthetic SymbolId for decoded nodes. */
  freshSym(): SymbolId {
    return makeSymbolId(`wire:${this.symCounter++}`);
  }

  // -------------------------------------------------------------------------
  // Identifier / name parsing
  // -------------------------------------------------------------------------

  isIdStart(ch: string): boolean {
    return /[a-zA-Z_$]/.test(ch);
  }

  isIdPart(ch: string): boolean {
    return /[a-zA-Z0-9_$]/.test(ch);
  }

  parseIdentifier(): string {
    if (!this.isIdStart(this.peek())) this.error(`expected identifier, got '${this.peek()}'`);
    const start = this.pos;
    while (this.pos < this.input.length && this.isIdPart(this.input[this.pos]!)) this.pos++;
    return this.input.slice(start, this.pos);
  }

  /** Parse identifiers and dots, collecting a dotted path. */
  parseDottedPath(): string[] {
    const parts: string[] = [this.parseIdentifier()];
    while (this.pos < this.input.length && this.input[this.pos] === '.') {
      this.pos++;
      parts.push(this.parseIdentifier());
    }
    return parts;
  }

  /** Resolve a name alias via symbol pool. */
  resolveName(alias: string, ctx: DecoderContext): string {
    return ctx.symPool.get(alias) ?? alias;
  }

  /** Parse an identifier and resolve via symbol pool. */
  parseResolvedName(ctx: DecoderContext): string {
    return this.resolveName(this.parseIdentifier(), ctx);
  }

  // -------------------------------------------------------------------------
  // Type parsing
  // -------------------------------------------------------------------------

  parseTypeExpr(ctx: DecoderContext): IonType {
    const start = this.pos;
    const raw = this.readTypeToken();
    return this.resolveType(raw, ctx, new Set([raw]), start);
  }

  /**
   * Read a complete type token (no spaces, may include nested <...>).
   * E.g. "int", "list<int>", "fn(int)->str!io", "a" (alias).
   */
  private readTypeToken(): string {
    const start = this.pos;
    // Read initial identifier or keyword
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]!;
      if (ch === '<' || ch === '(') {
        // consume balanced
        this.pos++;
        this.consumeBalanced(ch === '<' ? '>' : ')');
      } else if (ch === '-') {
        // could be -> in fn type
        if (this.input[this.pos + 1] === '>') {
          this.pos += 2;
          // consume the return type token
          const retStart = this.pos;
          while (this.pos < this.input.length) {
            const rc = this.input[this.pos]!;
            if (rc === '<' || rc === '(') {
              this.pos++;
              this.consumeBalanced(rc === '<' ? '>' : ')');
            } else if (rc === '!' ) {
              // effect tag
              this.pos++;
              while (this.pos < this.input.length && this.isIdPart(this.input[this.pos]!)) this.pos++;
            } else if (this.isIdPart(rc) || rc === '$') {
              this.pos++;
            } else {
              break;
            }
          }
          void retStart;
        } else {
          break;
        }
      } else if (ch === '!' ) {
        // effect suffix
        this.pos++;
        while (this.pos < this.input.length && this.isIdPart(this.input[this.pos]!)) this.pos++;
      } else if (this.isIdPart(ch) || ch === '$') {
        this.pos++;
      } else {
        break;
      }
    }
    return this.input.slice(start, this.pos);
  }

  private consumeBalanced(closeChar: string): void {
    let depth = 1;
    const openChar = closeChar === '>' ? '<' : '(';
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos++]!;
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return;
      }
    }
    this.error(`unclosed bracket, expected '${closeChar}'`);
  }

  private resolveType(expr: string, ctx: DecoderContext, visiting: ReadonlySet<string>, errPos: number): IonType {
    // Check type pool alias
    const pooled = ctx.typPool.get(expr);
    if (pooled !== undefined) {
      if (visiting.has(pooled)) throw new WireDecodeError('circular type alias', errPos);
      return this.resolveType(pooled, ctx, new Set([...visiting, pooled]), errPos);
    }
    return this.parseTypeString(expr, ctx, errPos, visiting);
  }

  private parseTypeString(s: string, ctx: DecoderContext, errPos: number, visiting: ReadonlySet<string> = new Set()): IonType {
    if (s === 'int') return { kind: 'Int' };
    if (s === 'flt') return { kind: 'Float' };
    if (s === 'str') return { kind: 'Str' };
    if (s === 'bool') return { kind: 'Bool' };
    if (s === 'null') return { kind: 'Null' };
    if (s === 'unit') return { kind: 'Unit' };
    if (s === 'never') return { kind: 'Never' };
    if (s.startsWith('$')) return { kind: 'TypeVar', id: s.slice(1) };

    if (s.startsWith('list<') && s.endsWith('>')) {
      const inner = s.slice(5, -1);
      return { kind: 'List', elem: this.resolveType(inner, ctx, new Set([...visiting, inner]), errPos) };
    }
    if (s.startsWith('opt<') && s.endsWith('>')) {
      const inner = s.slice(4, -1);
      return { kind: 'Option', inner: this.resolveType(inner, ctx, new Set([...visiting, inner]), errPos) };
    }
    if (s.startsWith('map<') && s.endsWith('>')) {
      const [key, val] = this.splitCommaBalanced(s.slice(4, -1), errPos);
      return { kind: 'Map', key: this.resolveType(key, ctx, new Set([...visiting, key]), errPos), value: this.resolveType(val, ctx, new Set([...visiting, val]), errPos) };
    }
    if (s.startsWith('res<') && s.endsWith('>')) {
      const [ok, err] = this.splitCommaBalanced(s.slice(4, -1), errPos);
      return { kind: 'Result', ok: this.resolveType(ok, ctx, new Set([...visiting, ok]), errPos), err: this.resolveType(err, ctx, new Set([...visiting, err]), errPos) };
    }
    if (s.startsWith('fn(')) {
      return this.parseFnTypeString(s, ctx, errPos, visiting);
    }

    // User type or alias in type pool
    const pooled = ctx.typPool.get(s);
    if (pooled !== undefined) {
      return this.resolveType(pooled, ctx, new Set([...visiting, pooled]), errPos);
    }

    // User type: name or name<args>
    const ltIdx = s.indexOf('<');
    if (ltIdx === -1) {
      return { kind: 'User', name: s, symbolId: this.freshSym(), args: [] };
    }
    const name = s.slice(0, ltIdx);
    const argsStr = s.slice(ltIdx + 1, -1);
    const argStrs = this.splitCommaBalancedMulti(argsStr, errPos);
    const args = argStrs.map(a => this.resolveType(a, ctx, new Set([...visiting, a]), errPos));
    return { kind: 'User', name, symbolId: this.freshSym(), args };
  }

  private parseFnTypeString(s: string, ctx: DecoderContext, errPos: number, visiting: ReadonlySet<string> = new Set()): IonType {
    // s: fn(p1,p2)->ret!eff1!eff2
    // find closing ) of params
    let depth = 0;
    let closeIdx = -1;
    for (let i = 3; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        if (depth === 0) { closeIdx = i; break; }
        depth--;
      }
    }
    if (closeIdx === -1) throw new WireDecodeError('malformed fn type', errPos);
    const paramsStr = s.slice(3, closeIdx);
    const afterClose = s.slice(closeIdx + 1);
    if (!afterClose.startsWith('->')) throw new WireDecodeError('fn type missing ->', errPos);
    const retAndEffects = afterClose.slice(2);
    // split retType from !effects
    const bangIdx = retAndEffects.indexOf('!');
    let retStr: string;
    let effectPart: string;
    if (bangIdx === -1) {
      retStr = retAndEffects;
      effectPart = '';
    } else {
      retStr = retAndEffects.slice(0, bangIdx);
      effectPart = retAndEffects.slice(bangIdx);
    }
    const params = paramsStr.length === 0 ? [] :
      this.splitCommaBalancedMulti(paramsStr, errPos).map(p => this.resolveType(p, ctx, new Set([...visiting, p]), errPos));
    const ret = this.resolveType(retStr, ctx, new Set([...visiting, retStr]), errPos);
    const effects = new Set<string>(
      effectPart.split('!').filter(e => e.length > 0)
    );
    return { kind: 'Fn', params, ret, effects };
  }

  /** Split `a,b<c,d>,e` into ['a', 'b<c,d>', 'e'] - handles balanced <> */
  private splitCommaBalancedMulti(s: string, errPos: number): string[] {
    if (s.length === 0) return [];
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (ch === '<' || ch === '(') depth++;
      else if (ch === '>' || ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(s.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(s.slice(start));
    return parts;
  }

  /** Split into exactly two parts at the first top-level comma. */
  private splitCommaBalanced(s: string, errPos: number): [string, string] {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (ch === '<' || ch === '(') depth++;
      else if (ch === '>' || ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        return [s.slice(0, i), s.slice(i + 1)];
      }
    }
    throw new WireDecodeError(`expected comma in '${s}'`, errPos);
  }

  // -------------------------------------------------------------------------
  // Param parsing
  // -------------------------------------------------------------------------

  parseParam(ctx: DecoderContext): Param {
    const name = this.parseResolvedName(ctx);
    this.consume(':');
    const type = this.parseTypeExpr(ctx);
    return { name, symbolId: this.freshSym(), type, span: WIRE_SPAN };
  }

  /** Parse `(param, param, ...)` — returns params array. */
  parseParamList(ctx: DecoderContext): Param[] {
    this.consume('(');
    if (this.peek() === ')') { this.consume(')'); return []; }
    const params: Param[] = [this.parseParam(ctx)];
    while (this.peek() === ',') { this.consume(','); params.push(this.parseParam(ctx)); }
    this.consume(')');
    return params;
  }

  /** Parse `(node, node, ...)` — returns nodes array. */
  parseNodeList(ctx: DecoderContext): IonIRNode[] {
    this.consume('(');
    if (this.peek() === ')') { this.consume(')'); return []; }
    const nodes: IonIRNode[] = [this.parseNode(ctx)];
    while (this.peek() === ',') { this.consume(','); nodes.push(this.parseNode(ctx)); }
    this.consume(')');
    return nodes;
  }

  // -------------------------------------------------------------------------
  // Node parsing
  // -------------------------------------------------------------------------

  parseNode(ctx: DecoderContext): IonIRNode {
    if (++this.depth > this.MAX_DEPTH) {
      this.depth--;
      this.error('node nesting too deep');
    }
    try {
      return this.parseNodeInner(ctx);
    } finally {
      this.depth--;
    }
  }

  private parseNodeInner(ctx: DecoderContext): IonIRNode {
    const p = this.peek();

    // Abs: (params)->body
    if (p === '(') {
      const params = this.parseParamList(ctx);
      this.consumeStr('->');
      const body = this.parseNode(ctx);
      return { kind: 'Abs', params, body, captures: [], span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // Let: let id=value;body
    if (this.input.startsWith('let ', this.pos)) {
      this.consumeStr('let ');
      const name = this.parseResolvedName(ctx);
      this.consume('=');
      const value = this.parseNode(ctx);
      this.consume(';');
      const body = this.parseNode(ctx);
      return { kind: 'Let', name, symbolId: this.freshSym(), bindingType: UNIT_TYPE, value, body, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // Case: match(scrutinee){arms}
    if (this.input.startsWith('match(', this.pos)) {
      this.consumeStr('match(');
      const scrutinee = this.parseNode(ctx);
      this.consume(')');
      this.consume('{');
      const arms: CaseArm[] = [];
      if (this.peek() !== '}') {
        arms.push(this.parseCaseArm(ctx));
        while (this.peek() === ';') { this.consume(';'); arms.push(this.parseCaseArm(ctx)); }
      }
      this.consume('}');
      return { kind: 'Case', scrutinee, arms, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // Effect: eff!tag(body)
    if (this.input.startsWith('eff!', this.pos)) {
      this.consumeStr('eff!');
      const tag = this.parseIdentifier();
      this.consume('(');
      const body = this.parseNode(ctx);
      this.consume(')');
      return { kind: 'Effect', effectTag: tag, body, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // ForeignRef: ffi:target:module:symbol
    if (this.input.startsWith('ffi:', this.pos)) {
      this.consumeStr('ffi:');
      const target = this.parseIdentifier();
      this.consume(':');
      const mod = this.parseIdentifier();
      this.consume(':');
      const sym = this.parseIdentifier();
      return { kind: 'ForeignRef', target, module: mod, symbol: sym, sig: STUB_SIG, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // OopClass: class name[:superid]{fields}{methods}
    if (this.input.startsWith('class ', this.pos)) {
      this.consumeStr('class ');
      const name = this.parseResolvedName(ctx);
      let superClass: SymbolId | undefined;
      if (this.peek() === ':') {
        this.consume(':');
        superClass = makeSymbolId(this.parseSymbolIdToken());
      }
      // fields
      this.consume('{');
      const fields: Param[] = [];
      if (this.peek() !== '}') {
        fields.push(this.parseParam(ctx));
        while (this.peek() === ',') { this.consume(','); fields.push(this.parseParam(ctx)); }
      }
      this.consume('}');
      // methods
      this.consume('{');
      const methods: OopMethod[] = [];
      if (this.peek() !== '}') {
        methods.push(this.parseOopMethod(ctx));
        while (this.peek() === ';') { this.consume(';'); methods.push(this.parseOopMethod(ctx)); }
      }
      this.consume('}');
      return {
        kind: 'OopClass', name, symbolId: this.freshSym(),
        ...(superClass !== undefined ? { superClass } : {}),
        interfaces: [], fields, methods, span: WIRE_SPAN, type: UNIT_TYPE,
      };
    }

    // OopInterface: iface name{members}
    if (this.input.startsWith('iface ', this.pos)) {
      this.consumeStr('iface ');
      const name = this.parseResolvedName(ctx);
      this.consume('{');
      const members: OopMember[] = [];
      if (this.peek() !== '}') {
        members.push(this.parseOopMember(ctx));
        while (this.peek() === ',') { this.consume(','); members.push(this.parseOopMember(ctx)); }
      }
      this.consume('}');
      return { kind: 'OopInterface', name, symbolId: this.freshSym(), members, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // OopNew: new sid(args)
    if (this.input.startsWith('new ', this.pos)) {
      this.consumeStr('new ');
      const ctorSymbolId = makeSymbolId(this.parseSymbolIdToken());
      const args = this.parseNodeList(ctx);
      return { kind: 'OopNew', ctorSymbolId, args, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // OopThis: this
    if (this.input.startsWith('this', this.pos) && !this.isIdPart(this.peekAt(4))) {
      this.consumeStr('this');
      return { kind: 'OopThis', span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // AsyncBlock: async{body}
    if (this.input.startsWith('async{', this.pos)) {
      this.consumeStr('async{');
      const body = this.parseNode(ctx);
      this.consume('}');
      return { kind: 'AsyncBlock', body, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // Await: await(expr)
    if (this.input.startsWith('await(', this.pos)) {
      this.consumeStr('await(');
      const expr = this.parseNode(ctx);
      this.consume(')');
      return { kind: 'Await', expr, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // AdtDecl: adt name{variant|variant...}
    if (this.input.startsWith('adt ', this.pos)) {
      this.consumeStr('adt ');
      const name = this.parseResolvedName(ctx);
      this.consume('{');
      const variants: AdtVariant[] = [];
      if (this.peek() !== '}') {
        variants.push(this.parseAdtVariant(ctx));
        while (this.peek() === '|') { this.consume('|'); variants.push(this.parseAdtVariant(ctx)); }
      }
      this.consume('}');
      return { kind: 'AdtDecl', name, symbolId: this.freshSym(), variants, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // AdtMatch: adt(scrutinee){arms}
    if (this.input.startsWith('adt(', this.pos)) {
      this.consumeStr('adt(');
      const scrutinee = this.parseNode(ctx);
      this.consume(')');
      this.consume('{');
      const arms: AdtArm[] = [];
      if (this.peek() !== '}') {
        arms.push(this.parseAdtArm(ctx));
        while (this.peek() === ';') { this.consume(';'); arms.push(this.parseAdtArm(ctx)); }
      }
      this.consume('}');
      return { kind: 'AdtMatch', scrutinee, arms, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // EffectDecl: effect name{ops}
    if (this.input.startsWith('effect ', this.pos)) {
      this.consumeStr('effect ');
      const name = this.parseResolvedName(ctx);
      this.consume('{');
      const operations: EffectOp[] = [];
      if (this.peek() !== '}') {
        operations.push(this.parseEffectOp(ctx));
        while (this.peek() === ';') { this.consume(';'); operations.push(this.parseEffectOp(ctx)); }
      }
      this.consume('}');
      return { kind: 'EffectDecl', name, symbolId: this.freshSym(), operations, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // Perform: perf!effectSymbolId:operation(args)
    if (this.input.startsWith('perf!', this.pos)) {
      this.consumeStr('perf!');
      const effectSymbolId = makeSymbolId(this.parseSymbolIdToken());
      this.consume(':');
      const operation = this.parseResolvedName(ctx);
      const args = this.parseNodeList(ctx);
      return { kind: 'Perform', effectSymbolId, operation, args, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // Handle: handle(body){handlers}[;ret:returnClause]
    if (this.input.startsWith('handle(', this.pos)) {
      this.consumeStr('handle(');
      const body = this.parseNode(ctx);
      this.consume(')');
      this.consume('{');
      const handlers: EffectHandler[] = [];
      if (this.peek() !== '}') {
        handlers.push(this.parseEffectHandler(ctx));
        while (this.peek() === ';') { this.consume(';'); handlers.push(this.parseEffectHandler(ctx)); }
      }
      this.consume('}');
      let returnClause: IonIRNode | undefined;
      if (this.input.startsWith(';ret:', this.pos)) {
        this.consumeStr(';ret:');
        returnClause = this.parseNode(ctx);
      }
      return {
        kind: 'Handle', body, handlers,
        ...(returnClause !== undefined ? { returnClause } : {}),
        span: WIRE_SPAN, type: UNIT_TYPE,
      };
    }

    // Resume: resume(value)
    if (this.input.startsWith('resume(', this.pos)) {
      this.consumeStr('resume(');
      const value = this.parseNode(ctx);
      this.consume(')');
      return { kind: 'Resume', value, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // Literal: number / string / true / false / null
    const lit = this.tryParseLiteral();
    if (lit !== null) {
      return { kind: 'Literal', value: lit, span: WIRE_SPAN, type: UNIT_TYPE };
    }

    // Primary: id chains with left-recursive suffixes
    return this.parsePrimary(ctx);
  }

  private parsePrimary(ctx: DecoderContext): IonIRNode {
    // Greedily consume id (.id)* then check for ::
    const firstId = this.parseIdentifier();
    const path: string[] = [this.resolveName(firstId, ctx)];

    while (this.pos < this.input.length && this.input[this.pos] === '.') {
      // Accessor suffix or part of ModuleRef dotted path
      // We greedily collect all .id segments
      this.pos++;
      const part = this.parseIdentifier();
      path.push(this.resolveName(part, ctx));
    }

    // Check for ModuleRef ::sid
    if (this.input.startsWith('::', this.pos)) {
      this.pos += 2;
      const symbolId = makeSymbolId(this.parseSymbolIdToken());
      let node: IonIRNode = { kind: 'ModuleRef', modulePath: path, symbolId, span: WIRE_SPAN, type: UNIT_TYPE };
      node = this.applyPrimarySuffixes(node, ctx);
      return node;
    }

    // Otherwise: Accessor chain or Var
    // Fold path into left-associative Accessor chain
    let node: IonIRNode;
    if (path.length === 1) {
      node = { kind: 'Var', name: path[0]!, symbolId: this.freshSym(), span: WIRE_SPAN, type: UNIT_TYPE };
    } else {
      // path = [a, b, c] → Accessor(Accessor(Var(a), b), c)
      let inner: IonIRNode = { kind: 'Var', name: path[0]!, symbolId: this.freshSym(), span: WIRE_SPAN, type: UNIT_TYPE };
      for (let i = 1; i < path.length; i++) {
        inner = { kind: 'Accessor', receiver: inner, member: path[i]!, span: WIRE_SPAN, type: UNIT_TYPE };
      }
      node = inner;
    }

    return this.applyPrimarySuffixes(node, ctx);
  }

  private applyPrimarySuffixes(node: IonIRNode, ctx: DecoderContext): IonIRNode {
    let current = node;
    while (true) {
      const ch = this.peek();

      // App: callee(args)
      if (ch === '(') {
        const args = this.parseNodeList(ctx);
        current = { kind: 'App', callee: current, args, span: WIRE_SPAN, type: UNIT_TYPE };
        continue;
      }

      // OopVirtualCall: receiver->method(args)
      // Only consume -> if followed by identifier then ( — otherwise it's an arm separator
      if (ch === '-' && this.peekAt(1) === '>') {
        const savedPos = this.pos;
        this.pos += 2;
        let methodEnd = this.pos;
        while (methodEnd < this.input.length && this.isIdPart(this.input[methodEnd]!)) methodEnd++;
        if (methodEnd > this.pos && methodEnd < this.input.length && this.input[methodEnd] === '(') {
          const method = this.parseResolvedName(ctx);
          const args = this.parseNodeList(ctx);
          current = { kind: 'OopVirtualCall', receiver: current, method, args, span: WIRE_SPAN, type: UNIT_TYPE };
          continue;
        }
        this.pos = savedPos;
        break;
      }

      // Accessor: receiver.member (only if NOT followed by :: which would be wrong here)
      if (ch === '.') {
        this.pos++;
        const member = this.parseResolvedName(ctx);
        current = { kind: 'Accessor', receiver: current, member, span: WIRE_SPAN, type: UNIT_TYPE };
        continue;
      }

      break;
    }
    return current;
  }

  // -------------------------------------------------------------------------
  // Literal parsing
  // -------------------------------------------------------------------------

  tryParseLiteral(): LiteralValue | null {
    // JSON string
    if (this.peek() === '"') {
      return { kind: 'Str', value: this.parseJsonString() };
    }
    // true / false / null
    if (this.input.startsWith('true', this.pos) && !this.isIdPart(this.peekAt(4))) {
      this.pos += 4;
      return { kind: 'Bool', value: true };
    }
    if (this.input.startsWith('false', this.pos) && !this.isIdPart(this.peekAt(5))) {
      this.pos += 5;
      return { kind: 'Bool', value: false };
    }
    if (this.input.startsWith('null', this.pos) && !this.isIdPart(this.peekAt(4))) {
      this.pos += 4;
      return { kind: 'Null' };
    }
    // Number: optional minus, digits, optional dot+digits
    if (this.peek() === '-' || (this.peek() >= '0' && this.peek() <= '9')) {
      return this.parseNumber();
    }
    return null;
  }

  private parseNumber(): LiteralValue {
    const start = this.pos;
    if (this.peek() === '-') this.pos++;
    while (this.pos < this.input.length && this.input[this.pos]! >= '0' && this.input[this.pos]! <= '9') this.pos++;
    let isFloat = false;
    if (this.pos < this.input.length && this.input[this.pos] === '.') {
      isFloat = true;
      this.pos++;
      while (this.pos < this.input.length && this.input[this.pos]! >= '0' && this.input[this.pos]! <= '9') this.pos++;
    }
    // Exponent
    if (this.pos < this.input.length && (this.input[this.pos] === 'e' || this.input[this.pos] === 'E')) {
      isFloat = true;
      this.pos++;
      if (this.pos < this.input.length && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) this.pos++;
      while (this.pos < this.input.length && this.input[this.pos]! >= '0' && this.input[this.pos]! <= '9') this.pos++;
    }
    const raw = this.input.slice(start, this.pos);
    const n = Number(raw);
    return isFloat ? { kind: 'Float', value: n } : { kind: 'Int', value: n };
  }

  private parseJsonString(): string {
    this.consume('"');
    let result = '';
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos]!;
      if (ch === '"') { this.pos++; return result; }
      if (ch === '\\') {
        this.pos++;
        const esc = this.input[this.pos++]!;
        switch (esc) {
          case '"': result += '"'; break;
          case '\\': result += '\\'; break;
          case '/': result += '/'; break;
          case 'n': result += '\n'; break;
          case 'r': result += '\r'; break;
          case 't': result += '\t'; break;
          case 'b': result += '\b'; break;
          case 'f': result += '\f'; break;
          case 'u': {
            const hex = this.input.slice(this.pos, this.pos + 4);
            result += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4;
            break;
          }
          default: result += esc;
        }
      } else {
        result += ch;
        this.pos++;
      }
    }
    this.error('unterminated string');
  }

  // -------------------------------------------------------------------------
  // Symbol ID token (may contain colons: e.g. "mod:Foo:0")
  // -------------------------------------------------------------------------

  /** Parse a symbolId token: identifier parts joined by colons. */
  parseSymbolIdToken(): string {
    let result = this.parseIdentifier();
    while (this.pos < this.input.length && this.input[this.pos] === ':' &&
           this.pos + 1 < this.input.length && this.isIdStart(this.input[this.pos + 1]!)) {
      this.pos++;
      result += ':' + this.parseIdentifier();
    }
    // Also allow trailing :digits
    while (this.pos < this.input.length && this.input[this.pos] === ':' &&
           this.pos + 1 < this.input.length &&
           this.input[this.pos + 1]! >= '0' && this.input[this.pos + 1]! <= '9') {
      this.pos++;
      let digits = '';
      while (this.pos < this.input.length && this.input[this.pos]! >= '0' && this.input[this.pos]! <= '9') {
        digits += this.input[this.pos++]!;
      }
      result += ':' + digits;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Case arm parsing
  // -------------------------------------------------------------------------

  parseCaseArm(ctx: DecoderContext): CaseArm {
    const pattern = this.parseCasePattern(ctx);
    let guard: IonIRNode | undefined;
    if (this.input.startsWith(' if ', this.pos)) {
      this.consumeStr(' if ');
      guard = this.parseNode(ctx);
    }
    this.consumeStr('->');
    const body = this.parseNode(ctx);
    return { pattern, ...(guard !== undefined ? { guard } : {}), body, span: WIRE_SPAN };
  }

  parseCasePattern(ctx: DecoderContext): CasePattern {
    // Wildcard
    if (this.peek() === '_' && !this.isIdPart(this.peekAt(1))) {
      this.pos++;
      return { kind: 'Wildcard', span: WIRE_SPAN };
    }
    // Literal
    const lit = this.tryParseLiteral();
    if (lit !== null) return { kind: 'Literal', value: lit, span: WIRE_SPAN };

    // Var or Constructor: id optionally followed by (fields)
    const name = this.parseResolvedName(ctx);
    if (this.peek() === '(') {
      // Constructor
      this.consume('(');
      const fields: CasePattern[] = [];
      if (this.peek() !== ')') {
        fields.push(this.parseCasePattern(ctx));
        while (this.peek() === ',') { this.consume(','); fields.push(this.parseCasePattern(ctx)); }
      }
      this.consume(')');
      return { kind: 'Constructor', ctorName: name, symbolId: this.freshSym(), fields, span: WIRE_SPAN };
    }
    return { kind: 'Var', name, symbolId: this.freshSym(), span: WIRE_SPAN };
  }

  // -------------------------------------------------------------------------
  // ADT variant/arm parsing
  // -------------------------------------------------------------------------

  parseAdtVariant(ctx: DecoderContext): AdtVariant {
    const tag = this.parseResolvedName(ctx);
    const fields = this.parseParamList(ctx);
    return { tag, symbolId: this.freshSym(), fields, span: WIRE_SPAN };
  }

  parseAdtArm(ctx: DecoderContext): AdtArm {
    const tag = this.parseResolvedName(ctx);
    const bindings = this.parseParamList(ctx);
    this.consumeStr('->');
    const body = this.parseNode(ctx);
    return { tag, bindings, body, span: WIRE_SPAN };
  }

  // -------------------------------------------------------------------------
  // Effect op/handler parsing
  // -------------------------------------------------------------------------

  parseEffectOp(ctx: DecoderContext): EffectOp {
    const name = this.parseResolvedName(ctx);
    const params = this.parseParamList(ctx);
    this.consumeStr('->');
    const retType = this.parseTypeExpr(ctx);
    return { name, params, retType, span: WIRE_SPAN };
  }

  parseEffectHandler(ctx: DecoderContext): EffectHandler {
    const operation = this.parseResolvedName(ctx);
    const params = this.parseParamList(ctx);
    this.consumeStr('->');
    const body = this.parseNode(ctx);
    return { operation, params, body, span: WIRE_SPAN };
  }

  // -------------------------------------------------------------------------
  // OOP method/member parsing
  // -------------------------------------------------------------------------

  parseOopMethod(ctx: DecoderContext): OopMethod {
    // name(params)->retType{body}
    const name = this.parseResolvedName(ctx);
    const params = this.parseParamList(ctx);
    this.consumeStr('->');
    const retType = this.parseTypeExpr(ctx);
    this.consume('{');
    let body: IonIRNode | undefined;
    if (this.peek() !== '}') {
      body = this.parseNode(ctx);
    }
    this.consume('}');
    return {
      name, symbolId: this.freshSym(), params, retType,
      ...(body !== undefined ? { body } : {}),
      isAbstract: false, isStatic: false, span: WIRE_SPAN,
    };
  }

  parseOopMember(ctx: DecoderContext): OopMember {
    const name = this.parseResolvedName(ctx);
    this.consume(':');
    const type = this.parseTypeExpr(ctx);
    return { name, symbolId: this.freshSym(), type, span: WIRE_SPAN };
  }

  // -------------------------------------------------------------------------
  // Section parsers
  // -------------------------------------------------------------------------

  parseVersion(): void {
    if (!this.input.startsWith('I1', this.pos)) {
      this.error('expected wire format version I1');
    }
    this.pos += 2;
    this.consumeEol();
  }

  parseModuleLine(): { module: string; version: string; dialects: IonIRDialect[] } {
    if (!this.input.startsWith('M ', this.pos)) this.error('expected M line');
    this.pos += 2;
    // module name: read until space
    const modStart = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== ' ' && this.input[this.pos] !== '\n') this.pos++;
    const module = this.input.slice(modStart, this.pos);
    this.consume(' ');
    // v=version
    if (!this.input.startsWith('v=', this.pos)) this.error('expected v= in M line');
    this.pos += 2;
    const vStart = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== ' ' && this.input[this.pos] !== '\n') this.pos++;
    const version = this.input.slice(vStart, this.pos);
    // d=dialects
    let dialects: IonIRDialect[] = [];
    if (this.peek() === ' ') {
      this.consume(' ');
      if (!this.input.startsWith('d=', this.pos)) this.error('expected d= in M line');
      this.pos += 2;
      const dStart = this.pos;
      while (!this.atEol()) this.pos++;
      const dStr = this.input.slice(dStart, this.pos);
      dialects = dStr === '' ? [] : dStr.split(',').map(d => d.trim() as IonIRDialect);
    }
    this.consumeEol();
    return { module, version, dialects };
  }

  parseSymbolLine(): Map<string, string> {
    const pool = new Map<string, string>();
    if (!this.input.startsWith('S ', this.pos)) return pool;
    this.pos += 2;
    while (!this.atEol()) {
      // alias=value
      const alias = this.parseIdentifier();
      this.consume('=');
      // value: read until space or EOL
      const valStart = this.pos;
      while (!this.atEol() && this.input[this.pos] !== ' ') this.pos++;
      const value = this.input.slice(valStart, this.pos);
      pool.set(alias, value);
      if (this.peek() === ' ') this.pos++;
    }
    this.consumeEol();
    return pool;
  }

  parseTypeLine(): Map<string, string> {
    const pool = new Map<string, string>();
    if (!this.input.startsWith('T ', this.pos)) return pool;
    this.pos += 2;
    while (!this.atEol()) {
      const alias = this.parseIdentifier();
      this.consume('=');
      // value: a type expression with no spaces — read until space or EOL
      const valStart = this.pos;
      while (!this.atEol() && this.input[this.pos] !== ' ') this.pos++;
      const value = this.input.slice(valStart, this.pos);
      pool.set(alias, value);
      if (this.peek() === ' ') this.pos++;
    }
    this.consumeEol();
    return pool;
  }

  parseImportLine(ctx: DecoderContext): ModuleRefNode[] {
    const imports: ModuleRefNode[] = [];
    if (!this.input.startsWith('X ', this.pos)) return imports;
    this.pos += 2;
    while (!this.atEol()) {
      // item: sid from dotted.path:sid
      const symbolIdStr = this.parseSymbolIdToken();
      this.consumeStr(' from ');
      // dotted.path:sid — module path parts separated by '.', then ':' sid
      const pathStart = this.pos;
      while (!this.atEol() && this.input[this.pos] !== ' ' && this.input[this.pos] !== ';') this.pos++;
      const pathAndSid = this.input.slice(pathStart, this.pos);
      // First colon separates dot-path from symbolId (path has no colons)
      const firstColon = pathAndSid.indexOf(':');
      const modulePath = firstColon === -1 ? pathAndSid.split('.') : pathAndSid.slice(0, firstColon).split('.');
      const importSid = firstColon === -1 ? symbolIdStr : pathAndSid.slice(firstColon + 1);
      void importSid;
      imports.push({
        kind: 'ModuleRef',
        modulePath,
        symbolId: makeSymbolId(symbolIdStr),
        span: WIRE_SPAN,
        type: UNIT_TYPE,
      });
      if (this.input.startsWith('; ', this.pos)) this.pos += 2;
      else break;
    }
    this.consumeEol();
    return imports;
  }

  parseDataLine(ctx: DecoderContext): AdtDeclNode[] {
    const data: AdtDeclNode[] = [];
    if (!this.input.startsWith('D ', this.pos)) return data;
    this.pos += 2;
    while (!this.atEol()) {
      // ADT name
      const name = this.parseResolvedName(ctx);
      const variants: AdtVariant[] = [];
      // Collect variants: space then id{ means a variant
      while (this.peek() === ' ') {
        // look ahead: skip space, check if next thing is id immediately followed by {
        const lookahead = this.pos + 1;
        let end = lookahead;
        while (end < this.input.length && this.isIdPart(this.input[end]!)) end++;
        if (end < this.input.length && this.input[end] === '{') {
          this.pos++; // consume space
          const tag = this.parseResolvedName(ctx);
          this.consume('{');
          const fields: Param[] = [];
          if (this.peek() !== '}') {
            fields.push(this.parseParam(ctx));
            while (this.peek() === ',') { this.consume(','); fields.push(this.parseParam(ctx)); }
          }
          this.consume('}');
          variants.push({ tag, symbolId: this.freshSym(), fields, span: WIRE_SPAN });
        } else {
          break;
        }
      }
      data.push({ kind: 'AdtDecl', name, symbolId: this.freshSym(), variants, span: WIRE_SPAN, type: UNIT_TYPE });
      if (this.peek() === ' ') this.pos++;
    }
    this.consumeEol();
    return data;
  }

  parseDeclLine(ctx: DecoderContext): IonIRNode[] {
    const decls: IonIRNode[] = [];
    if (!this.input.startsWith('F ', this.pos)) return decls;
    this.pos += 2;
    while (!this.atEol()) {
      decls.push(this.parseNode(ctx));
      if (this.peek() === ' ') this.pos++;
    }
    this.consumeEol();
    return decls;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Decodes wire-format text produced by encodeModule back to an IonIRModule. */
export function decodeModule(wire: string): IonIRModule {
  const parser = new WireParser(wire);

  parser.parseVersion();
  const { module, version, dialects } = parser.parseModuleLine();

  let symPool = new Map<string, string>();
  let typPool = new Map<string, string>();
  let imports: ModuleRefNode[] = [];
  let data: AdtDeclNode[] = [];
  let decls: IonIRNode[] = [];

  // Parse optional sections in order: S T X D F
  if (parser.input.startsWith('S ', parser.pos)) {
    symPool = parser.parseSymbolLine();
  }
  if (parser.input.startsWith('T ', parser.pos)) {
    typPool = parser.parseTypeLine();
  }
  const ctx: DecoderContext = { symPool, typPool };
  if (parser.input.startsWith('X ', parser.pos)) {
    imports = parser.parseImportLine(ctx);
  }
  if (parser.input.startsWith('D ', parser.pos)) {
    data = parser.parseDataLine(ctx);
  }
  if (parser.input.startsWith('F ', parser.pos)) {
    decls = parser.parseDeclLine(ctx);
  }

  return { ionir: '1.0', module, version, dialects, imports, data, decls };
}
