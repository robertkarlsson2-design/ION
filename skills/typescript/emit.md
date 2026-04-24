# TypeScript Emitter Rules

The TypeScript emitter extends the JavaScript emitter. **All JavaScript emitter rules apply**
(`skills/javascript/emit.md`), with the following TypeScript-specific additions and overrides.

---

## Preamble

- First line is always `"use strict";`
- No ESM `import`/`export` keywords in emitted output
- TypeScript-specific syntax (type annotations, interfaces, generics) is emitted inline

---

## Type mapping — Ion → TypeScript

| Ion type      | TypeScript type            | Notes                                        |
|---------------|----------------------------|----------------------------------------------|
| `Int`         | `number`                   | TS has no distinct integer type              |
| `Float`       | `number`                   | Same as Int in TS                            |
| `Bool`        | `boolean`                  |                                              |
| `Str`         | `string`                   |                                              |
| `Unit`        | `void`                     | Only on return positions; never as param     |
| `Null`        | `null`                     |                                              |
| `Never`       | `never`                    | Bottom type; emitter uses `never` for holes  |
| `TypeVar`     | `unknown`                  | When a type variable cannot be resolved      |
| `List<a>`     | `a[]`                      | e.g. `List<Int>` → `number[]`                |
| `Map<k,v>`    | `Map<k, v>`                | e.g. `Map<Str,Int>` → `Map<string, number>`  |
| `Option<a>`   | `a \| null`                | No `undefined`; use `null` for absent values |
| `Result<a,e>` | `{ ok: a } \| { err: e }`  | Discriminated union object                   |
| `Fn<(a)->b>`  | `(a: a) => b`              | Arrow function type                          |
| `Tuple<a,b>`  | `[a, b]`                   | Tuple array type                             |
| `User<T>`     | `T` (or `T<Args>`)         | Named types pass through as-is               |

---

## Function declarations with type annotations

Every top-level `Let` whose value is an `Abs` node emits as a typed `const` arrow:

```typescript
// Ion:  let add = (n: Int, m: Int): Int => n + m
// Emits:
const add = (n: number, m: number): number => n + m;
```

Parameter type annotations are emitted when the Ion type is known (not `never`/`unknown`).
Return type annotation is omitted only when the return type resolves to `unknown`.

Multi-parameter functions always use parentheses:
```typescript
const greet = (name: string): string => "Hello, " + name;
```

Zero-parameter functions:
```typescript
const now = (): number => Date.now();
```

---

## Nested let bindings

`Let` nodes inside an expression context become `const` declarations inside a block arrow:

```typescript
// Emits as block-body arrow, not IIFE, when inside a typed Abs:
(x: number): number => {
  const doubled: number = x * 2;
  return doubled + 1;
}
```

---

## Interfaces

`OopInterface` emits a real TypeScript `interface` declaration (unlike JavaScript, which emits only a comment):

```typescript
// Ion:  interface Shape { area: Fn<()->Float>, name: Str }
interface Shape {
  area: () => number;
  name: string;
}
```

Interface method signatures use `methodName(params): returnType` shorthand when all parameter
types are known; otherwise fall back to the arrow function type property form.

---

## Classes

`OopClass` nodes emit typed classes:

```typescript
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
```

`class Foo implements Bar` — when a class has an `interfaces` list, each name is added to
`implements Bar, Baz`:

```typescript
class Circle implements Shape {
  radius: number;
  constructor(radius: number) { this.radius = radius; }
  area(): number { return Math.PI * this.radius * this.radius; }
  name(): string { return "circle"; }
}
```

---

## Generics

Generic functions are emitted with TypeScript type parameters:

```typescript
// Ion:  let identity = <A>(x: A): A => x
const identity = <A>(x: A): A => x;

// Ion:  let map = <A, B>(list: List<A>, f: Fn<(A)->B>): List<B> => list.map(f)
const map = <A, B>(list: A[], f: (a: A) => B): B[] => list.map(f);
```

When a type variable is unresolved (TypeVar in IR), it becomes `unknown`:
```typescript
const wrap = (x: unknown): unknown[] => [x];
```

---

## Algebraic data types (ADT)

ADT declarations emit as typed discriminated unions:

```typescript
// ADT: Color
const Red = { _tag: "Red" } as const;
const Green = { _tag: "Green" } as const;
const Blue = { _tag: "Blue" } as const;
```

Variants with fields emit typed factory functions:

```typescript
// Ion:  adt Shape = Circle(radius: Float) | Rect(w: Float, h: Float)
const Circle = (radius: number) => ({ _tag: "Circle" as const, radius });
const Rect = (w: number, h: number) => ({ _tag: "Rect" as const, w, h });
```

ADT match (`AdtMatch`) emits as a self-invoking switch:

```typescript
(() => {
  const _s = shape;
  switch (_s._tag) {
    case "Circle": { const radius = _s.radius; return Math.PI * radius * radius; }
    case "Rect": { const w = _s.w; const h = _s.h; return w * h; }
    default: return undefined;
  }
})()
```

---

## Async/await

Async functions emit with the `async` keyword and typed return:

```typescript
// Ion:  !async fn fetchUser = (id: Str): Promise<Str> => ...
const fetchUser = async (id: string): Promise<string> => {
  const response = await fetch("/api/users/" + id);
  return response.text();
};
```

`AsyncBlock` → `async () => { return body; }`
`Await` → `await expr`

---

## Prelude functions (TypeScript-specific typed declarations)

The TypeScript emitter replaces `ForeignRef` wrappers with fully-typed `const` declarations.
These are tree-shaken — only the ones actually referenced in the Ion source are emitted.

Key prelude signatures (for reference when writing Ion that targets TS):

```typescript
const map    = <A, B>(list: A[], f: (a: A) => B): B[] => list.map(f);
const filter = <A>(list: A[], pred: (a: A) => boolean): A[] => list.filter(pred);
const fold   = <A, B>(list: A[], init: B, f: (acc: B, x: A) => B): B => list.reduce(f, init);
const length = <A>(list: A[]): number => list.length;
const range  = (start: number, end: number): number[] =>
  Array.from(Array(end - start), (_, i) => start + i);
const concat = <A>(a: A[], b: A[]): A[] => [...a, ...b];
const zip    = <A, B>(a: A[], b: B[]): [A, B][] =>
  a.slice(0, Math.min(a.length, b.length)).map((x, i) => [x, b[i]]);
const find   = <A>(list: A[], pred: (a: A) => boolean): A | undefined => list.find(pred);
const unique = <A>(list: A[]): A[] => [...new Set(list)];
const sortBy = <A>(list: A[], cmp: (a: A, b: A) => number): A[] => [...list].sort(cmp);
const head   = <A>(list: A[]): A => list[0];
const tail   = <A>(list: A[]): A[] => list.slice(1);
const flatten = <A>(list: A[][]): A[] => list.flat();
```

---

## Casting / type assertions

Ion has no explicit cast syntax. When ingesting TypeScript `as` expressions, the cast is
**dropped** and only the inner expression is emitted. Do not add `as Type` in Ion source.

---

## Optional parameters

TypeScript optional parameters (`x?: string`) map to Ion `Option<Str>` parameters.
The emitter renders these as `x: string | null` (no `?` in the arrow function signature).

When writing Ion that will target TS, use `Option<T>` for parameters that may be absent:

```ion
let greet = (name: Option<Str>): Str =>
  case name of
    Some(n) => "Hello, " + n
    None    => "Hello, stranger"
```

---

## Enums

TypeScript `enum` declarations are ingested as Ion ADTs with unit variants:

```typescript
// TypeScript source (ingestion target):
enum Direction { North, South, East, West }

// Ion IR produced:
// adt Direction = North | South | East | West

// Emitted TypeScript:
const North = { _tag: "North" } as const;
const South = { _tag: "South" } as const;
const East  = { _tag: "East" }  as const;
const West  = { _tag: "West" }  as const;
```

---

## Module output order

1. `"use strict";`
2. Hoisted typed prelude declarations (only those referenced)
3. ADT declarations (typed factory functions)
4. Interface declarations
5. Class declarations
6. Top-level `const` declarations in source order

---

## Relationship to JS patterns

All JavaScript ingestion patterns (`skills/javascript/patterns/`) also apply to TypeScript files.
The TypeScript-specific patterns in `skills/typescript/patterns/` extend the JS set by handling
TS-only syntax nodes (`type_annotation`, `interface_declaration`, `type_alias_declaration`,
`enum_declaration`, `as_expression`, `optional_parameter`, etc.). When both a JS pattern and a
TS pattern could match, the TS pattern takes priority because it has more specific conditions.

Do **not** duplicate JS patterns in the TS directory — import them by reference.

---

## Gotchas

- `void` is only valid as a return type annotation, never as a parameter type. Use `Unit` in Ion.
- TypeScript `never` is the bottom type and is used by the emitter as a placeholder for
  unresolved types; avoid writing Ion with explicit `Never` types unless you mean "unreachable".
- `Map<k,v>` in Ion emits as the ES6 `Map` class, not a plain object. Use `Object.fromEntries`
  (via `objectFromEntries` extern) if you need a plain object at the call site.
- Generic type parameters on `const` arrows require the `<A>` prefix: `const id = <A>(x: A): A => x`.
  In TSX files this conflicts with JSX; Ion targets `.ts`, so this is not an issue.
