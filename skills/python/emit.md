# Python Emitter Rules

## Overview

Ion compiles to idiomatic Python 3. This document describes how Ion constructs
map to Python output and how to write Ion that produces clean, readable Python.

---

## Top-level declarations

- `fn name(x: Int) -> Int = expr` compiles to:
  ```python
  def name(x):
      return expr
  ```
- Simple value bindings (`let x = expr` at top level) compile to:
  ```python
  x = expr
  ```
- No type annotations are emitted in Python output — Ion types are erased.
- No `__all__`, no `if __name__ == "__main__"` guard is emitted automatically.

---

## Functions and lambdas

- Named top-level functions always emit as `def` with a `return` statement.
- Anonymous functions (`x -> expr`) compile to `lambda x: expr`.
- Multi-parameter lambdas: `(x, y) -> expr` → `lambda x, y: expr`.
- Zero-parameter lambdas: `() -> expr` → `lambda: expr`.
- `lambda` bodies must be single expressions in Python. If the Ion body
  contains `let` bindings, they become nested lambda applications (see below).

---

## Let bindings in expressions

Expression-level `let` bindings are encoded as immediately-applied lambdas:

```
let x = val in body
```
compiles to:
```python
(lambda x: body)(val)
```

Multiple consecutive lets chain outward:
```
let x = a in let y = b in expr
```
compiles to:
```python
(lambda x: (lambda y: expr)(b))(a)
```

**Avoid deep nested lets in expression context** — they produce verbose,
hard-to-read Python. Prefer hoisting bindings to top-level `def` bodies
where the emitter can use `x = val` assignment statements instead.

Inside a named `def`, let bindings become assignment statements followed
by `return`:
```python
def foo(n):
    x = n + 1
    y = x * 2
    return y
```
This is the idiomatic path. Write helper logic inside named functions
rather than in anonymous lambda chains when targeting Python.

---

## Conditionals

`if c then a else b` compiles to Python's ternary expression:
```python
a if c else b
```

Ion `case` expressions with multiple arms emit as chained ternaries:
```python
(branch1) if (cond1) else (branch2) if (cond2) else fallback
```

Prefer simple `if/else` over complex multi-arm `case` when targeting Python —
deeply nested ternaries are legal but hard to read.

---

## Operators

| Ion | Python |
|-----|--------|
| `&&` | `and` |
| `\|\|` | `or` |
| `!x` | `not x` |
| `==` | `==` (Python uses `==` for structural equality) |
| `!=` | `!=` |
| `+`, `-`, `*`, `/`, `%` | `+`, `-`, `*`, `/`, `%` |
| `**` (via `pow`) | `**` |

Note: Ion has no `===` / `!==` — `==` always compiles to Python `==`.

Boolean literals: `True` → `True`, `False` → `False`.
Null: `None` → `None`.

---

## Type mapping

| Ion type | Python runtime type |
|----------|---------------------|
| `Int` | `int` |
| `Float` | `float` |
| `Bool` | `bool` |
| `Str` | `str` |
| `List<a>` | `list` |
| `Option<a>` | value or `None` |
| `Unit` | `None` (ignored return) |
| `Map<k,v>` / record | `dict` |
| ADT variant | `dict` with `"_tag"` key |

Python has no generic type parameters at runtime. `List<Int>` and `List<Str>`
both emit as plain `list`. Do not rely on Ion's type system for Python
runtime type safety — add `isinstance` checks via `@foreign` if needed.

---

## Prelude functions — clean Python output

The following prelude functions are wired directly to Python idioms and
produce clean, idiomatic output. **Prefer these over raw `@foreign` calls.**

| Ion prelude | Python output |
|-------------|---------------|
| `map(lst, f)` | `list(map(f, lst))` |
| `filter(lst, pred)` | `list(filter(pred, lst))` |
| `fold(lst, init, f)` | `__import__("functools").reduce(f, lst, init)` |
| `length(lst)` | `len(lst)` |
| `range(lo, hi)` | `list(range(lo, hi))` |
| `head(lst)` | `lst[0]` |
| `tail(lst)` | `lst[1:]` |
| `last(lst)` | `lst[-1]` |
| `sort(lst)` | `sorted(lst)` |
| `sortBy(lst, key)` | `sorted(lst, key=key)` |
| `reverse(lst)` | `list(reversed(lst))` |
| `any(lst, pred)` | `any(map(pred, lst))` |
| `all(lst, pred)` | `all(map(pred, lst))` |
| `sum(lst)` | `sum(lst)` |
| `product(lst)` | `__import__("math").prod(lst)` |
| `zip(a, b)` | `list(zip(a, b))` |
| `unique(lst)` | `list(dict.fromkeys(lst))` |
| `indexOf(lst, x)` | `lst.index(x)` |
| `find(lst, pred)` | `next(filter(pred, lst), None)` |
| `findIndex(lst, pred)` | `next((i for i, x in enumerate(lst) if pred(x)), -1)` |
| `flatten(lst)` | `[x for xs in lst for x in xs]` |
| `flatMap(lst, f)` | `[x for xs in map(f, lst) for x in xs]` |
| `concat(a, b)` | `a + b` |
| `contains(lst, x)` | `x in lst` |
| `isEmpty(lst)` | `len(lst) == 0` |
| `slice(lst, lo, hi)` | `lst[lo:hi]` |
| `joinWith(lst, sep)` | `sep.join(lst)` |
| `split(s, sep)` | `s.split(sep)` |
| `trim(s)` | `s.strip()` |
| `toUpper(s)` | `s.upper()` |
| `toLower(s)` | `s.lower()` |
| `startsWith(s, prefix)` | `s.startswith(prefix)` |
| `endsWith(s, suffix)` | `s.endswith(suffix)` |
| `replace(s, pat, rep)` | `s.replace(pat, rep)` |
| `repeat(s, n)` | `s * n` |
| `strLen(s)` | `len(s)` |
| `strIndexOf(s, sub)` | `s.find(sub)` |
| `strContains(s, sub)` | `sub in s` |
| `toString(x)` | `str(x)` |
| `toFloat(x)` | `float(x)` |
| `toInt(x)` | `int(x)` |
| `abs(x)` | `abs(x)` |
| `floor(x)` | `int(x)` |
| `ceil(x)` | `__import__("math").ceil(x)` |
| `round(x)` | `round(x)` |
| `sqrt(x)` | `__import__("math").sqrt(x)` |
| `min(a, b)` | `min(a, b)` |
| `max(a, b)` | `max(a, b)` |
| `pow(base, exp)` | `base ** exp` |
| `print(x)` | `print(x)` |
| `printInt(x)` | `print(x)` |
| `printFloat(x)` | `print(x)` |

---

## Functions that need @foreign

Use `@foreign` for anything outside the prelude list above:

- `os.path.join`, file I/O, `open()`
- `json.dumps` / `json.loads`
- `re.match`, `re.sub`
- `sys.argv`, `sys.exit`
- `datetime.now()`
- `collections.defaultdict`, `Counter`
- `random.random()`, `random.choice()`
- Any third-party library (requests, numpy, etc.)

See `stdlib.ion` in this directory for ready-made `@foreign` declarations
covering the most common Python stdlib functions.

---

## Algebraic data types (ADT)

Ion `data` declarations compile to dict-based factories in Python:

```ion
data Shape {
  Circle { radius: Float }
  Rect { width: Float, height: Float }
  Point
}
```

emits:

```python
# ADT: Shape
def Circle(radius):
    return {"_tag": "Circle", "radius": radius}

def Rect(width, height):
    return {"_tag": "Rect", "width": width, "height": height}

Point = {"_tag": "Point"}
```

ADT match expressions emit as nested lambda chains using `_s["_tag"]` checks.
They are functional but verbose. For performance-sensitive code with many
variants, prefer `@foreign` wrapping a Python `match` statement (Python 3.10+)
or a dict dispatch table.

---

## Effects

Ion's effect system (`!io`, `!async`, `!err`) is a **type-level hint only**
in Python output. No runtime machinery is emitted for effects.

- `!io` — no runtime change; the function body executes normally.
- `!async` — Python has `async def` / `await`, but Ion's async is not mapped
  to Python coroutines. Use `@foreign` to bridge Python async code.
- `!err` — no `Result` wrapper is emitted; exceptions propagate naturally.

If you need Python-native `async def` functions, declare them via `@foreign`.

---

## Lists and dicts

- `[a, b, c]` → `[a, b, c]` (Python list literal).
- `{k: v, ...}` (Ion `MapLit`) → `{k: v, ...}` (Python dict literal).
- Dict keys in Ion map literals are expressions, which may emit as strings
  if they are `Str` literals, or as variable references otherwise.

---

## Practical guide — writing Ion that produces clean Python

### Do

- Use named top-level `fn` declarations. The emitter uses `def` with
  assignment statements for let bindings in the body — far cleaner than lambda chains.
- Use prelude functions (`map`, `filter`, `fold`, `sort`, etc.) — they map
  directly to idiomatic Python one-liners.
- Keep `if/else` conditions simple — binary `if c then a else b` compiles
  to a clean `a if c else b` ternary.
- Use `data` types for tagged unions — the dict-based encoding works well
  for small variant counts.

### Avoid

- **Deep nested `let` in expression context** — every nesting level adds
  a `(lambda name: ...)(value)` wrapper. If you have 3+ lets, use a
  named function instead.
- **Complex multi-arm `case` without an ADT** — long ternary chains are
  unreadable. Restructure as a `data` type or use `@foreign`.
- **ADT match with many variants and field bindings** — the emitter uses
  exec-in-lambda tricks for field bindings inside match arms, which is slow
  and unidiomatic. For large matches, use a `@foreign` Python function with
  a `match` statement (Python 3.10+).
- **`!async` without `@foreign`** — Ion async is not Python coroutines.
  Mixing them without `@foreign` bridges produces broken async code.
- **Relying on Ion generics for runtime checks** — `List<Int>` is just
  `list` in Python; there is no `isinstance(x, List[int])` guard emitted.

---

## Output format

- 4-space indentation inside `def` bodies.
- Blank line between top-level declarations.
- No module-level `"use strict"` or shebang (unlike the JS emitter).
- No trailing newline is added automatically beyond the final declaration.
- `# ADT: Name` comment precedes each ADT's variant declarations.
