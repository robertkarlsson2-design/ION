# ION Wire Format — Reference

Wire format is the compact, zero-whitespace encoding of ION IR. It is designed for LLM-to-compiler communication: smaller token count, faster to write, no parser ambiguities.

## File structure

```
I1
M <module-name> <version>
S <alias1> <name1> <alias2> <name2> ...
F <alias1>.<type1> <alias2>.<type2> ...
<node>
<node>
...
```

Line 1 (`I1`) is the format sentinel.  
Line 2 (`M`) is the module header.  
Line 3 (`S`) is the name pool — repeated pairs of `alias name`.  
Line 4 (`F`) is the type pool — repeated `alias.typeExpr` entries.  
Subsequent lines are top-level IR nodes.

## Name and type pools

Rather than repeating long names, assign short aliases in the pools and reference them by alias in nodes.

```
S a Int b Float c greet d name
F a.Int b.Float c.(Int->Int) d.Str
```

Then use `a`, `b`, `c`, `d` in nodes instead of full names.

## Type expressions in the F pool

| Type | Wire encoding |
|---|---|
| `Int` | `Int` |
| `Float` | `Float` |
| `Str` | `Str` |
| `Bool` | `Bool` |
| `Unit` | `Unit` |
| `[Int]` | `[Int]` |
| `{Str:Int}` | `{Str:Int}` |
| `(Int,Str)->Bool` | `(Int,Str)->Bool` |
| `Option<Int>` | `Option<Int>` |
| `Result<Int,Str>` | `Result<Int,Str>` |

## Node reference

### Core nodes

```
var(name)                                  ← variable reference
lit(42)                                    ← Int literal
lit(3.14)                                  ← Float literal
lit("hello")                               ← Str literal
lit(true)                                  ← Bool literal
lit(null)                                  ← Null
app(callee, arg1, arg2, ...)               ← function application
                                           ← optional: AppNode.propDict carries named expression props
abs([param(n,t), ...], body)               ← lambda abstraction
let(bodyType, name, bindType, value, body) ← let binding
case(scrutinee, [arm(pat, body), ...])     ← pattern match
ctor(name, symbolId, arg1, arg2)           ← constructor application
acc(receiver, member)                      ← field accessor
list([elem1, elem2])                       ← list literal
map([key1:val1, key2:val2])                ← map literal
foreign(target, module, symbol, sig)       ← extern call
```

### OOP dialect nodes

```
oopClass(name, id, super?, ifaces, [field(n,t)...], [method(n,id,[p...],retT,body,isAbstract,isStatic)...])
oopInterface(name, id, [member(n,t)...])
oopNew(ctorId, arg1, arg2)
oopCall(receiver, method, arg1, arg2)
oopThis()
```

### Async dialect nodes

```
async(body)
await(expr)
```

### ADT dialect nodes

```
adtDecl(name, id, [variant(tag, id, [field(n,t)...])...])
adtMatch(scrutinee, [arm(tag, [binding(n,t)...], body)...])
```

### Effects dialect nodes

```
effectDecl(name, id, [op(opName, [param(n,t)...], retType)...])
perform(effectId, opName, arg1, arg2)
handle(body, [handler(opName, [param(n,t)...], handlerBody)...])
resume(value)
```

### Escape hatch

```
raw("verbatim target-language code")
```

Every emitter emits the string unchanged. Use when an emitter doesn't support a specific node. See `write-ion.md` for the full gap-handling workflow.

## Full example — TypeScript utility function

**Target TypeScript:**
```typescript
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
```

**ION wire format:**
```
I1
M org.example.math 1.0.0
S a clamp b value c min d max e lt f gt
F a.(Int,Int,Int)->Int b.Int c.Int d.Int e.(Int,Int)->Bool f.(Int,Int)->Bool
let(a,clamp,a,
  abs([param(b,Int),param(c,Int),param(d,Int)],
    case(app(var(e),var(b),var(c)),
      [arm(lit(true),var(c)),
       arm(wildcard,
         case(app(var(f),var(b),var(d)),
           [arm(lit(true),var(d)),
            arm(wildcard,var(b))]))])))
```

## Full example — with raw() escape hatch

**Target TypeScript:**
```typescript
export function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}
```

**ION wire format (using raw() because Date methods aren't in ION's type system):**
```
I1
M org.example.dates 1.0.0
S a formatDate b d
F a.(Str)->Str b.Str
let(a,formatDate,a,
  abs([param(b,Str)],
    raw("d.toISOString().split('T')[0]")))
```

## propDict — named expression props on App nodes

`AppNode` carries an optional `propDict` field: `readonly { key: string; value: IonIRNode }[]`.

This is an **additive, backward-compatible extension** — the field is absent on nodes produced by positional-only call expressions, and the deserializer treats a missing `propDict` as `undefined` (no version bump to `I1` required).

**When it is populated**: the ION desugarer sets `propDict` for any call argument written with a label (`key: expr`). Positional (unlabeled) args remain in `args`; labeled args move into `propDict`. Both can coexist:

```ion
// Positional + labeled
Card("class=card", key: item.id, item: item)
// → AppNode { args: [Str("class=card")], propDict: [{key:"key", value:...}, {key:"item", value:...}] }
```

**React emitter**: the React emitter renders `propDict` entries as JSX expression attributes:
```tsx
<Card className="card" key={item.id} item={item} />
```

**Other emitters**: emitters that do not yet handle `propDict` will ignore the field silently (since it is optional). File a ticket to add support if needed.

## Special call forms inside expressions

| Form | Meaning |
|---|---|
| `app(callee, ...args)` | Explicit application where the callee is itself an expression (typically an FFI ref). **Required** for calling FFI refs: `app(ffi:js:pg:Pool, conn)`. Without `app(...)`, `name(args)` parses as a call to a Var named `name`. |
| `async{body}` | AsyncBlock — runs body in `(async () => body)()`. |
| `await(expr)` | Emits `await expr`. Must be inside `async{...}` or an async surface function. |
| `match(scrutinee){pat->body;...}` | Pattern match. For booleans, use `match(b){true->a;_->b}` — emits a ternary. |
| `raw("...")` | Verbatim target-language escape hatch — line-level only, never whole-module. |

Example — async DB query body in real Ion (no `raw()` for the function body):
```
F let getUser:fn(any,str)->any=(p:any,id:str)->async{await(app(ffi:js:pg:Pool,p,id))};0
```
emits:
```ts
const getUser = (p: any, id: string) => (async () => await Pool(p, id))();
```

FFI refs can also be used at the top of an `F` line as bare identifiers (no `app(...)` needed) when you only want to declare them, not call them — that's how cross-module FFI imports register the module name (see ION-190).

## Operator builtins (use via `app(__name__, args)`)

Wire form has no infix operators. Use these built-in names with `app(...)`:

| Wire form | TS output | Notes |
|---|---|---|
| `app(__add__,a,b)` | `a + b` | Arithmetic + string concat |
| `app(__sub__,a,b)` | `a - b` | |
| `app(__mul__,a,b)` | `a * b` | |
| `app(__div__,a,b)` | `a / b` | |
| `app(__mod__,a,b)` | `a % b` | |
| `app(__eq__,a,b)` | `a === b` | Strict equality |
| `app(__ne__,a,b)` | `a !== b` | |
| `app(__lt__,a,b)` | `a < b` | Plus `__gt__`, `__le__`, `__ge__` |
| `app(__and__,a,b)` | `a && b` | |
| `app(__or__,a,b)` | `a \|\| b` | |
| `app(__neg__,a)` | `-a` | |
| `app(__not__,a)` | `!a` | |
| `app(__obj__,"k1",v1,"k2",v2,...)` | `{ k1: v1, k2: v2, ... }` | Object literal — string keys + value expressions interleaved. |
| `app(__index__,arr,i)` | `arr[i]` | Array/object indexing. |
| `app(__nullish__,a,b)` | `(a ?? b)` | Nullish coalescing. |
| `app(__optchain__,obj,"member")` | `obj?.member` | Optional chaining (member must be a string literal). |

These let you write real-Ion bodies for almost every common JS expression
pattern without dropping into `raw(...)`.
