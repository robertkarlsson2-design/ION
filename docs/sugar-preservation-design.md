# Sugar-preserving encoder design

## Problem

The wire decoder accepts many syntactic sugar forms (`try{x}catch{y}`,
`cond?then:else`, `{key:value}`, `<Tag/>`, `expr?.field`, `x??y`,
`async{...}`, `@expr`, etc.) and lowers each to a verbose builtin
application like `app(__try__,x,y)`, `app(__cond__,c,t,e)`, etc.

The encoder is the inverse direction but does **not** preserve the original
sugar form: it always emits the verbose `app(__sugar_name__, ...)` shape.

Consequence: a `decode → encode` roundtrip on a hand-written `.ion` file
balloons the wire form (the verbose shape is 2-5× the size of the sugar
form) and produces a file that's much worse for both LLM-read tokens and
build-time disk size.

This blocks the "auto-hoist L+S+T pool via encoder roundtrip" path that
was the original goal of the `feat/encoder-l-pool-auto-hoist` branch:
the encoder was correct, but running it on hand-written sugar-rich files
was not viable because the round-trip would lose the sugar.

The text-level compressor we ship today (`scripts/ion-compress.mjs` in
OTOURENV2) sidesteps this by editing wire-format text directly, but it
can only do simple substitutions (L pool, S pool) — not structural
rewrites that would require IR analysis.

## Goal

Make `decode(s)` then `encode(decoded)` produce a wire-format string that
is byte-equivalent to `s` for any well-formed sugar-rich input. Once the
roundtrip preserves sugar, the auto-hoister becomes:

```ts
const ir = decodeModule(text);
const reEncoded = encodeModule(ir); // S/T/L pools auto-applied, sugar preserved
```

…and we get every pool optimization the encoder knows about for free.

## Sugar forms in the wire decoder (audit)

Each entry below is a surface form, the corresponding IR shape it lowers
to today, and where the lowering happens. The encoder needs an emit-case
mirroring each one when sugar preservation is requested.

| Surface form | Lowers to (IR App with callee) | Decoder location |
|---|---|---|
| `cond?then:else` | `Var("__cond__")` | `parseTernary` (within applyInfix) |
| `x??y` | `Var("__nullish__")` | applyInfix nullish branch |
| `expr?.field` | `Var("__optchain__")` | applyInfix postfix `?.` |
| `expr.field` | `Accessor` (not App) — already preserved | applyInfix postfix `.` |
| `expr->method(args)` | App with callee=`Accessor` | applyInfix postfix `->` |
| `expr(args)` postfix call | App | applyInfix postfix `(` |
| `{key:value, ...}` | `Var("__obj__")` | parseNode `{` branch |
| `[a,b,...]` list lit | `ListLit` (not App) — already preserved | parseNode `[` branch |
| `{stmt;stmt;...;result}` do-block | nested `Let` chain | parseNode `{` else branch |
| `try{x}catch{y}` | `Var("__try__")` | parseNode `try{` branch |
| `try{x}finally{y}` | `Var("__tryfin__")` or `__finally__` | same |
| `throw x` | `Var("__throw__")` | parseNode `throw ` branch |
| `async{body}` | `AsyncBlock` (already preserved) | parseNode `async{` branch |
| `@expr` await sugar | `Await` (already preserved) | parseNode `@` branch |
| `<Tag attr=v>...</Tag>` | `Var("__jsx__")` or `Var("ffi:js:react:createElement")` chain | parseJsx |
| `let X=v;body` keyword | `Let` (already preserved) | parseNode `let ` branch |
| `match(s){pat:body;...}` | `Case` | parseNode `match(` branch |
| `app(__regex__,p,f)` | `Var("__regex__")` (no sugar today; could add `/p/f`) | n/a |
| `eff!Op(args)` | `Perform` | parseNode `eff!` branch |
| `handle(body){...}` | `Handle` | parseNode `handle(` branch |

Already-preserved (no work): Accessor, ListLit, AsyncBlock, Await, Let,
Case, Perform, Handle, ForeignRef, Resume.

Need new emit cases (~13 sugar forms): `__cond__`, `__nullish__`,
`__optchain__`, postfix call, `__obj__`, do-block, `__try__`, `__tryfin__`,
`__throw__`, `__jsx__`, plus a few less-common ones (`?.`, spread, etc.).

## Approach 1 — sugar-marker field on App nodes (recommended)

Add an optional `sugarForm` field to `IonIRApp`:

```ts
export interface IonIRApp extends IonIRBaseNode {
  readonly kind: 'App';
  readonly callee: IonIRNode;
  readonly args: ReadonlyArray<IonIRNode>;
  readonly sugarForm?:
    | 'ternary'    // App(__cond__, c, t, e)
    | 'nullish'    // App(__nullish__, x, y)
    | 'optchain'   // App(__optchain__, recv, field-as-string)
    | 'postcall'   // App(callee, args) where source had postfix `(`
    | 'obj'        // App(__obj__, k1, v1, k2, v2, ...)
    | 'doblock'    // synthetic — App expressing { stmt;stmt;...;ret }
    | 'try'        // App(__try__, body, catchHandler)
    | 'tryfin'     // App(__tryfin__, body, catchHandler, finallyBlock)
    | 'throw'      // App(__throw__, val)
    | 'jsx'        // App(__jsx__, tag, props, ...children)
    | 'spread';    // App(__spread__, target)
}
```

Decoder sets `sugarForm` whenever it lowers a sugar form to an App.
Encoder, in `encodeNode` for App, dispatches on `sugarForm`:

```ts
case 'App': {
  if (node.sugarForm) return encodeAppSugar(node, ctx, depth);
  // ... existing canonical encoding ...
}

function encodeAppSugar(node, ctx, depth) {
  switch (node.sugarForm) {
    case 'ternary': {
      const [c, t, e] = node.args;
      return `${encodeNode(c)}?${encodeNode(t)}:${encodeNode(e)}`;
    }
    case 'try': {
      const [body, handler] = node.args;
      const handlerBody = handler.kind === 'Abs' ? encodeNode(handler.body) : encodeNode(handler);
      return `try{${encodeNode(body)}}catch{${handlerBody}}`;
    }
    // ... etc per sugar form ...
  }
}
```

**Pros:**
- Localized changes — one new field, decoder mods, encoder dispatch
- Backward compatible — `sugarForm` is optional, missing means current behavior
- Each sugar form is independent — can ship them one at a time

**Cons:**
- IR carries source-form info, blurring "IR is sugar-free" invariant
- JSON serialization of IR includes the field (harmless)

## Approach 2 — separate sugar IR nodes

Add new node kinds for each sugar form (`Ternary`, `Nullish`, `OptChain`,
`Try`, `Throw`, `Jsx`, `Obj`, etc.). Decoder produces the new node; emitters
already handle them as App-equivalent during TS/React emission, but the
encoder emits the sugar-specific form.

**Pros:**
- IR shape is more honest (sugar isn't disguised as App)

**Cons:**
- Bigger blast radius — every IR walker (binder, checker, every emitter,
  every test golden) needs a case for each new node kind
- Existing emitters and passes need updates everywhere
- Higher risk

**Recommendation: Approach 1.** Lower risk, smaller diff, same end result.

## Test strategy

1. **Unit roundtrip tests** — for each sugar form, write a test that:
   ```ts
   const wireBefore = `I1\nM ...\nF let f=()->try{x}catch{y}\n`;
   const ir = decodeModule(wireBefore);
   const wireAfter = encodeModule(ir);
   expect(wireAfter).toBe(wireBefore);
   ```
2. **Property test** — generate random sugar-rich IR, encode, decode,
   re-encode, assert byte-equivalence.
3. **Golden tests** — pick 5-10 representative `.ion` files (the
   OTOURENV2 ones are perfect candidates), feed each through
   `decode → encode`, assert byte-equivalence with input.
4. **Regression** — full existing test suite (1432 tests) must still pass.

## Implementation phases

| Phase | Scope | Estimated effort |
|---|---|---|
| 1 | IR change: add `sugarForm?` field, no behavior change | 1-2h |
| 2 | Decoder: set `sugarForm` for each sugar entry point | 1 day |
| 3 | Encoder: dispatch on `sugarForm`, emit sugar form per kind | 1-1.5 days |
| 4 | Roundtrip tests + golden regression sweep | 1 day |
| 5 | Wire into OTOURENV2 build pipeline (replace text-level compressor with `decode → encode` roundtrip) | 0.5 day |
| **Total** | | **~4-5 days** |

## Out of scope (intentionally deferred)

- Comments / blank lines / formatting preservation. Wire format has none
  of these today; surface syntax doesn't either. If a future surface-syntax
  layer (parser, formatter) is built, it'll need its own preservation pass.
- Source-position spans. The IR has `WIRE_SPAN` placeholders. Real spans
  for error messages would be a separate effort.
- Wire format extensions (new sugar). Only existing forms are in scope.

## When this matters

This unblocks "run the encoder, get all pool optimizations for free":
- L pool auto-hoist (already in `feat/encoder-l-pool-auto-hoist` branch)
- S pool auto-hoist
- T pool auto-hoist
- Any future pool / compression the encoder learns

Without sugar preservation, those optimizations require duplicating the
analysis at the text level (what `scripts/ion-compress.mjs` in OTOURENV2
does today). With sugar preservation, the text-level tool becomes a
redundant fallback.
