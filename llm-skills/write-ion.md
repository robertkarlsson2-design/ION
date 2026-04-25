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
  const {emitTS} = require('./dist/skills/typescript/emit.js');
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

## Step 5 — Supported emitters and their coverage

| Emitter | File | Full coverage |
|---|---|---|
| TypeScript | `skills/typescript/emit.ts` | ✅ All node kinds |
| JavaScript | `skills/javascript/emit.ts` | ✅ All node kinds |
| Python | `skills/python/emit.ts` | ✅ All node kinds |
| HTML | `skills/html/emit.ts` | ✅ All node kinds |
| React TSX | `skills/react/emit.ts` | ✅ All node kinds |
| Vue 3 SFC | `skills/vue/emit.ts` | ✅ All node kinds |
| LWC | `skills/lwc/emit.ts` | ✅ All node kinds |
| Apex | `skills/apex/emit.ts` | ✅ All node kinds |

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
