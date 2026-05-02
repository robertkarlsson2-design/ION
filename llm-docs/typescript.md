
# Writing Ion for TypeScript

TypeScript is the primary backend target for Ion. The emitter at `emitters/typescript/emit.ts` is the most thoroughly exercised, ~700 lines, and handles every IR node kind.

This skill covers what compiles **today** (verified with `ion build`), what doesn't, and how to work around the gaps with `raw(...)` or `extern`.


## The compilation pipeline (what actually runs)

```
my-project/
├── ion/
│   ├── ion.config.json     ← { "target": "typescript", "rootDir": "./src", "outDir": "../" }
│   └── src/
│       └── api/users.ion
└── src/
    └── api/users.ts        ← emitted (do not edit)
```

You run `ion build` from the directory **containing** `ion/`, not from inside `ion/`. Every `.ion` file produces exactly one `.ts` file at the mirrored path.


## Functions

### Single-expression functions

```ion
fn double(x: Int) -> Int = x * 2
```

emits:

```ts
const double = (x: number): number => x * 2;
```

### Block functions with let bindings

```ion
fn addOne(x: Int) -> Int = let n = x + 1; n
```

emits:

```ts
const addOne = (x: number): number => {
  const n: number = x + 1;
  return n;
};
```

The emitter recognises top-level `let` chains in function bodies and produces a clean arrow-with-block — NOT an IIFE. Verified compile.

### Multiple parameters

```ion
fn first(x: Int, y: Int) -> Int = x
```

emits:

```ts
const first = (x: number, y: number): number => x;
```

### Functions as `let` bindings

`let` is the same as `fn` for top-level bindings — `fn` is sugar.

```ion
let double = (x: Int) -> x * 2
```

emits the same as `fn double(x: Int) -> Int = x * 2` (modulo type inference).

### Effect annotations

```ion
fn fetchUser(id: Int) !async -> Int = ...
fn save(u: User) !io !db -> Bool = ...
```

Effect annotations (`!async`, `!io`, `!db`, `!http`, `!llm`) are **type-checked by the compiler** but produce **no decoration in TypeScript output today**. The signature is identical to the non-effect version. If you want `async function ... await`, use the AsyncBlock IR node — but in surface syntax this means dropping to `extern` or `raw(...)`. See "Gaps" below.

```ion
@foreign("Promise", "resolve", "Promise.resolve($1)")
extern fn promise(v: Int) -> Int

fn fetchValue() -> Int = promise(42)
```

emits:

```ts
const promise: (_0: number) => number = (v: number): number => Promise.resolve(v);
const fetchValue = (): number => promise(42);
```

**This is the canonical async pattern in surface syntax today.** Verified compile.

### Generic functions

Generics in surface syntax: untested — the parser accepts annotation forms like `List<Int>` only as type references, not as `fn id<T>(x: T) -> T`. If you need generics, write a non-generic Ion function and let TypeScript widen at the call site, or drop to `raw("...")` for the body. **Verify with: `ion build`** before relying on a `<T>` signature.


## Types and type mapping

The table the TypeScript emitter uses (verbatim from `emit.ts::ionTypeToTs`):

| Ion type | TypeScript |
|---|---|
| `Int` | `number` |
| `Float` | `number` |
| `Str` | `string` |
| `Bool` | `boolean` |
| `Unit` | `void` |
| `Null` | `null` |
| `List<T>` | `T[]` |
| `Map<K,V>` | `Map<K, V>` |
| `Option<T>` | `T \| null` |
| `Result<T,E>` | `{ ok: T } \| { err: E }` |
| `(A, B) -> C` (Fn) | `(_0: A, _1: B) => C` |
| `Tuple<A, B>` | `[A, B]` |
| User type | `T` (or `T<args>` for generics) |

**Important:** `Option` and `Result` are **types** that map cleanly. But the **constructors** `Some(...)`, `None`, `Ok(...)`, `Err(...)` are **NOT predefined**. If you write:

```ion
fn safeFirst(xs: List<Int>) -> Option<Int> = Some(42)
```

you get `error[BD003]: Undefined name 'Some'`. To use Option/Result, declare your own ADT:

```ion
data MyResult = Ok(Int) | Err(Str)
```

Then construct via `Ok(42)` and pattern-match on `_tag`.


## `data` types — single-constructor records

Ion's compact form:

```ion
data User = User { id: Int; name: Str; active: Bool }
```

⚠️ **CRITICAL GAP:** the TypeScript emitter does **NOT** emit a TS `interface` or `type` declaration for record-style `data` types. The emitter only iterates `irModule.decls` and skips `irModule.data` entirely (where ADT declarations land). The emitted output references `User` as a type with no declaration, producing:

```ts
const isActive = (u: User): boolean => u.active;  // 'User' is not defined
```

**Workarounds today:**

1. Pair every `data` decl with an `extern` shim or a separate `.d.ts` file you write by hand.
2. Use `raw("interface User { id: number; name: string; active: boolean }")` at the top of the file. **Untested — verify with `ion build`** because surface-level `raw(...)` may not parse.
3. File a follow-up: TS emitter should iterate `irModule.data` like the React emitter does (`emitters/react/emit.ts:548`).

The Python and Java emitters have the same gap; React, Vue, HTML, LWC do iterate `data`. This is the **single most painful gap** when writing Ion for TypeScript today.


## ADT sum types (discriminated unions)

```ion
data Shape = Circle { radius: Float } | Rect { width: Float; height: Float }
```

Same caveat: the TS emitter does not emit the union type, just constructor functions if any are referenced (and even those land in `data`, not `decls`). For a working sum-type pattern that emits **today**, you have to construct the IR directly, or accept that the discriminator and constructors won't be declared in the output and supply them via `extern` / a separate `.d.ts`.

The React emitter emits the full pattern correctly:

```ts
// React-target output (NOT TS-target):
// ADT: Shape
interface Circle { readonly _tag: 'Circle'; radius: number }
interface Rect   { readonly _tag: 'Rect'; width: number; height: number }
type Shape = Circle | Rect;
function makeCircle(radius: number): Circle { return { _tag: 'Circle', radius }; }
function makeRect(width: number, height: number): Rect { return { _tag: 'Rect', width, height }; }
```

If you need this from a TS target today, your two options are:

1. Build for `--target react` (works) and accept the React import noise.
2. Use `extern fn makeCircle(...) -> Circle` per variant + `raw("...")` for the type alias. **Verify with `ion build`** before standardising on this pattern.


## Pattern matching

Single-data matching works for **flat** patterns:

```ion
fn area(s: Shape) -> Float =
  match s
  | Circle(radius) -> 3.14 * radius * radius
  | Rect(width, height) -> width * height
  | _ -> 0.0
```

emits a chain of ternaries by `_tag`:

```ts
const area = (s: Shape): number =>
  s._tag === "Circle" ? (3.14 * radius) * radius
  : s._tag === "Rect" ? width * height
  : 0;
```

⚠️ **Variable-binding gap:** the bound names `radius`, `width`, `height` are **not** scoped to the arm body in surface syntax compilation. The emitted code refers to bare `radius`, not `s.radius`. This produces a **runtime ReferenceError** at the call site. Confirmed with the test compilation; the JS emitter has the same bug. Workaround: use `match` with explicit field accessors via nested `if/then/else`:

```ion
fn area(s: Shape) -> Float =
  if s._tag == "Circle" then 3.14 * s.radius * s.radius
  else if s._tag == "Rect" then s.width * s.height
  else 0.0
```

**Verify with: `ion build`** — the if-chain approach is untested at the field-accessor level (because `data` types don't get TS interfaces emitted, the typechecker may reject `s._tag`). If it doesn't compile, drop the typecheck via `extern` or accept the bound-name bug and hand-edit emitted output.

### Conditional expressions — `if`/`then`/`else`

The actual surface-syntax form for boolean conditionals is **`if cond then a else b`** (not `case`):

```ion
fn abs_int(x: Int) -> Int = if x > 0 then x else 0 - x
```

emits a clean ternary:

```ts
const abs_int = (x: number): number => x > 0 ? x : 0 - x;
```

Verified compile. The `case ... of { true -> a | _ -> b }` form documented in `llm-skills/ion-syntax.md` is **NOT actually parsed today** — the binder rejects it with "expected declaration keyword". Use `if/then/else` for booleans, and `match` for sum types (see below).


## Pipelines (`|>`)

```ion
fn double(x: Int) -> Int = x * 2
fn isEven(n: Int) -> Bool = n % 2 == 0

fn process(xs: List<Int>) -> List<Int> =
  xs |> filter(isEven) |> map(double)
```

emits:

```ts
const map = <A, B>(list: A[], f: (a: A) => B): B[] => list.map(f);
const filter = <A>(list: A[], pred: (a: A) => boolean): A[] => list.filter(pred);
const double = (x: number): number => x * 2;
const isEven = (n: number): boolean => (n % 2) === 0;
const process = (xs: number[]): number[] => map(filter(xs, isEven), double);
```

**Verified compile.** The prelude functions `map`, `filter`, etc. are auto-injected (DCE-shaken — only ones you use). Full prelude list in `emit.ts::PRELUDE_NAMES`:

```
map, filter, fold, length, range, concat, contains, isEmpty, reverse, slice,
joinWith, flatMap, any, all, abs, floor, ceil, round, sqrt, min, max, pow,
toString, split, trim, toUpper, toLower, startsWith, endsWith, print, sum,
product, head, last, tail, flatten, sort, sortStrs, sortBy, unique, zip,
indexOf, find, findIndex, strContains, repeat, replace, strIndexOf,
toFloat, toInt, strLen
```

The `?` error-propagation operator (Result-bind) is **not implemented in surface syntax** today — file an issue or use explicit `match` + early-return-via-ternary.


## Lists, maps, tuples

```ion
let nums = [1, 2, 3]
```

emits:

```ts
const nums: number[] = [1, 2, 3];
```

Maps in surface syntax: **inline literals are not supported** (per `llm-skills/ion-syntax.md`). Use `extern` with `Object.create({})` or build via `MapLit` IR nodes. For the surface-level workaround:

```ion
@foreign("Object", "fromEntries", "Object.fromEntries($1)")
extern fn dict(entries: List<Str>) -> Str
```

Tuples: untested in surface syntax — **verify with `ion build`** before relying on `(a, b)` literal forms.


## ADT constructors as values

```ion
data Maybe = Just(Int) | Nothing
let it = Just(42)
```

The constructor `Just(42)` works **inside `let` bindings** when an ADT is declared in the same file (verified via the golden `adt-constructor-as-value` test). The emitted JS/TS is `const Just = (_0) => ({ _tag: "Just", _0 });`. Field name is `_0` (positional) for tuple variants, the field name itself for record variants.


## Module imports between Ion files

⚠️ **`use` syntax accepts `use std.http as http` per the README**, but cross-file Ion `import` semantics are **not yet tested in this skill — verify with `ion build`** on a multi-file project. The CLI compiles each `.ion` file independently 1-to-1 to a `.ts` file.

For TypeScript imports, the canonical surface-syntax path today is:

```ion
@foreign("./other-module", "myFunc", "myFunc($1)")
extern fn myFunc(x: Int) -> Int
```

This produces a foreign-ref call but **does NOT emit a TypeScript `import` statement**. The emitted `.ts` file references `myFunc` as a free identifier. You need to either:

1. Wrap your generated output with a hand-written `index.ts` that re-exports/imports.
2. Rely on TypeScript's project-wide name resolution (requires `tsconfig.json` with `paths` or a global declaration).
3. Drop to `raw("import { myFunc } from './other-module';")` at the top of the file. **Untested — verify with `ion build`** on whether `raw` can land at module scope.

This is a real gap. Track via TICKSTER-style ticket once filed.


## Builtin operators (sugar surface → emitter)

The emitter recognises double-underscore operator function names:

| Ion operator | Surface form | Emits |
|---|---|---|
| `__add__` | `a + b` | `a + b` |
| `__sub__` | `a - b` | `a - b` |
| `__mul__` | `a * b` | `a * b` |
| `__div__` | `a / b` | `a / b` |
| `__mod__` | `a % b` | `a % b` |
| `__eq__` | `a == b` | `a === b` (strict!) |
| `__ne__` | `a != b` | `a !== b` |
| `__lt__` / `__gt__` / `__le__` / `__ge__` | `a < b` etc. | same |
| `__and__` | `a && b` | `a && b` |
| `__or__` | `a \|\| b` | `a \|\| b` |
| `__not__` | `!a` | `!a` |
| `__neg__` | `-a` | `-a` |

`==` becoming `===` is intentional and correct for TypeScript.


## OOP — `oopClass` (advanced)

The TS emitter has full support for OOP-shape declarations (classes, interfaces, methods with visibility/static/abstract/get/set, constructors, generics, decorators). However, **surface syntax for OOP is undocumented** and we have no working `.ion` example that compiles a class through the surface parser.

If you need a TypeScript class today:

1. Wrap it in `raw("class Foo { ... }")`. **Untested at module-top-level — verify with `ion build`.**
2. Or hand-write the `.ts` and have an Ion file that just declares its signatures via `extern`.

The OOP nodes (`oopClass`, `oopInterface`, `oopNew`, `oopVirtualCall`, `oopThis`) are reachable from wire format (`.ionw`) — see `llm-skills/wire-format.md`. They're not surface-reachable yet.


## Gap summary — what NOT to assume works in TS surface syntax

| Feature | Status | Workaround |
|---|---|---|
| `data User { ... }` emits a TS `interface` | ❌ broken (data ignored by TS emitter) | hand-write `.d.ts` or `extern` shim |
| ADT sum types emit `type Foo = ...` union | ❌ broken (same root cause) | use `--target react` or hand-write |
| `match` with field-binding patterns (`Circle(r) -> r * r`) | ❌ broken (refs unbound `r`) | use `if x._tag == "Foo" then ... else ...` chains + field access |
| `case ... of { true -> ... }` syntax from `ion-syntax.md` | ❌ doesn't parse today | use `if/then/else` instead |
| `Option`/`Result` constructors (`Some`, `None`, `Ok`, `Err`) | ❌ not predefined | declare your own `data` |
| `?` error-propagation operator | ❌ not in surface today | manual `match` + early ternary |
| `try`/`catch`/`finally` | ❌ no Ion construct | `raw("try { ... } catch (e) { ... }")` for the expr |
| `import` between Ion files | ❌ untested in surface | `@foreign` extern or top-level `raw` (untested) |
| Generic functions `fn id<T>(x: T) -> T` | ❌ untested in surface | non-generic + TS-side widening |
| `!async`/`!io` decorate output | ❌ no decoration | use `extern` with explicit `Promise.resolve` template |
| `raw(...)` at expression position in surface syntax | ❌ undefined name | wire format only |
| Inline map literals `{k: v}` | ❌ surface syntax unsupported | `extern` + `Object.fromEntries` |
| Pipelines `|>` | ✅ works | — |
| Pattern match on bool with `_` | ✅ works (clean ternary) | — |
| Effect annotations type-checked | ✅ works | — |
| Prelude DCE (only used preludes emit) | ✅ works | — |
| Module-level `extern fn` | ✅ works | — |
| `case` on string discriminator | ✅ works | — |

**Rule of thumb:** if a TS feature isn't covered above, write a tiny test file under `ion/src/` and run `ion build` — the answer takes 5 seconds and prevents an hour of debugging emitted code that references undefined names.


## Recipe — TypeScript backend handler skeleton

```ion
// ion/src/api/getUser.ion

@foreign("./db", "queryUser", "queryUser($1)")
extern fn queryUser(id: Int) -> Str

@foreign("../types", "Response", "$1")
extern fn ok(body: Str) -> Str

fn getUser(id: Int) -> Str =
  let raw = queryUser(id);
  let body = raw;
  ok(body)
```

emits:

```ts
"use strict";
const queryUser: (_0: number) => string = (id: number): string => queryUser(id);
const ok: (_0: string) => string = (body: string): string => body;
const getUser = (id: number): string => (() => {
  const raw = queryUser(id);
  const body = raw;
  return ok(body);
})();
```

Notice the `extern fn queryUser` becomes `const queryUser = (id) => queryUser(id)` — that's a stub wrapper. The actual import of `queryUser` from `./db` is **NOT emitted** by the TS emitter. You must wrap this output in a hand-rolled re-export or rely on global types. See "Module imports" gap above.


## When to use `raw(...)` (wire format only, today)

`raw(...)` is the universal escape hatch but it's **not currently parseable in surface syntax** — no surface-level `raw` keyword exists. To use it, drop to `.ionw` wire format:

```
I1
M my.module 1.0.0
S a getCurrent
F a.()->Str
let(a,getCurrent,a,abs([],raw("new Date().toISOString()")))
```

For surface syntax today, the practical escape hatches are:
1. `extern fn` with a `@foreign` template (works for fixed-shape calls)
2. `@foreign(target="javascript", ...)` annotations on `extern` (works for FFI)
3. Open a TheTicketer ticket to add surface-level `raw()` parsing (not currently filed; would be a small PR to `src/parser/expressions.ts`)


## Checklist before declaring an Ion-for-TS file done

1. `ion build` returns `0 error(s)` ✓
2. Open the emitted `.ts` and read it. Look for:
   - Any reference to a `User`, `Shape`, etc. type that has **no declaration** above it → the data-type gap. Add `extern` or `.d.ts`.
   - Any pattern-match arm with a bare `radius` / `width` identifier instead of `s.radius` → the binding gap. Switch to `case s._tag of`.
   - Any `import` that **didn't** get emitted → the cross-module gap. Hand-add or wrap.
3. `tsc --noEmit src/your-file.ts` to catch the gaps the Ion compiler missed.
4. If clean, commit. If not, file a TheTicketer ticket describing the missing emission case — gaps in the TS target are high-leverage to fix.
