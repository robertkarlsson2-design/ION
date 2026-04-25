# ION Surface Syntax — Quick Reference

## Module header

```ion
module org.example.myModule  "1.0.0"
```

## Comments

```ion
// single-line only. Block comments not supported.
```

## Let bindings

```ion
// Top-level constant
let pi = 3.14159;

// Top-level function
let add = (x: Int, y: Int) -> x + y;

// Let with body (NOT "let ... in")
let result =
  let temp = x * 2;
  temp + 1;
```

## Lambdas

```ion
let double = (x: Int) -> x * 2;
let greet  = (name: Str) -> concat("Hello ", name);
let always = (_: Int) -> 42;
```

## Function application

```ion
let y = add(3, 4);
let s = concat("foo", "bar");
```

## Arithmetic and comparisons

ION has no infix operators in surface syntax. Use builtin functions:

| Operation | ION | Notes |
|---|---|---|
| `a + b` | `add(a, b)` | Int or Float |
| `a - b` | `sub(a, b)` | |
| `a * b` | `mul(a, b)` | |
| `a / b` | `div(a, b)` | |
| `a == b` | `eq(a, b)` | any type |
| `a != b` | `neq(a, b)` | |
| `a < b`  | `lt(a, b)` | |
| `a > b`  | `gt(a, b)` | |
| `a && b` | `and(a, b)` | Bool |
| `a \|\| b` | `or(a, b)` | Bool |
| `!a`     | `not(a)` | Bool |
| `concat` | `concat(s1, s2)` | Str |

## Case / pattern matching

```ion
let abs_val = (x: Int) ->
  case x > 0 of {
    true  -> x
  | false -> sub(0, x)
  };
```

## Ternary shorthand (via case)

```ion
// case <bool> of { true -> <a> | _ -> <b> }
let max = (a: Int, b: Int) ->
  case gt(a, b) of {
    true -> a
  | _    -> b
  };
```

## Lists

```ion
let nums = [1, 2, 3];
let strs = ["a", "b", "c"];
```

## Records / Maps

Inline map literals are not yet supported in surface syntax. Use `extern` or `raw(...)`:

```ion
@foreign("Object", "create", "{}")
extern fn emptyObj() -> UserType;
```

## ADT declarations

```ion
type Maybe =
  | Just(value: Int)
  | Nothing;
```

## ADT matching

```ion
let unwrap = (m: Maybe) ->
  case m of {
    Just(v) -> v
  | Nothing -> 0
  };
```

## Extern functions (FFI)

```ion
@foreign("String", "concat", "$1 + $2")
extern fn concat(a: Str, b: Str) -> Str;

@foreign("console", "log", "console.log($1)")
extern fn println(s: Str) -> Unit;

@foreign("Array", "push", "$1.push($2)")
extern fn push(arr: Str, item: Str) -> Unit;
```

`$1`, `$2` … are positional placeholders for the arguments.

## The escape hatch

When the emitter doesn't support a construct, use `raw(...)`:

```ion
let result = raw("someFrameworkCall(x, { deep: true })");
```

`raw(...)` accepts a string literal and emits it verbatim in the target language. Works in both surface syntax and wire format.

## Common mistakes

| Wrong | Correct |
|---|---|
| `-- comment` | `// comment` |
| `let x = v in body` | `let x = v; body` |
| `a + b` (infix) | `add(a, b)` |
| `[Str -> Bool]` in param | use `Str` as placeholder |
| `(Str) -> Bool` as param type | use `Str` as placeholder |
