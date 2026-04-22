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

function collectNamesFromType(t: IonType, c: NameCollector): void {
  switch (t.kind) {
    case 'Int':
    case 'Float':
    case 'Str':
    case 'Bool':
    case 'Null':
    case 'Unit':
    case 'Never':
    case 'TypeVar':
      break;
    case 'List':
      collectNamesFromType(t.elem, c);
      break;
    case 'Option':
      collectNamesFromType(t.inner, c);
      break;
    case 'Map':
      collectNamesFromType(t.key, c);
      collectNamesFromType(t.value, c);
      break;
    case 'Result':
      collectNamesFromType(t.ok, c);
      collectNamesFromType(t.err, c);
      break;
    case 'Fn':
      for (const p of t.params) collectNamesFromType(p, c);
      collectNamesFromType(t.ret, c);
      break;
    case 'User':
      c.record(t.name);
      for (const a of t.args) collectNamesFromType(a, c);
      break;
    default:
      assertNever(t);
  }
}

function collectNamesFromPattern(p: CasePattern, c: NameCollector): void {
  switch (p.kind) {
    case 'Wildcard':
    case 'Literal':
      break;
    case 'Var':
      c.record(p.name);
      break;
    case 'Constructor':
      c.record(p.ctorName);
      for (const f of p.fields) collectNamesFromPattern(f, c);
      break;
    default:
      assertNever(p);
  }
}

function collectNamesFromNode(node: IonIRNode, c: NameCollector): void {
  collectNamesFromType(node.type, c);

  switch (node.kind) {
    case 'Var':
      c.record(node.name);
      break;
    case 'Literal':
      break;
    case 'App':
      collectNamesFromNode(node.callee, c);
      for (const a of node.args) collectNamesFromNode(a, c);
      break;
    case 'Abs':
      for (const p of node.params) {
        c.record(p.name);
        collectNamesFromType(p.type, c);
      }
      collectNamesFromNode(node.body, c);
      break;
    case 'Let':
      c.record(node.name);
      collectNamesFromType(node.bindingType, c);
      collectNamesFromNode(node.value, c);
      collectNamesFromNode(node.body, c);
      break;
    case 'Case':
      collectNamesFromNode(node.scrutinee, c);
      for (const arm of node.arms) {
        collectNamesFromPattern(arm.pattern, c);
        if (arm.guard !== undefined) collectNamesFromNode(arm.guard, c);
        collectNamesFromNode(arm.body, c);
      }
      break;
    case 'Constructor':
      c.record(node.ctorName);
      for (const a of node.args) collectNamesFromNode(a, c);
      break;
    case 'Accessor':
      collectNamesFromNode(node.receiver, c);
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
      collectNamesFromNode(node.body, c);
      break;
    case 'OopClass':
      c.record(node.name);
      for (const f of node.fields) {
        c.record(f.name);
        collectNamesFromType(f.type, c);
      }
      for (const m of node.methods) {
        c.record(m.name);
        for (const p of m.params) {
          c.record(p.name);
          collectNamesFromType(p.type, c);
        }
        collectNamesFromType(m.retType, c);
        if (m.body !== undefined) collectNamesFromNode(m.body, c);
      }
      break;
    case 'OopInterface':
      c.record(node.name);
      for (const mem of node.members) {
        c.record(mem.name);
        collectNamesFromType(mem.type, c);
      }
      break;
    case 'OopNew':
      for (const a of node.args) collectNamesFromNode(a, c);
      break;
    case 'OopVirtualCall':
      collectNamesFromNode(node.receiver, c);
      c.record(node.method);
      for (const a of node.args) collectNamesFromNode(a, c);
      break;
    case 'OopThis':
      break;
    case 'AsyncBlock':
      collectNamesFromNode(node.body, c);
      break;
    case 'Await':
      collectNamesFromNode(node.expr, c);
      break;
    case 'AdtDecl':
      c.record(node.name);
      for (const v of node.variants) {
        c.record(v.tag);
        for (const f of v.fields) {
          c.record(f.name);
          collectNamesFromType(f.type, c);
        }
      }
      break;
    case 'AdtMatch':
      collectNamesFromNode(node.scrutinee, c);
      for (const arm of node.arms) {
        c.record(arm.tag);
        for (const b of arm.bindings) {
          c.record(b.name);
          collectNamesFromType(b.type, c);
        }
        collectNamesFromNode(arm.body, c);
      }
      break;
    case 'EffectDecl':
      c.record(node.name);
      for (const op of node.operations) {
        c.record(op.name);
        for (const p of op.params) {
          c.record(p.name);
          collectNamesFromType(p.type, c);
        }
        collectNamesFromType(op.retType, c);
      }
      break;
    case 'Perform':
      c.record(node.operation);
      for (const a of node.args) collectNamesFromNode(a, c);
      break;
    case 'Handle':
      collectNamesFromNode(node.body, c);
      for (const h of node.handlers) {
        c.record(h.operation);
        for (const p of h.params) {
          c.record(p.name);
          collectNamesFromType(p.type, c);
        }
        collectNamesFromNode(h.body, c);
      }
      if (node.returnClause !== undefined) collectNamesFromNode(node.returnClause, c);
      break;
    case 'Resume':
      collectNamesFromNode(node.value, c);
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
function serializeTypeRaw(t: IonType): string {
  switch (t.kind) {
    case 'Int':   return 'int';
    case 'Float': return 'flt';
    case 'Str':   return 'str';
    case 'Bool':  return 'bool';
    case 'Null':  return 'null';
    case 'Unit':  return 'unit';
    case 'Never': return 'never';
    case 'TypeVar': return `$${t.id}`;
    case 'List':  return `list<${serializeTypeRaw(t.elem)}>`;
    case 'Option': return `opt<${serializeTypeRaw(t.inner)}>`;
    case 'Map':   return `map<${serializeTypeRaw(t.key)},${serializeTypeRaw(t.value)}>`;
    case 'Result': return `res<${serializeTypeRaw(t.ok)},${serializeTypeRaw(t.err)}>`;
    case 'Fn': {
      const params = t.params.map(serializeTypeRaw).join(',');
      const effects = [...t.effects].sort().map(e => `!${e}`).join('');
      return `fn(${params})->${serializeTypeRaw(t.ret)}${effects}`;
    }
    case 'User':
      return t.args.length === 0
        ? t.name
        : `${t.name}<${t.args.map(serializeTypeRaw).join(',')}>`;
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

function collectTypesFromType(t: IonType, out: Map<string, number>): void {
  if (!isPrimitiveType(t)) {
    const expr = serializeTypeRaw(t);
    out.set(expr, (out.get(expr) ?? 0) + 1);
  }
  switch (t.kind) {
    case 'Int': case 'Float': case 'Str': case 'Bool':
    case 'Null': case 'Unit': case 'Never': case 'TypeVar':
      break;
    case 'List':   collectTypesFromType(t.elem, out); break;
    case 'Option': collectTypesFromType(t.inner, out); break;
    case 'Map':
      collectTypesFromType(t.key, out);
      collectTypesFromType(t.value, out);
      break;
    case 'Result':
      collectTypesFromType(t.ok, out);
      collectTypesFromType(t.err, out);
      break;
    case 'Fn':
      for (const p of t.params) collectTypesFromType(p, out);
      collectTypesFromType(t.ret, out);
      break;
    case 'User':
      for (const a of t.args) collectTypesFromType(a, out);
      break;
    default:
      assertNever(t);
  }
}

function collectTypesFromNode(node: IonIRNode, out: Map<string, number>): void {
  collectTypesFromType(node.type, out);
  switch (node.kind) {
    case 'Var': case 'Literal': case 'ModuleRef': case 'OopThis': break;
    case 'App':
      collectTypesFromNode(node.callee, out);
      for (const a of node.args) collectTypesFromNode(a, out);
      break;
    case 'Abs':
      for (const p of node.params) collectTypesFromType(p.type, out);
      collectTypesFromNode(node.body, out);
      break;
    case 'Let':
      collectTypesFromType(node.bindingType, out);
      collectTypesFromNode(node.value, out);
      collectTypesFromNode(node.body, out);
      break;
    case 'Case':
      collectTypesFromNode(node.scrutinee, out);
      for (const arm of node.arms) {
        if (arm.guard !== undefined) collectTypesFromNode(arm.guard, out);
        collectTypesFromNode(arm.body, out);
      }
      break;
    case 'Constructor':
      for (const a of node.args) collectTypesFromNode(a, out);
      break;
    case 'Accessor': collectTypesFromNode(node.receiver, out); break;
    case 'ForeignRef':
      for (const p of node.sig.params) collectTypesFromType(p, out);
      collectTypesFromType(node.sig.ret, out);
      break;
    case 'Effect': collectTypesFromNode(node.body, out); break;
    case 'OopClass':
      for (const f of node.fields) collectTypesFromType(f.type, out);
      for (const m of node.methods) {
        for (const p of m.params) collectTypesFromType(p.type, out);
        collectTypesFromType(m.retType, out);
        if (m.body !== undefined) collectTypesFromNode(m.body, out);
      }
      break;
    case 'OopInterface':
      for (const mem of node.members) collectTypesFromType(mem.type, out);
      break;
    case 'OopNew':
      for (const a of node.args) collectTypesFromNode(a, out);
      break;
    case 'OopVirtualCall':
      collectTypesFromNode(node.receiver, out);
      for (const a of node.args) collectTypesFromNode(a, out);
      break;
    case 'AsyncBlock': collectTypesFromNode(node.body, out); break;
    case 'Await':      collectTypesFromNode(node.expr, out); break;
    case 'AdtDecl':
      for (const v of node.variants) {
        for (const f of v.fields) collectTypesFromType(f.type, out);
      }
      break;
    case 'AdtMatch':
      collectTypesFromNode(node.scrutinee, out);
      for (const arm of node.arms) {
        for (const b of arm.bindings) collectTypesFromType(b.type, out);
        collectTypesFromNode(arm.body, out);
      }
      break;
    case 'EffectDecl':
      for (const op of node.operations) {
        for (const p of op.params) collectTypesFromType(p.type, out);
        collectTypesFromType(op.retType, out);
      }
      break;
    case 'Perform':
      for (const a of node.args) collectTypesFromNode(a, out);
      break;
    case 'Handle':
      collectTypesFromNode(node.body, out);
      for (const h of node.handlers) {
        for (const p of h.params) collectTypesFromType(p.type, out);
        collectTypesFromNode(h.body, out);
      }
      if (node.returnClause !== undefined) collectTypesFromNode(node.returnClause, out);
      break;
    case 'Resume': collectTypesFromNode(node.value, out); break;
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

/**
 * Pooling heuristic:
 *   tokenCost(name) = ceil(name.length / 4)
 *   pool if: count * (tokenCost(name) - 1) > 2 + tokenCost(name)
 * Sort entries by firstPos ascending.
 */
function buildSymbolPool(names: Map<string, NameRecord>): SymbolPool {
  const candidates = [...names.entries()]
    .filter(([name, rec]) => shouldPool(name.length, rec.count))
    .sort(([, a], [, b]) => a.firstPos - b.firstPos);

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
  const dialects = [...m.dialects].sort().join(',');
  return `M ${m.module} v=${m.version} d=${dialects}`;
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

/** Returns "X <sid> from <module>:<sid> [; ...]" or "" when no imports. */
function encodeImportLines(imports: readonly ModuleRefNode[]): string {
  if (imports.length === 0) return '';
  const parts = imports.map(imp => {
    const modPath = imp.modulePath.join('.');
    const sid = String(imp.symbolId);
    return `${sid} from ${modPath}:${sid}`;
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
function encodeType(type: IonType, ctx: EncoderContext): string {
  const raw = serializeTypeRaw(type);
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

function encodePattern(p: CasePattern, ctx: EncoderContext): string {
  switch (p.kind) {
    case 'Wildcard': return '_';
    case 'Var':      return encodeName(p.name, ctx.sym);
    case 'Constructor': {
      const fields = p.fields.map(f => encodePattern(f, ctx)).join(',');
      return `${encodeName(p.ctorName, ctx.sym)}(${fields})`;
    }
    case 'Literal': return encodeLiteral(p.value);
    default: return assertNever(p);
  }
}

function encodeParam(p: Param, ctx: EncoderContext): string {
  return `${encodeName(p.name, ctx.sym)}:${encodeType(p.type, ctx)}`;
}

/** Encodes an IonIRNode to its compact wire representation. */
function encodeNode(node: IonIRNode, ctx: EncoderContext): string {
  switch (node.kind) {
    case 'Var':
      return encodeName(node.name, ctx.sym);

    case 'Literal':
      return encodeLiteral(node.value);

    case 'App': {
      const args = node.args.map(a => encodeNode(a, ctx)).join(',');
      return `${encodeNode(node.callee, ctx)}(${args})`;
    }

    case 'Abs': {
      const params = node.params.map(p => encodeParam(p, ctx)).join(',');
      return `(${params})->${encodeNode(node.body, ctx)}`;
    }

    case 'Let': {
      const n = encodeName(node.name, ctx.sym);
      return `let ${n}=${encodeNode(node.value, ctx)};${encodeNode(node.body, ctx)}`;
    }

    case 'Case': {
      const arms = node.arms.map(arm => {
        const guard = arm.guard !== undefined ? ` if ${encodeNode(arm.guard, ctx)}` : '';
        return `${encodePattern(arm.pattern, ctx)}${guard}->${encodeNode(arm.body, ctx)}`;
      }).join(';');
      return `match(${encodeNode(node.scrutinee, ctx)}){${arms}}`;
    }

    case 'Constructor': {
      const args = node.args.map(a => encodeNode(a, ctx)).join(',');
      return `${encodeName(node.ctorName, ctx.sym)}(${args})`;
    }

    case 'Accessor':
      return `${encodeNode(node.receiver, ctx)}.${encodeName(node.member, ctx.sym)}`;

    case 'ModuleRef':
      return `${node.modulePath.map(p => encodeName(p, ctx.sym)).join('.')}::${String(node.symbolId)}`;

    case 'ForeignRef':
      return `ffi:${node.target}:${node.module}:${node.symbol}`;

    case 'Effect':
      return `eff!${node.effectTag}(${encodeNode(node.body, ctx)})`;

    // OOP dialect — provisional: awaiting decoder validation (TASK-004)
    case 'OopClass': {
      const fields = node.fields.map(f => encodeParam(f, ctx)).join(',');
      const methods = node.methods.map(m => {
        const ps = m.params.map(p => encodeParam(p, ctx)).join(',');
        const body = m.body !== undefined ? encodeNode(m.body, ctx) : '';
        return `${encodeName(m.name, ctx.sym)}(${ps})->${encodeType(m.retType, ctx)}{${body}}`;
      }).join(';');
      const sup = node.superClass !== undefined ? `:${String(node.superClass)}` : '';
      return `class ${encodeName(node.name, ctx.sym)}${sup}{${fields}}{${methods}}`;
    }

    case 'OopInterface': {
      const mems = node.members.map(m =>
        `${encodeName(m.name, ctx.sym)}:${encodeType(m.type, ctx)}`
      ).join(',');
      return `iface ${encodeName(node.name, ctx.sym)}{${mems}}`;
    }

    case 'OopNew': {
      const args = node.args.map(a => encodeNode(a, ctx)).join(',');
      return `new ${String(node.ctorSymbolId)}(${args})`;
    }

    case 'OopVirtualCall': {
      const args = node.args.map(a => encodeNode(a, ctx)).join(',');
      return `${encodeNode(node.receiver, ctx)}->${encodeName(node.method, ctx.sym)}(${args})`;
    }

    case 'OopThis':
      return 'this';

    // Async dialect
    case 'AsyncBlock':
      return `async{${encodeNode(node.body, ctx)}}`;

    case 'Await':
      return `await(${encodeNode(node.expr, ctx)})`;

    // ADT dialect
    case 'AdtDecl': {
      const variants = node.variants.map(v => {
        const fields = v.fields.map(f =>
          `${encodeName(f.name, ctx.sym)}:${encodeType(f.type, ctx)}`
        ).join(',');
        return `${encodeName(v.tag, ctx.sym)}(${fields})`;
      }).join('|');
      return `adt ${encodeName(node.name, ctx.sym)}{${variants}}`;
    }

    case 'AdtMatch': {
      const arms = node.arms.map(arm => {
        const bindings = arm.bindings.map(b => encodeParam(b, ctx)).join(',');
        return `${encodeName(arm.tag, ctx.sym)}(${bindings})->${encodeNode(arm.body, ctx)}`;
      }).join(';');
      return `adt(${encodeNode(node.scrutinee, ctx)}){${arms}}`;
    }

    // Effects dialect — provisional: awaiting decoder validation (TASK-004)
    case 'EffectDecl': {
      const ops = node.operations.map(op => {
        const ps = op.params.map(p => encodeParam(p, ctx)).join(',');
        return `${encodeName(op.name, ctx.sym)}(${ps})->${encodeType(op.retType, ctx)}`;
      }).join(';');
      return `effect ${encodeName(node.name, ctx.sym)}{${ops}}`;
    }

    case 'Perform': {
      const args = node.args.map(a => encodeNode(a, ctx)).join(',');
      return `perf!${String(node.effectSymbolId)}:${encodeName(node.operation, ctx.sym)}(${args})`;
    }

    case 'Handle': {
      const handlers = node.handlers.map(h => {
        const ps = h.params.map(p => encodeParam(p, ctx)).join(',');
        return `${encodeName(h.operation, ctx.sym)}(${ps})->${encodeNode(h.body, ctx)}`;
      }).join(';');
      const ret = node.returnClause !== undefined
        ? `;ret:${encodeNode(node.returnClause, ctx)}`
        : '';
      return `handle(${encodeNode(node.body, ctx)}){${handlers}}${ret}`;
    }

    case 'Resume':
      return `resume(${encodeNode(node.value, ctx)})`;

    default:
      return assertNever(node);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Encodes an IonIRModule to wire-format text. Deterministic and byte-stable. */
export function encodeModule(module: IonIRModule): string {
  const names = collectNames(module);
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

  const importLine = encodeImportLines(module.imports);
  if (importLine) lines.push(importLine);

  const dataLine = encodeDataLines(module.data, ctx);
  if (dataLine) lines.push(dataLine);

  const declLine = encodeDeclLines(module.decls, ctx);
  if (declLine) lines.push(declLine);

  return lines.join('\n') + '\n';
}
