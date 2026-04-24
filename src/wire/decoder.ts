import type {
  IonIRModule,
  IonIRNode,
  ModuleRefNode,
  AdtDeclNode,
  AdtVariant,
  AdtArm,
  CaseArm,
  CasePattern,
  Param,
  ForeignSignature,
  OopMethod,
  OopMember,
  EffectOp,
  EffectHandler,
  LiteralValue,
} from '../ir/nodes.js';
import type { IonType, EffectSet } from '../ir/types.js';
import type { EffectTag } from '../ast/types.js';
import type { Span } from '../types.js';
import { makeSymbolId } from '../types.js';
import { MAX_ENCODE_DEPTH } from './encoder.js';

/** Thrown internally when wire text is structurally invalid. */
export class WireDecodeError extends Error {
  override readonly name = 'WireDecodeError';
}

// Sentinels for fields absent from the wire format.
const WIRE_SPAN: Span = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const FOREIGN_SIG_PLACEHOLDER: ForeignSignature = { params: [], ret: { kind: 'Unit' }, template: '' };

interface DecoderContext {
  readonly sym: ReadonlyMap<string, string>; // alias → raw name
  readonly typ: ReadonlyMap<string, string>; // alias → type expression string
}

interface Cursor {
  readonly text: string;
  pos: number;
}

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

function peek(cur: Cursor): string | undefined {
  return cur.text[cur.pos];
}

function consume(cur: Cursor, expected: string): void {
  if (cur.text.startsWith(expected, cur.pos)) {
    cur.pos += expected.length;
  } else {
    const got = cur.text.slice(cur.pos, cur.pos + expected.length + 4);
    throw new WireDecodeError(
      `expected ${JSON.stringify(expected)} at pos ${cur.pos}, got ${JSON.stringify(got)}`,
    );
  }
}

function tryConsume(cur: Cursor, s: string): boolean {
  if (cur.text.startsWith(s, cur.pos)) {
    cur.pos += s.length;
    return true;
  }
  return false;
}

function skipSpaces(cur: Cursor): void {
  while (cur.pos < cur.text.length && cur.text[cur.pos] === ' ') cur.pos++;
}

// Characters that terminate an identifier token.
const IDENT_STOP = new Set([
  ' ', '(', ')', '{', '}', '[', ']', ',', ';', ':', '<', '>', '!', '|', '=', '-', '.', '\n', '\r',
]);

function readIdent(cur: Cursor): string {
  const start = cur.pos;
  while (cur.pos < cur.text.length && !IDENT_STOP.has(cur.text[cur.pos]!)) cur.pos++;
  if (cur.pos === start) {
    throw new WireDecodeError(
      `expected identifier at pos ${cur.pos}, got ${JSON.stringify(cur.text[cur.pos])}`,
    );
  }
  return cur.text.slice(start, cur.pos);
}

/** Read until a specific stop character (used for fields that may contain dots). */
function readUntilChar(cur: Cursor, stop: string): string {
  const start = cur.pos;
  while (cur.pos < cur.text.length && cur.text[cur.pos] !== stop) cur.pos++;
  return cur.text.slice(start, cur.pos);
}

function isIdentEnd(ch: string | undefined): boolean {
  return ch === undefined || IDENT_STOP.has(ch);
}

function resolveName(raw: string, ctx: DecoderContext): string {
  return ctx.sym.get(raw) ?? raw;
}

// ---------------------------------------------------------------------------
// Phase 1: split wire text into labelled lines
// ---------------------------------------------------------------------------

interface ParsedLines {
  M: string;
  S?: string;
  T?: string;
  X?: string;
  D?: string;
  F?: string;
}

function parseLines(text: string): ParsedLines | { error: string } {
  const lines = text.split('\n').filter(l => l.length > 0);

  if (lines[0] !== 'I1') {
    return { error: 'not a wire-format file: expected I1 header' };
  }

  let M: string | undefined;
  let S: string | undefined;
  let T: string | undefined;
  let X: string | undefined;
  let D: string | undefined;
  let F: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const letter = line[0]!;
    const rest = line.length > 2 ? line.slice(2) : '';

    switch (letter) {
      case 'M':
        if (M !== undefined) return { error: 'duplicate M line' };
        M = rest;
        break;
      case 'S':
        if (S !== undefined) return { error: 'duplicate S line' };
        S = rest;
        break;
      case 'T':
        if (T !== undefined) return { error: 'duplicate T line' };
        T = rest;
        break;
      case 'X':
        if (X !== undefined) return { error: 'duplicate X line' };
        X = rest;
        break;
      case 'D':
        if (D !== undefined) return { error: 'duplicate D line' };
        D = rest;
        break;
      case 'F':
        if (F !== undefined) return { error: 'duplicate F line' };
        F = rest;
        break;
      default:
        return { error: `unknown section letter: ${JSON.stringify(letter)}` };
    }
  }

  if (M === undefined) return { error: 'missing M line' };

  return {
    M,
    ...(S !== undefined && { S }),
    ...(T !== undefined && { T }),
    ...(X !== undefined && { X }),
    ...(D !== undefined && { D }),
    ...(F !== undefined && { F }),
  };
}

// ---------------------------------------------------------------------------
// Phase 2: module header
// ---------------------------------------------------------------------------

interface ModuleHeader {
  module: string;
  version: string;
  dialects: string[];
}

function parseModuleLine(line: string): ModuleHeader | { error: string } {
  // "<module> v=<version> [d=<dialect1,dialect2>]"
  const parts = line.split(' ');
  if (parts.length < 2) return { error: `malformed M line: ${JSON.stringify(line)}` };

  const module = parts[0]!;
  let version = '';
  const dialects: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith('v=')) {
      version = p.slice(2);
    } else if (p.startsWith('d=')) {
      dialects.push(...p.slice(2).split(',').filter(d => d.length > 0));
    }
  }

  if (!version) return { error: 'M line missing v= field' };

  return { module, version, dialects };
}

// ---------------------------------------------------------------------------
// Phase 3: pool construction (alias → value maps)
// ---------------------------------------------------------------------------

function parsePool(line: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!line.trim()) return map;
  for (const token of line.split(' ')) {
    const eq = token.indexOf('=');
    if (eq < 1) continue;
    map.set(token.slice(0, eq), token.slice(eq + 1));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Phase 4: type expression parser
// ---------------------------------------------------------------------------

function parseType(cur: Cursor, ctx: DecoderContext): IonType {
  if (peek(cur) === '$') {
    cur.pos++;
    const id = readIdent(cur);
    return { kind: 'TypeVar', id };
  }

  const word = readIdent(cur);

  // Resolve type pool alias first.
  const resolved = ctx.typ.get(word);
  if (resolved !== undefined) {
    const sub: Cursor = { text: resolved, pos: 0 };
    return parseType(sub, ctx);
  }

  switch (word) {
    case 'int':   return { kind: 'Int' };
    case 'flt':   return { kind: 'Float' };
    case 'str':   return { kind: 'Str' };
    case 'bool':  return { kind: 'Bool' };
    case 'null':  return { kind: 'Null' };
    case 'unit':  return { kind: 'Unit' };
    case 'never': return { kind: 'Never' };

    case 'list': {
      consume(cur, '<');
      const elem = parseType(cur, ctx);
      consume(cur, '>');
      return { kind: 'List', elem };
    }

    case 'opt': {
      consume(cur, '<');
      const inner = parseType(cur, ctx);
      consume(cur, '>');
      return { kind: 'Option', inner };
    }

    case 'map': {
      consume(cur, '<');
      const key = parseType(cur, ctx);
      consume(cur, ',');
      const value = parseType(cur, ctx);
      consume(cur, '>');
      return { kind: 'Map', key, value };
    }

    case 'res': {
      consume(cur, '<');
      const ok = parseType(cur, ctx);
      consume(cur, ',');
      const errType = parseType(cur, ctx);
      consume(cur, '>');
      return { kind: 'Result', ok, err: errType };
    }

    case 'fn': {
      consume(cur, '(');
      const params: IonType[] = [];
      if (!tryConsume(cur, ')')) {
        params.push(parseType(cur, ctx));
        while (tryConsume(cur, ',')) params.push(parseType(cur, ctx));
        consume(cur, ')');
      }
      consume(cur, '->');
      const ret = parseType(cur, ctx);
      const effects: EffectTag[] = [];
      if (tryConsume(cur, '!')) {
        effects.push(readIdent(cur) as EffectTag);
        while (tryConsume(cur, ',')) effects.push(readIdent(cur) as EffectTag);
      }
      return { kind: 'Fn', params, ret, effects: new Set(effects) as EffectSet };
    }

    default: {
      // User type: name or name<args>
      const name = resolveName(word, ctx);
      if (peek(cur) === '<') {
        cur.pos++;
        const args: IonType[] = [parseType(cur, ctx)];
        while (tryConsume(cur, ',')) args.push(parseType(cur, ctx));
        consume(cur, '>');
        return { kind: 'User', name, symbolId: makeSymbolId(''), args };
      }
      return { kind: 'User', name, symbolId: makeSymbolId(''), args: [] };
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 5: node parser
// ---------------------------------------------------------------------------

function parseParam(cur: Cursor, ctx: DecoderContext): Param {
  const name = resolveName(readIdent(cur), ctx);
  consume(cur, ':');
  const type = parseType(cur, ctx);
  return { name, symbolId: makeSymbolId(''), type, span: WIRE_SPAN };
}

function parseParamList(cur: Cursor, ctx: DecoderContext): Param[] {
  const params: Param[] = [];
  if (peek(cur) === ')') return params;
  params.push(parseParam(cur, ctx));
  while (tryConsume(cur, ',')) params.push(parseParam(cur, ctx));
  return params;
}

function parseLiteral(cur: Cursor): LiteralValue {
  const c = peek(cur);

  // String literal
  if (c === '"') {
    const start = cur.pos;
    cur.pos++;
    while (cur.pos < cur.text.length) {
      const ch = cur.text[cur.pos];
      if (ch === '\\') { cur.pos += 2; }
      else if (ch === '"') { cur.pos++; break; }
      else { cur.pos++; }
    }
    return { kind: 'Str', value: JSON.parse(cur.text.slice(start, cur.pos)) as string };
  }

  // Boolean / Null
  if (cur.text.startsWith('true', cur.pos) && isIdentEnd(cur.text[cur.pos + 4])) {
    cur.pos += 4;
    return { kind: 'Bool', value: true };
  }
  if (cur.text.startsWith('false', cur.pos) && isIdentEnd(cur.text[cur.pos + 5])) {
    cur.pos += 5;
    return { kind: 'Bool', value: false };
  }
  if (cur.text.startsWith('null', cur.pos) && isIdentEnd(cur.text[cur.pos + 4])) {
    cur.pos += 4;
    return { kind: 'Null' };
  }

  // Numeric
  const start = cur.pos;
  if (c === '-') cur.pos++;
  while (cur.pos < cur.text.length && /[0-9]/.test(cur.text[cur.pos]!)) cur.pos++;
  if (cur.pos < cur.text.length && cur.text[cur.pos] === '.') {
    cur.pos++;
    while (cur.pos < cur.text.length && /[0-9]/.test(cur.text[cur.pos]!)) cur.pos++;
    return { kind: 'Float', value: parseFloat(cur.text.slice(start, cur.pos)) };
  }
  return { kind: 'Int', value: parseInt(cur.text.slice(start, cur.pos), 10) };
}

function parseCasePattern(cur: Cursor, ctx: DecoderContext): CasePattern {
  const c = peek(cur);

  if (c === '_' && isIdentEnd(cur.text[cur.pos + 1])) {
    cur.pos++;
    return { kind: 'Wildcard', span: WIRE_SPAN };
  }

  if (c === '"' || (c !== undefined && /[0-9]/.test(c)) || c === '-') {
    return { kind: 'Literal', value: parseLiteral(cur), span: WIRE_SPAN };
  }

  if (cur.text.startsWith('true', cur.pos) && isIdentEnd(cur.text[cur.pos + 4])) {
    return { kind: 'Literal', value: parseLiteral(cur), span: WIRE_SPAN };
  }
  if (cur.text.startsWith('false', cur.pos) && isIdentEnd(cur.text[cur.pos + 5])) {
    return { kind: 'Literal', value: parseLiteral(cur), span: WIRE_SPAN };
  }
  if (cur.text.startsWith('null', cur.pos) && isIdentEnd(cur.text[cur.pos + 4])) {
    return { kind: 'Literal', value: parseLiteral(cur), span: WIRE_SPAN };
  }

  const name = resolveName(readIdent(cur), ctx);
  if (peek(cur) === '(') {
    cur.pos++;
    const fields: CasePattern[] = [];
    if (peek(cur) !== ')') {
      fields.push(parseCasePattern(cur, ctx));
      while (tryConsume(cur, ',')) fields.push(parseCasePattern(cur, ctx));
    }
    consume(cur, ')');
    return { kind: 'Constructor', ctorName: name, symbolId: makeSymbolId(''), fields, span: WIRE_SPAN };
  }
  return { kind: 'Var', name, symbolId: makeSymbolId(''), span: WIRE_SPAN };
}

function parseNodeArgs(cur: Cursor, ctx: DecoderContext, depth: number): IonIRNode[] {
  const args: IonIRNode[] = [];
  if (peek(cur) !== ')') {
    args.push(parseNode(cur, ctx, depth));
    while (tryConsume(cur, ',')) args.push(parseNode(cur, ctx, depth));
  }
  return args;
}

function parseNode(cur: Cursor, ctx: DecoderContext, depth = 0): IonIRNode {
  if (depth > MAX_ENCODE_DEPTH) {
    throw new WireDecodeError('module exceeds maximum encoding depth');
  }

  const c = peek(cur);
  if (c === undefined) throw new WireDecodeError(`unexpected end of input at pos ${cur.pos}`);

  // ── String literal ──────────────────────────────────────────────────────
  if (c === '"') {
    return { kind: 'Literal', value: parseLiteral(cur), span: WIRE_SPAN, type: { kind: 'Str' } };
  }

  // ── Numeric literal (int / float, possibly negative) ────────────────────
  if (c === '-' || /[0-9]/.test(c)) {
    const value = parseLiteral(cur);
    const type: IonType = value.kind === 'Float' ? { kind: 'Float' } : { kind: 'Int' };
    return { kind: 'Literal', value, span: WIRE_SPAN, type };
  }

  // ── Abs: (params)->body ──────────────────────────────────────────────────
  if (c === '(') {
    cur.pos++;
    const params = parseParamList(cur, ctx);
    consume(cur, ')');
    consume(cur, '->');
    const body = parseNode(cur, ctx, depth + 1);
    return { kind: 'Abs', params, body, captures: [], span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── let name:type=value;body ─────────────────────────────────────────────
  if (cur.text.startsWith('let ', cur.pos)) {
    cur.pos += 4;
    const name = resolveName(readIdent(cur), ctx);
    consume(cur, ':');
    const bindingType = parseType(cur, ctx);
    consume(cur, '=');
    const value = parseNode(cur, ctx, depth + 1);
    consume(cur, ';');
    const body = parseNode(cur, ctx, depth + 1);
    return {
      kind: 'Let', name, symbolId: makeSymbolId(''), bindingType, value, body,
      span: WIRE_SPAN, type: { kind: 'Unit' },
    };
  }

  // ── match(scrutinee){arms} ───────────────────────────────────────────────
  if (cur.text.startsWith('match(', cur.pos)) {
    cur.pos += 6;
    const scrutinee = parseNode(cur, ctx, depth + 1);
    consume(cur, ')');
    consume(cur, '{');
    const arms: CaseArm[] = [];
    while (peek(cur) !== '}') {
      const pattern = parseCasePattern(cur, ctx);
      let guard: IonIRNode | undefined;
      if (cur.text.startsWith(' if ', cur.pos)) {
        cur.pos += 4;
        guard = parseNode(cur, ctx, depth + 1);
      }
      consume(cur, '->');
      const body = parseNode(cur, ctx, depth + 1);
      arms.push(guard !== undefined ? { pattern, guard, body, span: WIRE_SPAN } : { pattern, body, span: WIRE_SPAN });
      if (peek(cur) === ';') cur.pos++;
    }
    consume(cur, '}');
    return { kind: 'Case', scrutinee, arms, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── ffi:target:module:symbol ─────────────────────────────────────────────
  if (cur.text.startsWith('ffi:', cur.pos)) {
    cur.pos += 4;
    const target = readUntilChar(cur, ':');
    consume(cur, ':');
    const module = readUntilChar(cur, ':');
    consume(cur, ':');
    const symbol = readIdent(cur);
    return {
      kind: 'ForeignRef', target, module, symbol, sig: FOREIGN_SIG_PLACEHOLDER,
      span: WIRE_SPAN, type: { kind: 'Unit' },
    };
  }

  // ── eff!tag(body) ────────────────────────────────────────────────────────
  if (cur.text.startsWith('eff!', cur.pos)) {
    cur.pos += 4;
    const effectTag = readIdent(cur) as EffectTag;
    consume(cur, '(');
    const body = parseNode(cur, ctx, depth + 1);
    consume(cur, ')');
    return { kind: 'Effect', effectTag, body, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── class name[:superId]{fields}{methods} ────────────────────────────────
  if (cur.text.startsWith('class ', cur.pos)) {
    cur.pos += 6;
    const name = resolveName(readIdent(cur), ctx);
    const superClass = peek(cur) === ':' ? (cur.pos++, makeSymbolId(readIdent(cur))) : undefined;
    consume(cur, '{');
    const fields: Param[] = [];
    if (peek(cur) !== '}') {
      fields.push(parseParam(cur, ctx));
      while (tryConsume(cur, ',')) fields.push(parseParam(cur, ctx));
    }
    consume(cur, '}');
    consume(cur, '{');
    const methods: OopMethod[] = [];
    while (peek(cur) !== '}') {
      const mName = resolveName(readIdent(cur), ctx);
      consume(cur, '(');
      const mParams = parseParamList(cur, ctx);
      consume(cur, ')');
      consume(cur, '->');
      const retType = parseType(cur, ctx);
      consume(cur, '{');
      const body: IonIRNode | undefined = peek(cur) !== '}' ? parseNode(cur, ctx, depth + 1) : undefined;
      consume(cur, '}');
      const baseMethod = { name: mName, symbolId: makeSymbolId(''), params: mParams, retType, isAbstract: false, isStatic: false, span: WIRE_SPAN };
      methods.push(body !== undefined ? { ...baseMethod, body } : baseMethod);
      if (peek(cur) === ';') cur.pos++;
    }
    consume(cur, '}');
    const baseClass = { kind: 'OopClass' as const, name, symbolId: makeSymbolId(''), interfaces: [] as readonly import('../types.js').SymbolId[], fields, methods, span: WIRE_SPAN, type: { kind: 'Unit' as const } };
    return superClass !== undefined ? { ...baseClass, superClass } : baseClass;
  }

  // ── iface name{members} ──────────────────────────────────────────────────
  if (cur.text.startsWith('iface ', cur.pos)) {
    cur.pos += 6;
    const name = resolveName(readIdent(cur), ctx);
    consume(cur, '{');
    const members: OopMember[] = [];
    if (peek(cur) !== '}') {
      do {
        const mName = resolveName(readIdent(cur), ctx);
        consume(cur, ':');
        const type = parseType(cur, ctx);
        members.push({ name: mName, symbolId: makeSymbolId(''), type, span: WIRE_SPAN });
      } while (tryConsume(cur, ','));
    }
    consume(cur, '}');
    return { kind: 'OopInterface', name, symbolId: makeSymbolId(''), members, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── new ctorSymbolId(args) ───────────────────────────────────────────────
  if (cur.text.startsWith('new ', cur.pos)) {
    cur.pos += 4;
    const ctorSymbolId = makeSymbolId(readIdent(cur));
    consume(cur, '(');
    const args = parseNodeArgs(cur, ctx, depth + 1);
    consume(cur, ')');
    return { kind: 'OopNew', ctorSymbolId, args, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── this ──────────────────────────────────────────────────────────────────
  if (cur.text.startsWith('this', cur.pos) && isIdentEnd(cur.text[cur.pos + 4])) {
    cur.pos += 4;
    return { kind: 'OopThis', span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── async{body} ───────────────────────────────────────────────────────────
  if (cur.text.startsWith('async{', cur.pos)) {
    cur.pos += 6;
    const body = parseNode(cur, ctx, depth + 1);
    consume(cur, '}');
    return { kind: 'AsyncBlock', body, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── await(expr) ──────────────────────────────────────────────────────────
  if (cur.text.startsWith('await(', cur.pos)) {
    cur.pos += 6;
    const expr = parseNode(cur, ctx, depth + 1);
    consume(cur, ')');
    return { kind: 'Await', expr, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── adt name{tag(fields)|...} ────────────────────────────────────────────
  if (cur.text.startsWith('adt ', cur.pos)) {
    cur.pos += 4;
    const name = resolveName(readIdent(cur), ctx);
    consume(cur, '{');
    const variants: AdtVariant[] = [];
    if (peek(cur) !== '}') {
      do {
        const tag = resolveName(readIdent(cur), ctx);
        consume(cur, '(');
        const fields = parseParamList(cur, ctx);
        consume(cur, ')');
        variants.push({ tag, symbolId: makeSymbolId(''), fields, span: WIRE_SPAN });
      } while (tryConsume(cur, '|'));
    }
    consume(cur, '}');
    return { kind: 'AdtDecl', name, symbolId: makeSymbolId(''), variants, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── adt(scrutinee){arms} ─────────────────────────────────────────────────
  if (cur.text.startsWith('adt(', cur.pos)) {
    cur.pos += 4;
    const scrutinee = parseNode(cur, ctx, depth + 1);
    consume(cur, ')');
    consume(cur, '{');
    const arms: AdtArm[] = [];
    while (peek(cur) !== '}') {
      const tag = resolveName(readIdent(cur), ctx);
      consume(cur, '(');
      const bindings = parseParamList(cur, ctx);
      consume(cur, ')');
      consume(cur, '->');
      const body = parseNode(cur, ctx, depth + 1);
      arms.push({ tag, bindings, body, span: WIRE_SPAN });
      if (peek(cur) === ';') cur.pos++;
    }
    consume(cur, '}');
    return { kind: 'AdtMatch', scrutinee, arms, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── effect name{ops} ─────────────────────────────────────────────────────
  if (cur.text.startsWith('effect ', cur.pos)) {
    cur.pos += 7;
    const name = resolveName(readIdent(cur), ctx);
    consume(cur, '{');
    const operations: EffectOp[] = [];
    while (peek(cur) !== '}') {
      const opName = resolveName(readIdent(cur), ctx);
      consume(cur, '(');
      const opParams = parseParamList(cur, ctx);
      consume(cur, ')');
      consume(cur, '->');
      const retType = parseType(cur, ctx);
      operations.push({ name: opName, params: opParams, retType, span: WIRE_SPAN });
      if (peek(cur) === ';') cur.pos++;
    }
    consume(cur, '}');
    return { kind: 'EffectDecl', name, symbolId: makeSymbolId(''), operations, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── perf!effectSymId:operation(args) ─────────────────────────────────────
  if (cur.text.startsWith('perf!', cur.pos)) {
    cur.pos += 5;
    // effectSymbolId may contain colons; the last ':' separates it from operation
    const start = cur.pos;
    while (cur.pos < cur.text.length && cur.text[cur.pos] !== '(') cur.pos++;
    const combined = cur.text.slice(start, cur.pos);
    const lastColon = combined.lastIndexOf(':');
    if (lastColon < 0) throw new WireDecodeError(`malformed perf! node at pos ${start}`);
    const effectSymbolId = makeSymbolId(combined.slice(0, lastColon));
    const operation = resolveName(combined.slice(lastColon + 1), ctx);
    consume(cur, '(');
    const args = parseNodeArgs(cur, ctx, depth + 1);
    consume(cur, ')');
    return { kind: 'Perform', effectSymbolId, operation, args, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── handle(body){handlers}[;ret:returnClause] ────────────────────────────
  if (cur.text.startsWith('handle(', cur.pos)) {
    cur.pos += 7;
    const body = parseNode(cur, ctx, depth + 1);
    consume(cur, ')');
    consume(cur, '{');
    const handlers: EffectHandler[] = [];
    while (peek(cur) !== '}') {
      const operation = resolveName(readIdent(cur), ctx);
      consume(cur, '(');
      const hParams = parseParamList(cur, ctx);
      consume(cur, ')');
      consume(cur, '->');
      const hBody = parseNode(cur, ctx, depth + 1);
      handlers.push({ operation, params: hParams, body: hBody, span: WIRE_SPAN });
      if (peek(cur) === ';') cur.pos++;
    }
    consume(cur, '}');
    let returnClause: IonIRNode | undefined;
    if (cur.text.startsWith(';ret:', cur.pos)) {
      cur.pos += 5;
      returnClause = parseNode(cur, ctx, depth + 1);
    }
    const baseHandle = { kind: 'Handle' as const, body, handlers, span: WIRE_SPAN, type: { kind: 'Unit' as const } };
    return returnClause !== undefined ? { ...baseHandle, returnClause } : baseHandle;
  }

  // ── resume(value) ────────────────────────────────────────────────────────
  if (cur.text.startsWith('resume(', cur.pos)) {
    cur.pos += 7;
    const value = parseNode(cur, ctx, depth + 1);
    consume(cur, ')');
    return { kind: 'Resume', value, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // ── Boolean / Null literals (as nodes) ──────────────────────────────────
  if (cur.text.startsWith('true', cur.pos) && isIdentEnd(cur.text[cur.pos + 4])) {
    cur.pos += 4;
    return { kind: 'Literal', value: { kind: 'Bool', value: true }, span: WIRE_SPAN, type: { kind: 'Bool' } };
  }
  if (cur.text.startsWith('false', cur.pos) && isIdentEnd(cur.text[cur.pos + 5])) {
    cur.pos += 5;
    return { kind: 'Literal', value: { kind: 'Bool', value: false }, span: WIRE_SPAN, type: { kind: 'Bool' } };
  }
  if (cur.text.startsWith('null', cur.pos) && isIdentEnd(cur.text[cur.pos + 4])) {
    cur.pos += 4;
    return { kind: 'Literal', value: { kind: 'Null' }, span: WIRE_SPAN, type: { kind: 'Null' } };
  }

  // ── Identifier-dispatched: Var / App / Accessor / ModuleRef / OopVirtualCall
  const rawId = readIdent(cur);
  const next = peek(cur);

  // App: name(args)
  if (next === '(') {
    cur.pos++;
    const callee: IonIRNode = {
      kind: 'Var', name: resolveName(rawId, ctx), symbolId: makeSymbolId(''), span: WIRE_SPAN, type: { kind: 'Unit' },
    };
    const args = parseNodeArgs(cur, ctx, depth + 1);
    consume(cur, ')');
    return { kind: 'App', callee, args, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // Accessor or ModuleRef: name.name... or name.name::symbolId
  if (next === '.') {
    const segments = [rawId];
    while (peek(cur) === '.') {
      cur.pos++;
      segments.push(readIdent(cur));
    }
    // ModuleRef: path::symbolId
    if (peek(cur) === ':' && cur.text[cur.pos + 1] === ':') {
      cur.pos += 2;
      const symIdStr = readIdent(cur);
      return {
        kind: 'ModuleRef',
        modulePath: segments.map(s => resolveName(s, ctx)),
        symbolId: makeSymbolId(symIdStr),
        span: WIRE_SPAN,
        type: { kind: 'Unit' },
      };
    }
    // Accessor chain: fold left — [a, b, c] → Accessor(Accessor(Var(a), b), c)
    let receiver: IonIRNode = {
      kind: 'Var', name: resolveName(segments[0]!, ctx), symbolId: makeSymbolId(''), span: WIRE_SPAN, type: { kind: 'Unit' },
    };
    for (let i = 1; i < segments.length - 1; i++) {
      receiver = { kind: 'Accessor', receiver, member: resolveName(segments[i]!, ctx), span: WIRE_SPAN, type: { kind: 'Unit' } };
    }
    return {
      kind: 'Accessor',
      receiver,
      member: resolveName(segments[segments.length - 1]!, ctx),
      span: WIRE_SPAN,
      type: { kind: 'Unit' },
    };
  }

  // OopVirtualCall: receiver->method(args)
  if (next === '-' && cur.text[cur.pos + 1] === '>') {
    cur.pos += 2;
    const method = resolveName(readIdent(cur), ctx);
    const receiver: IonIRNode = {
      kind: 'Var', name: resolveName(rawId, ctx), symbolId: makeSymbolId(''), span: WIRE_SPAN, type: { kind: 'Unit' },
    };
    consume(cur, '(');
    const args = parseNodeArgs(cur, ctx, depth + 1);
    consume(cur, ')');
    return { kind: 'OopVirtualCall', receiver, method, args, span: WIRE_SPAN, type: { kind: 'Unit' } };
  }

  // Var
  return { kind: 'Var', name: resolveName(rawId, ctx), symbolId: makeSymbolId(''), span: WIRE_SPAN, type: { kind: 'Unit' } };
}

// ---------------------------------------------------------------------------
// Phase 6: section parsers
// ---------------------------------------------------------------------------

function parseSectionX(content: string, ctx: DecoderContext): ModuleRefNode[] {
  if (!content.trim()) return [];
  return content.split('; ').map(part => {
    // "import <symbolId> from <modulePath>:<symbolId>"
    const tokens = part.trim().split(' ');
    if (tokens.length < 4 || tokens[0] !== 'import' || tokens[2] !== 'from') {
      throw new WireDecodeError(`malformed import: ${JSON.stringify(part)}`);
    }
    const symbolIdStr = tokens[1]!;
    const fromPart = tokens[3]!;
    // modPath is fromPart minus the trailing ":${symbolIdStr}"
    const suffix = `:${symbolIdStr}`;
    const modPathStr = fromPart.endsWith(suffix)
      ? fromPart.slice(0, fromPart.length - suffix.length)
      : fromPart;
    const modulePath = modPathStr.split('.').map(s => resolveName(s, ctx));
    return {
      kind: 'ModuleRef' as const,
      modulePath,
      symbolId: makeSymbolId(symbolIdStr),
      span: WIRE_SPAN,
      type: { kind: 'Unit' as const },
    };
  });
}

function parseSectionD(content: string, ctx: DecoderContext): AdtDeclNode[] {
  if (!content.trim()) return [];
  const cur: Cursor = { text: content, pos: 0 };
  const result: AdtDeclNode[] = [];

  while (cur.pos < cur.text.length) {
    skipSpaces(cur);
    if (cur.pos >= cur.text.length) break;

    const name = resolveName(readIdent(cur), ctx);
    const variants: AdtVariant[] = [];

    // Variants in D section: "tag{fields}" (curly braces, not parens)
    while (cur.pos < cur.text.length) {
      const savedPos = cur.pos;
      if (peek(cur) === ' ') cur.pos++;

      const identStart = cur.pos;
      let tag: string;
      try {
        tag = readIdent(cur);
      } catch {
        cur.pos = savedPos;
        break;
      }

      if (peek(cur) === '{') {
        cur.pos++;
        const fields: Param[] = [];
        if (peek(cur) !== '}') {
          fields.push(parseParam(cur, ctx));
          while (tryConsume(cur, ',')) fields.push(parseParam(cur, ctx));
        }
        consume(cur, '}');
        variants.push({ tag: resolveName(tag, ctx), symbolId: makeSymbolId(''), fields, span: WIRE_SPAN });
      } else {
        // Not a variant — backtrack: this identifier is the next ADT name.
        cur.pos = savedPos;
        break;
      }
      void identStart; // silence unused warning
    }

    result.push({
      kind: 'AdtDecl',
      name,
      symbolId: makeSymbolId(''),
      variants,
      span: WIRE_SPAN,
      type: { kind: 'Unit' },
    });
  }

  return result;
}

function parseSectionF(content: string, ctx: DecoderContext): IonIRNode[] {
  const cur: Cursor = { text: content, pos: 0 };
  const result: IonIRNode[] = [];
  while (cur.pos < cur.text.length) {
    skipSpaces(cur);
    if (cur.pos >= cur.text.length) break;
    result.push(parseNode(cur, ctx));
    // Single space separates top-level decls in the F section.
    if (peek(cur) === ' ') cur.pos++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decodes a wire-format text string into an IonIRModule.
 * Returns `{ error: string }` on any parse failure. Never throws.
 */
export function decodeModule(wireText: string): IonIRModule | { error: string } {
  try {
    const lines = parseLines(wireText);
    if ('error' in lines) return lines;

    const header = parseModuleLine(lines.M);
    if ('error' in header) return header;

    const symPool = lines.S !== undefined ? parsePool(lines.S) : new Map<string, string>();
    const typPool = lines.T !== undefined ? parsePool(lines.T) : new Map<string, string>();
    const ctx: DecoderContext = { sym: symPool, typ: typPool };

    const imports = lines.X !== undefined ? parseSectionX(lines.X, ctx) : [];
    const data = lines.D !== undefined ? parseSectionD(lines.D, ctx) : [];
    const decls = lines.F !== undefined ? parseSectionF(lines.F, ctx) : [];

    const mod: IonIRModule = {
      ionir: '1.0',
      module: header.module,
      version: header.version,
      // Dialect strings from the wire format are trusted to be valid IonIRDialect values.
      dialects: header.dialects as IonIRModule['dialects'],
      imports,
      data,
      decls,
    };

    return mod;
  } catch (e) {
    if (e instanceof WireDecodeError) return { error: e.message };
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
