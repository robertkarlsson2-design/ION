# JavaScript Emitter Rules

## Formatting

- 2-space indentation; increase one level per nested block
- Semicolons at the end of every statement
- No trailing commas in argument lists
- Single blank line between top-level declarations of different kinds

## String literals

- Prefer double-quoted strings: `"hello"`
- Escape `\`, `"`, `\n`, `\r`, `\t` inside string literals
- No backtick template literals (the emitter does not currently produce string interpolation)

## Arrow functions

- Single parameter: no parentheses — `x => expr`
- Zero or multiple parameters: parentheses required — `() => expr`, `(x, y) => expr`
- Expression body only (no block body `{}`); complex bodies use IIFE wrapping

## Top-level declarations

- Every top-level `Let` node becomes `const name = value;`
- No `var` or `let`; always `const`
- No ESM `export` keywords (bare `const` declarations)
- Module preamble: `"use strict";` on the first line

## Nested let bindings

- `Let` nodes in expression context become immediately-invoked function expressions:
  ```js
  (() => {
    const name = value;
    return body;
  })()
  ```

## Conditional expressions (Case)

- `Case` nodes emit as an IIFE wrapping an `if`/`else if`/`else` chain
- Wildcard and variable patterns become the `else` branch (last arm only)
- Variable patterns bind the scrutinee: `const name = scrutinee;` inside the branch
- Guard expressions append `&& guardExpr` to the condition

## Object-oriented nodes

- `OopClass` → `class Name { constructor(...) { this.field = field; } }`
- Inheritance: `class Child extends Parent { ... }` when `superClass` is present
- `OopNew` → `new ClassName(args)`
- `OopVirtualCall` → `receiver.method(args)`
- `OopThis` → `this`
- `OopInterface` → comment only (`// interface Name`); JS has no interface syntax

## Algebraic data types (ADT)

- `AdtDecl` emits one factory per variant:
  - Zero-field variant: `const Tag = { _tag: "Tag" };`
  - With fields: `const Tag = (f1, f2) => ({ _tag: "Tag", f1, f2 });`
- `AdtMatch` emits an IIFE with a `switch` on `._tag`:
  ```js
  (() => {
    const _s = scrutinee;
    switch (_s._tag) {
      case "Tag1": {
        const field = _s.field;
        return body;
      }
    }
  })()
  ```

## Async nodes

- `AsyncBlock` → `async () => { return body; }`
- `Await` → `await expr`

## Effects (minimal throw/catch encoding)

When any `Perform` or `Handle` node is present, a `EffectPerform` helper class is
hoisted before all declarations:

```js
class EffectPerform extends Error {
  constructor(operation, payload) {
    super(`Effect: ${operation}`);
    this.operation = operation;
    this.payload = payload;
  }
}
```

- `Perform` → throws an `EffectPerform` instance via IIFE
- `Handle` → IIFE with `try`/`catch`, dispatching on `_e.operation`
- `Resume` → emits value with a `/* resume */` comment (continuations not supported)

## Foreign references (ForeignRef)

A `ForeignRef` node wraps the call template in an arrow function so it can be
stored as a first-class value:

- Arity 0: template emitted directly as a constant expression
- Arity 1: `_p1 => template($1→_p1)`
- Arity N: `(_p1, …, _pN) => template`

## Module output order

1. `"use strict";`
2. Hoisted helpers (e.g. `EffectPerform` class), if needed
3. ADT declarations (`module.data`)
4. Top-level declarations (`module.decls`) in order
