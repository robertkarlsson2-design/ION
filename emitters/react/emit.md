# React Emitter Rules

## Component shape

The emitter chooses one of three forms for a top-level `Let` whose value is an `Abs`:

- **Arrow-expression form** (`() => (JSX)`) — when `abs.body` is directly a JSX-producing node (e.g. `App` with an HTML tag callee). The emitter annotates the binding as `React.FC`.
- **Block-body form** (`() => { stmts; return (JSX); }`) — when `abs.body` is a `Let` chain. Each binding in the chain becomes a `const` statement; the terminal node becomes `return (JSX)`. Always annotated as `React.FC`.
- **Plain function form** (`const f = (...) => expr`) — when `abs.body` is neither JSX nor a `Let` chain (e.g. a non-HTML expression).

## RawInject in a Let chain

When a `Let` binding's value is `RawInject`, the raw code is emitted as a **bare statement** (no `const name = ...` wrapper). The raw string is expected to be a complete statement, e.g. `const [count, setCount] = useState(0)`. All other value kinds emit as `const ${name} = ${expr};`.

## Async arrow functions

An `Abs` node whose body is `AsyncBlock` emits as `async (params) => body` — not as an IIFE. This applies in both expression position (`emitTsExprForReact`) and when the handler is a `Let` binding inside a block-body component.

## Attribute → prop mapping

| HTML attribute | React prop   |
|----------------|--------------|
| `class`        | `className`  |
| `for`          | `htmlFor`    |
| `tabindex`     | `tabIndex`   |
| `onclick`      | `onClick`    |
| `onchange`     | `onChange`   |
| `onsubmit`     | `onSubmit`   |
| `oninput`      | `onInput`    |
| `onfocus`      | `onFocus`    |
| `onblur`       | `onBlur`     |
| `readonly`     | `readOnly`   |
| `maxlength`    | `maxLength`  |
| `colspan`      | `colSpan`    |
| `rowspan`      | `rowSpan`    |
| `crossorigin`  | `crossOrigin`|

## Event handler values

When an attribute key starts with `on`, is in the table above, AND the value is a plain JS identifier (matches `[a-zA-Z_][a-zA-Z0-9_]*`), the emitter emits `{handler}` (curly braces, no quotes). All other attribute values are emitted as `"string"`. Event-like attributes not in the table (e.g. `onmouseover`) are always emitted as strings.

## Module preamble

Every React output file starts with:

```tsx
"use strict";
import React from 'react';
```

## Void elements

Tags in the void-elements set (e.g. `input`, `br`, `hr`, `img`) are always emitted as self-closing: `<tag attrs />`. They never have children.
