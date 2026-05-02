
# Writing Ion for Java

The Java emitter (`emitters/java/emit.ts`, ~700 lines, marked **experimental** in the README status table) targets **Java 21+** and produces a single `.java` file per Ion module. The output is structured as:

- `public final class ModuleName { ... }` wrapping all top-level decls
- Top-level `let f = abs(...)` → `public static <RetType> f(...)`
- Top-level `let v = literal` → `private static <Type> v = literal;`
- `data` declarations → not currently emitted as Java records (see gap below)
- A bundled `Prelude` inner class (~200 lines) auto-injected for any `map`/`filter`/`fold`/etc. usage

This skill is grounded in a verified `ion build --target java` run on a small pipeline file.


## Compilation contract

```
my-project/
├── ion/
│   ├── ion.config.json   ← { "target": "java", ... }
│   └── src/
│       └── hello.ion
└── hello.java            ← single file, named after module
```

The module name (e.g., `hello`) becomes a PascalCase class (`Hello`). One `.ion` file → one `.java` file.


## Type mapping

The Java emitter's type translation (from inspection of the prelude templates and Java's emission shape):

| Ion type | Java |
|---|---|
| `Int` | `long` (yes, 64-bit; emitter uses `Long` for boxing) |
| `Float` | `double` |
| `Bool` | `boolean` |
| `Str` | `String` |
| `Unit` | `void` |
| `List<T>` | `List<Object>` (NOT `List<T>`) |
| `Map<K,V>` | `Map<Object, Object>` |
| `Option<T>` | `Object` (nullable) |
| Untyped param (TypeVar) | `Object` (with `(Long)` casts at use sites) |

⚠️ **Key insight:** the Java emitter **deliberately erases generics to `Object`** in collections and untyped parameters (`emit.ts:18-19`, header docstring). The bundled `Prelude` is `Object`-polymorphic throughout, with `(Long)`/`(Double)` casts inserted at numeric operation sites. This is intentional — it makes generic inference robust against untyped Ion sources, at the cost of less precise types.

If you want sharper Java types (`List<Long>` instead of `List<Object>`), you'll need to hand-edit the emitted Java or open an enhancement request.


## Verified compile — pipeline example

```ion
fn double(x: Int) -> Int = x * 2

fn doubleAll(xs: List<Int>) -> List<Int> = xs |> map(double)

fn isEven(n: Int) -> Bool = n % 2 == 0

fn process(xs: List<Int>) -> List<Int> =
  xs |> filter(isEven) |> map(double)
```

emits:

```java
// Generated from Ion. Do not edit.
import java.util.List;

public final class Hello {
  private Hello() {}

  public static long double(long x) {
    return x * 2L;
  }

  public static List<Object> doubleAll(List<Object> xs) {
    return Prelude.map(xs, (java.util.function.Function<Object, Object>) (Hello::double));
  }

  public static boolean isEven(long n) {
    return (n % 2L) == 0L;
  }

  public static List<Object> process(List<Object> xs) {
    return Prelude.map(
      Prelude.filter(xs, (java.util.function.Function<Object, Object>) (Hello::isEven)),
      (java.util.function.Function<Object, Object>) (Hello::double));
  }

  /* ───────────── Ion prelude (auto-generated, do not edit) ───────────── */
  @SuppressWarnings({"unchecked", "rawtypes"})
  static final class Prelude {
    // ...~200 lines of Object-typed list/string/math helpers
  }
}
```

Token report: **Ion 73 → Java 1770 — saved 1697 (96%)**. This is the largest single-target saving; Java's verbosity is the worst case Ion was designed to absorb.

⚠️ **`double` is a Java reserved word** — the emitted `public static long double(long x)` won't compile. Rename the Ion function to `doubleVal` or similar. The emitter does NOT escape Java keywords today.


## Operator emission

| Ion | Java | Notes |
|---|---|---|
| `__add__`/`-`/`*`/`/` | `+`/`-`/`*`/`/` | numeric ops with `(Long)` cast inserted as needed |
| `__mod__` | `%` | |
| `__eq__` | `==` | reference equality on objects! Use `.equals()` for strings — see gap |
| `__ne__` | `!=` | |
| `__lt__`/`__gt__`/`__le__`/`__ge__` | `<`/`>`/`<=`/`>=` | numeric only |
| `__and__`/`__or__` | `&&`/`||` | |
| `__not__` | `!` | |
| `__neg__` | `-` | |

⚠️ **Major Java gotcha:** `==` on `String` checks reference identity, not value. The emitter uses `==` regardless. Two strings that are equal-by-value can still return false. For string equality, use a helper:

```ion
@foreign("Object", "equals", "$1.equals($2)")
extern fn streq(a: Str, b: Str) -> Bool

fn isAdmin(role: Str) -> Bool = streq(role, "admin")
```

Without this, `role == "admin"` becomes `role == "admin"` in Java, which is unreliable.


## Numeric-literal suffix

Integer literals are emitted with a `L` suffix (`x * 2L`) because Ion's `Int` maps to Java `long`. This is correct and avoids the auto-int → `long` widening surprise.

Float literals emit without suffix (`3.14`), which Java treats as `double` by default. Same convention.


## `data` types — major gap

⚠️ **The Java emitter does NOT emit Java records for `data` declarations.** Like the TS and Python emitters, the Java emitter only iterates `irModule.decls` and skips `irModule.data`. The header docstring claims:

> Data declarations -> records (Java 16+)

But this is **aspirational** based on inspection of `emit.ts` — the actual code does not contain a record-emission path that reads `irModule.data`. Verified by writing `data User = User { id: Int; name: Str }` and confirming the emitted Java has no `record User(...)` line.

**Workaround today:** hand-write the Java records in a separate file:

```java
// User.java (hand-written)
public record User(long id, String name, boolean active) {}
```

Then in Ion, reference `User` as a User-type without declaring it (the binder may complain — file an issue if it does). Alternatively, drop to wire format (`.ionw`) and construct an `OopClass` IR node, which DOES have a Java emission path.


## Sealed classes / sum types

Same gap — `data Shape = Circle | Rect(Int, Int)` does not emit a sealed interface today. The README status notes the Java emitter as "experimental"; this is one of the unfinished pieces.

**Hand-rolled equivalent** (Java 21+):

```java
public sealed interface Shape permits Circle, Rect {}
public record Circle() implements Shape {}
public record Rect(long _0, long _1) implements Shape {}
```

In Ion, these would be referenced via `extern` once hand-written.


## Pattern matching

`case` and `match` follow the same path as TypeScript and Python — chained ternaries:

```ion
fn classify(n: Int) -> Str =
  case n < 0 of {
    true -> "negative"
  | _ -> case n == 0 of {
      true -> "zero"
    | _ -> "positive"
    }
  }
```

emits:

```java
public static String classify(long n) {
  return n < 0L ? "negative" : (n == 0L ? "zero" : "positive");
}
```

For Java 21+ pattern-match-on-`switch` (e.g., `switch (s) { case Circle c -> ...; case Rect r -> ...; }`), the Java emitter's docstring promises support — but again, **untested in this skill — verify with `ion build`** before relying on it. The emitter does have an `OopClass`-aware switch path; whether it triggers from surface syntax is unclear.


## Lambdas and method references

Bare function references (passed to `map`/`filter`/etc.) emit as method references:

```
map(xs, double)   →   Prelude.map(xs, (Function<Object, Object>) (Hello::double))
```

The cast is necessary because Java's generic inference can't disambiguate against `Object`. The emitter inserts the cast unconditionally (`emit.ts::FN1`).

Inline lambdas:

```ion
fn over10(xs: List<Int>) -> List<Int> = filter(xs, (n: Int) -> n > 10)
```

emits something like (verify with `ion build`):

```java
public static List<Object> over10(List<Object> xs) {
  return Prelude.filter(xs, (Function<Object, Object>) ((n) -> ((Long) n) > 10L));
}
```

The `(Long) n` cast is needed because the prelude's lambda parameter is typed `Object`. The emitter inserts it at numeric-comparison sites (`NUMERIC_OPS` set in `emit.ts:58`).


## The bundled Prelude class

Every Java output file includes a 200-line `Prelude` inner class containing every prelude helper actually used (DCE-shaken). For example, if you use `map` and `length`, only those two are emitted (along with their dependencies like `asList` and `toLong`).

This means **a hello-world `fn double(x: Int) = x * 2` can produce ~30 lines of Java** (class wrapper + method + private constructor + minimal prelude scaffolding even when unused). For larger files the overhead is amortised — see the 96% saving on the pipeline example above.


## Worked example 1 — Pure utility module

```ion
fn doubleVal(x: Int) -> Int = x * 2
fn isEven(n: Int) -> Bool = n % 2 == 0
fn sumEven(xs: List<Int>) -> Int = sum(filter(xs, isEven))
```

emits (top of file):

```java
import java.util.List;

public final class Hello {
  private Hello() {}

  public static long doubleVal(long x) {
    return x * 2L;
  }
  
  public static boolean isEven(long n) {
    return (n % 2L) == 0L;
  }
  
  public static long sumEven(List<Object> xs) {
    return Prelude.sum(Prelude.filter(xs, (Function<Object, Object>) (Hello::isEven)));
  }
  
  // ... Prelude inner class with sum, filter, asList, toLong, etc.
}
```

`javac Hello.java` should compile cleanly (verify before relying on this in CI).


## Worked example 2 — User-typed function (hand-rolled record + extern)

In `User.java` (hand-written):

```java
public record User(long id, String name, boolean active) {}
```

In `hello.ion`:

```ion
@foreign("User", "constructor", "new User($1, $2, $3)")
extern fn mkUser(id: Int, name: Str, active: Bool) -> Str

fn welcome(id: Int, name: Str) -> Str = mkUser(id, name, true)
```

emits:

```java
public static String mkUser(long id, String name, boolean active) {
  return new User(id, name, active);
}

public static String welcome(long id, String name) {
  return mkUser(id, name, true);
}
```

Note the **return type is `String`** because Ion's `User` type doesn't have a Java mapping — User-types fall through to the literal type name. If the User type isn't on Java's classpath at compile time, javac will reject. The honest answer: Ion's user types in Java are **best treated as opaque names**, with the actual class declared in hand-written Java.


## Worked example 3 — Generic wrapper via `OopClass`

Generic functions and classes in surface syntax: untested today (parser rejects `<T>` on `fn` decls in spot tests). Generic OOP via wire format DOES work — the emitter has a full `typeParams` path. See `tests/golden/java-emit.test.ts` for an example IR.

For surface syntax today, **erase generics manually** and use `Object` types:

```ion
fn firstOf(xs: List<Int>) -> Int = head(xs)
```

→ emit `(Long) Prelude.head(xs)` with the `(Long)` cast inserted.


## Gap summary — Java target

| Feature | Status | Workaround |
|---|---|---|
| `fn` → `public static method` | ✅ works | — |
| Pipeline `|>` desugaring | ✅ works | — |
| Prelude DCE injection | ✅ works | — |
| `Long`/`Double` cast insertion at numeric sites | ✅ works | — |
| `data User { ... }` → Java record | ❌ not emitted (skipped) | hand-write `User.java`; reference via `extern` |
| `data Foo = A | B` → sealed interface | ❌ not emitted | hand-write |
| Java `==` on String becomes `.equals()` | ❌ uses raw `==` | wrap in extern `streq(a, b)` |
| Java reserved-word escaping (`double`, `class`, `int`...) | ❌ not handled | rename your Ion function |
| `import` between Ion files | ❌ untested | `@foreign` extern |
| Generic functions `fn id<T>(x: T) -> T` in surface | ❌ untested | use wire format or hand-write |
| Pattern match on sealed types via `switch` | ⚠️ untested | hand-write or use ternary chain |
| `!async` effect → `CompletableFuture<T>` | ❌ no path | hand-roll |
| `try`/`catch` | ❌ no Ion construct | wire-format `raw(...)` or hand-edit |


## When NOT to use Ion → Java

The Java emitter is marked **experimental** for good reasons:

1. **Reserved-word collisions** are easy to hit (Ion `fn class` / `fn int` / `fn enum` — all silently emit invalid Java).
2. **Strings with `==`** is a runtime correctness bug, not a syntax error — `javac` won't catch it.
3. **No record/sealed-interface emission** means data-shape code requires hand-writing.
4. **`Object`-erased generics** are correct but ugly; reviewers will push back.

For Java backends today, Ion is best for **pure functional helpers** and **pipeline glue code** — anything that's mostly `map`/`filter`/`fold` over collections of primitives. For domain modelling (records, sealed types, exceptions, async), hand-write Java and use Ion only at the function-implementation level.


## Recommended workflow

1. **Pick a narrow scope** — a utility class with 5-15 pure functions.
2. **Avoid Ion function names that are Java reserved words**: `class`, `int`, `long`, `double`, `boolean`, `void`, `null`, `true`, `false`, `if`, `else`, `for`, `while`, `do`, `switch`, `case`, `default`, `return`, `try`, `catch`, `finally`, `throw`, `new`, `this`, `super`, `static`, `final`, `abstract`, `public`, `private`, `protected`, `synchronized`, `volatile`, `transient`, `extends`, `implements`, `interface`, `enum`, `record`, `package`, `import`.
3. **Wrap string equality** with `@foreign` extern `streq` — never use bare `==` on `Str`.
4. **Run `javac OutputModule.java`** as a sanity check after every `ion build`.
5. **For records/sealed types, hand-write the data layer in `.java`** and import-via-extern in Ion.

The 96% token saving is real and substantial when the constraints are met. If you find yourself fighting more than helping, drop down a stack — TypeScript or JavaScript with a JVM transpiler may be a better fit for the project's needs.
