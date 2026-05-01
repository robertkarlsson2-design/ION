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
