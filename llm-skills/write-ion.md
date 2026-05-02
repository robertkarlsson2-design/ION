# Writing ION — LLM Skill

This is your step-by-step workflow for writing ION code, compiling it, and recovering from emitter gaps using the escape hatch.

## Overview

ION saves tokens. Instead of generating 200 lines of TypeScript, you write 40 lines of ION wire format that the compiler expands into the same output. When the compiler cannot yet handle a construct, the `raw(...)` escape hatch lets you inject verbatim target-language code.

---

## Step 1 — Write in ION surface syntax (preferred for clarity)

Use `.ion` files in the `ion/src/` directory. Surface syntax is human-readable.

```ion
module org.example.utils  "1.0.0"

let greet = (name: Str) ->
  concat("Hello, ", concat(name, "!"));
```

Key syntax rules:
- Comments: `//` only (not `--`)
- Let with body: `let x = val; body`  (NOT `let x = val in body`)
- Lambda: `(param: Type) -> body`
- Function call: `f(a, b)`
- String concatenation: `concat(s1, s2)` (extern)
- List literal: `[a, b, c]`  
- Map literal: `{k: v, k2: v2}`
- If-then-else via case: `case b of { true -> x | _ -> y }`
- ADT variant: `Just(42)` / `Nothing`
- Module reference: `io.println`

### Supported types in surface syntax
```
Int  Float  Str  Bool  Unit
[Str]              ← list (ONLY simple element types work today)
{Str: Int}         ← NOT yet supported; use UserType instead
(Str) -> Bool      ← function type (only as standalone type annotation, not in param lists)
```

---

## Step 2 — Or write in wire format (most compact)

Wire format is the line-oriented binary-text encoding. Use it when you know exactly what IR nodes you need.

```
I1
M org.example.utils 1.0.0
S a hello b greet c name
F a.Str b.Unit c.Str
let(b,greet,a,abs([param(c,a)],app(var(c),var(c))))
```

Wire format rules:
- Line 1: `I1`
- Line 2: `M <module> <version>`
- Line 3: `S <alias> <name> ...`  — name pool (space-separated pairs)
- Line 4: `F <alias>.<type> ...` — type pool
- Rest: one node per line

Wire nodes:
```
var(name)
lit(42)  lit("hello")  lit(3.14)  lit(true)  lit(null)
app(callee, arg1, arg2)
abs([param(name,type)], body)
let(bodyType, name, type, value, body)   ← 5-arg form (type of body, name, binding type, value, body)
case(scrutinee, [arm(pattern, body), ...])
ctor(name, symbolId, arg1, arg2)
acc(receiver, member)
list([elem1, elem2])
map([key1:val1, key2:val2])
foreign(target, module, symbol, sig)
oopClass(name, id, [field(n,t)...], [method(n,id,[p...],retT,body)...])
oopNew(ctorId, arg1, arg2)
oopCall(receiver, method, arg1, arg2)
oopThis()
async(body)
await(expr)
adtDecl(name, id, [variant(tag, id, [field(n,t)...])...])
adtMatch(scrutinee, [arm(tag, [binding(n,t)...], body)...])
effectDecl(name, id, [op(n,[p...],retT)...])
perform(effectId, operation, arg1, arg2)
handle(body, [handler(op,[p...],body)...])
resume(value)
raw("verbatim target-language code here")
```

---

## Step 3 — Compile and check for errors

```bash
# For surface syntax (.ion files in ion/src/)
node scripts/compile-ion.mjs

# For wire format — pass through the decoder then emitter directly:
node -e "
  const {decodeModule} = require('./dist/src/wire/decoder.js');
  const {emitTS} = require('./dist/emitters/typescript/emit.js');
  const fs = require('fs');
  const src = fs.readFileSync('path/to/file.ion', 'utf8');
  const ir = decodeModule(src);
  console.log(emitTS(ir));
"
```

### What a successful compile looks like
```
  ✓ [surface] ion/src/utils/greet.ion → src/ion-generated/utils/greet.ts (240B → 180B, 0.8×)
```

### What a gap error looks like
```
  ✗ ion/src/utils/greet.ion: Unhandled IonIRNode kind 'OopVirtualCall' in Python emitter
```
or a TypeScript type error:
```
  ✗ ion/src/utils/greet.ion: Type 'OopClassNode' is not assignable to type 'never'
```

---

## Step 4 — Handle a gap: use `raw(...)`

When an emitter does not yet support a construct, replace the unsupported construct with a `raw("...")` node containing verbatim target-language code. Every emitter is guaranteed to handle `raw(...)` by emitting the string unchanged.

### Surface syntax escape hatch

```ion
// BEFORE (causes a gap if OOP isn't supported):
let result = obj.transform(x);

// AFTER (always works):
let result = raw("obj.transform(x)");
```

### Wire format escape hatch

```
// BEFORE (gap if emitter doesn't handle OopVirtualCall):
app(oopCall(var(obj),transform,var(x)))

// AFTER:
raw("obj.transform(x)")
```

### Injecting multi-line code

Use `\n` inside the string for multiple lines:

```
raw("const result = obj\n  .step1()\n  .step2(x);")
```

### When to use raw(...)

| Situation | Action |
|---|---|
| Emitter gap (clear error message) | Use `raw(...)` |
| Complex OOP hierarchy with many methods | Use `raw(...)` for the whole class body |
| Framework-specific boilerplate (React hooks, LWC decorators, Apex annotations) | Use `raw(...)` for the framework-specific parts |
| Standard logic (math, string ops, list ops, let/case) | Always use proper ION nodes |

### Token budget rule
Only use `raw(...)` for the gap. Keep everything else in ION. A `let` binding wrapping a `raw(...)` still saves tokens on the surrounding structure:

```ion
// Still generates the full TypeScript function signature from ION,
// only the body uses raw():
let processItems = (items: [Str], config: Config) ->
  raw("items.filter(x => config.allow(x)).map(x => x.trim())");
```

---

## Writing UI components for React / HTML / Vue targets

In ION wire format, HTML elements are ordinary function calls: the first argument is a space-separated `key=value` attribute string, and the remaining arguments are children (text literals or nested element calls). The React, HTML, and Vue emitters recognise these calls by tag name and convert them to JSX / HTML / SFC syntax automatically.

### Pattern 1 — Simple stateless component

**.ion source (wire format)**:

```
I1
M ui.greeting v=1.0.0
F let Greeting:never=()->div("class=card",h2("class=title","Hello, World!"),p("class=subtitle","Welcome to ION"));0
```

**Compiled React TSX** (verbatim `ion build --target react` output):

```tsx
"use strict";
import React from 'react';

const Greeting: React.FC = () => (
  <div className="card">
    <h2 className="title">
{"Hello, World!"}
    </h2>
    <p className="subtitle">
{"Welcome to ION"}
    </p>
  </div>
);
```

**Token count**: Ion: 52 tokens → TSX: 67 tokens (saved 15, 22% vs writing TSX directly, cl100k)

---

### Pattern 2 — Component with typed props

Parameters in the lambda map directly to the React component's argument list in the compiled TSX.

**.ion source (wire format)**:

```
I1
M ui.user_card v=1.0.0
F let UserCard:never=(name:str,role:str)->div("class=user-card",h3("class=user-name",name),span("class=user-role",role));0
```

**Compiled React TSX**:

```tsx
"use strict";
import React from 'react';

const UserCard: React.FC = (name, role) => (
  <div className="user-card">
    <h3 className="user-name">
{name}
    </h3>
    <span className="user-role">
{role}
    </span>
  </div>
);
```

**Token count**: Ion: 52 tokens → TSX: 67 tokens (saved 15, 22% vs writing TSX directly, cl100k)

> For a fully typed props interface, use the `class` node (`oopClass` pattern) with fields — the emitter generates a `${Name}Props` interface and `extends React.Component<${Name}Props>`.

---

### Pattern 3 — Conditional render via `match` + list render via `raw`

**.ion source (wire format)**:

```
I1
M ui.status_list v=1.0.0
F let StatusBadge:never=(isActive:bool)->div("class=status-card",span("class=label","Status: "),match(isActive){true->span("class=badge-green","Active");_->span("class=badge-red","Inactive")});0 let ItemList:never=(items:[Str])->ul("class=list",raw("{items.map((item,i)=><li key={i}>{item}</li>)}"));0
```

**Compiled React TSX**:

```tsx
"use strict";
import React from 'react';

const StatusBadge: React.FC = (isActive) => (
  <div className="status-card">
    <span className="label">
{"Status: "}
    </span>
{isActive ? (
    <span className="badge-green">
{"Active"}
    </span>
) : (
    <span className="badge-red">
{"Inactive"}
    </span>
)}
  </div>
);
const ItemList: React.FC = (items) => (
  <ul className="list">
{items.map((item,i)=><li key={i}>{item}</li>)}
  </ul>
);
```

**Token count**: Ion: 103 tokens → TSX: 129 tokens (saved 26, 20% vs writing TSX directly, cl100k)

> `raw(...)` is needed for dynamic `array.map` in JSX because the React emitter only lifts calls into JSX when the callee is a known HTML tag. Arbitrary method-call callees (e.g. `items.map(...)`) fall through to the plain-expression path and lose JSX context for any nested tags. Include the `{...}` braces inside the raw string so the result is a valid JSX expression.

---

### HTML attribute → React prop mapping

The emitter rewrites the following HTML attribute names to their React equivalents. Attributes not in this table are passed through unchanged.

| HTML attribute | React prop    |
|----------------|---------------|
| `class`        | `className`   |
| `for`          | `htmlFor`     |
| `tabindex`     | `tabIndex`    |
| `onclick`      | `onClick`     |
| `onchange`     | `onChange`    |
| `onsubmit`     | `onSubmit`    |
| `oninput`      | `onInput`     |
| `onfocus`      | `onFocus`     |
| `onblur`       | `onBlur`      |
| `readonly`     | `readOnly`    |
| `maxlength`    | `maxLength`   |
| `colspan`      | `colSpan`     |
| `rowspan`      | `rowSpan`     |
| `crossorigin`  | `crossOrigin` |

**Event handler values**: when the attribute key starts with `on`, is in the table above, AND the value is a plain JS identifier (matches `[a-zA-Z_][a-zA-Z0-9_]*`), the emitter emits `{handler}` (curly braces). All other values are emitted as `"string"`. Event-like attributes that are NOT in the table (e.g. `onmouseover`) are always emitted as strings. For dynamic non-event attributes (e.g. `src={avatarUrl}`), include the `{}` inside the `raw(...)` string.

---

### Using HTML tags in surface syntax

HTML tag functions (`div`, `span`, etc.) are not in the ION prelude. In surface syntax (`.ion` files) each tag must be declared as an `@foreign` extern before use. Wire format is the recommended approach for all UI component work — tags need no declaration there and the token savings are greatest.

---

## React component patterns

These patterns require the React emitter to emit a **block-body** component (uses `{...}` braces with local bindings, not a bare arrow expression). The emitter automatically switches to block-body form when the `Abs` body is a `let` chain.

> **Known gap — tuple destructuring in let**: Ion's `let` binding only supports a single name (`let x = ...`); there is no `let [a, b] = ...` destructuring. Use `raw(...)` for the useState call and the emitter emits it verbatim as a statement. Filing sub-ticket for native tuple-destructuring in Let as a separate ION backlog item.
>
> **Known gap — list rendering with JSX inside map**: `items.map((x, i) => <li key={i}>{x}</li>)` requires `raw(...)` because the emitter only promotes HTML-tag `App` nodes to JSX — arbitrary method-call callees don't get JSX context for nested tags.

---

### Pattern 4 — Stateful counter (useState + click handler)

**.ion source (wire format)**:

```
I1
M ui.counter v=1.0.0
F let Counter:never=()->let _:unit=raw("const [count, setCount] = useState(0)");let handleClick:unit=()->raw("setCount(count + 1)");div("class=counter",p("","Count: "),button("onclick=handleClick","Increment"));0
```

**Compiled React TSX**:

```tsx
"use strict";
import React from 'react';

const Counter: React.FC = () => {
  const [count, setCount] = useState(0)
  const handleClick = () => setCount(count + 1);
  return (
    <div className="counter">
      <p>
{"Count: "}
      </p>
      <button onClick={handleClick}>
{"Increment"}
      </button>
    </div>
  );
};
```

**Notes**: `raw(...)` is needed for useState because Ion's `let` binding does not yet support tuple destructuring. The handler body uses `raw(...)` only for the imperative expression; the surrounding component structure and JSX are native Ion. No `raw()` wraps the whole function body.

---

### Pattern 5 — Controlled form input (multiple useState + onChange)

**.ion source (wire format)**:

```
I1
M ui.login_inputs v=1.0.0
F let LoginInputs:never=()->let _:unit=raw("const [email, setEmail] = useState(\"\")");let _:unit=raw("const [password, setPassword] = useState(\"\")");div("class=fields",input("type=email onchange=setEmail placeholder=Email"),input("type=password onchange=setPassword placeholder=Password"));0
```

**Compiled React TSX**:

```tsx
"use strict";
import React from 'react';

const LoginInputs: React.FC = () => {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  return (
    <div className="fields">
      <input type="email" onChange={setEmail} placeholder="Email" />
      <input type="password" onChange={setPassword} placeholder="Password" />
    </div>
  );
};
```

**Notes**: Multiple `raw(...)` useState calls stack naturally in the let chain — one per state variable. The JSX structure and attribute-to-prop mapping (`onchange` → `onChange`) are handled natively by the emitter.

---

### Pattern 6 — Async submit handler with error state

**.ion source (wire format)**:

```
I1
M ui.submit_form v=1.0.0
F let SubmitForm:never=()->let _:unit=raw("const [error, setError] = useState(null)");let _:unit=raw("const [loading, setLoading] = useState(false)");let handleSubmit:unit=(e:unit)->async{raw("{ e.preventDefault(); try { setLoading(true); setError(null); await submitData(); } catch (err) { setError(String(err)); } finally { setLoading(false); } }")};form("onsubmit=handleSubmit",raw("{error && <p className=\"error\">{error}</p>}"),button("type=submit","Submit"));0
```

**Compiled React TSX**:

```tsx
"use strict";
import React from 'react';

const SubmitForm: React.FC = () => {
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const handleSubmit = async (e) => { e.preventDefault(); try { setLoading(true); setError(null); await submitData(); } catch (err) { setError(String(err)); } finally { setLoading(false); } };
  return (
    <form onSubmit={handleSubmit}>
{error && <p className="error">{error}</p>}
      <button type="submit">
{"Submit"}
      </button>
    </form>
  );
};
```

**Notes**: An `Abs` whose body is `async{...}` emits as `async (params) => body` — not an IIFE. The `try/catch/finally` and the conditional `{error && ...}` require `raw(...)` because these are statement-level constructs or JSX short-circuit patterns not yet in the Ion emitter.

---

### Pattern 7 — List rendering with conditional empty state

**.ion source (wire format)**:

```
I1
M ui.item_list v=1.0.0
F let ItemList:never=(items:list<str>)->let _:unit=raw("const [filter, setFilter] = useState(\"\")");div("class=list-container",input("type=text onchange=setFilter placeholder=Filter"),match(items){_->raw("{items.length === 0 ? <p className=\"empty\">No items</p> : <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>}")});0
```

**Compiled React TSX**:

```tsx
"use strict";
import React from 'react';

const ItemList: React.FC = (items) => {
  const [filter, setFilter] = useState("")
  return (
    <div className="list-container">
      <input type="text" onChange={setFilter} placeholder="Filter" />
{items.length === 0 ? <p className="empty">No items</p> : <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>}
    </div>
  );
};
```

**Notes**: Both conditional render and `array.map` with JSX children require `raw(...)` (known gap — see top of section). The surrounding component structure, props, and input binding are all native Ion.

---

## Step 5 — Supported emitters and their coverage

| Emitter | File | Full coverage |
|---|---|---|
| TypeScript | `emitters/typescript/emit.ts` | ✅ All node kinds |
| JavaScript | `emitters/javascript/emit.ts` | ✅ All node kinds |
| Python | `emitters/python/emit.ts` | ✅ All node kinds |
| HTML | `emitters/html/emit.ts` | ✅ All node kinds |
| React TSX | `emitters/react/emit.ts` | ✅ All node kinds |
| Vue 3 SFC | `emitters/vue/emit.ts` | ✅ All node kinds |
| LWC | `emitters/lwc/emit.ts` | ✅ All node kinds |
| Apex | `emitters/apex/emit.ts` | ✅ All node kinds |

All emitters support `raw(...)`. If you get an "unhandled kind" error, that means the emitter has a new gap introduced since this was written — use `raw(...)` and file an issue.

---

## Quick reference — ION → TypeScript token savings

| TypeScript construct | ION approach | Estimated saving |
|---|---|---|
| `const x = a + b` | `let(Int,x,Int,app(var(add),var(a),var(b)),...)` | ~40% |
| `function f(x: string): string { return x.trim() }` | `let...abs...raw("x.trim()")` | ~35% |
| Full class with 5 methods | `oopClass(...)` | ~60% |
| React component | `oopClass(...)` or `.ion` surface | ~55% |
| ADT (discriminated union) | `adtDecl(...)` | ~70% |
| Pattern matching | `adtMatch(...)` | ~65% |
