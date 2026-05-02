# Ion FFI Prelude

A small set of `.ion` modules that pre-declare common foreign-function bindings
for Express, node-postgres, Node stdlib, React, jsonwebtoken, and bcrypt — so
downstream Ion code (Otouren v2 server, etc.) can avoid `raw(...)` and re-typing
the same `@foreign` declarations in every file.

## What's here

```
prelude/
├── express.ion          surface  ─┐
├── express.ionw         wire      │
├── pg.ion / .ionw                 │
├── node.ion / .ionw               ├── 6 libraries × 2 formats
├── react.ion / .ionw              │
├── jsonwebtoken.ion / .ionw       │
├── bcrypt.ion / .ionw           ─┘
├── examples/server.ion  ← end-to-end Express + pg + bcrypt + jwt
├── skill-section.md     ← addendum for llm-skills/write-ion.md
└── CHANGES.md           ← compile results + limitations
```

## Usage (today)

**Important:** Ion has no working cross-module FFI right now. The `use` directive
resolves names but the TypeScript emitter does not emit `import` statements,
and `@foreign` templates only fire for `extern fn` declarations in the **same
.ion file** as the caller. Until that changes, the prelude is consumed by
**copying the `extern fn` blocks you need into your own .ion file**.

For each library you reach for, open `prelude/<lib>.ion`, copy the relevant
`@foreign(...)` + `extern fn ...` lines into your file, and call them.

Example — using `pg`:

```ion
// At the top of ion/src/api/users.ion:
@foreign("pg", "Pool", "new (require('pg').Pool)($1)")
extern fn pg_new_pool(conn: Str) !io -> Str
@foreign("pg", "query", "$1.query($2, $3)")
extern fn pg_query(pool: Str, sql: Str, params: Str) !async !io -> Str

fn boot() !io -> Str = pg_new_pool("postgres://localhost/app")
```

The compiled TypeScript references `require('pg')` inline at each call site;
no top-level `import { Pool } from 'pg'` is emitted, but the runtime call works.

## What you do NOT get

1. **No top-of-file TypeScript imports.** The TS emitter never produces
   `import { Pool } from 'pg'`. Templates inline `require('module-name').Symbol`
   verbatim. This is pragmatically fine on Node (CommonJS `require` works in
   compiled `.ts` files) but breaks ESM-only consumers and makes tree-shaking
   impossible.

2. **No opaque foreign types.** Ion's `data` declarations don't currently emit
   to TypeScript at all (they live on `module.data` which the emitter ignores).
   So `Pool`, `Request`, `Response`, etc. are all typed as `Str` in the prelude.
   At runtime values are correct; statically, the types are imprecise. Calling
   `.foo` on a "Str" that's actually a Pool will succeed at runtime but TS
   strict-mode won't approve.

3. **No generic foreign types.** `QueryResult<T>` cannot be expressed today.
   Helper functions return raw `Str` and downstream code accesses `.rows` /
   `.rowCount` via additional `extern fn` accessors. See pg.ion for the pattern.

4. **No first-class function references.** Templates like
   `(require('react').useState)($1)` work because they're synchronous calls;
   passing a function reference around requires the arity-0 trick (declare with
   no params, the template returns the function unbound, the call site
   `f()` invokes it).

## Naming conventions

- All extern functions are prefixed with the module name (`express_*`, `pg_*`,
  `node_*`, etc.) to avoid colliding with the built-in Ion prelude (which
  defines `length`, `concat`, `map`, `filter`, etc.).
- Underscore-snake casing matches what `pub extern fn` produces in the emitted
  TypeScript const names.

## The arity-0 footgun

Ion's TypeScript emitter inlines templates for zero-parameter externs at
**module load time**, not at call time. So:

```ion
@foreign("express", "express", "(require('express'))()")
extern fn express_app() !io -> Str  // BUG: app is created once at module load
```

emits:

```ts
const express_app: () => string = (require('express'))();
//                                  ^^^^^^^^^^^^^^^^^^^^^^^
// This is the EXPRESS APP, not a function. Calling express_app()
// would try to invoke the app object as a function.
```

**Fix:** add a unit-typed dummy parameter to force lambda emission:

```ion
@foreign("express", "express", "(require('express'))()")
extern fn express_app(unit: Bool) !io -> Str
```

emits:

```ts
const express_app = (unit: boolean): string => (require('express'))();
```

The prelude uses `unit: Bool` on factory-style functions and the
"return-the-uninvoked-fn" pattern (`require('mod').func` with no `()`) on
idempotent middleware factories. See express.ion for examples.

## Adding a new prelude entry

1. Open the relevant `prelude/<lib>.ion`.
2. Add `@foreign("module", "Symbol", "template($1, $2)")` followed by a
   matching `extern fn name(p1: T1, p2: T2) !io -> Str` declaration.
3. Avoid `{` and `}` characters inside the template string — Ion's lexer
   treats them as string interpolation. Use object-literal-free APIs (e.g.
   pass a connection string instead of a config object), or factor them
   into a `raw(...)` block inside a wire-format `.ionw` file.
4. Re-run the compile-test in the parent CHANGES.md.

## Adding a new prelude module

1. Add `prelude/<newlib>.ion` with a header comment documenting the module
   and its conventions.
2. Add `prelude/<newlib>.ionw` (wire-format header + `F` line listing
   `ffi:js:<lib>:<symbol>` for each export).
3. Update `examples/server.ion` if the new module is used in the worked
   example.
4. Update CHANGES.md.

## Compatibility / version pinning

The `.ion` files don't pin npm package versions — `require('express')`
loads whatever version your `package.json` resolves. The bindings target:

| Library | Tested against |
|---|---|
| express | 4.x (not Express 5) |
| pg | 8.x |
| react / react-dom | 18+ |
| jsonwebtoken | 9.x |
| bcrypt | 5.x |
| node | Node 20+ stdlib (`node:` prefix imports) |

If you need a different version with breaking API differences, fork the
relevant `.ion` file in your project and adjust the templates.
