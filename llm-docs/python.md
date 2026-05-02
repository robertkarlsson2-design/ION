
# Writing Ion for Python

The Python emitter (`emitters/python/emit.ts`, ~545 lines) targets Python 3.10+ and produces idiomatic `def`-based functions, dict-shaped ADT values, and a positional-template prelude. This skill grounds every example below in either the `tests/golden/js/*.ion` corpus (same surface syntax) or a verified `ion build --target python` run.


## Type mapping

The Python emitter does **not emit type annotations** by default. Python's runtime is duck-typed; the emitter omits `: int`, `: str`, etc. on parameters and return values.

| Ion type | Python (where annotations would land) | Emitted? |
|---|---|---|
| `Int` | `int` | ❌ no annotation |
| `Float` | `float` | ❌ |
| `Str` | `str` | ❌ |
| `Bool` | `bool` | ❌ |
| `Unit` | `None` | ❌ |
| `List<T>` | `List[T]` (typing) | ❌ |
| `Map<K,V>` | `Dict[K,V]` | ❌ |
| `Option<T>` | `Optional[T]` | ❌ |
| User type `User` | `User` | ❌ |

If you want type hints in the emitted Python, add them by hand to the output, or use `raw("def foo(x: int) -> int: ...")` (untested for surface syntax — verify with `ion build`).


## Functions — the emission rule

```ion
fn double(x: Int) -> Int = x * 2
```

emits:

```python
def double(x):
    return x * 2
```

For multi-let bodies, the emitter uses real Python statements (no IIFE trick):

```ion
fn addOne(x: Int) -> Int = let n = x + 1; n
```

emits:

```python
def addOne(x):
    n = x + 1
    return n
```

This is **cleaner than the TypeScript output** for the same input — Python's statement-oriented function bodies map directly to Ion's let-chain desugaring.


## Lambdas

Top-level lambdas with let-bindings can't fit in a Python `lambda` (statements not allowed), so the emitter falls back to **nested-lambda chains** (`emitPyLetChain`):

```ion
let f = (x: Int) ->
  let n = x + 1;
  let m = n * 2;
  m
```

emits:

```python
f = lambda x: (lambda n: (lambda m: m)(n * 2))(x + 1)
```

Functionally correct; visually noisy. For readability, write top-level functions as `fn` declarations (which become `def`) rather than `let` lambdas with bodies.


## Operators

The double-underscore operator names map to Python operators:

| Ion | Python |
|---|---|
| `__add__`/`__sub__`/`__mul__`/`__div__`/`__mod__` | `+`/`-`/`*`/`/`/`%` |
| `__eq__`/`__ne__` | `==`/`!=` |
| `__lt__`/`__gt__`/`__le__`/`__ge__` | `<`/`>`/`<=`/`>=` |
| `__and__`/`__or__` | `and`/`or` (not `&&`/`||`) |
| `__not__` | `not ` |
| `__neg__` | `-` |

Note `__div__ → /` produces **true division** in Python 3 (returns float). For integer division, use `floor(a / b)` from the prelude.

Verified compile (`tests/golden/py/...` does not exist but `ion build --target python` on the canonical pipeline file emits):

```ion
fn isEven(n: Int) -> Bool = n % 2 == 0
```

```python
def isEven(n):
    return (n % 2) == 0
```


## Prelude — Python templates

The Python emitter has its own prelude template table (`emit.ts::PYTHON_PRELUDE`). When you call a prelude function, it expands inline (no helper `def` injected):

| Ion call | Python expansion |
|---|---|
| `map(xs, f)` | `list(map(f, xs))` |
| `filter(xs, p)` | `list(filter(p, xs))` |
| `fold(xs, init, f)` | `__import__("functools").reduce(f, xs, init)` |
| `length(xs)` | `len(xs)` |
| `range(a, b)` | `list(range(a, b))` |
| `concat(a, b)` | `a + b` |
| `contains(xs, x)` | `x in xs` |
| `isEmpty(xs)` | `len(xs) == 0` |
| `reverse(xs)` | `list(reversed(xs))` |
| `slice(xs, a, b)` | `xs[a:b]` |
| `joinWith(xs, sep)` | `sep.join(xs)` |
| `flatMap(xs, f)` | `[__x for __xs in map(f, xs) for __x in __xs]` |
| `any(xs, p)` / `all(xs, p)` | `any(map(p, xs))` / `all(map(p, xs))` |
| `head(xs)` / `last(xs)` / `tail(xs)` | `xs[0]` / `xs[-1]` / `xs[1:]` |
| `sort(xs)` / `unique(xs)` | `sorted(xs)` / `list(dict.fromkeys(xs))` |
| `toString(n)` / `toInt(s)` / `toFloat(s)` | `str(n)` / `int(s)` / `float(s)` |
| `print(msg)` | `print(msg)` |
| `abs`/`floor`/`ceil`/`round`/`sqrt`/`min`/`max`/`pow` | `abs(...)`/etc. (some via `__import__("math")`) |
| `split`/`trim`/`toUpper`/`toLower` | `s.split(...)` / `s.strip()` / `s.upper()` / `s.lower()` |

Each call site expands to the inline expression — there are NO `def map(...): ...` declarations injected (unlike the TS emitter).

### Verified compile

```ion
fn double(x: Int) -> Int = x * 2
fn isEven(n: Int) -> Bool = n % 2 == 0
fn process(xs: List<Int>) -> List<Int> =
  xs |> filter(isEven) |> map(double)
```

emits:

```python
def double(x):
    return x * 2

def isEven(n):
    return (n % 2) == 0

def process(xs):
    return list(map(double, list(filter(isEven, xs))))
```

Pipeline desugaring works identically to other targets.


## `data` types — emit as ADT dicts (NOT dataclasses)

⚠️ **The Python emitter does NOT emit `@dataclass` classes.** It emits ADT-style dicts with a `_tag` discriminator.

```ion
data User = User { id: Int; name: Str; active: Bool }
```

emits:

```python
# ADT: User
def User(id, name, active):
    return {"_tag": "User", "id": id, "name": name, "active": active}
```

Same gap structure as the TS emitter for record-style `data` decls — but here the gap is **less severe** because Python's runtime is duck-typed: as long as you access `u["id"]` (or use `getattr` semantics via dict), things work. The downside is:

1. No `isinstance(u, User)` check (use `u["_tag"] == "User"` instead).
2. No editor autocompletion on field access without external type stubs.
3. Field access via `u.id` from Ion **emits as Python `u.id`** (attribute access) → fails at runtime (dict access needs `u["id"]`).

**Workaround for #3 — the dict-attribute access mismatch:**

The emitter's `Accessor` IR node always emits `obj.field` regardless of whether `obj` is a Python class or a dict. This means:

```ion
fn getName(u: User) -> Str = u.name
```

emits:

```python
def getName(u):
    return u.name
```

But `u` is a dict, so `u.name` raises `AttributeError: 'dict' object has no attribute 'name'`. **You need a wrapper class** or to override accessor emission.

**Practical fix today:** wrap the dict in a `dataclass` shim by hand-editing the generated Python, or declare `User` via `OopClass` (which the emitter handles correctly with Python's class syntax — see "Classes" below).

### Sum types

```ion
data Shape = Circle | Rect(Int, Int)
```

emits:

```python
# ADT: Shape
Circle = {"_tag": "Circle"}
def Rect(_0, _1):
    return {"_tag": "Rect", "_0": _0, "_1": _1}
```

Verified per `tests/golden/js/adt-mixed-variants.expected.js` (same emission shape, with `def` instead of `const`).


## Pattern matching

The Python emitter does **NOT use Python 3.10+ `match` statements**. It emits ternary chains:

```ion
fn area(s: Shape) -> Float =
  case s._tag of {
    "Circle" -> 3.14 * s.r * s.r
  | "Rect" -> s.w * s.h
  | _ -> 0.0
  }
```

emits:

```python
def area(s):
    return ((3.14 * s.r) * s.r) if (s._tag == "Circle") else (s.w * s.h) if (s._tag == "Rect") else 0.0
```

**Same arm-binding gap as TS:** patterns like `Circle(r) -> r * r` produce code referring to bare `r` instead of `s["r"]`. Use the explicit `case s._tag of` form with field accessors (per the workaround in writing-ion-for-typescript.md).

ADT-match (`adtMatch` IR node) emits this pattern:

```python
(lambda _s: (lambda _s: (exec('id = _s["id"]') or _s["id"]) if _s["_tag"] == "Named" else None)(_s) or (lambda _s: (exec('') or 0) if _s["_tag"] == "_" else None)(_s))(_s)
```

Honest assessment: this `exec` + ternary chain is **structurally questionable** — `exec` doesn't bind names in the enclosing lambda's scope, so the bindings don't actually take effect for the body. Treat ADT match in Python as **broken for variable-binding patterns** and use explicit `case s._tag of` plus dict access, exactly like the TS workaround.


## Classes — `OopClass` works correctly

When you have a class declaration (via wire format or `OopClass` IR), the Python emitter generates **proper class syntax with `__init__`, methods, decorators, and `Generic[T]`** support:

```python
from abc import ABC, abstractmethod
from typing import Generic, TypeVar
T = TypeVar('T')

class Container(Generic[T]):
    def __init__(self, value):
        self.value = value
    
    def get(self):
        return self.value
    
    @property
    def isEmpty(self):
        return self.value is None
```

The emitter handles:
- Auto-generated `__init__` from fields (instance fields only)
- Visibility prefixes: `private` → `__name`, `protected` → `_name`
- Static fields/methods → class-level + `@staticmethod`
- Abstract methods → `@abstractmethod` + `from abc import ABC, abstractmethod`
- Generic type params → `Generic[T]` + `TypeVar` declarations
- Property accessors (`get`/`set`) → `@property` and `@<name>.setter`
- Custom annotations → emit as `@decoratorName(...)` lines

**Surface-syntax trigger:** `data User = User { id: Int }` lands in `irModule.data` (ADT), NOT `irModule.decls` as `OopClass`. To get a real Python class, you need wire format or to file an enhancement that promotes record-style `data` to `OopClass` for the Python target.


## Worked example 1 — Pure number-crunching

```ion
fn fib(n: Int) -> Int = if n < 2 then n else fib(n - 1) + fib(n - 2)

fn sumTo(n: Int) -> Int = sum(range(0, n + 1))
```

emits:

```python
def fib(n):
    return n if n < 2 else (fib(n - 1) + fib(n - 2))

def sumTo(n):
    return sum(list(range(0, n + 1)))
```

Verified compile.


## Worked example 2 — Typed dataclass with method (gap-aware)

**Wanted output:**

```python
from dataclasses import dataclass

@dataclass
class User:
    id: int
    name: str
    active: bool
    
    def display(self) -> str:
        return f"{self.id}: {self.name}"
```

**What you can express in Ion surface syntax today:**

```ion
data User = User { id: Int; name: Str; active: Bool }

fn display(u: User) -> Str =
  toString(u.id)  // and concat with name — but format strings have no surface
```

**What actually emits:**

```python
def User(id, name, active):
    return {"_tag": "User", "id": id, "name": name, "active": active}

def display(u):
    return str(u.id)  # u.id will fail at runtime — see dict-attr gap
```

**Honest workaround:** for any code where Python developers expect `@dataclass`, hand-write a wrapper module that re-exports the dataclasses, and use Ion only for the function bodies referencing them via `extern`.


## Worked example 3 — Async HTTP (heavily reliant on extern)

Python's `async def`/`await` is NOT generated by the Python emitter today. The `AsyncBlock` IR node emits `(lambda: body)` (a thunk), and `Await` becomes the bare expression:

```ion
fn fetchValue() !async -> Int =
  raw("await aiohttp.ClientSession().get('/api')")
```

⚠️ **`raw(...)` is not in surface syntax** (per the generic write-ion skill — confirmed in the binder error `Undefined name 'raw'`). So this exact form doesn't compile. You must use the wire format to embed `raw(...)` IR nodes, OR use an `extern` whose template inlines the async expression:

```ion
@foreign("aiohttp", "fetch", "await aiohttp.ClientSession().get($1)")
extern fn fetch(url: Str) -> Str

fn getData() -> Str = fetch("/api")
```

emits (untested in this exact form):

```python
fetch = lambda url: await aiohttp.ClientSession().get(url)
```

⚠️ The `lambda` here can't contain `await` in Python — Python lambdas can't be async. **This emit is invalid Python.** The honest answer: **async Python is not currently expressible cleanly via the Python emitter**. File an enhancement request.

For sync code, use the same `extern` pattern without `await`:

```ion
@foreign("requests", "get", "requests.get($1).json()")
extern fn get(url: Str) -> Str

fn getData() -> Str = get("/api/users")
```

emits:

```python
get = lambda url: requests.get(url).json()
def getData():
    return get("/api/users")
```

The `lambda` form for `extern` is awkward but valid Python. For synchronous IO this works.


## Common gotchas — Python target

| Symptom in emitted code | Cause | Fix |
|---|---|---|
| `u.id` raises `AttributeError` | `data` decl emits dict, not class | Hand-write dataclass; use dict access in Ion (`u["id"]` via `extern`) |
| `(n % 2) == 0` parens (mostly cosmetic) | `needsParens` is conservative | Ignore — semantically correct |
| No type hints anywhere | Emitter omits all annotations | Add by hand or open an enhancement |
| `match` statements never appear | Emitter uses ternary chains | Acceptable; if you want match, hand-edit |
| `lambda x: (lambda y: ...)(...)` chains | Surface `let` chains in lambda position | Hoist to `def` (use `fn` not `let`) |
| `await` inside `lambda` | `extern` template + `!async` | Don't — async needs proper hand-rolled output |
| `exec(...)` in ADT-match output | ADT-match emitter shape | Use `case x._tag of` instead |


## Recommended workflow

1. **Use Ion for pure functions and pipeline logic.** This is where the emitter shines: `def double(x): return x * 2` emits cleanly.
2. **Use `extern` for any IO** — DB calls, HTTP, file IO. The `lambda x: template($1)` shape works for sync calls.
3. **Skip `data` for record-shaped Python objects.** Hand-write a dataclass module. Reference its constructors via `extern`.
4. **Skip async Python entirely in Ion.** Hand-write the async layer; let Ion handle the synchronous helpers it calls.
5. **Run `python -m py_compile your_file.py`** as a syntax check after each `ion build` — catches the malformed-lambda async case immediately.


## What works (verified)

- `def` from `fn ... -> ...`
- `lambda` from `let ... = (...) -> ...`
- All arithmetic and comparison operators
- Pipeline `|>` desugaring
- Prelude function expansion (45 functions)
- Branch-2 case → ternary
- `OopClass` declarations (full support including generics, ABCs, properties, decorators)
- ADT constructors as dict factories

## What doesn't work cleanly today

- `@dataclass` emission for record `data` decls
- `match` statement emission for ADT patterns
- Variable-binding patterns in `case x of Foo(y) -> ...`
- `async def` / `await` for `!async` effect
- Type hints (`int`, `Optional[int]`) on params and returns
- `import` statements between Ion modules (`@foreign` references aren't auto-imported)
- `raw(...)` at surface syntax level

For each unsupported pattern, the realistic path is: hand-edit the emitted Python OR use wire format (`.ionw`) where the IR nodes are constructable directly.
