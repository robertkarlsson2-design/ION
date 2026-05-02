## Using the FFI prelude

The `@ion/prelude/` bundle (in this repo) ships pre-written `extern fn`
declarations for Express 4, node-postgres (`pg`), Node stdlib, React 18+,
`jsonwebtoken`, and `bcrypt`. Use these instead of dropping into `raw(...)`
or hand-writing the same `@foreign` declarations in every file.

### When to import from prelude vs. declare locally

| Situation | Action |
|---|---|
| Calling Express, pg, React hooks, JWT, bcrypt, or Node stdlib | Copy from `prelude/<lib>.ion` |
| Calling a one-off library with 1-2 functions | Declare inline in your `.ion` file |
| Need a literal `{` or `}` in the template | Move that piece to a `raw(...)` block in a `.ionw` file (surface syntax can't escape braces) |
| Type system needs an opaque foreign type (e.g. `Pool`) | Use `Str` as a placeholder type — `data` decls don't emit yet |

### Caveat — same-file rule

Ion's `use prelude.express.{express_app}` resolves the name but the TS
emitter does NOT emit cross-module imports. Templates in `@foreign` only
expand at call sites in the **same** `.ion` file as the `extern fn`
declaration. Until the compiler grows multi-module FFI emission, copy
the extern blocks you need into the file that calls them.

### Worked example — Express middleware that authenticates a JWT

```ion
// auth_middleware.ion — copies extern blocks from prelude/express.ion
// and prelude/jsonwebtoken.ion. No raw(...) needed.

@foreign("express", "use", "$1.use($2)")
extern fn express_use(app: Str, mw: Str) !io -> Str

@foreign("express", "res_status", "$1.status($2)")
extern fn express_res_status(res: Str, code: Int) !io -> Str

@foreign("express", "res_json", "$1.json($2)")
extern fn express_res_json(res: Str, body: Str) !io -> Str

@foreign("jsonwebtoken", "verify", "(require('jsonwebtoken').verify)($1, $2)")
extern fn jwt_verify(token: Str, secret: Str) !io -> Str

// Build a middleware as a curried-style function. Ion lambdas emit cleanly,
// so a request handler is just a fn taking (req, res, next) and returning
// the express response chain.
fn require_auth(secret: Str) -> Str =
  raw_handler_inlined_via_template(secret)  // Ion lambdas would go here in a real impl

// Apply to an app:
fn protect(app: Str, secret: Str) !io -> Str =
  express_use(app, require_auth(secret))
```

In production you'd typically write the request handler itself as a
`fn (req: Str, res: Str, next: Str) -> Str` lambda, capture the middleware
factory in a let binding, and pass that to `express_use`. The prelude
externs cover all the boundary calls.

### Adding to the prelude

1. Open `prelude/<lib>.ion` (or create a new file under `prelude/`).
2. Add `@foreign("module", "Symbol", "template")` + `extern fn name(...) !io -> Str`.
3. Make sure the template has no literal `{` or `}` (string interpolation
   collides with object-literal braces in Ion strings). For object-config
   APIs, write a thin JS wrapper file, or restrict the binding to the
   string-config form.
4. Add a matching `ffi:js:<lib>:<symbol>` entry to `prelude/<lib>.ionw`.
5. Compile-test by copying the file into a sibling project's `ion/src/`
   and running `ion build` — should report `0 error(s)`.

### Things the prelude is **not**

- It is **not** a TypeScript type-bridge. `Pool`, `Request`, `Response` etc.
  are typed as `Str`. The runtime values are correct; static types are
  imprecise.
- It does **not** emit `import { Pool } from 'pg'` at the top of compiled
  TS files. Templates inline `require('module')` at each call site.
- It does **not** support generics on foreign types. `QueryResult<T>` is
  represented as `Str`; access fields via additional accessor externs.

These constraints come from the current Ion compiler; lifting any of them
is a compiler change, not a prelude change.
