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

## Wire-format syntax — sugared form (use this)

This is the canonical syntax for writing `.ion` wire-format files. The
underlying IR builtin names (`app(__obj__, ...)`, etc.) are listed at the
end as a reference but **do not author wire format using the verbose
`app(__name__, ...)` form** — it costs more bytes and the architecture
stage will reject as not idiomatic.

| Sugar | TS output | Notes |
|---|---|---|
| `{k:v,k:v}` | `{ k: v, k: v }` | Inline object literal. Bare ident or string key. |
| `{...:obj,k:v}` | `{ ...obj, k: v }` | Spread inside object. |
| `{stmt;stmt;result}` | `(() => { stmt; stmt; return result; })()` | Multi-statement do-block. |
| `arr[i]` | `arr[i]` | Postfix indexing. |
| `obj?.field` | `obj?.field` | Optional chain. |
| `!x` | `!x` | Prefix not. |
| `a+b` `a-b` `a*b` `a/b` `a%b` | infix arithmetic | |
| `a===b` `a!==b` | strict equality | |
| `a<b` `a>b` `a<=b` `a>=b` | comparison | |
| `a&&b` `a\|\|b` | logical | |
| `a??b` | `(a ?? b)` | Nullish coalescing. |
| `c?a:b` | `c ? a : b` | Ternary. Lowest precedence. |
| `(expr)` | (grouped) | Parens for precedence grouping. |
| `(p1, p2) -> body` | function with `:any` params | Default `:any` annotation. |
| `({a, b}) -> body` | `({a, b}: any) => body` | Lambda destructuring (object). |
| `([x, y]) -> body` | `([x, y]: any) => body` | Lambda destructuring (array). |
| `let x = v` | `let x:any = v` | Default `:any` let-binding. |
| `app(callee, ...args)` | `callee(...args)` | Explicit application — needed for calling FFI refs and other expression callees. |
| `obj->method(args)` | `obj.method(args)` | Method call. |
| `async{body}` | `(async () => body)()` | Async block. Body can be a let-chain or a do-block. |
| `await(expr)` or `@expr` | `await expr` | Must be inside `async{...}`. `@expr` saves 5 chars per use. |
| `throw "msg"` or `throw EXPR` | `(() => { throw new Error(EXPR); })()` | Throw as expression. |
| `try{T}catch{C}` | async-IIFE try/catch | Each `{...}` body parses as a do-block (semicolons separate statements). |
| `try{T}catch{C}finally{F}` | async-IIFE try/catch/finally | For pg transactions with rollback + cleanup. |
| `try{T}finally{F}` | async-IIFE try/finally | Rare. |
| `match(scrutinee){pat->body;...}` | TS chain of ternaries on `_tag` (or `===` for booleans) | For ADTs. For booleans prefer the `c?a:b` ternary form. |
| `<Tag attr=v {...spread}>kids</Tag>` | `React.createElement(Tag, {attr:v, ...spread}, ...kids)` | JSX sugar for React. Lowercase tag → string ("div"); uppercase → identifier. Self-closing `<Tag/>` for no children. Children: nested JSX, `{expr}` interpolation, raw text. |
| `&alias` | (the literal pooled in `L`) | Reference to a string in the L (literal) pool. Use to dedupe long SQL/error/format strings repeated across the file. |
| `raw("expr")` | verbatim TS | Line-level escape hatch. Never wrap a whole function body. |

Operator precedence (high → low): postfix `[]` `?.`, prefix `!`, `* / %`,
`+ -`, `< > <= >=`, `=== !==`, `&&`, `||`, `??`, ternary `?:`.

### `L` literal pool

Long string literals (SQL queries, error codes, format strings) repeated across a file dedupe via the `L` line:

```
L q1="SELECT id, email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL" code401="UNAUTHORIZED" msg401="Missing Authorization header"
F let findUser=(p,id)->async{let r=@p->query(&q1,[id]);r.rows[0]??null}
F let unauth=(res)->res->status(401)->json({error:{code:&code401,message:&msg401}})
```

The L line maps short aliases (`q1`, `code401`) to string-literal values; reference them as `&alias` in any expression position. Worth doing when a string is ≥40 bytes AND used ≥2 times.

### Example — a complete async pg query function

```
F let getMe=(pool,userId)->async{let r=await(pool->query("SELECT id, email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL",[userId]));r.rows[0]??null}
```

emits:

```ts
const getMe = (pool: any, userId: any) => (async () => {
  const r: any = await pool.query("SELECT id, email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
  return (r.rows[0] ?? null);
})();
```

### Example — JWT signing with object spread

```
F let signToken=(payload)->app(ffi:js:jsonwebtoken:sign,{...:payload,jti:app(ffi:js:crypto:randomUUID)},getJwtSecret(),{expiresIn:"24h"})
```

emits:

```ts
const signToken = (payload: any) => sign({ ...payload, jti: randomUUID() }, getJwtSecret(), { expiresIn: "24h" });
```

### Example — try/catch/finally for transactions

```
F let createCrew=(pool,userId,name)->async{let client=await(pool->connect());app(__tryfin__,let _b=await(client->query("BEGIN"));let cr=await(client->query("INSERT...",[name,userId]));let crew=cr.rows[0];let _m=await(client->query("INSERT crew_members...",[crew.id,userId,"owner"]));let _c=await(client->query("COMMIT"));crew,{await(client->query("ROLLBACK"));raw("(() => { throw e; })()")},client->release())}
```

emits clean async TS with try/catch/finally, BEGIN/COMMIT, ROLLBACK on error,
client.release() in finally.

## Authoring rule (hard)

Forbidden: `let X:fn(...)->any=raw("entire async body")`. The body of every
function MUST be real Ion using the sugar above. `raw(...)` is line-level
only — for the rare expression Ion can't express today (re-throw `e`,
TypeScript type augmentations, multi-step dynamic SQL with for-loops).
Architecture stage rejects whole-body raw().

## Verified savings on real OTOURENV2 files

| File | Ion bytes | TS bytes | Savings |
|---|---|---|---|
| services/shared/users.ion | 342 | 368 | 7% |
| services/shared/auth.ion (10 funcs) | 1947 | 2194 | 11% |
| services/crew/crews.ion (5 funcs incl. transaction) | 1652 | 1971 | 16% |
| services/crew/courses.ion | 2110 | 2359 | 11% |
| services/crew/courseFeatures.ion | 2396 | 2666 | 10% |
| services/crew/courseHoles.ion | 1349 | 1527 | 12% |
| services/crew/courseFavorites.ion | 1110 | 1220 | 9% |
| services/crew/members.ion (5 simple + 2 raw transactions) | 4690 | 4983 | 6% |

Average: 10% smaller in Ion than the equivalent TypeScript.

## Underlying IR builtins (reference only — do not author with these)

The sugar above lowers to these IR-level builtin names. Listed for
debugging compiler output, not for authoring:

`__add__` `__sub__` `__mul__` `__div__` `__mod__` `__eq__` `__ne__`
`__lt__` `__gt__` `__le__` `__ge__` `__and__` `__or__` `__neg__` `__not__`
`__obj__` `__index__` `__nullish__` `__optchain__` `__throw__` `__env__`
`__set__` `__regex__` `__try__` `__tryfin__` `__finally__` `__do__`
`__seq__` `__spread__`.

## `__fold__` for dynamic SQL (and reduce in general)

`app(__fold__, list, init, fn)` lowers to `list.reduce(fn, init)`. Use for the dynamic-SQL UPDATE-by-fields pattern:

```
F let updateCols=(allowed,fields)->app(__fold__,allowed,{sets:[],vals:[],i:1},(acc,col)->fields[col]!==undefined?{sets:acc.sets->concat([col+" = $"+acc.i]),vals:acc.vals->concat([fields[col]]),i:acc.i+1}:acc)
```

emits a clean `allowed.reduce((acc, col) => fields[col] !== undefined ? {...} : acc, {sets:[],vals:[],i:1})`.
