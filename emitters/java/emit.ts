/**
 * Java emitter (experimental).
 *
 * Walks an IonIRModule and produces a single .java file with:
 *   - Module name -> public final class
 *   - Top-level `let` bindings -> static fields
 *   - Top-level `let f = abs(...)` -> static methods
 *   - Data declarations -> records (Java 16+)
 *   - Pattern match -> nested ternaries / sealed-type switch (Java 21+)
 *   - Prelude (map/filter/fold/range/...) -> calls into a small Object-typed
 *     `Prelude` helper class emitted alongside the module.
 *
 * Designed for Java 21+. Output is intended to compile with `javac` directly.
 *
 * Untyped Ion: when the type checker leaves `TypeVar` on a parameter (e.g.
 * `pub fn total(ns) = fold(ns, 0, (+))`), the emitter widens to `Object` and
 * inserts `(Long)` casts at arithmetic/comparison sites. The Prelude itself
 * is `Object`-typed throughout so generic inference always succeeds.
 */

import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  CasePattern,
  ForeignRefNode,
  AdtDeclNode,
  AdtMatchNode,
  VarNode,
  ListLitIRNode,
  MapLitIRNode,
  ConstructorNode,
  AccessorNode,
  RawInjectNode,
  ModuleRefNode,
  EffectNode,
  Param,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';

// ---------------------------------------------------------------------------
// Builtin operator maps
// ---------------------------------------------------------------------------

const BUILTIN_BINARY_OPS: Record<string, string> = {
  __add__: '+', __sub__: '-', __mul__: '*', __div__: '/', __mod__: '%',
  __eq__: '==', __ne__: '!=', __lt__: '<', __gt__: '>', __le__: '<=', __ge__: '>=',
  __and__: '&&', __or__: '||',
};
const BUILTIN_UNARY_OPS: Record<string, string> = { __neg__: '-', __not__: '!' };

/** Operators that need numeric (Long) operands. == / != / && / || don't. */
const NUMERIC_OPS = new Set(['__add__', '__sub__', '__mul__', '__div__', '__mod__', '__lt__', '__gt__', '__le__', '__ge__', '__neg__']);

// ---------------------------------------------------------------------------
// Prelude: each Ion stdlib call -> an inline Java expression template.
// Templates use $1, $2, ... positional placeholders.
// ---------------------------------------------------------------------------

/** Permissive cast for any expression flowing into a HOF prelude param. */
const FN1 = '(java.util.function.Function<Object, Object>) ($X)';
const FN2 = '(java.util.function.BiFunction<Object, Object, Object>) ($X)';

const JAVA_PRELUDE: Record<string, string> = {
  // List ops — HOF args ($N for fns) get an explicit functional-interface cast
  map: `Prelude.map($1, ${FN1.replace('$X', '$2')})`,
  filter: `Prelude.filter($1, ${FN1.replace('$X', '$2')})`,
  fold: `Prelude.fold($1, $2, ${FN2.replace('$X', '$3')})`,
  flatMap: `Prelude.flatMap($1, ${FN1.replace('$X', '$2')})`,
  any: `Prelude.any($1, ${FN1.replace('$X', '$2')})`,
  all: `Prelude.all($1, ${FN1.replace('$X', '$2')})`,
  length: 'Prelude.length($1)',
  range: 'Prelude.range(Prelude.toLong($1), Prelude.toLong($2))',
  concat: 'Prelude.concat($1, $2)',
  contains: 'Prelude.contains($1, $2)',
  isEmpty: 'Prelude.isEmpty($1)',
  reverse: 'Prelude.reverse($1)',
  slice: 'Prelude.slice($1, Prelude.toLong($2), Prelude.toLong($3))',
  joinWith: 'Prelude.joinWith($1, $2)',
  head: 'Prelude.head($1)',
  last: 'Prelude.last($1)',
  tail: 'Prelude.tail($1)',
  flatten: 'Prelude.flatten($1)',
  sort: 'Prelude.sort($1)',
  sortStrs: 'Prelude.sort($1)',
  sortBy: `Prelude.sortBy($1, ${FN1.replace('$X', '$2')})`,
  unique: 'Prelude.unique($1)',
  zip: 'Prelude.zip($1, $2)',
  indexOf: 'Prelude.indexOf($1, $2)',
  find: `Prelude.find($1, ${FN1.replace('$X', '$2')})`,
  findIndex: `Prelude.findIndex($1, ${FN1.replace('$X', '$2')})`,
  sum: 'Prelude.sum($1)',
  product: 'Prelude.product($1)',

  // Math
  abs: 'Math.abs(Prelude.toLong($1))',
  floor: '(long) Math.floor(Prelude.toDouble($1))',
  ceil: '(long) Math.ceil(Prelude.toDouble($1))',
  round: 'Math.round(Prelude.toDouble($1))',
  sqrt: 'Math.sqrt(Prelude.toDouble($1))',
  min: 'Math.min(Prelude.toLong($1), Prelude.toLong($2))',
  max: 'Math.max(Prelude.toLong($1), Prelude.toLong($2))',
  pow: '(long) Math.pow(Prelude.toDouble($1), Prelude.toDouble($2))',

  // String
  toString: 'String.valueOf($1)',
  split: 'Prelude.split($1, $2)',
  trim: 'Prelude.trim($1)',
  toUpper: 'Prelude.toUpper($1)',
  toLower: 'Prelude.toLower($1)',
  startsWith: 'Prelude.startsWith($1, $2)',
  endsWith: 'Prelude.endsWith($1, $2)',
  strContains: 'Prelude.strContains($1, $2)',
  repeat: 'Prelude.repeat($1, Prelude.toLong($2))',
  replace: 'Prelude.replace($1, $2, $3)',
  strIndexOf: 'Prelude.strIndexOf($1, $2)',
  toFloat: 'Prelude.toDouble($1)',
  toInt: 'Prelude.toLong($1)',
  strLen: 'Prelude.strLen($1)',

  // IO
  print: 'System.out.println($1)',
  printInt: 'System.out.println($1)',
  printFloat: 'System.out.println($1)',
};

const PRELUDE_NAMES = new Set(Object.keys(JAVA_PRELUDE));

/**
 * Object-polymorphic runtime. Every method takes `Object` and casts internally
 * — that keeps generic inference from rejecting calls with `Object`-typed
 * arguments coming from untyped Ion sources. We emit it as a nested static
 * class so the generated file is self-contained.
 */
const PRELUDE_RUNTIME = `  /* ───────────── Ion prelude (auto-generated, do not edit) ───────────── */
  @SuppressWarnings({"unchecked", "rawtypes"})
  static final class Prelude {
    static java.util.function.Function<Object, Object> Fn1 = null;
    static java.util.function.BiFunction<Object, Object, Object> Fn2 = null;
    private static List<Object> asList(Object xs) { return (List<Object>) xs; }

    /* numeric coercion */
    static long toLong(Object x) {
      if (x instanceof Long l) return l;
      if (x instanceof Integer i) return i.longValue();
      if (x instanceof Number n) return n.longValue();
      return ((Number) x).longValue();
    }
    static double toDouble(Object x) {
      if (x instanceof Double d) return d;
      if (x instanceof Number n) return n.doubleValue();
      return ((Number) x).doubleValue();
    }

    /* list ops */
    static List<Object> map(Object xs, java.util.function.Function<Object, Object> f) {
      return asList(xs).stream().map(f).collect(java.util.stream.Collectors.toList());
    }
    static List<Object> filter(Object xs, java.util.function.Function<Object, Object> p) {
      return asList(xs).stream().filter(x -> (boolean) p.apply(x)).collect(java.util.stream.Collectors.toList());
    }
    static Object fold(Object xs, Object seed, java.util.function.BiFunction<Object, Object, Object> f) {
      Object acc = seed;
      for (Object x : asList(xs)) acc = f.apply(acc, x);
      return acc;
    }
    static List<Object> flatMap(Object xs, java.util.function.Function<Object, Object> f) {
      return asList(xs).stream().flatMap(x -> ((List<Object>) f.apply(x)).stream()).collect(java.util.stream.Collectors.toList());
    }
    static boolean any(Object xs, java.util.function.Function<Object, Object> p) {
      return asList(xs).stream().anyMatch(x -> (boolean) p.apply(x));
    }
    static boolean all(Object xs, java.util.function.Function<Object, Object> p) {
      return asList(xs).stream().allMatch(x -> (boolean) p.apply(x));
    }
    static long length(Object xs) { return asList(xs).size(); }
    static List<Object> range(long lo, long hi) {
      return java.util.stream.LongStream.range(lo, hi).boxed().map(x -> (Object) x).collect(java.util.stream.Collectors.toList());
    }
    static List<Object> concat(Object a, Object b) {
      List<Object> out = new java.util.ArrayList<>(asList(a)); out.addAll(asList(b)); return out;
    }
    static boolean contains(Object xs, Object x) { return asList(xs).contains(x); }
    static boolean isEmpty(Object xs) { return asList(xs).isEmpty(); }
    static List<Object> reverse(Object xs) {
      List<Object> out = new java.util.ArrayList<>(asList(xs)); java.util.Collections.reverse(out); return out;
    }
    static List<Object> slice(Object xs, long lo, long hi) {
      List<Object> src = asList(xs);
      int from = Math.max(0, (int) lo);
      int to = Math.min(src.size(), (int) hi);
      if (from >= to) return new java.util.ArrayList<>();
      return new java.util.ArrayList<>(src.subList(from, to));
    }
    static String joinWith(Object xs, Object sep) {
      return asList(xs).stream().map(String::valueOf).collect(java.util.stream.Collectors.joining((String) sep));
    }
    static Object head(Object xs) { return asList(xs).get(0); }
    static Object last(Object xs) { var l = asList(xs); return l.get(l.size() - 1); }
    static List<Object> tail(Object xs) { var l = asList(xs); return l.subList(1, l.size()); }
    static List<Object> flatten(Object xs) {
      return asList(xs).stream().flatMap(x -> ((List<Object>) x).stream()).collect(java.util.stream.Collectors.toList());
    }
    static List<Object> sort(Object xs) {
      List<Object> out = new java.util.ArrayList<>(asList(xs));
      out.sort((a, b) -> ((Comparable) a).compareTo(b));
      return out;
    }
    static List<Object> sortBy(Object xs, java.util.function.Function<Object, Object> key) {
      List<Object> out = new java.util.ArrayList<>(asList(xs));
      out.sort((a, b) -> ((Comparable) key.apply(a)).compareTo(key.apply(b)));
      return out;
    }
    static List<Object> unique(Object xs) {
      return asList(xs).stream().distinct().collect(java.util.stream.Collectors.toList());
    }
    static List<Object> zip(Object a, Object b) {
      var la = asList(a); var lb = asList(b);
      int n = Math.min(la.size(), lb.size());
      List<Object> out = new java.util.ArrayList<>(n);
      for (int i = 0; i < n; i++) out.add(java.util.Map.entry(la.get(i), lb.get(i)));
      return out;
    }
    static long indexOf(Object xs, Object x) { return asList(xs).indexOf(x); }
    static Object find(Object xs, java.util.function.Function<Object, Object> p) {
      return asList(xs).stream().filter(x -> (boolean) p.apply(x)).findFirst().orElse(null);
    }
    static long findIndex(Object xs, java.util.function.Function<Object, Object> p) {
      var l = asList(xs);
      for (int i = 0; i < l.size(); i++) if ((boolean) p.apply(l.get(i))) return i;
      return -1;
    }
    static long sum(Object xs) { long s = 0; for (Object x : asList(xs)) s += toLong(x); return s; }
    static long product(Object xs) { long s = 1; for (Object x : asList(xs)) s *= toLong(x); return s; }

    /* string ops */
    static List<Object> split(Object s, Object sep) {
      String str = (String) s; String sp = (String) sep;
      String[] parts = str.split(java.util.regex.Pattern.quote(sp), -1);
      List<Object> out = new java.util.ArrayList<>(parts.length);
      for (String p : parts) out.add(p);
      return out;
    }
    static String trim(Object s) { return ((String) s).trim(); }
    static String toUpper(Object s) { return ((String) s).toUpperCase(); }
    static String toLower(Object s) { return ((String) s).toLowerCase(); }
    static boolean startsWith(Object s, Object p) { return ((String) s).startsWith((String) p); }
    static boolean endsWith(Object s, Object p) { return ((String) s).endsWith((String) p); }
    static boolean strContains(Object s, Object p) { return ((String) s).contains((String) p); }
    static String repeat(Object s, long n) { return ((String) s).repeat((int) n); }
    static String replace(Object s, Object from, Object to) { return ((String) s).replace((String) from, (String) to); }
    static long strIndexOf(Object s, Object p) { return ((String) s).indexOf((String) p); }
    static long strLen(Object s) { return ((String) s).length(); }
  }
`;

// ---------------------------------------------------------------------------
// Type emission
// ---------------------------------------------------------------------------

function isUnknown(t: IonType | undefined): boolean {
  return t === undefined || t.kind === 'TypeVar';
}

/** Boxed type, suitable inside generics (List<Long> not List<long>). */
function javaTypeBoxed(t: IonType | undefined): string {
  if (t === undefined) return 'Object';
  switch (t.kind) {
    case 'Int': return 'Long';
    case 'Float': return 'Double';
    case 'Bool': return 'Boolean';
    case 'Str': return 'String';
    case 'Unit': return 'Void';
    case 'Null': return 'Object';
    case 'List': return 'List<Object>';
    case 'Map': return 'java.util.Map<Object, Object>';
    case 'Option': return 'java.util.Optional<Object>';
    case 'Result': return 'Object';
    case 'Fn': {
      const arity = t.params.length;
      if (arity === 0) return 'java.util.function.Supplier<Object>';
      if (arity === 1) return 'java.util.function.Function<Object, Object>';
      if (arity === 2) return 'java.util.function.BiFunction<Object, Object, Object>';
      return 'Object';
    }
    case 'User': return t.name;
    case 'TypeVar': return 'Object';
    case 'Tuple': return 'java.util.List<Object>';
    case 'Never': return 'Void';
  }
}

/** Primitive form for top-level signatures (long not Long). */
function javaTypePrim(t: IonType | undefined): string {
  if (t === undefined || t.kind === 'TypeVar') return 'Object';
  switch (t.kind) {
    case 'Int': return 'long';
    case 'Float': return 'double';
    case 'Bool': return 'boolean';
    case 'Unit': return 'void';
    default: return javaTypeBoxed(t);
  }
}

// ---------------------------------------------------------------------------
// Emit context
// ---------------------------------------------------------------------------

interface EmitCtx {
  /** Java class wrapping the module — needed for method references. */
  className: string;
  /** Names of top-level functions (Abs values). Used to emit method refs. */
  fnNames: Set<string>;
  /** Param/Var names whose static type is Object/TypeVar. */
  objectTypedNames: Set<string>;
}

/** Heuristic: does this expression evaluate to Object (vs primitive)? */
function isObjectTyped(node: IonIRNode, ctx: EmitCtx): boolean {
  if (node.kind === 'Var') {
    return ctx.objectTypedNames.has(node.name);
  }
  if (node.kind === 'Literal' || node.kind === 'ListLit' || node.kind === 'MapLit') {
    return false;
  }
  if (node.kind === 'App') {
    const app = node;
    if (app.callee.kind === 'Var') {
      const name = (app.callee as VarNode).name;
      if (BUILTIN_BINARY_OPS[name] !== undefined || BUILTIN_UNARY_OPS[name] !== undefined) return false;
      // Most prelude calls return Object/List<Object>
      if (PRELUDE_NAMES.has(name)) return true;
    }
    return true;
  }
  if (node.type !== undefined && node.type.kind === 'TypeVar') return true;
  return false;
}

/** Wrap an emitted expression with a (Long) cast when its source is Object. */
function castNumeric(emitted: string, srcNode: IonIRNode, ctx: EmitCtx): string {
  if (!isObjectTyped(srcNode, ctx)) return emitted;
  return `((Long) ${emitted}).longValue()`;
}

// ---------------------------------------------------------------------------
// Expression emission
// ---------------------------------------------------------------------------

function isInfixCall(node: IonIRNode): boolean {
  if (node.kind !== 'App') return false;
  const app = node;
  return app.callee.kind === 'Var' && (
    BUILTIN_BINARY_OPS[(app.callee as VarNode).name] !== undefined ||
    BUILTIN_UNARY_OPS[(app.callee as VarNode).name] !== undefined
  );
}

/**
 * Emit a `Var(name)` in argument position. If `name` is a top-level function,
 * we emit a method reference. Otherwise it's a regular value reference.
 */
function emitVarAsArg(name: string, ctx: EmitCtx): string {
  if (ctx.fnNames.has(name)) {
    return `${ctx.className}::${name}`;
  }
  return name;
}

function emitExpr(node: IonIRNode, ctx: EmitCtx): string {
  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Bool') return v.value ? 'true' : 'false';
      if (v.kind === 'Null') return 'null';
      if (v.kind === 'Str') return JSON.stringify(v.value);
      if (v.kind === 'Int') return `${v.value}L`;
      return String(v.value);
    }

    case 'Var': return node.name;

    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const name = (app.callee as VarNode).name;
        const bop = BUILTIN_BINARY_OPS[name];
        if (bop !== undefined && app.args.length === 2) {
          const a0 = app.args[0]!;
          const a1 = app.args[1]!;
          let l = isInfixCall(a0) ? `(${emitExpr(a0, ctx)})` : emitExpr(a0, ctx);
          let r = isInfixCall(a1) ? `(${emitExpr(a1, ctx)})` : emitExpr(a1, ctx);
          if (NUMERIC_OPS.has(name)) {
            l = castNumeric(l, a0, ctx);
            r = castNumeric(r, a1, ctx);
          }
          return `${l} ${bop} ${r}`;
        }
        const uop = BUILTIN_UNARY_OPS[name];
        if (uop !== undefined && app.args.length === 1) {
          const a = app.args[0]!;
          let inner = emitExpr(a, ctx);
          if (NUMERIC_OPS.has(name)) inner = castNumeric(inner, a, ctx);
          return `${uop}${inner}`;
        }
        const tmpl = JAVA_PRELUDE[name];
        if (tmpl !== undefined) {
          const argStrs = app.args.map(a => wrapEmitted(emitArgExpr(a, ctx)));
          return expandTemplate(tmpl, argStrs);
        }
        // User-defined function call (top-level static method)
        const args = app.args.map(a => emitArgExpr(a, ctx)).join(', ');
        return `${name}(${args})`;
      }
      const callee = emitExpr(app.callee, ctx);
      const args = app.args.map(a => emitArgExpr(a, ctx)).join(', ');
      if (app.args.length === 0) return `((java.util.function.Supplier<Object>) ${callee}).get()`;
      if (app.args.length === 1) return `((java.util.function.Function<Object, Object>) ${callee}).apply(${args})`;
      if (app.args.length === 2) return `((java.util.function.BiFunction<Object, Object, Object>) ${callee}).apply(${args})`;
      return `((java.util.function.Function<Object, Object>) ${callee}).apply(${args})`;
    }

    case 'Abs': {
      const abs = node as AbsNode;
      // New scope: lambda params are Object-typed when their declared type is
      // unknown. Add them to the ctx so binops cast them.
      const inner: EmitCtx = {
        ...ctx,
        objectTypedNames: new Set(ctx.objectTypedNames),
      };
      for (const p of abs.params) {
        if (isUnknown(p.type)) inner.objectTypedNames.add(p.name);
      }
      const params = abs.params.map(p => p.name).join(', ');
      const wrap = abs.params.length === 1 ? params : `(${params})`;
      const body = emitExpr(abs.body, inner);
      return `${wrap} -> ${body}`;
    }

    case 'Let': {
      const lt = node as LetNode;
      const bind = `${javaTypeBoxed(lt.bindingType)} ${lt.name} = ${emitExpr(lt.value, ctx)};`;
      const body = emitExpr(lt.body, ctx);
      return `((java.util.function.Supplier<Object>)(() -> { ${bind} return ${body}; })).get()`;
    }

    case 'Case': return emitCase(node as CaseNode, ctx);

    case 'ForeignRef': {
      const fr = node as ForeignRefNode;
      const arity = fr.sig.params.length;
      const tmpl = JAVA_PRELUDE[fr.symbol] ?? fr.sig.template;
      if (arity === 0) return expandTemplate(tmpl, []);
      const pnames = fr.sig.params.map((_, i) => fr.sig.paramNames[i] ?? `_p${i + 1}`);
      const argStrs = pnames.map(p => wrapEmitted(p));
      const body = expandTemplate(tmpl, argStrs);
      const wrap = arity === 1 ? pnames[0]! : `(${pnames.join(', ')})`;
      return `${wrap} -> ${body}`;
    }

    case 'Accessor': {
      const acc = node as AccessorNode;
      return `${emitExpr(acc.receiver, ctx)}.${acc.member}`;
    }

    case 'ListLit': {
      const ll = node as ListLitIRNode;
      if (ll.elements.length === 0) return 'java.util.List.<Object>of()';
      return `java.util.<Object>List.of(${ll.elements.map(e => emitExpr(e, ctx)).join(', ')})`;
    }

    case 'MapLit': {
      const ml = node as MapLitIRNode;
      const entries = ml.entries.map(e => `${emitExpr(e.key, ctx)}, ${emitExpr(e.value, ctx)}`).join(', ');
      return `java.util.Map.of(${entries})`;
    }

    case 'Constructor': {
      const c = node as ConstructorNode;
      return `new ${c.ctorName}(${c.args.map(a => emitExpr(a, ctx)).join(', ')})`;
    }

    case 'AdtMatch': return emitAdtMatch(node as AdtMatchNode, ctx);

    case 'ModuleRef': {
      const mr = node as ModuleRefNode;
      return mr.modulePath.join('.');
    }

    case 'Effect': return emitExpr((node as EffectNode).body, ctx);

    case 'RawInject': return (node as RawInjectNode).code;

    case 'OopClass':
    case 'OopInterface':
    case 'OopNew':
    case 'OopVirtualCall':
    case 'OopThis':
    case 'AsyncBlock':
    case 'Await':
    case 'AdtDecl':
    case 'EffectDecl':
    case 'Perform':
    case 'Handle':
    case 'Resume':
      return `null /* TODO: ${node.kind} not yet supported in Java emitter */`;
  }
}

/** Like emitExpr, but Var args become method references / lambda wrappers when
 *  they name a top-level fn (own module) or a prelude function. */
function emitArgExpr(node: IonIRNode, ctx: EmitCtx): string {
  if (node.kind === 'Var') {
    const v = node as VarNode;
    if (ctx.fnNames.has(v.name)) {
      return emitVarAsArg(v.name, ctx);
    }
    if (PRELUDE_NAMES.has(v.name)) {
      // Wrap the prelude template as a lambda so it converts to Function<Object, Object>.
      const tmpl = JAVA_PRELUDE[v.name]!;
      const arity = countTemplateArity(tmpl);
      if (arity === 1) return `(java.util.function.Function<Object, Object>) (_x -> ${expandTemplate(tmpl, [wrapEmitted('_x')])})`;
      if (arity === 2) return `(java.util.function.BiFunction<Object, Object, Object>) ((_x, _y) -> ${expandTemplate(tmpl, [wrapEmitted('_x'), wrapEmitted('_y')])})`;
      if (arity === 3) return `(_x, _y, _z) -> ${expandTemplate(tmpl, [wrapEmitted('_x'), wrapEmitted('_y'), wrapEmitted('_z')])}`;
      return v.name;
    }
    // Note: don't blanket-cast Object-typed Vars to Function here — that
    // would also affect non-HOF prelude args (e.g. `range(2, n)` where n is
    // Object). The function-position cast is baked into the prelude templates
    // themselves below (see HOF_FN1 / HOF_FN2 helpers in JAVA_PRELUDE).
  }
  return emitExpr(node, ctx);
}

function countTemplateArity(tmpl: string): number {
  let max = 0;
  const re = /\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tmpl)) !== null) {
    const n = parseInt(m[1]!, 10);
    if (n > max) max = n;
  }
  return max;
}

function isBoolLitPattern(p: CasePattern, want: boolean): boolean {
  return p.kind === 'Literal' && p.value.kind === 'Bool' && p.value.value === want;
}

function isWildcardish(p: CasePattern): boolean {
  return p.kind === 'Wildcard' || p.kind === 'Var';
}

function emitCase(c: CaseNode, ctx: EmitCtx): string {
  // Java disallows `switch` over boolean, so any Case whose arms include a
  // boolean literal is lowered to a ternary. Most desugared `if/then/else`
  // lands here.
  const hasBoolLit = c.arms.some(a => isBoolLitPattern(a.pattern, true) || isBoolLitPattern(a.pattern, false));
  if (hasBoolLit && c.arms.length === 2) {
    const trueArm = c.arms.find(a => isBoolLitPattern(a.pattern, true) || (isWildcardish(a.pattern) && c.arms.some(b => isBoolLitPattern(b.pattern, false))));
    const falseArm = c.arms.find(a => a !== trueArm);
    if (trueArm !== undefined && falseArm !== undefined) {
      return `(${emitExpr(c.scrutinee, ctx)}) ? (${emitExpr(trueArm.body, ctx)}) : (${emitExpr(falseArm.body, ctx)})`;
    }
  }

  // Multi-arm: lower to nested ternaries via instanceof / equality checks.
  let acc: string | null = null;
  for (let i = c.arms.length - 1; i >= 0; i--) {
    const arm = c.arms[i]!;
    const body = emitExpr(arm.body, ctx);
    if (isWildcardish(arm.pattern)) {
      acc = body;
      continue;
    }
    if (arm.pattern.kind === 'Literal') {
      const cond = `(${emitExpr(c.scrutinee, ctx)} == ${patternLit(arm.pattern)})`;
      acc = acc === null ? body : `${cond} ? (${body}) : (${acc})`;
      continue;
    }
    if (arm.pattern.kind === 'Constructor') {
      const cond = `(${emitExpr(c.scrutinee, ctx)} instanceof ${arm.pattern.ctorName})`;
      acc = acc === null ? body : `${cond} ? (${body}) : (${acc})`;
      continue;
    }
    acc = body;
  }
  return acc ?? 'null';
}

function patternLit(p: CasePattern): string {
  if (p.kind === 'Literal') {
    const v = p.value;
    if (v.kind === 'Bool') return v.value ? 'true' : 'false';
    if (v.kind === 'Int') return `${v.value}L`;
    if (v.kind === 'Str') return JSON.stringify(v.value);
    if (v.kind === 'Float') return String(v.value);
    if (v.kind === 'Null') return 'null';
  }
  if (p.kind === 'Constructor') {
    const fields = p.fields.length > 0
      ? `(${p.fields.map(patternLit).join(', ')})`
      : '';
    return `${p.ctorName}${fields}`;
  }
  if (p.kind === 'Var') return `var ${p.name}`;
  return '/* unsupported pattern */ null';
}

function emitAdtMatch(node: AdtMatchNode, ctx: EmitCtx): string {
  const arms = node.arms.map(a => {
    const binds = a.bindings.length > 0
      ? `(${a.bindings.map(b => `${javaTypeBoxed(b.type)} ${b.name}`).join(', ')})`
      : '';
    return `      case ${a.tag}${binds} -> ${emitExpr(a.body, ctx)};`;
  }).join('\n');
  return `switch (${emitExpr(node.scrutinee, ctx)}) {\n${arms}\n    }`;
}

// ---------------------------------------------------------------------------
// Function bodies
// ---------------------------------------------------------------------------

function emitFnBody(body: IonIRNode, indent: string, retType: IonType | undefined, ctx: EmitCtx): string {
  const stmts: string[] = [];
  let cur = body;
  while (cur.kind === 'Let') {
    const lt = cur as LetNode;
    stmts.push(`${indent}${javaTypeBoxed(lt.bindingType)} ${lt.name} = ${emitExpr(lt.value, ctx)};`);
    cur = lt.body;
  }
  const tail = retType !== undefined && retType.kind === 'Unit'
    ? `${indent}${emitExpr(cur, ctx)};`
    : `${indent}return ${emitExpr(cur, ctx)};`;
  return [...stmts, tail].join('\n');
}

// ---------------------------------------------------------------------------
// Module emission
// ---------------------------------------------------------------------------

function classNameFor(moduleName: string): string {
  const basename = moduleName.replace(/\\/g, '/').split('/').pop() ?? moduleName;
  const stem = basename.replace(/\.[^.]+$/, '');
  const safe = stem.replace(/[^A-Za-z0-9_]/g, '_');
  const head = safe.match(/^[A-Za-z_]/) ? safe : `M_${safe}`;
  return head.charAt(0).toUpperCase() + head.slice(1);
}

function emitDecl(d: IonIRNode, ctx: EmitCtx): string | null {
  if (d.kind === 'AdtDecl') {
    const adt = d as AdtDeclNode;
    if (adt.variants.length === 1) {
      const v = adt.variants[0]!;
      const fields = v.fields.map(f => `${javaTypeBoxed(f.type)} ${f.name}`).join(', ');
      return `  public record ${adt.name}(${fields}) {}`;
    }
    const variants = adt.variants.map(v => {
      const fields = v.fields.map(f => `${javaTypeBoxed(f.type)} ${f.name}`).join(', ');
      return `  public record ${v.tag}(${fields}) implements ${adt.name} {}`;
    }).join('\n');
    return `  public sealed interface ${adt.name} permits ${adt.variants.map(v => v.tag).join(', ')} {}\n${variants}`;
  }

  if (d.kind !== 'Let') return null;
  const lt = d as LetNode;
  if (PRELUDE_NAMES.has(lt.name)) return null;

  if (lt.value.kind === 'Abs') {
    const abs = lt.value as AbsNode;
    const fnType = abs.type.kind === 'Fn' ? abs.type : null;
    const ret = fnType ? javaTypePrim(fnType.ret) : 'Object';
    const inner: EmitCtx = {
      ...ctx,
      objectTypedNames: new Set(ctx.objectTypedNames),
    };
    const params = abs.params.map((p: Param, i: number) => {
      const declared = fnType ? fnType.params[i] : p.type;
      const t = javaTypePrim(declared);
      if (t === 'Object' || t === 'List<Object>') {
        inner.objectTypedNames.add(p.name);
      }
      return `${t} ${p.name}`;
    }).join(', ');
    const body = emitFnBody(abs.body, '    ', fnType?.ret, inner);
    return `  public static ${ret} ${lt.name}(${params}) {\n${body}\n  }`;
  }

  return `  public static final ${javaTypeBoxed(lt.bindingType)} ${lt.name} = ${emitExpr(lt.value, ctx)};`;
}

export function emitJava(irModule: IonIRModule): string {
  const module = shakePreludeDecls(irModule);
  const className = classNameFor(module.module);

  // Build the top-level fn-name set so Var args become method refs.
  const fnNames = new Set<string>();
  for (const d of module.decls) {
    if (d.kind === 'Let' && (d as LetNode).value.kind === 'Abs' && !PRELUDE_NAMES.has((d as LetNode).name)) {
      fnNames.add((d as LetNode).name);
    }
  }

  const ctx: EmitCtx = {
    className,
    fnNames,
    objectTypedNames: new Set(),
  };

  const decls: string[] = [];
  for (const d of module.data ?? []) {
    const out = emitDecl(d, ctx);
    if (out !== null) decls.push(out);
  }
  for (const d of module.decls) {
    const out = emitDecl(d, ctx);
    if (out !== null) decls.push(out);
  }

  return [
    '// Generated from Ion. Do not edit.',
    'import java.util.List;',
    '',
    `public final class ${className} {`,
    `  private ${className}() {}`,
    '',
    decls.join('\n\n'),
    '',
    PRELUDE_RUNTIME,
    '}',
    '',
  ].join('\n');
}
