
# Writing Ion for React

The React emitter (`emitters/react/emit.ts`, ~600 lines) compiles Ion to TSX with `import React from 'react'` and a `React.FC` wrapper around top-level components. It handles HTML element calls, attribute remapping (`class → className`, `onclick → onClick`), JSX fragments, conditional rendering via `Case`, and full ADT/class declarations at module scope.

This is the **most idiom-dense target**. Read this whole file before writing your first component.


## ⚠️ Surface-syntax warning — IR-level reality

The React emitter is exercised entirely by **direct IR construction** in `tests/emit/react.test.ts`. There are **zero `.ion` surface-syntax files in the test corpus** that compile to React TSX. This means:

1. Every pattern below is verified at the **IR level** (the emitter does what the table says).
2. The **surface-syntax form** that produces those IR nodes is **inferred** from how the parser desugars HTML-element calls (`div(...)`, `span(...)`, etc.) into `App` nodes against pre-declared externs.
3. **If a surface form below doesn't compile, drop to the wire format (`.ionw`) and assemble the IR explicitly** — see `llm-skills/wire-format.md`. The wire format is the canonical input the emitter is tested against.

For everything outside the most basic "App returns div" component, **expect to use wire format or `raw(...)` heavily** until surface-syntax sugar for HTML-element calls lands.


## The contract — what makes a React component

The emitter recognises a component by these rules (`emit.ts:553-583`):

1. A top-level `let Name = ...` where the value is **either**:
   - An `App` whose callee is a `Var` with one of the recognised HTML tag names (the emitter calls `isHtmlElement(value)`).
   - An `Abs` (lambda) whose **body** is JSX — the emitter calls `emitJsxNode` and checks that the result `startsWith('<')`.
2. The name becomes the component identifier; the emitter wraps the body as `const Name: React.FC = () => ( <jsx> );`.
3. If the value is a non-JSX scalar (number, string, etc.), it emits `const Name = value;` instead.

Module preamble is hard-coded:

```tsx
"use strict";
import React from 'react';
```

The emitter never emits `import { useState } from 'react'` or any other named import. **Hooks come in via `extern` declarations** — see the State section below.


## Recognised HTML tag set

From `emitters/ui-shared.ts::HTML_TAGS`. These are the tag names the emitter treats as JSX elements; any other call name becomes a function-call expression.

```
div span p h1 h2 h3 h4 h5 h6
header footer main nav section article aside
ul ol li table thead tbody tr th td
form input button textarea select option label
a img br hr meta link script style
title head body html
figure figcaption blockquote pre code
em strong small mark sup sub
details summary dialog
```

**Void (self-closing) elements** — emit as `<input ... />` not `<input></input>`:
```
input br hr img meta link
area base col embed param source track wbr
```

If you need a tag NOT in that set (e.g. `svg`, `path`, `canvas`, `iframe`), the emitter falls through to `{tagName(args)}` — a function call inside JSX. This compiles but is rarely what you want. Either file an issue to extend `HTML_TAGS`, or use `raw("<svg>...</svg>")` inline.


## The attribute string convention

The first argument of every HTML element call is the **attribute string** — a single Ion `Str` literal containing space-separated `key=value` pairs. This is unusual but compact. Example IR:

```
App( callee=Var("div"), args=[ Str("class=container id=root"), Str("Hello") ] )
```

Compiles to:

```tsx
<div className="container" id="root">
  {"Hello"}
</div>
```

### Key remappings (HTML → JSX)

The emitter applies these substitutions (`emit.ts::ATTR_MAP`):

| Raw key | Emitted as |
|---|---|
| `class` | `className` |
| `for` | `htmlFor` |
| `tabindex` | `tabIndex` |
| `onclick` | `onClick` |
| `onchange` | `onChange` |
| `onsubmit` | `onSubmit` |
| `oninput` | `onInput` |
| `onfocus` | `onFocus` |
| `onblur` | `onBlur` |
| `readonly` | `readOnly` |
| `maxlength` | `maxLength` |
| `colspan` | `colSpan` |
| `rowspan` | `rowSpan` |
| `crossorigin` | `crossOrigin` |

### Identifier vs. string values for event handlers

For keys that map via `ATTR_MAP` AND start with `on`, if the value parses as a JS identifier (regex `/^[a-zA-Z_][a-zA-Z0-9_]*$/`), the emitter wraps it in curly braces:

```
onclick=handleClick   →   onClick={handleClick}
onclick=alert         →   onClick={alert}
onclick=do+something  →   onClick="do something"   (not an identifier, becomes a string)
```

This is the **only path** to event-handler binding in surface syntax today. The handler must be a **bare identifier** referring to a function in scope. Inline lambdas as handlers don't fit (an Ion `Abs` would land as `onclick=(e) -> ...` which doesn't survive the regex).

### Children

After the attribute string, every remaining argument is a child:

```
App(div, [
  Str(""),                         // empty attrs
  Str("First child"),              // text node → {"First child"}
  App(span, [Str(""), Str("two")]) // nested element
])
```

Compiles to:

```tsx
<div>
  {"First child"}
  <span>
    {"two"}
  </span>
</div>
```

### Conjoined attribute values (the `+` trick)

Because the attr string is space-delimited, multi-word values must use `+` (parsed by `parseAttrString` for HTML, `emitJsxAttrString` for React):

```
class=card+rounded+shadow-lg   →   className="card rounded shadow-lg"
```

This applies to ANY string-valued attr where you want spaces. It's load-bearing — `class=card rounded` would be parsed as TWO attributes `class=card` + `rounded`.


## Components — the patterns

### 1. Static element

```ion
let MyPage = div("class=page", "Page Content")
```

emits:

```tsx
const MyPage: React.FC = () => (
  <div className="page">
  {"Page Content"}
</div>
);
```

### 2. Function component (Abs with JSX body)

```ion
let Greeting = () -> div("class=greet", "Hello!")
```

The lambda has zero params; the emitter still wraps in `React.FC`. With params (untested at surface syntax, but the IR test asserts):

```ion
let Greeting = (name: Str) -> span("class=name", name)
```

emits:

```tsx
const Greeting: React.FC = (name) => (
  <span className="name">
  {name}
</span>
);
```

⚠️ **Gap:** the emitter does **not** type the params. `name` would be `any`. Props typing requires either an `OopClass` declaration with fields (which lands in `irModule.decls`, not surface-easily) or hand-edited `.tsx`.

### 3. Reference resolution across decls

The emitter builds a `Map<name, IRnode>` from all top-level lets and **inlines variable references** when they appear in JSX (`emit.ts:124`). So:

```ion
let pageHeader = header("", "Title")
let MyPage = div("", pageHeader)
```

emits:

```tsx
const pageHeader: React.FC = () => (
  <header>
  {"Title"}
</header>
);
const MyPage: React.FC = () => (
  <div>
  <header>
  {"Title"}
</header>
</div>
);
```

The inner `<header>` appears **inlined inside `MyPage`** — that's intentional. Variable references in JSX position get resolved through the env. This is unlike normal React where you'd render `<PageHeader />`. To opt out and emit a component reference instead of an inline render, the variable must NOT be a Let-bound JSX element — use `extern` or a non-JSX alias.

### 4. Conditional rendering — `if/then/else` → ternary

The actual surface-syntax form for booleans is `if cond then a else b` (the `case ... of { true -> ... | _ -> ... }` form documented elsewhere does NOT parse today):

```ion
let Banner = if isActive then div("class=on", "Active!") else div("class=off", "Inactive")
```

The emitter recognises the `[true, _]` arm shape and emits:

```tsx
const Banner: React.FC = () => (
  {isActive ? (
    <div className="on">
    {"Active!"}
  </div>
  ) : (
    <div className="off">
    {"Inactive"}
  </div>
  )}
);
```

(Whitespace is the emitter's; it works because JSX expression `{cond ? ... : ...}` is the standard React idiom.)

For 3+ arm cases, the emitter falls back to **emitting only the first arm's body** (`emit.ts:193`). So multi-way matches in JSX position lose branches silently. Use nested `case` or pull the logic into an Ion `let` first.

### 5. Lists — `ListLit` becomes a Fragment

```ion
let Items = [
  li("", "a"),
  li("", "b"),
  li("", "c")
]
```

emits:

```tsx
const Items: React.FC = () => (
  <>
    <li>{"a"}</li>
    <li>{"b"}</li>
    <li>{"c"}</li>
  </>
);
```

`<>...</>` is the React fragment. If you want a `<ul>` wrapper, wrap the list explicitly:

```ion
let TodoList = ul("class=list", [
  li("", "Buy milk"),
  li("", "Walk dog")
])
```

⚠️ Note: passing a `ListLit` as a child of an HTML element call is **untested in surface syntax** — the emitter recursively handles `ListLit` in JSX position correctly per the test. **Verify with `ion build`** before relying on this pattern.

### 6. Dynamic list rendering with `map` — gap

There is no clean surface-syntax way to express `items.map(item => <Card item={item} />)` in Ion today. The pattern relies on:
- An expression-form lambda passed as a child (`Abs` of `App(Card, ...)`)
- A pipeline `items |> map(...)`

Both round-trip through the IR but **the React emitter calls `emitJsxNode` on `App(map, [...])`** and falls into the "non-HTML function call" branch (`emit.ts:152`), emitting `{map(items, ...)}` as a TS expression embedded in JSX. The lambda body inside the `map` argument goes through `emitTsExprForReact`, NOT `emitJsxNode`, so any JSX inside the lambda becomes a string of TS code, not real JSX.

**Workaround today:** drop the entire list-rendering subtree to a `raw("...")` IR node containing pre-baked `{items.map(item => <Card item={item} />)}` JSX. **Untested in surface syntax — verify with `ion build`.**

This is a real gap; opening a TheTicketer ticket to handle `App(map, [items, lambda])` specially in JSX position would unlock the most-common React idiom.


## State — useState, useEffect, useRef, useContext

React hooks are **not built into the Ion language**. They must be declared as `extern` and referenced as bare functions. None of these patterns are tested at surface-syntax level — **all are untested; verify with `ion build`** before standardising.

### useState (untested)

```ion
@foreign("react", "useState", "React.useState($1)")
extern fn useState(initial: Int) -> Int

let Counter = () ->
  let n = useState(0);
  div("class=counter", n)
```

⚠️ The real hook returns `[value, setter]` (a tuple). Ion's `extern` template can only return one value, so this pattern loses the setter. Working around requires an `extern` that destructures and returns each half separately, or `raw("const [n, setN] = React.useState(0)")` at the head of the component. **Both untested.**

### useEffect (untested)

```ion
@foreign("react", "useEffect", "React.useEffect(() => { $1; }, [$2])")
extern fn useEffect(eff: Str, deps: Str) -> Unit
```

Effect bodies of any complexity will overflow the foreign-template format and need `raw(...)`.

### useRef (untested)

```ion
@foreign("react", "useRef", "React.useRef($1)")
extern fn useRef(initial: Str) -> Str
```

### useContext (untested)

```ion
@foreign("react", "useContext", "React.useContext($1)")
extern fn useContext(ctx: Str) -> Str
```

**Honest assessment:** React hook ergonomics in Ion surface syntax are **not yet good enough for production component code** — the surface-syntax sugar to express tuple destructuring, dependency arrays, and effect-cleanup functions is not designed yet. However, **wire-format `raw()` + Let chain patterns are tested and working** — see the "Tested hook patterns" section below. For real React code today, the workflow is:

1. Write the structural skeleton in Ion (component shape, JSX, conditional rendering).
2. Use `raw("...")` in a Let chain for hook calls (useState, useEffect, etc.) — the emitter recognises the Let chain and emits a block-body component.
3. File TheTicketer tickets describing remaining gaps.

### Async arrow functions

An `Abs` node whose body is `AsyncBlock` emits as `async (params) => body` — not as an IIFE. This applies in both expression position (`emitTsExprForReact`) and when the handler is a `Let` binding inside a block-body component. Use this for async event handlers (e.g. form submit handlers with `await`).


## Worked example 1 — Stateful counter

**Best-case Ion (assuming hook externs land cleanly):**

```ion
@foreign("react", "useState", "React.useState($1)")
extern fn useState(initial: Int) -> Int

let Counter = () ->
  let count = useState(0);
  div("class=counter", [
    p("", count),
    button("onclick=increment", "+")
  ])
```

**Honest current state:** the `useState` setter is unreachable, so the button will fire `increment` (a free identifier, undefined at runtime) instead of `setCount(c => c + 1)`. **Drop to `raw("...")` for the hook lines** until the gap is addressed.

**Compiled (idealised) TSX (target shape, NOT current emit):**

```tsx
import React, { useState } from 'react';

const Counter: React.FC = () => {
  const [count, setCount] = useState(0);
  return (
    <div className="counter">
      <p>{count}</p>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
};
```

To get there today, hand-write the hook lines and let Ion handle the JSX shape. Or build for `--target typescript` and write the React component manually.


## Worked example 2 — Controlled form (untested surface)

```ion
let LoginForm = () ->
  form("onsubmit=handleSubmit class=login", [
    input("type=email name=email placeholder=you@example.com class=field"),
    input("type=password name=password class=field"),
    button("type=submit", "Sign in")
  ])
```

**Verified IR shape works** (per `tests/emit/react.test.ts:197`). Surface-syntax compilation untested — verify with `ion build`. The submit handler `handleSubmit` would need an `extern` declaration to satisfy the binder.

Expected emit:

```tsx
const LoginForm: React.FC = () => (
  <form onSubmit={handleSubmit} className="login">
    <input type="email" name="email" placeholder="you@example.com" className="field" />
    <input type="password" name="password" className="field" />
    <button type="submit">{"Sign in"}</button>
  </form>
);
```


## Worked example 3 — List with empty state

```ion
let TodoList = if isEmpty(todos) then p("class=empty", "No todos yet") else ul("class=list", todos)
```

`isEmpty` is in the prelude; `todos` is a bare reference (presumed in scope via `extern` or props). The two-arm Case becomes a ternary with the right-shape JSX.

⚠️ The `ul("class=list", todos)` form passes `todos` (a List) as a child. The emitter handles `ListLit` in child position, but a **`Var` reference to a List** at child position becomes `{todos}` — which renders as `[object Object]` unless React can iterate it. To render each item, you need `todos |> map(...)` → which has the gap noted above.

**Practical pattern today:** keep the conditional shape in Ion, but the `map` body in `raw(...)`.


## Worked example 4 — Fetched data with loading/error states

This is the most-requested pattern and the one that exposes the most gaps:

```ion
data RemoteState = Loading | Error(Str) | Success(Str)

let UserCard = case state of {
  Loading -> div("class=spinner", "Loading…")
| Error(msg) -> div("class=error", msg)
| Success(name) -> div("class=card", name)
}
```

Three problems compound here:
1. `data` declarations don't emit a TS union for React (actually React DOES emit it, see `emit.ts:548-551` — TS does not).
2. Multi-arm pattern matches with field bindings have the same arm-binding gap as TS (the bound `msg`/`name` may not be in scope in the emitted ternary chain).
3. The `state` variable has to come from somewhere — usually `useState` of a discriminated value, which itself has the hook gap.

**Realistic today:** stub the whole component with `raw("(...)")` containing a hand-written `<>{state._tag === 'Loading' ? ... : ...}</>` ternary. Use Ion only for the outer component shell.


## Top-level non-Let declarations (do work)

The emitter **does** correctly emit module-level declarations for `OopClass`, `OopInterface`, `AdtDecl`, `EffectDecl` (`emit.ts:586-592`). For ADT specifically:

```ion
data Result = Ok(Int) | Err(Str)
```

emits:

```tsx
// (in React-target output)
interface Ok  { readonly _tag: 'Ok'; _0: number }
interface Err { readonly _tag: 'Err'; _0: string }
type Result = Ok | Err;
function makeOk(_0: number): Ok { return { _tag: 'Ok', _0 }; }
function makeErr(_0: string): Err { return { _tag: 'Err', _0 }; }
```

This is the cleanest piece of the React emitter — full discriminated union typing. Use `data` declarations whenever your component's state is a sum type.


## Tested hook patterns (wire format + raw())

These patterns use the block-body component form: when the `Abs` body is a `Let` chain, the emitter switches from `() => (JSX)` to `() => { statements; return (JSX); }`. Each `RawInject` value is emitted as a bare statement; all others become `const name = expr;`.

> **Known gap — tuple destructuring in let**: Ion's `let` binding only supports a single name; use `raw(...)` for useState calls. The emitter emits it verbatim as a statement.

### useState + click handler (tested)

```
I1
M ui.counter v=1.0.0
F let Counter:never=()->let _:unit=raw("const [count, setCount] = useState(0)");let handleClick:unit=()->raw("setCount(count + 1)");div("class=counter",p("","Count: "),button("onclick=handleClick","Increment"));0
```

Emits:

```tsx
const Counter: React.FC = () => {
  const [count, setCount] = useState(0);
  const handleClick = () => setCount(count + 1);
  return (
    <div className="counter">
      <p>{"Count: "}</p>
      <button onClick={handleClick}>{"Increment"}</button>
    </div>
  );
};
```

### Multiple useState + onChange (tested)

```
I1
M ui.login_inputs v=1.0.0
F let LoginInputs:never=()->let _:unit=raw("const [email, setEmail] = useState(\"\")");let _:unit=raw("const [password, setPassword] = useState(\"\")");div("class=fields",input("type=email onchange=setEmail placeholder=Email"),input("type=password onchange=setPassword placeholder=Password"));0
```

### Async submit handler (tested)

An `Abs` whose body is `async{...}` emits as `async (params) => body`:

```
I1
M ui.submit_form v=1.0.0
F let SubmitForm:never=()->let _:unit=raw("const [error, setError] = useState(null)");let handleSubmit:unit=(e:unit)->async{raw("{ e.preventDefault(); try { await submitData(); } catch (err) { setError(String(err)); } }")};form("onsubmit=handleSubmit",button("type=submit","Submit"));0
```


## Gap summary — React target

| Feature | Status | Workaround |
|---|---|---|
| Static HTML elements (`div`, `span`, etc.) | ✅ works at IR level | — |
| Attribute remap (`class → className` etc.) | ✅ works | — |
| Two-arm Case → JSX ternary | ✅ works | — |
| `ListLit` → `<>...</>` fragment | ✅ works | — |
| `data` ADT → typed union + factories | ✅ works | — |
| Variable inlining across decls | ✅ works (intentional) | — |
| 3+ arm Case in JSX | ❌ silently emits first arm | nested 2-arm Cases |
| `useState` returning a tuple | ❌ extern can't model tuple return | `raw("const [v, setV] = useState(...)")` |
| `useEffect` cleanup function | ❌ extern can't model | `raw(...)` |
| Inline event-handler lambda `onclick=(e) -> ...` | ❌ regex rejects | hoist handler to a `let`, pass identifier |
| Dynamic list rendering `items |> map(item -> Card(item))` | ❌ JSX-inside-lambda flattens to TS | `raw("{items.map(...)}")` |
| `<svg>`, `<path>`, etc. (non-HTML_TAGS) | ❌ becomes function call | extend `HTML_TAGS` or `raw(...)` |
| Surface-syntax for HTML element calls | ⚠️ untested in this skill | wire format works |
| Component props typing | ❌ params untyped | `OopClass` decl or `.d.ts` |
| Explicit `<Component />` reference (no inlining) | ❌ Let-bound vars always inline | `extern` for the component |


## Recommended workflow

1. **Sketch the component tree** in Ion using HTML-element calls, `case`, and `data` ADTs. This is where Ion saves tokens.
2. **Run `ion build --target react`.** Read the emitted TSX.
3. **Hand-fix the hook lines** (state, effects, refs) by editing the emitted file or replacing them with `raw(...)` in Ion.
4. **Run the result through `tsc --jsx preserve`** to catch the gaps the emitter missed (untyped props, undefined `setN` from broken extern, etc.).
5. **Iterate.** Each pass tightens the loop on which patterns Ion handles cleanly vs. which need pass-through.

For a full component file, expect ~60-70% of the lines to be Ion-compilable JSX shape and ~30-40% to be `raw(...)` or hand-edits for hooks and event-handler lambdas. That ratio is still worth it for component-heavy code; the JSX shell is where Ion shines.


## When to file a TheTicketer ticket

If you hit any of these, the gap is worth filing:

- A multi-arm `case` in JSX position drops branches silently (>2 arms).
- An HTML tag you need isn't in `HTML_TAGS` (likely svg/path/canvas).
- A hook pattern that's idiomatic in real React has no Ion path (especially custom hooks).
- The ADT-arm-binding bug from the TS target is also visible in React-target output.

Each of these is a small, focused PR to `emitters/react/emit.ts`. Repo: `robertkarlsson2-design/ION`.
