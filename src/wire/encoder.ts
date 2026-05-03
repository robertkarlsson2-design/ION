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

interface EncoderContext {
  readonly sym: SymbolPool;
  readonly typ: TypePool;
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

/** Infinite generator: a–z, then aa–zz. */
function* aliasSequence(): Generator<Alias, never, undefined> {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  for (const c of chars) yield c;
  for (const c1 of chars) {
    for (const c2 of chars) {
      yield c1 + c2;
    }
  }
  // unreachable in practice; satisfies Generator return type
  throw new Error('alias space exhausted');
}

function tokenCost(len: number): number {
  return Math.ceil(len / 4);
}

function shouldPool(len: number, count: number): boolean {
  const cost = tokenCost(len);
  return count * (cost - 1) > 2 + cost;
}

// Characters that would break the decoder if present verbatim in an identifier.
// Matches the IDENT_STOP set in decoder.ts.
const WIRE_DELIMITER_RE = /[ (){}[\],;:<>!=|\-.\n\r]/;

/** Returns true when the name contains characters the decoder can't read verbatim. */
function mustPool(name: string): boolean {
  return WIRE_DELIMITER_RE.test(name);
}

/**
 * Pooling heuristic:
 *   tokenCost(name) = ceil(name.length / 4)
 *   pool if: count * (tokenCost(name) - 1) > 2 + tokenCost(name)
 *   Always pool names containing wire-format delimiter characters (operators, spaces, etc.)
 *   so the decoder can read them back via their alias.
 * Sort entries by firstPos ascending.
 */
function buildSymbolPool(names: Map<string, NameRecord>): SymbolPool {
  // Split into two groups:
  // 1. shouldPool entries: sorted by firstPos for token savings (stable through JSON serde
  //    as long as module structure traversal order is consistent).
  // 2. mustPool-only entries: sorted alphabetically, so they're deterministic regardless
  //    of collection order (e.g., Set<EffectTag> iteration order changes after JSON sort).
  const shouldPoolEntries = [...names.entries()]
    .filter(([name, rec]) => shouldPool(name.length, rec.count))
    .sort(([, a], [, b]) => a.firstPos - b.firstPos);
  const mustPoolOnlyEntries = [...names.entries()]
    .filter(([name, rec]) => !shouldPool(name.length, rec.count) && mustPool(name))
    .sort(([a], [b]) => a.localeCompare(b));
  const candidates = [...shouldPoolEntries, ...mustPoolOnlyEntries];

  const toAlias = new Map<string, Alias>();
  const entries: PoolEntry[] = [];
  const gen = aliasSequence();

  for (const [name] of candidates) {
    const next = gen.next();
    const alias = next.value as Alias;
    toAlias.set(name, alias);
    entries.push({ alias, value: name });
  }

  return { toAlias, entries };
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
      return encodeLiteral(node.value);

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

  const sym = buildSymbolPool(names);
  const typ = buildTypePool(types);
  const ctx: EncoderContext = { sym, typ };

  const lines: string[] = [];
  lines.push(encodeVersionLine());
  lines.push(encodeModuleLine(module));

  const symLine = encodeSymbolLine(sym);
  if (symLine) lines.push(symLine);

  const typLine = encodeTypeLine(typ);
  if (typLine) lines.push(typLine);

  const importLine = encodeImportLines(module.imports, ctx);
  if (importLine) lines.push(importLine);

  const dataLine = encodeDataLines(module.data, ctx);
  if (dataLine) lines.push(dataLine);

  const declLine = encodeDeclLines(module.decls, ctx);
  if (declLine) lines.push(declLine);

  return lines.join('\n') + '\n';
}
