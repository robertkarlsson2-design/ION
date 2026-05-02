# React (TSX) emitter — design notes

This emitter takes an `IonIRModule` and produces a single `.tsx` file containing
React function components. It is the `--target react` backend for `ion build`.

The goal is **token efficiency for the calling agent**: an agent writes a
component skeleton in Ion (in wire format usually, since that is where the
RawInject escape hatch lives) and the emitter produces idiomatic TSX with the
right JSX, prop names, and hook plumbing. Everything the emitter cannot model
falls through `raw("...")` so the agent always has a way to reach the output.

---

## 1. HTML element handling

An `App` node whose callee is a `Var` with a name in `HTML_TAGS` (see
`emitters/ui-shared.ts`) renders as a JSX element:

```
div("class=app", h1("", "Hello"))
```

becomes

```tsx
<div className="app">
  <h1>{"Hello"}</h1>
</div>
```

Rules:

- The **first** argument of the call is the attribute string (always a string
  literal — see section 2). If absent or empty, no attributes are emitted.
- The **remaining** arguments are children. Strings render as `{"..."}` JSX
  text, numbers/booleans render as `{value}` braces, and nested element calls
  recurse.
- Tags listed in `VOID_ELEMENTS` (`input`, `br`, `hr`, `img`, `meta`, `link`,
  `area`, `base`, `col`, `embed`, `param`, `source`, `track`, `wbr`) self-close.
- An `App` node whose callee is a `Var` with a **capitalised** name (e.g.
  `Card("item={selected}")`) renders as a JSX **component reference**:
  `<Card item={selected} />`. This lets the agent use other components without
  dropping into `raw(...)`.
- An `App` node whose callee is anything else (`Accessor` for `obj.method(...)`,
  a lambda, etc.) renders as a TS expression wrapped in JSX braces:
  `{user.fullName()}`. Before the patch in this rollout it silently emitted
  `{/* app */}`, which is why list rendering via `items.map(...)` used to need
  raw() — that footgun is gone.
- An `App` of a known HTML tag appearing **inside** an expression position
  (e.g. inside a `.map(...)` lambda) is detected via `isHtmlElement` and
  re-routed through `emitJsxNode`, so the lambda body becomes real JSX
  rather than a sequence of plain function calls.

## 2. Attribute parsing

Attributes are encoded as a single space-separated string passed as the first
argument of the element call. The format is `key=value key=value ...` where
each value is a single token (no spaces). Use `+` inside a value to encode a
literal space, e.g. `class=foo+bar` → `class="foo bar"`.

Mapping happens in `emitJsxAttrString`:

| Source attr key | JSX prop name | Notes |
|---|---|---|
| `class` | `className` | always rewritten |
| `for` | `htmlFor` | always rewritten |
| `tabindex` | `tabIndex` | |
| `onclick`, `onchange`, `onsubmit`, `oninput`, `onfocus`, `onblur` | `onClick`, `onChange`, ... | event-handler camelcase rewrite |
| `readonly` | `readOnly` | |
| `maxlength` | `maxLength` | |
| `colspan`, `rowspan` | `colSpan`, `rowSpan` | |
| `crossorigin` | `crossOrigin` | |
| anything else | unchanged | |

Value-encoding rules (in priority order):

1. **Explicit braces**: a value of the form `{...}` is emitted verbatim.
   `disabled={submitting}` → `disabled={submitting}`. This is the escape
   hatch when the value is a non-trivial expression.
2. **Event handler bound to an identifier**: `onclick=handleClick` →
   `onClick={handleClick}`.
3. **Common expression-valued attrs bound to an identifier**: `value`,
   `checked`, `selected`, `disabled`, `autoFocus`, `readOnly`, `key`, `ref`,
   `style`, `htmlFor`. `value=email` → `value={email}` so the agent doesn't
   have to write the braces explicitly for the most common React props.
4. **Otherwise**: emit as a string literal — `type=email` → `type="email"`.

If you need a string-literal value that *looks* like an identifier on a prop
that would normally be braced (rare), use the explicit `{}` form instead and
write the string inside, e.g. `key={"static-1"}`.

## 3. Hook idioms

Hooks (useState, useEffect, useRef, useMemo, useCallback, custom hooks) are
not modelled at the IR level — they run in JS, not in Ion. The recommended
pattern is a `Let` chain inside the component's `Abs` body where each binding
is a `RawInject`:

```
let App:never=()->
  let _s:never=raw("const [count, setCount] = useState(0)");
  let _e:never=raw("useEffect(() => { ... }, [])");
  div("class=root", ...)
```

The emitter recognises a `Let` chain at the top of an `Abs` body and switches
the function component from arrow-with-paren form (`() => (...)`) to
arrow-with-block form (`() => { ...; return (...); }`). Each `Let` binding
becomes one statement before the return:

- `RawInject` value → emitted verbatim (a trailing `;` is added if missing).
  Use this for `useState` / `useEffect` / `useRef` / arbitrary side-effecting
  declarations.
- Anything else → `const ${name} = ${emitTsExprForReact(value)};`.

The body of the deepest non-Let node becomes the `return ...;` — if it is JSX
(an HTML-element `App`), it is wrapped in parens.

## 4. Conditional rendering

A two-arm `Case` with pattern `[Bool true, Wildcard]` is the canonical "if
condition then JSX else JSX" form. The emitter has two output modes:

- **Both arms JSX, neither null**: emit a ternary —
  `{cond ? (<jsx/>) : (<jsx/>)}`.
- **The else arm is `Null` literal or `Bool false`**: emit `&&` short-circuit
  — `{cond && (<jsx/>)}`. This is what you want for the
  `{error && <p>{error}</p>}` idiom.
- A defensive guard: if either branch evaluates to an empty string (e.g.
  some unsupported node downstream), the emitter substitutes `null` so the
  output remains valid TSX. Before this rollout you could get `{cond ? () : ()}`
  for an unsupported false-branch.

## 5. List rendering

`items.map(item => <li>{item.name}</li>)` is built as an `App` with an
`Accessor` callee:

```
app(callee=accessor(var(items), map),
    args=[abs([item], app(li, "", accessor(var(item), name)))])
```

Because the callee is not a `Var`, the emitter previously emitted
`{/* app */}` (a comment). It now routes the whole call through
`emitTsExprForReact`, which produces `{items.map((item) => (<li>{item.name}</li>))}`.

For list rendering with an explicit `key` prop, the cleanest path today is to
write the per-item element via `raw("<li key={item.id}>...</li>")` — the
attribute parser does not yet have a way to express `key={item.id}` purely in
Ion (the `{}` brace form requires a literal string, but `item.id` is an
expression that depends on the lambda parameter and so isn't statically known
when the attribute string is parsed). Tracked as `it.todo` in the test suite.

## 6. Top-level shape

The emitter pipeline:

1. `shakePreludeDecls` strips unused prelude `const X = unknown;` lines
   (newly added — was missing, which is why pre-rollout outputs were noisy).
2. ADT data declarations render as TypeScript discriminated unions plus
   constructor functions.
3. Each top-level `Let` becomes either:
   - `const Name: React.FC = () => (<jsx/>);` if its value is an `Abs` with a
     directly-JSX body and no hook bindings,
   - `const Name: React.FC = () => { ...statements...; return (<jsx/>); };`
     if the `Abs` body is a `Let` chain (hooks),
   - `const Name = ...;` otherwise.
4. User-declared HTML-tag externs (`extern fn div ...`) are skipped entirely
   — the `const div = unknown;` line was pure noise.
5. `OopClass` declarations render as `class X extends React.Component { ... }`.
6. Other top-level node kinds fall through to a TS-expression emission.

## 7. Event handler types

Event handlers are not type-tagged by the emitter. If you need precise handler
types (e.g. `React.ChangeEvent<HTMLInputElement>`), declare the handler in a
`raw(...)` block at the top of the component body — see `examples/react/LoginForm.ion`
for the canonical pattern.

## 8. Known limitations + escape hatches

| Limitation | Workaround |
|---|---|
| `key={item.id}` per-item key in `.map(...)` | Inline `raw("<li key={item.id}>...</li>")` for the per-item element; or `raw("{items.map(...)}")` for the whole expression |
| Spread props (`<X {...rest} />`) | `raw("<X {...rest} />")` |
| Fragment with key (`<React.Fragment key={...}>`) | Same |
| Custom hook return-tuple destructuring | `raw("const [a, b] = useMyHook(...)")` |
| Imported components from other modules | `raw("import { Card } from './Card'")` at module scope, then use `Card(...)` as a JSX component reference |
| Stateful class components beyond a single render method | The emitter handles `OopClass` extending `React.Component` but does not synthesize state/setState — use functional components + hooks |
| TypeScript generics on components (`<MyList<Item> />`) | `raw(...)` for the whole call site |

The single rule: **anything you can't say in Ion, say in `raw("...")`. The
surrounding structure still pays for itself in tokens.**
