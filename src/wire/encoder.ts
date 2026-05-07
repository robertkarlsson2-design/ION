import type {
  IonIRModule,
  IonIRNode,
  ModuleRefNode,
  AdtDeclNode,
  CasePattern,
  LiteralValue,
  Param,
} from '../ir/nodes.js';
import type { IonType } from '../ir/types.js';

/** Maximum allowed nesting depth for encoder traversals. */
export const MAX_ENCODE_DEPTH = 100;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type Alias = string;

interface NameRecord {
  count: number;
  firstPos: number;
}

interface PoolEntry {
  alias: Alias;
  value: string;
}

interface SymbolPool {
  readonly toAlias: ReadonlyMap<string, Alias>;
  readonly entries: ReadonlyArray<PoolEntry>;
}

interface TypePool {
  readonly toAlias: ReadonlyMap<string, Alias>;
  readonly entries: ReadonlyArray<PoolEntry>;
}

interface LiteralPool {
  readonly toAlias: ReadonlyMap<string, Alias>;
  readonly entries: ReadonlyArray<PoolEntry>;
}

interface EncoderContext {
  readonly sym: SymbolPool;
  readonly typ: TypePool;
  readonly lit: LiteralPool;
}

function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Thrown by encodeModule when an identifier name contains illegal control characters. */
export class WireEncodeError extends Error {
  override readonly name = 'WireEncodeError';
}

function assertValidName(name: string): void {
  if (/[\x00-\x1F]/.test(name)) {
    throw new WireEncodeError(
      `Identifier name contains illegal control character: ${JSON.stringify(name)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 1a: name collection
// ---------------------------------------------------------------------------

class NameCollector {
  private readonly names = new Map<string, NameRecord>();
  private pos = 0;

  record(name: string): void {
    const existing = this.names.get(name);
    if (existing !== undefined) {
      existing.count++;
    } else {
      this.names.set(name, { count: 1, firstPos: this.pos++ });
    }
  }

  result(): Map<string, NameRecord> {
    return this.names;
  }
}

function collectNamesFromType(t: IonType, c: NameCollector, depth = 0): void {
  if (depth > MAX_ENCODE_DEPTH)
    throw new WireEncodeError(`module exceeds maximum encoding depth`);
  switch (t.kind) {
    case 'Int':
    case 'Float':
    case 'Str':
    case 'Bool':
    case 'Null':
    case 'Unit':
    case 'Never':
      break;
    case 'TypeVar':
      c.record(t.id);
      break;
    case 'List':
      collectNamesFromType(t.elem, c, depth + 1);
      break;
    case 'Option':
      collectNamesFromType(t.inner, c, depth + 1);
      break;
    case 'Map':
      collectNamesFromType(t.key, c, depth + 1);
      collectNamesFromType(t.value, c, depth + 1);
      break;
    case 'Result':
      collectNamesFromType(t.ok, c, depth + 1);
      collectNamesFromType(t.err, c, depth + 1);
      break;
    case 'Fn':
      for (const p of t.params) collectNamesFromType(p, c, depth + 1);
      collectNamesFromType(t.ret, c, depth + 1);
      for (const tag of t.effects) c.record(tag);
      break;
    case 'User':
      c.record(t.name);
      for (const a of t.args) collectNamesFromType(a, c, depth + 1);
      break;
    case 'Tuple':
      for (const e of t.elements) collectNamesFromType(e, c, depth + 1);
      break;
    default:
      assertNever(t);
  }
}

function collectNamesFromPattern(p: CasePattern, c: NameCollector, depth = 0): void {
  if (depth > MAX_ENCODE_DEPTH)
    throw new WireEncodeError(`module exceeds maximum encoding depth`);
  switch (p.kind) {
    case 'Wildcard':
    case 'Literal':
      break;
    case 'Var':
      c.record(p.name);
      break;
    case 'Constructor':
      c.record(p.ctorName);
      for (const f of (p.fields ?? [])) collectNamesFromPattern(f, c, depth + 1);
      break;
    case 'Tuple':
      for (const f of p.fields) collectNamesFromPattern(f, c, depth + 1);
      break;
    default:
      assertNever(p);
  }
}

function collectNamesFromNode(node: IonIRNode, c: NameCollector, depth = 0): void {
  if (depth > MAX_ENCODE_DEPTH)
    throw new WireEncodeError(`module exceeds maximum encoding depth`);
  collectNamesFromType(node.type, c, depth);

  switch (node.kind) {
    case 'Var':
      c.record(node.name);
      break;
    case 'Literal':
      break;
    case 'App':
      collectNamesFromNode(node.callee, c, depth + 1);
      for (const a of node.args) collectNamesFromNode(a, c, depth + 1);
      break;
    case 'Abs':
      for (const p of node.params) {
        c.record(p.name);
        collectNamesFromType(p.type, c, depth + 1);
      }
      collectNamesFromNode(node.body, c, depth + 1);
      break;
    case 'Let':
      c.record(node.name);
      collectNamesFromType(node.bindingType, c, depth + 1);
      collectNamesFromNode(node.value, c, depth + 1);
      collectNamesFromNode(node.body, c, depth + 1);
      break;
    case 'Case':
      collectNamesFromNode(node.scrutinee, c, depth + 1);
      for (const arm of node.arms) {
        collectNamesFromPattern(arm.pattern, c, depth + 1);
        if (arm.guard !== undefined) collectNamesFromNode(arm.guard, c, depth + 1);
        collectNamesFromNode(arm.body, c, depth + 1);
      }
      break;
    case 'Constructor':
      c.record(node.ctorName);
      for (const a of node.args) collectNamesFromNode(a, c, depth + 1);
      break;
    case 'Accessor':
      collectNamesFromNode(node.receiver, c, depth + 1);
      c.record(node.member);
      break;
    case 'ModuleRef':
      for (const p of node.modulePath) c.record(p);
      break;
    case 'ForeignRef':
      c.record(node.target);
      c.record(node.module);
      c.record(node.symbol);
      break;
    case 'Effect':
      c.record(node.effectTag);
      collectNamesFromNode(node.body, c, depth + 1);
      break;
    case 'OopClass':
      c.record(node.name);
      for (const tp of (node.typeParams ?? [])) c.record(tp);
      for (const anno of (node.annotations ?? [])) c.record(anno.name);
      for (const f of node.fields) {
        c.record(f.name);
        collectNamesFromType(f.type, c, depth + 1);
      }
      for (const m of node.methods) {
        c.record(m.name);
        for (const anno of (m.annotations ?? [])) c.record(anno.name);
        for (const p of m.params) {
          c.record(p.name);
          collectNamesFromType(p.type, c, depth + 1);
        }
        collectNamesFromType(m.retType, c, depth + 1);
        if (m.body !== undefined) collectNamesFromNode(m.body, c, depth + 1);
      }
      for (const ctor of (node.constructors ?? [])) {
        for (const p of ctor.params) {
          c.record(p.name);
          collectNamesFromType(p.type, c, depth + 1);
        }
        if (ctor.body !== undefined) collectNamesFromNode(ctor.body, c, depth + 1);
      }
      break;
    case 'OopInterface':
      c.record(node.name);
      for (const tp of (node.typeParams ?? [])) c.record(tp);
      for (const anno of (node.annotations ?? [])) c.record(anno.name);
      for (const mem of node.members) {
        c.record(mem.name);
        collectNamesFromType(mem.type, c, depth + 1);
      }
      break;
    case 'OopNew':
      for (const a of node.args) collectNamesFromNode(a, c, depth + 1);
      break;
    case 'OopVirtualCall':
      collectNamesFromNode(node.receiver, c, depth + 1);
      c.record(node.method);
      for (const a of node.args) collectNamesFromNode(a, c, depth + 1);
      break;
    case 'OopThis':
      break;
    case 'AsyncBlock':
      collectNamesFromNode(node.body, c, depth + 1);
      break;
    case 'Await':
      collectNamesFromNode(node.expr, c, depth + 1);
      break;
    case 'AdtDecl':
      c.record(node.name);
      for (const v of node.variants) {
        c.record(v.tag);
        for (const f of v.fields) {
          c.record(f.name);
          collectNamesFromType(f.type, c, depth + 1);
        }
      }
      break;
    case 'AdtMatch':
      collectNamesFromNode(node.scrutinee, c, depth + 1);
      for (const arm of node.arms) {
        c.record(arm.tag);
        for (const b of (arm.bindings ?? [])) {
          c.record(b.name);
          collectNamesFromType(b.type, c, depth + 1);
        }
        collectNamesFromNode(arm.body, c, depth + 1);
      }
      break;
    case 'EffectDecl':
      c.record(node.name);
      for (const op of node.operations) {
        c.record(op.name);
        for (const p of op.params) {
          c.record(p.name);
          collectNamesFromType(p.type, c, depth + 1);
        }
        collectNamesFromType(op.retType, c, depth + 1);
      }
      break;
    case 'Perform':
      c.record(node.operation);
      for (const a of node.args) collectNamesFromNode(a, c, depth + 1);
      break;
    case 'Handle':
      collectNamesFromNode(node.body, c, depth + 1);
      for (const h of node.handlers) {
        c.record(h.operation);
        for (const p of h.params) {
          c.record(p.name);
          collectNamesFromType(p.type, c, depth + 1);
        }
        collectNamesFromNode(h.body, c, depth + 1);
      }
      if (node.returnClause !== undefined) collectNamesFromNode(node.returnClause, c, depth + 1);
      break;
    case 'Resume':
      collectNamesFromNode(node.value, c, depth + 1);
      break;
    case 'ListLit':
      for (const el of node.elements) collectNamesFromNode(el, c, depth + 1);
      break;
    case 'MapLit':
      for (const e of node.entries) { collectNamesFromNode(e.key, c, depth + 1); collectNamesFromNode(e.value, c, depth + 1); }
      break;
    case 'RawInject':
      break;
    default:
      assertNever(node);
  }
}

/** Walks the IR collecting all string literal values from expression nodes (NOT from
 *  case patterns, which the decoder reads via parseLiteral without pool resolution).
 *  Records first-encounter position for stable ordering. */
class StrLitCollector {
  private map = new Map<string, { count: number; firstPos: number }>();
  private pos = 0;
  record(v: string): void {
    const existing = this.map.get(v);
    if (existing) existing.count++;
    else this.map.set(v, { count: 1, firstPos: this.pos++ });
  }
  result(): Map<string, { count: number; firstPos: number }> { return this.map; }
}

function collectStrLitsFromNode(node: IonIRNode, c: StrLitCollector, depth = 0): void {
  if (depth > MAX_ENCODE_DEPTH) return;
  switch (node.kind) {
    case 'Literal':
      if (node.value.kind === 'Str') c.record(node.value.value);
      break;
    case 'App':
      collectStrLitsFromNode(node.callee, c, depth + 1);
      for (const a of node.args) collectStrLitsFromNode(a, c, depth + 1);
      break;
    case 'Abs':
      collectStrLitsFromNode(node.body, c, depth + 1);
      break;
    case 'Let':
      collectStrLitsFromNode(node.value, c, depth + 1);
      collectStrLitsFromNode(node.body, c, depth + 1);
      break;
    case 'Case':
      collectStrLitsFromNode(node.scrutinee, c, depth + 1);
      for (const arm of node.arms) {
        // Pattern literals are NOT decoder-pool-aware; skip them.
        if (arm.guard !== undefined) collectStrLitsFromNode(arm.guard, c, depth + 1);
        collectStrLitsFromNode(arm.body, c, depth + 1);
      }
      break;
    case 'Constructor':
      for (const a of node.args) collectStrLitsFromNode(a, c, depth + 1);
      break;
    case 'Accessor':
      collectStrLitsFromNode(node.receiver, c, depth + 1);
      break;
    case 'Effect':
      collectStrLitsFromNode(node.body, c, depth + 1);
      break;
    case 'OopClass':
      for (const m of node.methods) {
        if (m.body !== undefined) collectStrLitsFromNode(m.body, c, depth + 1);
      }
      for (const ctor of (node.constructors ?? [])) {
        if (ctor.body !== undefined) collectStrLitsFromNode(ctor.body, c, depth + 1);
      }
      break;
    case 'OopNew':
      for (const a of node.args) collectStrLitsFromNode(a, c, depth + 1);
      break;
    case 'OopVirtualCall':
      collectStrLitsFromNode(node.receiver, c, depth + 1);
      for (const a of node.args) collectStrLitsFromNode(a, c, depth + 1);
      break;
    case 'AsyncBlock':
      collectStrLitsFromNode(node.body, c, depth + 1);
      break;
    case 'Await':
      collectStrLitsFromNode(node.expr, c, depth + 1);
      break;
    case 'AdtMatch':
      collectStrLitsFromNode(node.scrutinee, c, depth + 1);
      for (const arm of node.arms) collectStrLitsFromNode(arm.body, c, depth + 1);
      break;
    case 'Perform':
      for (const a of node.args) collectStrLitsFromNode(a, c, depth + 1);
      break;
    case 'Handle':
      collectStrLitsFromNode(node.body, c, depth + 1);
      for (const h of node.handlers) collectStrLitsFromNode(h.body, c, depth + 1);
      if (node.returnClause !== undefined) collectStrLitsFromNode(node.returnClause, c, depth + 1);
      break;
    case 'Resume':
      collectStrLitsFromNode(node.value, c, depth + 1);
      break;
    case 'ListLit':
      for (const el of node.elements) collectStrLitsFromNode(el, c, depth + 1);
      break;
    case 'MapLit':
      for (const e of node.entries) {
        collectStrLitsFromNode(e.key, c, depth + 1);
        collectStrLitsFromNode(e.value, c, depth + 1);
      }
      break;
    // Var, ModuleRef, ForeignRef, OopThis, OopInterface, AdtDecl, EffectDecl, RawInject: no string literals to collect
    default: break;
  }
}

function collectStrLits(module: IonIRModule): Map<string, { count: number; firstPos: number }> {
  const c = new StrLitCollector();
  for (const d of module.data) collectStrLitsFromNode(d, c);
  for (const decl of module.decls) collectStrLitsFromNode(decl, c);
  return c.result();
}

/** Depth-first traversal; records occurrence count and first-encounter position for every name. */
function collectNames(module: IonIRModule): Map<string, NameRecord> {
  const c = new NameCollector();
  for (const imp of module.imports) {
    for (const p of imp.modulePath) c.record(p);
    collectNamesFromType(imp.type, c);
  }
  for (const d of module.data) collectNamesFromNode(d, c);
  for (const decl of module.decls) collectNamesFromNode(decl, c);
  return c.result();
}

// ---------------------------------------------------------------------------
// Phase 1b: raw type serialisation (no pool lookup — used for pool keys)
// ---------------------------------------------------------------------------

/** Serialises an IonType to its canonical wire string without pool aliasing. */
function serializeTypeRaw(t: IonType, depth = 0): string {
  if (depth > MAX_ENCODE_DEPTH)
    throw new WireEncodeError(`module exceeds maximum encoding depth`);
  switch (t.kind) {
    case 'Int':   return 'int';
    case 'Float': return 'flt';
    case 'Str':   return 'str';
    case 'Bool':  return 'bool';
    case 'Null':  return 'null';
    case 'Unit':  return 'unit';
    case 'Never': return 'never';
    case 'TypeVar': return `$${t.id}`;
    case 'List':  return `list<${serializeTypeRaw(t.elem, depth + 1)}>`;
    case 'Option': return `opt<${serializeTypeRaw(t.inner, depth + 1)}>`;
    case 'Map':   return `map<${serializeTypeRaw(t.key, depth + 1)},${serializeTypeRaw(t.value, depth + 1)}>`;
    case 'Result': return `res<${serializeTypeRaw(t.ok, depth + 1)},${serializeTypeRaw(t.err, depth + 1)}>`;
    case 'Fn': {
      const params = t.params.map(p => serializeTypeRaw(p, depth + 1)).join(',');
      const effects = t.effects.size > 0 ? '!' + [...t.effects].sort().join(',') : '';
      return `fn(${params})->${serializeTypeRaw(t.ret, depth + 1)}${effects}`;
    }
    case 'User':
      return t.args.length === 0
        ? t.name
        : `${t.name}<${t.args.map(a => serializeTypeRaw(a, depth + 1)).join(',')}>`;
    case 'Tuple':
      return `tup<${t.elements.map(e => serializeTypeRaw(e, depth + 1)).join(',')}>`;
    default:
      return assertNever(t);
  }
}

function isPrimitiveType(t: IonType): boolean {
  return (
    t.kind === 'Int' || t.kind === 'Float' || t.kind === 'Str' ||
    t.kind === 'Bool' || t.kind === 'Null' || t.kind === 'Unit' ||
    t.kind === 'Never' || t.kind === 'TypeVar'
  );
}

// ---------------------------------------------------------------------------
// Phase 1c: type expression collection
// ---------------------------------------------------------------------------

function collectTypesFromType(t: IonType, out: Map<string, number>, depth = 0): void {
  if (depth > MAX_ENCODE_DEPTH)
    throw new WireEncodeError(`module exceeds maximum encoding depth`);
  if (!isPrimitiveType(t)) {
    const expr = serializeTypeRaw(t, depth);
    out.set(expr, (out.get(expr) ?? 0) + 1);
  }
  switch (t.kind) {
    case 'Int': case 'Float': case 'Str': case 'Bool':
    case 'Null': case 'Unit': case 'Never': case 'TypeVar':
      break;
    case 'List':   collectTypesFromType(t.elem, out, depth + 1); break;
    case 'Option': collectTypesFromType(t.inner, out, depth + 1); break;
    case 'Map':
      collectTypesFromType(t.key, out, depth + 1);
      collectTypesFromType(t.value, out, depth + 1);
      break;
    case 'Result':
      collectTypesFromType(t.ok, out, depth + 1);
      collectTypesFromType(t.err, out, depth + 1);
      break;
    case 'Fn':
      for (const p of t.params) collectTypesFromType(p, out, depth + 1);
      collectTypesFromType(t.ret, out, depth + 1);
      break;
    case 'User':
      for (const a of t.args) collectTypesFromType(a, out, depth + 1);
      break;
    case 'Tuple':
      for (const e of t.elements) collectTypesFromType(e, out, depth + 1);
      break;
    default:
      assertNever(t);
  }
}

function collectTypesFromNode(node: IonIRNode, out: Map<string, number>, depth = 0): void {
  if (depth > MAX_ENCODE_DEPTH)
    throw new WireEncodeError(`module exceeds maximum encoding depth`);
  collectTypesFromType(node.type, out, depth);
  switch (node.kind) {
    case 'Var': case 'Literal': case 'ModuleRef': case 'OopThis': break;
    case 'App':
      collectTypesFromNode(node.callee, out, depth + 1);
      for (const a of node.args) collectTypesFromNode(a, out, depth + 1);
      break;
    case 'Abs':
      for (const p of node.params) collectTypesFromType(p.type, out, depth + 1);
      collectTypesFromNode(node.body, out, depth + 1);
      break;
    case 'Let':
      collectTypesFromType(node.bindingType, out, depth + 1);
      collectTypesFromNode(node.value, out, depth + 1);
      collectTypesFromNode(node.body, out, depth + 1);
      break;
    case 'Case':
      collectTypesFromNode(node.scrutinee, out, depth + 1);
      for (const arm of node.arms) {
        if (arm.guard !== undefined) collectTypesFromNode(arm.guard, out, depth + 1);
        collectTypesFromNode(arm.body, out, depth + 1);
      }
      break;
    case 'Constructor':
      for (const a of node.args) collectTypesFromNode(a, out, depth + 1);
      break;
    case 'Accessor': collectTypesFromNode(node.receiver, out, depth + 1); break;
    case 'ForeignRef':
      for (const p of node.sig.params) collectTypesFromType(p, out, depth + 1);
      collectTypesFromType(node.sig.ret, out, depth + 1);
      break;
    case 'Effect': collectTypesFromNode(node.body, out, depth + 1); break;
    case 'OopClass':
      for (const f of node.fields) collectTypesFromType(f.type, out, depth + 1);
      for (const m of node.methods) {
        for (const p of m.params) collectTypesFromType(p.type, out, depth + 1);
        collectTypesFromType(m.retType, out, depth + 1);
        if (m.body !== undefined) collectTypesFromNode(m.body, out, depth + 1);
      }
      break;
    case 'OopInterface':
      for (const mem of node.members) collectTypesFromType(mem.type, out, depth + 1);
      break;
    case 'OopNew':
      for (const a of node.args) collectTypesFromNode(a, out, depth + 1);
      break;
    case 'OopVirtualCall':
      collectTypesFromNode(node.receiver, out, depth + 1);
      for (const a of node.args) collectTypesFromNode(a, out, depth + 1);
      break;
    case 'AsyncBlock': collectTypesFromNode(node.body, out, depth + 1); break;
    case 'Await':      collectTypesFromNode(node.expr, out, depth + 1); break;
    case 'AdtDecl':
      for (const v of node.variants) {
        for (const f of v.fields) collectTypesFromType(f.type, out, depth + 1);
      }
      break;
    case 'AdtMatch':
      collectTypesFromNode(node.scrutinee, out, depth + 1);
      for (const arm of node.arms) {
        for (const b of (arm.bindings ?? [])) collectTypesFromType(b.type, out, depth + 1);
        collectTypesFromNode(arm.body, out, depth + 1);
      }
      break;
    case 'EffectDecl':
      for (const op of node.operations) {
        for (const p of op.params) collectTypesFromType(p.type, out, depth + 1);
        collectTypesFromType(op.retType, out, depth + 1);
      }
      break;
    case 'Perform':
      for (const a of node.args) collectTypesFromNode(a, out, depth + 1);
      break;
    case 'Handle':
      collectTypesFromNode(node.body, out, depth + 1);
      for (const h of node.handlers) {
        for (const p of h.params) collectTypesFromType(p.type, out, depth + 1);
        collectTypesFromNode(h.body, out, depth + 1);
      }
      if (node.returnClause !== undefined) collectTypesFromNode(node.returnClause, out, depth + 1);
      break;
    case 'Resume': collectTypesFromNode(node.value, out, depth + 1); break;
    case 'ListLit':
      for (const el of node.elements) collectTypesFromNode(el, out, depth + 1);
      break;
    case 'MapLit':
      for (const e of node.entries) { collectTypesFromNode(e.key, out, depth + 1); collectTypesFromNode(e.value, out, depth + 1); }
      break;
    case 'RawInject':
      break;
    default: assertNever(node);
  }
}

/** Collects all non-primitive type expressions and their occurrence counts. */
function collectTypes(module: IonIRModule): Map<string, number> {
  const out = new Map<string, number>();
  for (const imp of module.imports) collectTypesFromType(imp.type, out);
  for (const d of module.data) collectTypesFromNode(d, out);
  for (const decl of module.decls) collectTypesFromNode(decl, out);
  return out;
}

// ---------------------------------------------------------------------------
// Phase 2: pool construction
// ---------------------------------------------------------------------------

/** Infinite generator: a–z, then aa–zz. Optionally skip aliases that
 *  would collide with names that are emitted raw elsewhere in the module
 *  (otherwise the decoder would resolve the raw name through the S pool
 *  and substitute the pooled value, corrupting the IR). */
function* aliasSequence(skip: ReadonlySet<string> = new Set()): Generator<Alias, never, undefined> {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  for (const c of chars) {
    if (!skip.has(c)) yield c;
  }
  for (const c1 of chars) {
    for (const c2 of chars) {
      const a = c1 + c2;
      if (!skip.has(a)) yield a;
    }
  }
  // unreachable in practice; satisfies Generator return type
  throw new Error('alias space exhausted');
}

/**
 * Aggressive symbol/type pooling heuristic — matches the OTOURENV2
 * text-level compressor's `shouldPoolIdent` (`scripts/ion-compress-text.mjs`).
 *
 * Pool when count >= 3 AND length >= 4. This is more aggressive than the
 * earlier `count*(tokenCost-1) > 2+tokenCost` formula, which only pooled
 * names where the bytewise saving cleared a relatively high break-even
 * threshold derived from tiktoken's average token-cost-per-char.
 *
 * The wire format is read by LLMs (the dominant consumer); the relevant
 * cost model is "characters of context window", not "tokens after tiktoken
 * folding". Aliasing a 4-char name that occurs 3 times saves
 * (3 * 4) - (3 * 1) - (4 + 4 for "a=NAME ") = 1 char per occurrence
 * even before counting that the alias frees up space the LLM can spend on
 * actual code. The text-level compressor proved this in practice on
 * OTOURENV2 — see commit 9359a2d's token measurements.
 */
function shouldPool(len: number, count: number): boolean {
  if (count < 3) return false;
  return len >= 4;
}

// Characters that would break the decoder if present verbatim in an identifier.
// Matches the IDENT_STOP set in decoder.ts.
const WIRE_DELIMITER_RE = /[ (){}[\],;:<>!=|\-.\n\r]/;

/** Returns true when the name contains characters the decoder can't read verbatim. */
function mustPool(name: string): boolean {
  return WIRE_DELIMITER_RE.test(name);
}

/**
 * Wire-format reserved words and core builtins. These MUST NOT be pooled in
 * the S section — the wire decoder treats them as syntactic keywords and
 * relies on the literal token, not on a Var-name lookup. Aliasing `let` to
 * `a` would emit `a x:int=...;` which the decoder cannot parse as a let
 * binding.
 *
 * Originally mirrored OTOURENV2's text-level compressor KEYWORDS set;
 * that compressor was removed once the encoder learned to do its own
 * pooling. The list is now self-contained.
 *
 * Also includes the full set of JavaScript / TypeScript reserved words.
 * Why: the TS emitter passes Var names and member names through verbatim
 * in many positions (e.g. `let <name> = ...`, `(<name>) => ...`,
 * destructuring patterns). If a JS reserved word appears as a Var/member
 * in the IR (which is legal — `delete` is a perfectly valid object method
 * name in modern JS) and the encoder pools it, the alias text replaces
 * occurrences across the wire form. On decode the alias resolves back to
 * the reserved word, but at intermediate inspection points (and in the
 * old text-level compressor that helped corrupt OTOURENV2-113 .ion files)
 * the alias can be misapplied. Defence-in-depth: never pool reserved words.
 *
 * In addition to the explicit list, ALL IR meta-symbols matching the
 * regex `/^__\w+__$/` (e.g. `__not__`, `__obj__`, `__try__`, `__throw__`,
 * `__cond__`, `__optchain__`, `__nullish__`, `__add__`, `__eq__`, …) are
 * excluded. These are emitter-special-cased: the TS / React emitters
 * recognize `Var('__not__')` as the prefix `!` operator, `Var('__obj__')`
 * as an object literal constructor, etc., and emit them as syntactic sugar
 * rather than as a function call to `__not__`. Pooling them is wasted
 * (the alias adds bytes for no gain — meta-symbols never need to be read
 * raw from the wire as Var names, only resolved through the pool) and
 * actively dangerous: it expands the surface area for alias-collision
 * bugs. The text-level compressor that ran in OTOURENV2's hybrid
 * pipeline (commit f0881a2, since reverted) corrupted `crew.ion` by
 * conflating `__not__` and `status` aliases, baking `res.__not__(200)`
 * into the emitted TS where `res.status(200)` was the source intent.
 * Excluding `__*__` from the pool eliminates that whole class of bug.
 */
const JS_RESERVED_WORDS: readonly string[] = [
  // Strict & non-strict reserved words (ES2022 + TS)
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield',
  // Strict-mode reserved
  'await', 'implements', 'interface', 'let', 'package', 'private',
  'protected', 'public', 'static',
];

const POOL_EXCLUDED_KEYWORDS: ReadonlySet<string> = new Set([
  // Wire-format reserved words / core builtins
  'let', 'if', 'then', 'else', 'match', 'case', 'do',
  'async', 'await', 'try', 'catch', 'finally', 'throw',
  'handle', 'resume', 'perform', 'raw', 'null', 'true', 'false',
  'app', 'ffi', 'ret', 'this', 'import', 'from', 'new',
  'class', 'iface', 'extends', 'with', 'return',
  'any', 'int', 'float', 'str', 'bool', 'void', 'unit',
  'opt', 'list', 'map', 'tuple', 'fn', 'self',
  // JS/TS reserved words (some overlap with the above; Set dedups)
  ...JS_RESERVED_WORDS,
]);

/**
 * Matches IR meta-symbol names that the emitters special-case (`__not__`,
 * `__obj__`, `__try__`, `__throw__`, `__optchain__`, `__nullish__`,
 * `__add__`, `__eq__`, …). Future-proof: any new builtin following the
 * `__name__` convention is automatically excluded.
 *
 * Note: requires at least one character between the underscores, so
 * `____` (four underscores) is not matched. In practice no IR builtin
 * uses that form.
 */
const IR_META_SYMBOL_RE = /^__\w+__$/;

/** Returns true when `name` is an IR meta-symbol like `__not__`. */
function isIrMetaSymbol(name: string): boolean {
  return IR_META_SYMBOL_RE.test(name);
}

/**
 * Walks the IR collecting any name that appears as a JSX tag (a `Var`
 * argument to an `App` whose `sugarForm` is `'jsx'`, in tag position).
 * The wire decoder reads JSX tag names with a bare `readIdent` (see
 * `parseJsx` in `decoder.ts`) and does NOT consult the symbol pool — so
 * a name pooled in S that's also used as a JSX tag would round-trip as
 * the alias text, not the original name. Excluding ever-JSX-tag names
 * from the S pool matches what the OTOURENV2 text-level compressor
 * does (`findJsxTagNames`).
 *
 * The shape we look for matches what `parseJsx` produces:
 *   App(callee=ForeignRef(target='js', module='react', symbol='createElement'),
 *       args=[Var(tagName) | Literal(Str), props, ...children],
 *       sugarForm='jsx')
 *
 * Lowercase tag names lower to `Literal(Str)` (HTML element) — those
 * never need exclusion because they don't pass through the symbol pool
 * anyway. Uppercase and dotted (`Foo.Bar`) tag names lower to `Var` —
 * those are the ones we must skip-list.
 */
function collectJsxTagNames(module: IonIRModule): Set<string> {
  const tags = new Set<string>();
  const visit = (node: IonIRNode, depth = 0): void => {
    if (depth > MAX_ENCODE_DEPTH) return;
    if (node.kind === 'App' && node.sugarForm === 'jsx' && node.args.length >= 1) {
      const tagNode = node.args[0]!;
      if (tagNode.kind === 'Var') {
        // Dotted names like `Context.Provider` are stored as a single Var
        // with name 'Context.Provider' in the IR. Add both the full name
        // and each segment so the encoder skip-list catches a S-pool
        // candidate matching either form.
        tags.add(tagNode.name);
        for (const seg of tagNode.name.split('.')) tags.add(seg);
      }
    }
    // Recurse over all child IR nodes.
    switch (node.kind) {
      case 'App':
        visit(node.callee, depth + 1);
        for (const a of node.args) visit(a, depth + 1);
        break;
      case 'Abs':
        visit(node.body, depth + 1);
        break;
      case 'Let':
        visit(node.value, depth + 1);
        visit(node.body, depth + 1);
        break;
      case 'Case':
        visit(node.scrutinee, depth + 1);
        for (const arm of node.arms) {
          if (arm.guard !== undefined) visit(arm.guard, depth + 1);
          visit(arm.body, depth + 1);
        }
        break;
      case 'Constructor':
        for (const a of node.args) visit(a, depth + 1);
        break;
      case 'Accessor':
        visit(node.receiver, depth + 1);
        break;
      case 'Effect':
        visit(node.body, depth + 1);
        break;
      case 'OopClass':
        for (const m of node.methods) {
          if (m.body !== undefined) visit(m.body, depth + 1);
        }
        for (const ctor of (node.constructors ?? [])) {
          if (ctor.body !== undefined) visit(ctor.body, depth + 1);
        }
        break;
      case 'OopNew':
        for (const a of node.args) visit(a, depth + 1);
        break;
      case 'OopVirtualCall':
        visit(node.receiver, depth + 1);
        for (const a of node.args) visit(a, depth + 1);
        break;
      case 'AsyncBlock':
        visit(node.body, depth + 1);
        break;
      case 'Await':
        visit(node.expr, depth + 1);
        break;
      case 'AdtMatch':
        visit(node.scrutinee, depth + 1);
        for (const arm of node.arms) visit(arm.body, depth + 1);
        break;
      case 'Perform':
        for (const a of node.args) visit(a, depth + 1);
        break;
      case 'Handle':
        visit(node.body, depth + 1);
        for (const h of node.handlers) visit(h.body, depth + 1);
        if (node.returnClause !== undefined) visit(node.returnClause, depth + 1);
        break;
      case 'Resume':
        visit(node.value, depth + 1);
        break;
      case 'ListLit':
        for (const el of node.elements) visit(el, depth + 1);
        break;
      case 'MapLit':
        for (const e of node.entries) { visit(e.key, depth + 1); visit(e.value, depth + 1); }
        break;
      // No nested IR nodes to recurse into for these:
      case 'Var':
      case 'Literal':
      case 'ModuleRef':
      case 'ForeignRef':
      case 'OopThis':
      case 'OopInterface':
      case 'AdtDecl':
      case 'EffectDecl':
      case 'RawInject':
        break;
      default:
        // Fall through for any future node kinds; they won't carry JSX.
        break;
    }
  };
  for (const d of module.data) visit(d);
  for (const decl of module.decls) visit(decl);
  return tags;
}

/**
 * Pooling heuristic (aggressive — matches OTOURENV2 text-level compressor):
 *   pool if count >= 3 AND length >= 4
 *   Always pool names containing wire-format delimiter characters (operators,
 *   spaces, etc.) so the decoder can read them back via their alias.
 *
 * Skip-lists:
 *   - keywords: wire-format reserved words that the decoder reads as
 *     syntactic tokens, never as Var names.
 *   - jsxTagNames: names that ever appear as a JSX tag in this module —
 *     `parseJsx` reads tag names with a bare `readIdent` and does NOT
 *     consult the symbol pool, so aliasing them would break the JSX
 *     roundtrip.
 *
 * Sort entries by firstPos ascending.
 */
function buildSymbolPool(
  names: Map<string, NameRecord>,
  jsxTagNames: ReadonlySet<string> = new Set(),
): SymbolPool {
  const isExcluded = (name: string): boolean =>
    POOL_EXCLUDED_KEYWORDS.has(name) ||
    jsxTagNames.has(name) ||
    isIrMetaSymbol(name);

  // Split into two groups:
  // 1. shouldPool entries: sorted by firstPos for token savings (stable through JSON serde
  //    as long as module structure traversal order is consistent).
  // 2. mustPool-only entries: sorted alphabetically, so they're deterministic regardless
  //    of collection order (e.g., Set<EffectTag> iteration order changes after JSON sort).
  //
  // Excluded names (keywords, JSX tag names) are skipped from both groups
  // UNLESS they contain wire-delimiter characters, in which case we have
  // no choice — the decoder cannot read them otherwise. (In practice no
  // keyword and no valid JSX tag name contains a delimiter, so this is
  // a defence-in-depth check.)
  const shouldPoolEntries = [...names.entries()]
    .filter(([name, rec]) => shouldPool(name.length, rec.count) && !isExcluded(name))
    .sort(([, a], [, b]) => a.firstPos - b.firstPos);
  const mustPoolOnlyEntries = [...names.entries()]
    .filter(([name, rec]) =>
      mustPool(name) && !shouldPool(name.length, rec.count) && !isExcluded(name),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  const candidates = [...shouldPoolEntries, ...mustPoolOnlyEntries];

  // Alias-collision skip-list: any name that's emitted raw elsewhere in the
  // module must not be reused as a pool alias, or the decoder will resolve
  // the raw occurrence through the pool and substitute a different value.
  // Concretely: if the IR has both `Var("r")` (1 occurrence, not pooled)
  // and `Var("userId")` (5 occurrences, pooled), the alias generator must
  // skip `r` so userId doesn't get aliased to `r` (which the decoder would
  // misresolve in the let-binding `let r:any=...`).
  //
  // Build the candidate-name set first so we can remove pooled names from
  // the collision skip-list.
  const candidateNames = new Set(candidates.map(([n]) => n));
  const collisionSkip = new Set<string>();
  for (const name of names.keys()) {
    if (!candidateNames.has(name)) collisionSkip.add(name);
  }

  const toAlias = new Map<string, Alias>();
  const entries: PoolEntry[] = [];
  const gen = aliasSequence(collisionSkip);

  for (const [name] of candidates) {
    const next = gen.next();
    const alias = next.value as Alias;
    toAlias.set(name, alias);
    entries.push({ alias, value: name });
  }

  return { toAlias, entries };
}

/**
 * Literal pool: deduplicate repeated string literals across the module.
 * Heuristic: pool when total wire bytes saved > pool overhead.
 *   Without pool: count * (length + 2)         // each occurrence is "value"
 *   With pool:    length + alias.length + 3    // entry: alias="value"
 *               + count * (alias.length + 1)   // each ref: &alias
 *   Pool when count * (length + 2) > length + alias.length + 3 + count * (alias.length + 1)
 *   Estimating alias as 1 char: pool when count * (length + 1) > length + 4
 *   → count >= 2 and length >= 3 covers most useful cases.
 * Sort entries by firstPos ascending for stable, predictable output.
 */
function buildLiteralPool(literals: Map<string, { count: number; firstPos: number }>): LiteralPool {
  const candidates = [...literals.entries()]
    .filter(([value, rec]) => shouldPoolLiteral(value.length, rec.count))
    .sort(([, a], [, b]) => a.firstPos - b.firstPos);

  const toAlias = new Map<string, Alias>();
  const entries: PoolEntry[] = [];
  const gen = aliasSequence();

  for (const [value] of candidates) {
    const next = gen.next();
    const alias = next.value as Alias;
    toAlias.set(value, alias);
    entries.push({ alias, value: JSON.stringify(value) });
  }

  return { toAlias, entries };
}

/**
 * Aggressive literal-pool heuristic — matches OTOURENV2 text-level
 * compressor's `shouldPoolStr` (`scripts/ion-compress-text.mjs`).
 *
 *   pool if count >= 3 AND len >= 3
 *   OR     count == 2 AND len >= 8
 *
 * Lowering the count==2 threshold to len>=8 (was len>=5) catches a class
 * of medium-length strings that the conservative formula declined to pool
 * but are net-positive in chars saved. Lowering the count>=3 length floor
 * from "any" to len>=3 prevents tiny 1-2 char literals (rare but they
 * do happen for status codes etc.) from pushing the pool past its useful
 * width — pooling `"x"` is a wash because `&a` is already 2 chars.
 */
function shouldPoolLiteral(len: number, count: number): boolean {
  if (count < 2) return false;
  if (count >= 3) return len >= 3;
  return len >= 8;
}

/**
 * Type pool: deduplicate all non-primitive type expressions.
 * Sort entries alphabetically by typeExpr.
 * Pooling heuristic same formula applied to serialized type expression length.
 */
function buildTypePool(typeExprs: Map<string, number>): TypePool {
  const candidates = [...typeExprs.entries()]
    .filter(([expr, count]) => shouldPool(expr.length, count))
    .sort(([a], [b]) => a.localeCompare(b));

  const toAlias = new Map<string, Alias>();
  const entries: PoolEntry[] = [];
  const gen = aliasSequence();

  for (const [expr] of candidates) {
    const next = gen.next();
    const alias = next.value as Alias;
    toAlias.set(expr, alias);
    entries.push({ alias, value: expr });
  }

  return { toAlias, entries };
}

// ---------------------------------------------------------------------------
// Phase 3: section serialisers
// ---------------------------------------------------------------------------

/** Returns "I1". */
function encodeVersionLine(): string {
  return 'I1';
}

/** Returns "M <module> v=<version> d=<dialects>". */
function encodeModuleLine(m: IonIRModule): string {
  assertValidName(m.module);
  assertValidName(m.version);
  const base = `M ${m.module} v=${m.version}`;
  if (m.dialects.length === 0) return base;
  return `${base} d=${[...m.dialects].sort().join(',')}`;
}

/** Returns "S a=foo b=bar" or "" when pool is empty. */
function encodeSymbolLine(pool: SymbolPool): string {
  if (pool.entries.length === 0) return '';
  return `S ${pool.entries.map(e => `${e.alias}=${e.value}`).join(' ')}`;
}

/** Returns "T a=opt<int>" or "" when pool is empty. */
function encodeTypeLine(pool: TypePool): string {
  if (pool.entries.length === 0) return '';
  return `T ${pool.entries.map(e => `${e.alias}=${e.value}`).join(' ')}`;
}

/** Returns `L a="value" b="value"` or "" when pool is empty. */
function encodeLiteralLine(pool: LiteralPool): string {
  if (pool.entries.length === 0) return '';
  return `L ${pool.entries.map(e => `${e.alias}=${e.value}`).join(' ')}`;
}

/** Returns "X import <sid> from <module>:<sid> [; ...]" or "" when no imports. */
function encodeImportLines(imports: readonly ModuleRefNode[], ctx: EncoderContext): string {
  if (imports.length === 0) return '';
  const parts = imports.map(imp => {
    const modPath = imp.modulePath.map(p => encodeName(p, ctx.sym)).join('.');
    const sid = String(imp.symbolId);
    return `import ${sid} from ${modPath}:${sid}`;
  });
  return `X ${parts.join('; ')}`;
}

/** Returns "D <name> <tag>{<fields>} ..." or "" when no data decls. */
function encodeDataLines(data: readonly AdtDeclNode[], ctx: EncoderContext): string {
  if (data.length === 0) return '';
  const parts = data.map(adt => {
    const name = encodeName(adt.name, ctx.sym);
    const variants = adt.variants.map(v => {
      const tag = encodeName(v.tag, ctx.sym);
      const fields = v.fields.map(f =>
        `${encodeName(f.name, ctx.sym)}:${encodeType(f.type, ctx)}`
      ).join(',');
      return `${tag}{${fields}}`;
    });
    return variants.length > 0 ? `${name} ${variants.join(' ')}` : name;
  });
  return `D ${parts.join(' ')}`;
}

/** Returns "F <node> [<node> ...]" or "" when no decls. */
function encodeDeclLines(decls: readonly IonIRNode[], ctx: EncoderContext): string {
  if (decls.length === 0) return '';
  return `F ${decls.map(d => encodeNode(d, ctx)).join(' ')}`;
}

// ---------------------------------------------------------------------------
// Phase 4: node + type serialisers
// ---------------------------------------------------------------------------

/** Returns the alias if the name is pooled, otherwise the raw name. */
function encodeName(raw: string, pool: SymbolPool): string {
  return pool.toAlias.get(raw) ?? raw;
}

/** Returns the pool alias for this type expression if pooled, otherwise the raw serialisation. */
function encodeType(type: IonType, ctx: EncoderContext, depth = 0): string {
  const raw = serializeTypeRaw(type, depth);
  return ctx.typ.toAlias.get(raw) ?? raw;
}

function encodeLiteral(v: LiteralValue): string {
  switch (v.kind) {
    case 'Int':   return String(v.value);
    case 'Float': return String(v.value);
    case 'Str':   return JSON.stringify(v.value);
    case 'Bool':  return v.value ? 'true' : 'false';
    case 'Null':  return 'null';
    default: return assertNever(v);
  }
}

/** Like encodeLiteral but for expression-context: uses L-pool aliases for repeated strings. */
function encodeLiteralWithPool(v: LiteralValue, ctx: EncoderContext): string {
  if (v.kind === 'Str') {
    const alias = ctx.lit.toAlias.get(v.value);
    if (alias !== undefined) return `&${alias}`;
  }
  return encodeLiteral(v);
}

function encodePattern(p: CasePattern, ctx: EncoderContext, depth = 0): string {
  if (depth > MAX_ENCODE_DEPTH)
    throw new WireEncodeError(`module exceeds maximum encoding depth`);
  switch (p.kind) {
    case 'Wildcard': return '_';
    case 'Var':      return encodeName(p.name, ctx.sym);
    case 'Constructor': {
      const fields = (p.fields ?? []).map(f => encodePattern(f, ctx, depth + 1)).join(',');
      return `${encodeName(p.ctorName, ctx.sym)}(${fields})`;
    }
    case 'Literal': return encodeLiteral(p.value);
    case 'Tuple': {
      const fields = p.fields.map(f => encodePattern(f, ctx, depth + 1)).join(',');
      return `(${fields})`;
    }
    default: return assertNever(p);
  }
}

function encodeParam(p: Param, ctx: EncoderContext, depth = 0): string {
  // Encode field-specific prefixes: ~=static, -=private, +=protected, !=readonly
  // Prefix order (outermost→innermost): static, visibility, readonly
  let prefix = '';
  if (p.isStatic) prefix += '~';
  if (p.visibility === 'private') prefix += '-';
  else if (p.visibility === 'protected') prefix += '+';
  if (p.isReadonly) prefix += '!';
  return `${prefix}${encodeName(p.name, ctx.sym)}:${encodeType(p.type, ctx, depth)}`;
}

/**
 * Sugar-preserving emit for an `App` node carrying a `sugarForm` marker.
 *
 * Returns the original sugar form's wire string (e.g. `try{a}catch{b}`,
 * `<Tag attr=v/>`, `{k:v}`, `x??y`, `recv?.f`, `throw e`, `expr(args)`,
 * `{s1;s2;result}`), or `null` when the App's shape doesn't match its
 * claimed sugarForm — the caller then falls back to the canonical
 * `callee(args)` encoding.
 *
 * Mirrors the sugar lowerings in `decoder.ts`. Each branch must be the
 * inverse of its decoder counterpart; if you change one, change both.
 */
function encodeAppSugar(node: import('../ir/nodes.js').AppNode, ctx: EncoderContext, depth: number): string | null {
  const sf = node.sugarForm;
  if (sf === undefined) return null;
  switch (sf) {
    case 'nullish': {
      // App(__nullish__, x, y) → `x??y`
      if (node.args.length !== 2) return null;
      const [x, y] = node.args;
      return `${encodeNode(x!, ctx, depth + 1)}??${encodeNode(y!, ctx, depth + 1)}`;
    }
    case 'optchain': {
      // App(__optchain__, recv, "f") → `recv?.f`
      if (node.args.length !== 2) return null;
      const recv = node.args[0]!;
      const fieldNode = node.args[1]!;
      if (fieldNode.kind !== 'Literal' || fieldNode.value.kind !== 'Str') return null;
      return `${encodeNode(recv, ctx, depth + 1)}?.${fieldNode.value.value}`;
    }
    case 'postcall': {
      // App(callee, args) where source had postfix `(`. Emit canonical
      // `callee(args)` shape — but for `callee=Accessor(recv, m)` we MUST
      // emit `recv.m(args)` (postfix `.field` then postfix `(`) NOT
      // `recv->m(args)` (which would round-trip as OopVirtualCall and lose
      // the sugar). The decoder's parseChain + applyInfix postfix-`(`
      // handles this exact form.
      const args = node.args.map(a => encodeNode(a, ctx, depth + 1)).join(',');
      if (node.callee.kind === 'Accessor') {
        const recv = encodeNode(node.callee.receiver, ctx, depth + 1);
        const meth = encodeName(node.callee.member, ctx.sym);
        return `${recv}.${meth}(${args})`;
      }
      return `${encodeNode(node.callee, ctx, depth + 1)}(${args})`;
    }
    case 'obj': {
      // App(__obj__, k1, v1, k2, v2, ...) → `{k1:v1,k2:v2,...}`
      // Args must be even-length and each odd-indexed arg is a string-literal key.
      if (node.args.length % 2 !== 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < node.args.length; i += 2) {
        const keyNode = node.args[i]!;
        const valNode = node.args[i + 1]!;
        if (keyNode.kind !== 'Literal' || keyNode.value.kind !== 'Str') return null;
        const key = keyNode.value.value;
        const val = encodeNode(valNode, ctx, depth + 1);
        // The "..." key is the spread shorthand: `...:expr`.
        // Emit keys verbatim — the decoder reads bare idents OR JSON-string literals.
        // For keys containing wire-delimiter characters we must JSON-quote.
        const safeKey = key === '...' ? '...' :
          (mustPool(key) ? JSON.stringify(key) : key);
        parts.push(`${safeKey}:${val}`);
      }
      return `{${parts.join(',')}}`;
    }
    case 'doblock': {
      // App(__do__, s1, s2, ..., sN) → `{s1;s2;...;sN}`
      if (node.args.length === 0) return null;
      const stmts = node.args.map(s => encodeNode(s, ctx, depth + 1)).join(';');
      return `{${stmts}}`;
    }
    case 'try': {
      // App(__try__, body, catchHandler) → `try{body}catch{catchHandler}`
      if (node.args.length !== 2) return null;
      const [body, handler] = node.args;
      return `try{${encodeNode(body!, ctx, depth + 1)}}catch{${encodeNode(handler!, ctx, depth + 1)}}`;
    }
    case 'tryfin': {
      // App(__tryfin__, body, catchHandler, finallyBlock) → `try{body}catch{h}finally{f}`
      if (node.args.length !== 3) return null;
      const [body, handler, fin] = node.args;
      return `try{${encodeNode(body!, ctx, depth + 1)}}catch{${encodeNode(handler!, ctx, depth + 1)}}finally{${encodeNode(fin!, ctx, depth + 1)}}`;
    }
    case 'finally': {
      // App(__finally__, body, finallyBlock) → `try{body}finally{f}`
      if (node.args.length !== 2) return null;
      const [body, fin] = node.args;
      return `try{${encodeNode(body!, ctx, depth + 1)}}finally{${encodeNode(fin!, ctx, depth + 1)}}`;
    }
    case 'throw': {
      // App(__throw__, val) → `throw val`
      if (node.args.length !== 1) return null;
      return `throw ${encodeNode(node.args[0]!, ctx, depth + 1)}`;
    }
    case 'jsx': {
      // App(ffi:js:react:createElement, tag, props, ...children) → `<Tag attr=v ...>...</Tag>`
      // tag is either Literal(Str) (HTML lowercase) or Var (component reference).
      // props is either Literal(Null) (no props) or App(__obj__, k1, v1, ...) with
      // string-literal keys interleaved with values.
      if (node.args.length < 2) return null;
      const tagNode = node.args[0]!;
      const propsNode = node.args[1]!;
      const children = node.args.slice(2);
      let tagName: string;
      if (tagNode.kind === 'Literal' && tagNode.value.kind === 'Str') {
        tagName = tagNode.value.value;
      } else if (tagNode.kind === 'Var') {
        tagName = encodeName(tagNode.name, ctx.sym);
      } else {
        return null;
      }
      // Props
      let propsStr = '';
      if (propsNode.kind === 'Literal' && propsNode.value.kind === 'Null') {
        propsStr = '';
      } else if (propsNode.kind === 'App' && propsNode.callee.kind === 'Var' &&
                 propsNode.callee.name === '__obj__') {
        if (propsNode.args.length % 2 !== 0) return null;
        const parts: string[] = [];
        for (let i = 0; i < propsNode.args.length; i += 2) {
          const keyN = propsNode.args[i]!;
          const valN = propsNode.args[i + 1]!;
          if (keyN.kind !== 'Literal' || keyN.value.kind !== 'Str') return null;
          const key = keyN.value.value;
          if (key === '...') {
            // Spread attr: `{...expr}`
            parts.push(`{...${encodeNode(valN, ctx, depth + 1)}}`);
            continue;
          }
          // Boolean-true shorthand: just `name` means `name={true}`
          if (valN.kind === 'Literal' && valN.value.kind === 'Bool' && valN.value.value === true) {
            parts.push(key);
            continue;
          }
          // String-literal value: emit `name="str"` (JSON-encoded), no braces
          if (valN.kind === 'Literal' && valN.value.kind === 'Str') {
            parts.push(`${key}=${JSON.stringify(valN.value.value)}`);
            continue;
          }
          // Everything else: `name={expr}`
          parts.push(`${key}={${encodeNode(valN, ctx, depth + 1)}}`);
        }
        propsStr = parts.length > 0 ? ' ' + parts.join(' ') : '';
      } else {
        return null;
      }
      // Children: nested JSX → emit nested form; everything else → `{expr}`
      if (children.length === 0) {
        return `<${tagName}${propsStr}/>`;
      }
      const childParts = children.map(child => {
        if (child.kind === 'App' && child.sugarForm === 'jsx') {
          // Nested JSX: emit recursively (encodeNode hits the App→sugar fast path)
          return encodeNode(child, ctx, depth + 1);
        }
        return `{${encodeNode(child, ctx, depth + 1)}}`;
      }).join('');
      return `<${tagName}${propsStr}>${childParts}</${tagName}>`;
    }
    case 'spread': {
      // Reserved — no decoder path produces this today. Fall through.
      return null;
    }
    default: {
      // Exhaustiveness: if a new sugarForm is added but not handled, fall
      // back to canonical encoding rather than crash. (TS will flag missing
      // case if AppSugarForm is extended without updating here.)
      const _exhaustive: never = sf;
      void _exhaustive;
      return null;
    }
  }
}

/** Encodes an IonIRNode to its compact wire representation. */
function encodeNode(node: IonIRNode, ctx: EncoderContext, depth = 0): string {
  if (depth > MAX_ENCODE_DEPTH)
    throw new WireEncodeError(`module exceeds maximum encoding depth`);
  switch (node.kind) {
    case 'Var':
      return encodeName(node.name, ctx.sym);

    case 'Literal':
      return encodeLiteralWithPool(node.value, ctx);

    case 'App': {
      // Sugar-preserving fast path: if the App was produced by lowering a
      // wire-format sugar form (e.g. `try{...}catch{...}`, `<Tag/>`, `{k:v}`),
      // emit the original sugar form back so `decode → encode` is byte-stable.
      if (node.sugarForm !== undefined) {
        const sugared = encodeAppSugar(node, ctx, depth);
        if (sugared !== null) return sugared;
        // sugared===null means the App is mis-shaped for its claimed sugar
        // (e.g. wrong arg count) — fall through to the canonical encoding,
        // which is still semantically correct, just not byte-equivalent.
      }
      const args = node.args.map(a => encodeNode(a, ctx, depth + 1)).join(',');
      // When callee is Accessor(receiver, member), encode as OopVirtualCall syntax
      // (receiver->member(args)) so the decoder can round-trip it. The decoder does
      // not support callee-as-expression calls like "a.b(args)".
      if (node.callee.kind === 'Accessor') {
        const recv = encodeNode(node.callee.receiver, ctx, depth + 1);
        const meth = encodeName(node.callee.member, ctx.sym);
        return `${recv}->${meth}(${args})`;
      }
      return `${encodeNode(node.callee, ctx, depth + 1)}(${args})`;
    }

    case 'Abs': {
      const params = node.params.map(p => encodeParam(p, ctx, depth + 1)).join(',');
      return `(${params})->${encodeNode(node.body, ctx, depth + 1)}`;
    }

    case 'Let': {
      const n = encodeName(node.name, ctx.sym);
      const t = encodeType(node.bindingType, ctx, depth + 1);
      return `let ${n}:${t}=${encodeNode(node.value, ctx, depth + 1)};${encodeNode(node.body, ctx, depth + 1)}`;
    }

    case 'Case': {
      // Sugar-preserving fast path: ternary `cond?then:else` is decoded as a
      // 2-arm Case with sugarForm='ternary'. Emit it back as `?:` rather
      // than the canonical `match()` form.
      if (node.sugarForm === 'ternary' &&
          node.arms.length === 2 &&
          node.arms[0]!.pattern.kind === 'Literal' &&
          node.arms[0]!.pattern.value.kind === 'Bool' &&
          node.arms[0]!.pattern.value.value === true &&
          node.arms[1]!.pattern.kind === 'Wildcard' &&
          node.arms[0]!.guard === undefined) {
        const c = encodeNode(node.scrutinee, ctx, depth + 1);
        const t = encodeNode(node.arms[0]!.body, ctx, depth + 1);
        const e = encodeNode(node.arms[1]!.body, ctx, depth + 1);
        return `${c}?${t}:${e}`;
      }
      const arms = node.arms.map(arm => {
        const guard = arm.guard !== undefined ? ` if ${encodeNode(arm.guard, ctx, depth + 1)}` : '';
        return `${encodePattern(arm.pattern, ctx, depth + 1)}${guard}->${encodeNode(arm.body, ctx, depth + 1)}`;
      }).join(';');
      return `match(${encodeNode(node.scrutinee, ctx, depth + 1)}){${arms}}`;
    }

    case 'Constructor': {
      const args = node.args.map(a => encodeNode(a, ctx, depth + 1)).join(',');
      return `${encodeName(node.ctorName, ctx.sym)}(${args})`;
    }

    case 'Accessor':
      return `${encodeNode(node.receiver, ctx, depth + 1)}.${encodeName(node.member, ctx.sym)}`;

    case 'ModuleRef':
      return `${node.modulePath.map(p => encodeName(p, ctx.sym)).join('.')}::${String(node.symbolId)}`;

    case 'ForeignRef':
      assertValidName(node.target);
      assertValidName(node.module);
      assertValidName(node.symbol);
      return `ffi:${encodeName(node.target, ctx.sym)}:${encodeName(node.module, ctx.sym)}:${encodeName(node.symbol, ctx.sym)}`;

    case 'Effect':
      return `eff!${node.effectTag}(${encodeNode(node.body, ctx, depth + 1)})`;

    // OOP dialect — provisional: awaiting decoder validation (TASK-004)
    case 'OopClass': {
      const fields = node.fields.map(f => encodeParam(f, ctx, depth + 1)).join(',');
      const methods = node.methods.map(m => {
        const ps = m.params.map(p => encodeParam(p, ctx, depth + 1)).join(',');
        const body = m.body !== undefined ? encodeNode(m.body, ctx, depth + 1) : '';
        // Encode annotations: @Anno(a,b). prefix, stacked
        const annoPfx = (m.annotations ?? []).map(a =>
          `@${a.name}${a.args.length > 0 ? `(${a.args.join(',')})` : ''}.`
        ).join('');
        // Encode modifier prefix: ~ = static, - = private, + = protected
        let modPfx = '';
        if (m.isStatic) modPfx += '~';
        if (m.visibility === 'private') modPfx += '-';
        else if (m.visibility === 'protected') modPfx += '+';
        // Encode special method kinds
        let kindPfx = '';
        if (m.isAbstract) kindPfx = 'abs:';
        else if (m.accessorKind === 'get') kindPfx = 'get:';
        else if (m.accessorKind === 'set') kindPfx = 'set:';
        return `${annoPfx}${modPfx}${kindPfx}${encodeName(m.name, ctx.sym)}(${ps})->${encodeType(m.retType, ctx, depth + 1)}{${body}}`;
      }).join(';');
      // Encode class-level annotations
      const classAnno = (node.annotations ?? []).map(a =>
        `@${a.name}${a.args.length > 0 ? `(${a.args.join(',')})` : ''} `
      ).join('');
      // Encode type params
      const tp = (node.typeParams ?? []).length > 0
        ? `<${node.typeParams!.join(',')}>`
        : '';
      const sup = node.superClass !== undefined ? `:${String(node.superClass)}` : '';
      // Encode constructors as third {} section
      const hasCtors = (node.constructors ?? []).length > 0;
      let ctorSection = '';
      if (hasCtors) {
        const ctors = node.constructors!.map(ctor => {
          const ps = ctor.params.map(p => encodeParam(p, ctx, depth + 1)).join(',');
          const body = ctor.body !== undefined ? encodeNode(ctor.body, ctx, depth + 1) : '';
          const visPrefix = ctor.visibility === 'private' ? '~' : ctor.visibility === 'protected' ? '+' : '';
          return `${visPrefix}init(${ps}){${body}}`;
        }).join(';');
        ctorSection = `{${ctors}}`;
      }
      return `${classAnno}class ${encodeName(node.name, ctx.sym)}${tp}${sup}{${fields}}{${methods}}${ctorSection}`;
    }

    case 'OopInterface': {
      const mems = node.members.map(m =>
        `${encodeName(m.name, ctx.sym)}:${encodeType(m.type, ctx, depth + 1)}`
      ).join(',');
      // Encode interface-level annotations and type params
      const ifaceAnno = (node.annotations ?? []).map(a =>
        `@${a.name}${a.args.length > 0 ? `(${a.args.join(',')})` : ''} `
      ).join('');
      const tp = (node.typeParams ?? []).length > 0
        ? `<${node.typeParams!.join(',')}>`
        : '';
      return `${ifaceAnno}iface ${encodeName(node.name, ctx.sym)}${tp}{${mems}}`;
    }

    case 'OopNew': {
      const args = node.args.map(a => encodeNode(a, ctx, depth + 1)).join(',');
      return `new ${String(node.ctorSymbolId)}(${args})`;
    }

    case 'OopVirtualCall': {
      const args = node.args.map(a => encodeNode(a, ctx, depth + 1)).join(',');
      return `${encodeNode(node.receiver, ctx, depth + 1)}->${encodeName(node.method, ctx.sym)}(${args})`;
    }

    case 'OopThis':
      return 'this';

    // Async dialect
    case 'AsyncBlock':
      return `async{${encodeNode(node.body, ctx, depth + 1)}}`;

    case 'Await':
      return `await(${encodeNode(node.expr, ctx, depth + 1)})`;

    // ADT dialect
    case 'AdtDecl': {
      const variants = node.variants.map(v => {
        const fields = v.fields.map(f =>
          `${encodeName(f.name, ctx.sym)}:${encodeType(f.type, ctx, depth + 1)}`
        ).join(',');
        return `${encodeName(v.tag, ctx.sym)}(${fields})`;
      }).join('|');
      return `adt ${encodeName(node.name, ctx.sym)}{${variants}}`;
    }

    case 'AdtMatch': {
      const arms = node.arms.map(arm => {
        const bindings = (arm.bindings ?? []).map(b => encodeParam(b, ctx, depth + 1)).join(',');
        return `${encodeName(arm.tag, ctx.sym)}(${bindings})->${encodeNode(arm.body, ctx, depth + 1)}`;
      }).join(';');
      return `adt(${encodeNode(node.scrutinee, ctx, depth + 1)}){${arms}}`;
    }

    // Effects dialect — provisional: awaiting decoder validation (TASK-004)
    case 'EffectDecl': {
      const ops = node.operations.map(op => {
        const ps = op.params.map(p => encodeParam(p, ctx, depth + 1)).join(',');
        return `${encodeName(op.name, ctx.sym)}(${ps})->${encodeType(op.retType, ctx, depth + 1)}`;
      }).join(';');
      return `effect ${encodeName(node.name, ctx.sym)}{${ops}}`;
    }

    case 'Perform': {
      const args = node.args.map(a => encodeNode(a, ctx, depth + 1)).join(',');
      return `perf!${String(node.effectSymbolId)}:${encodeName(node.operation, ctx.sym)}(${args})`;
    }

    case 'Handle': {
      const handlers = node.handlers.map(h => {
        const ps = h.params.map(p => encodeParam(p, ctx, depth + 1)).join(',');
        return `${encodeName(h.operation, ctx.sym)}(${ps})->${encodeNode(h.body, ctx, depth + 1)}`;
      }).join(';');
      const ret = node.returnClause !== undefined
        ? `;ret:${encodeNode(node.returnClause, ctx, depth + 1)}`
        : '';
      return `handle(${encodeNode(node.body, ctx, depth + 1)}){${handlers}}${ret}`;
    }

    case 'Resume':
      return `resume(${encodeNode(node.value, ctx, depth + 1)})`;

    case 'ListLit': {
      const elems = node.elements.map(el => encodeNode(el, ctx, depth + 1)).join(',');
      return `[${elems}]`;
    }

    case 'MapLit': {
      const entries = node.entries.map(e =>
        `${encodeNode(e.key, ctx, depth + 1)}:${encodeNode(e.value, ctx, depth + 1)}`
      ).join(',');
      return `{${entries}}`;
    }

    case 'RawInject':
      return `raw(${JSON.stringify(node.code)})`;

    default:
      return assertNever(node);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Encodes an IonIRModule to wire-format text. Deterministic and byte-stable. */
export function encodeModule(module: IonIRModule): string {
  assertValidName(module.module);
  assertValidName(module.version);
  for (const dialect of module.dialects) assertValidName(dialect);
  const names = collectNames(module);
  for (const name of names.keys()) assertValidName(name);
  const types = collectTypes(module);

  const literals = collectStrLits(module);
  const jsxTagNames = collectJsxTagNames(module);

  const sym = buildSymbolPool(names, jsxTagNames);
  const typ = buildTypePool(types);
  const lit = buildLiteralPool(literals);
  const ctx: EncoderContext = { sym, typ, lit };

  const lines: string[] = [];
  lines.push(encodeVersionLine());
  lines.push(encodeModuleLine(module));

  const symLine = encodeSymbolLine(sym);
  if (symLine) lines.push(symLine);

  const typLine = encodeTypeLine(typ);
  if (typLine) lines.push(typLine);

  const litLine = encodeLiteralLine(lit);
  if (litLine) lines.push(litLine);

  const importLine = encodeImportLines(module.imports, ctx);
  if (importLine) lines.push(importLine);

  const dataLine = encodeDataLines(module.data, ctx);
  if (dataLine) lines.push(dataLine);

  const declLine = encodeDeclLines(module.decls, ctx);
  if (declLine) lines.push(declLine);

  return lines.join('\n') + '\n';
}
