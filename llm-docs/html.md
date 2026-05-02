
# Writing Ion for HTML

The HTML emitter (`emitters/html/emit.ts`, ~580 lines) produces **static HTML** wrapped in a `<!DOCTYPE html><html lang="en">` envelope. Top-level Ion `let` bindings whose values are HTML element calls land in the body; non-element decls (functions, classes, ADTs) collect into a single `<script>` block.

> **Status:** the HTML emitter is marked "Code present, not wired into CLI" in the README status table. To emit HTML today you call `emitHTML(irModule)` directly from a script — `ion build --target html` is **not yet a CLI option**. This skill describes the emitter behaviour for the day it lands.


## What the emitter actually produces

```
<!DOCTYPE html>
<html lang="en">
<header>...</header>
<main>...</main>
<footer>...</footer>
<script>
// classes, helper functions, ADT factories
</script>
</html>
```

It does **NOT** produce a `<head>`, `<title>`, `<meta charset>`, `<body>`, or `<link rel="stylesheet">`. Those tags are recognised in the `HTML_TAGS` set, so you can emit them via `let title = head([], ...)`, but the wrapper does not auto-include them. **Plan to wrap the emit output yourself** with whatever document chrome you need.


## Tag set + attribute conventions

Same as the React target — see `writing-ion-for-react.md` for the full list. Both targets share `emitters/ui-shared.ts` for tag recognition and attribute parsing.

Key differences vs. React:

| | HTML | React |
|---|---|---|
| `class=foo` | emits `class="foo"` | emits `className="foo"` |
| `for=email` | `for="email"` | `htmlFor="email"` |
| `onclick=fn` | `onclick="fn"` (attribute string) | `onClick={fn}` (JSX expression) |
| Multi-word values | `class=card+rounded` → `class="card rounded"` (uses `+`) | same |
| `{...}` interpolation | Var refs in children become `${name}` (template-string style) | become `{name}` (JSX expression) |
| Self-closing void elements | `<br />`, `<input ... />` | same |

⚠️ **Event handlers as plain attributes.** In the HTML target, `onclick=handleClick` becomes a literal HTML attribute `onclick="handleClick"` — not an event listener bound at script time. The browser will execute the string as JavaScript when the event fires (the legacy DOM Level 0 model). For modern code you'd want `addEventListener` from a `<script>` block.


## Core emission patterns

### Static page

```ion
let page = div("class=container", "Hello world!")
```

emits:

```html
<!DOCTYPE html>
<html lang="en">
<div class="container">Hello world!</div>
</html>
```

### Multiple top-level elements

```ion
let header = header([], "Site Title")
let main = main([], "Content goes here")
let footer = footer([], "© 2026")
```

emits:

```html
<!DOCTYPE html>
<html lang="en">
<header>Site Title</header>
<main>Content goes here</main>
<footer>© 2026</footer>
</html>
```

Order is preserved — the emitter walks `irModule.decls` in source order.

### Nested elements

```ion
let card = article("class=card", [
  h2("class=title", "Hello"),
  p("class=body", "Lorem ipsum")
])
```

emits:

```html
<article class="card"><h2 class="title">Hello</h2><p class="body">Lorem ipsum</p></article>
```

(All on one line. The HTML emitter does not pretty-print.)

### HTML escaping

Text content is escaped automatically (`<`, `>`, `&`, `"`):

```ion
let warn = p([], "<script>alert('xss')</script>")
```

emits:

```html
<p>&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;</p>
```

(Verbatim from the emitter's `escHtml` helper — verified per `tests/emit/html.test.ts:96`.)

### Variable resolution across decls

Same as React — `let outer = div([], var(inner))` inlines the inner element into the outer:

```ion
let title = h1([], "My Site")
let page = div([], title)
```

emits:

```html
<h1>My Site</h1>
<div><h1>My Site</h1></div>
```

(The `title` decl ALSO emits its own element at the top level. There is no auto-suppression of variables that are only used as references. To avoid the duplicate, declare reusables outside the top-level let-set or use wire format.)


## `if/then/else` → emits first arm only

The HTML emitter **always emits the `then` branch** of an `if` expression, regardless of the condition. This is correct for static HTML where the discriminator value is a build-time constant; it's wrong for "render this if logged in" runtime conditionals.

(Surface syntax for booleans is `if cond then a else b`. The `case ... of { true -> ... }` form documented in `ion-syntax.md` does not parse today — use `if/then/else`.)

```ion
let banner = if isLoggedIn then div("class=on", "Welcome!") else div("class=off", "Please log in")
```

emits **only the true arm**:

```html
<div class="on">Welcome!</div>
```

For runtime conditionals in static HTML, you have two options:
1. Both arms emitted, controlled by CSS (visibility: hidden) and a `<script>` toggle.
2. Server-side render via TypeScript/Python target instead.

The HTML target is for **content-fixed pages**; conditional rendering is not its strength.


## Lists become concatenated children

```ion
let menu = ul("class=nav", [
  li([], "Home"),
  li([], "About"),
  li([], "Contact")
])
```

emits:

```html
<ul class="nav"><li>Home</li><li>About</li><li>Contact</li></ul>
```

`ListLit` in HTML child position concatenates each rendered child with no separator. There's no fragment wrapper.


## Non-element decls go into `<script>`

```ion
fn double(x: Int) -> Int = x * 2
let count = 42
data Status = Active | Inactive
```

emits a single trailing `<script>` block:

```html
<!DOCTYPE html>
<html lang="en">
<script>
function double(x) {
  return x * 2;
}
const count = 42;
// ADT: Status
function Active() { return { _tag: 'Active' }; }
function Inactive() { return { _tag: 'Inactive' }; }
</script>
</html>
```

Non-element decls **are emitted in JS** with the same conventions as the JavaScript emitter (function declarations, ADT factories with `_tag` discriminators, etc.). This means the HTML target gives you **HTML + bundled JS** — useful for single-file demos, no build step needed.


## OOP / classes / interfaces

`OopClass` declarations emit as JS classes inside `<script>`:

```ion
// (via wire format; surface syntax for OopClass undocumented)
oopClass("Counter", id, [], [field(name=count, t=Int)], [...])
```

emits:

```html
<script>
class Counter {
  constructor(count) {
    this.count = count;
  }
  // methods...
}
</script>
```

If the class has a `customElement` annotation, the emitter prefixes a comment:

```html
<script>
// Custom element: <my-counter>
class Counter { ... }
</script>
```

This matches custom-element registration patterns; you'd still need a hand-written `customElements.define('my-counter', Counter)` call.


## Worked example — Static landing page

```ion
let nav = nav("class=site-nav", ul("class=nav-list", [
  li([], a("href=/", "Home")),
  li([], a("href=/about", "About")),
  li([], a("href=/contact", "Contact"))
]))

let hero = section("class=hero", [
  h1([], "Welcome to Ion"),
  p("class=lede", "A token-efficient AI-native language."),
  a("href=/docs class=cta", "Get started")
])

let footer = footer("class=site-footer", "© 2026 Ion Project")
```

emits (all in one HTML document, declared elements appended to body):

```html
<!DOCTYPE html>
<html lang="en">
<nav class="site-nav"><ul class="nav-list"><li><a href="/">Home</a></li><li><a href="/about">About</a></li><li><a href="/contact">Contact</a></li></ul></nav>
<section class="hero"><h1>Welcome to Ion</h1><p class="lede">A token-efficient AI-native language.</p><a href="/docs" class="cta">Get started</a></section>
<footer class="site-footer">© 2026 Ion Project</footer>
</html>
```


## Gap summary — HTML target

| Feature | Status | Workaround |
|---|---|---|
| Static element trees | ✅ works | — |
| HTML escaping of text content | ✅ works | — |
| Self-closing void elements | ✅ works | — |
| Variable inlining across decls | ✅ works | — |
| Pretty-printing / indentation | ❌ everything on one line | post-process with `prettier --parser html` |
| Two-arm Case as runtime conditional | ❌ first arm only | hand-write `<script>` toggle |
| `<head>`, `<title>`, `<body>` auto-wrap | ❌ raw envelope only | wrap output yourself |
| `addEventListener` event binding | ❌ legacy `onclick="..."` only | hand-write `<script>` |
| Pretty React-style props (`{value}`) | ❌ HTML uses literal strings | use template-string `${...}` via Var ref |
| `ion build --target html` from CLI | ❌ not wired up (per README) | call `emitHTML(irModule)` from a Node script |


## When to use the HTML target

- **Single-file demos** — Ion + emitted HTML + bundled JS = one self-contained file.
- **Static-site fragments** — emit each page from a small `.ion` file, glue together with hand-written `<head>` and stylesheets.
- **Email templates** — content-fixed HTML with no JS. (The `<script>` block is appended only if non-element decls exist; pure-element files get clean static output.)

## When to NOT use the HTML target

- **Interactive UIs** — use React or Vue.
- **Server-rendered pages with dynamic content** — use TypeScript/Python with a templating layer.
- **Anything needing `<!DOCTYPE>` overrides, multiple `<script type="module">` tags, or `<link>` to external stylesheets** — hand-write the chrome and pull in the Ion-emitted body fragment.


## Calling the emitter today (CLI not yet wired)

```bash
node -e "
  const { decodeModule } = require('./dist/src/wire/decoder.js');
  const { emitHTML } = require('./dist/emitters/html/emit.js');
  const fs = require('fs');
  const wire = fs.readFileSync('mypage.ionw', 'utf8');
  const ir = decodeModule(wire);
  console.log(emitHTML(ir));
" > mypage.html
```

Or compile from `.ion` surface syntax through the full pipeline (lexer → parser → checker → desugarer → emitter) by reusing the same Node-script pattern from `tests/emit/html.test.ts`. Once the CLI lands `--target html`, this glue goes away.
