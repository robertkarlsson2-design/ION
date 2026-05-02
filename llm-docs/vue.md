
# Writing Ion for Vue

The Vue emitter (`emitters/vue/emit.ts`, ~380 lines) produces a **Vue 3 Single-File Component** (`.vue`) with three sections: `<template>`, `<script setup lang="ts">`, and `<style scoped>`. The emitter delegates HTML rendering inside the template to the HTML emitter (`emitters/html/emit.ts::emitHtmlNode`), so **all HTML conventions transfer**: `class=foo` literal in attribute strings, `+` for multi-word values, Var-ref children become `${name}` template strings, etc.

> **Status:** the Vue emitter is marked "Code present, not wired into CLI" in the README status table. To emit Vue today, call `emitVue(irModule)` directly from a Node script. The skill below describes the emitter behaviour for the day `ion build --target vue` lands.


## SFC structure

Every Vue emit produces this exact envelope:

```vue
<template>
  <!-- last declared HTML element from irModule.decls; or <div><!-- empty --></div> if none -->
</template>

<script setup lang="ts">
// All non-HTML let bindings + ADT/class/interface/effect declarations, in order
</script>

<style scoped>
/* styles go here */
</style>
```

**Key rules:**
1. The **last** declared HTML element in the file becomes the template root. Earlier elements are not rendered into the template — they only show up if referenced via Var inlining.
2. Non-element `let` bindings (numbers, strings, lambdas without JSX) land in `<script setup>` as `const` declarations.
3. `OopClass`, `OopInterface`, `AdtDecl`, `EffectDecl` land in `<script setup>` as TypeScript type/class declarations.
4. The `<style>` section is always emitted as a placeholder — Ion has no surface syntax for CSS today.


## Verified emit shape (from tests)

For the Ion (IR-level) module:

```
let count = 5
let msg = "hello"
let app = div("class=app", "Hello")
```

emits:

```vue
<template>
  <div class="app">Hello</div>
</template>

<script setup lang="ts">
const count = 5;
const msg = "hello";
</script>

<style scoped>
/* styles go here */
</style>
```

Confirmed by `tests/emit/vue.test.ts:87-104`.


## Template section — what goes in

The template content comes from the **last** `irModule.decls` entry whose value is an HTML element call (`isHtmlElement(value)`) or whose value is an `Abs` whose body is an HTML element. The emitter calls `emitHtmlNode` to render it, which means:

- **Same tag set as HTML/React targets** (see `emitters/ui-shared.ts::HTML_TAGS`).
- **Attribute remapping is HTML-style** (`class="foo"`, NOT React's `className`).
- **Var refs in template positions become `${name}` template strings** — the HTML emitter convention.

Vue's reactive interpolation `{{ count }}` is **NOT generated**. The `${count}` form is a template-string syntax that won't parse as Vue interpolation. **This is a real gap** — until the emitter switches to `{{ }}` for Var refs in template position, dynamic data won't bind correctly.

**Workaround today:** wrap dynamic values in `raw("{{ count }}")` (untested in surface syntax — verify with `ion build`). Or hand-edit the emitted `.vue` file to fix the `${...}` forms.

### Multiple element decls — only the last lands in template

```ion
let header = h1([], "Top")
let main = main([], "Body")
let footer = footer([], "Bottom")
```

The template will contain **only** `<footer>Bottom</footer>`. The `header` and `main` decls are dropped (they don't even land in `<script>` either, because they're HTML elements — they're parked in `templateDecls[]` but only the last one is used).

To render multiple top-level elements, **wrap them in a single root** — Vue 3 does support multiple root elements in a `<template>`, but the emitter renders only the last one regardless:

```ion
let app = div("class=app", [
  h1([], "Top"),
  main([], "Body"),
  footer([], "Bottom")
])
```

Now `app` is the last decl, and its children become the rendered tree:

```vue
<template>
  <div class="app">
    <h1>Top</h1>
    <main>Body</main>
    <footer>Bottom</footer>
  </div>
</template>
```

(Whitespace/newlines in the actual emit are minimal; the example above is for clarity.)


## Script section — Composition API style

The emitter uses `<script setup lang="ts">` (Vue 3.2+ syntax-sugar mode), NOT the older Options API. All `let` bindings emit as `const`:

```ion
let count = 5
let msg = "hello"
let isActive = true
let toLower = (s: Str) -> "lowered"
```

emits:

```ts
const count = 5;
const msg = "hello";
const isActive = true;
const toLower = (s) => "lowered";
```

⚠️ **Reactivity is not wired up.** A bare `const count = 5` is NOT a Vue reactive ref. To get reactivity, you need `ref(5)` or `reactive(...)` — which the emitter does NOT inject. Three options:

1. **Hand-edit** to wrap each declared value in `ref(...)`.
2. **Use an `extern`** to call `ref` explicitly:
   ```ion
   @foreign("vue", "ref", "ref($1)")
   extern fn ref(initial: Int) -> Int
   
   let count = ref(0)
   ```
   This emits `const count = ref(0);` — closer to idiomatic Vue, but the type stays as `Int` instead of `Ref<Int>`. **Untested in surface syntax — verify with `ion build`.**
3. **Use the Options API instead** — declare an `OopClass` with `@Component` annotation. The emitter has a partial path for this (see "Class components" below), but it's incomplete.


## Class components (partial support)

The emitter recognises `@Component` annotations on `OopClass` declarations and emits them with a `vue-class-component` style:

```ts
// (Vue-target output for an OopClass annotated @Component)
@Component({})
// Class: MyApp
interface MyAppOptions {
  count: number;
}
class MyApp {
  constructor(count: number) {
    this.count = count;
  }
  
  // computed
  get doubled(): number {
    return this.count * 2;
  }
}
```

Method emission supports `accessorKind === 'get'` (with `// computed` comment) and `accessorKind === 'set'`. Constructors with explicit bodies emit as `created()` lifecycle hooks instead of a JS constructor (Vue Options API convention).

**Surface syntax for OOP is undocumented.** The patterns above are emit-time only — to trigger them you'd need wire format input.


## ADT declarations in script section

```ion
data Status = Active | Inactive | Pending(Int)
```

emits in `<script setup>`:

```ts
interface Active { readonly _tag: 'Active'; }
interface Inactive { readonly _tag: 'Inactive'; }
interface Pending { readonly _tag: 'Pending'; _0: number }
type Status = Active | Inactive | Pending;
function makeActive(): Active { return { _tag: 'Active' }; }
function makeInactive(): Inactive { return { _tag: 'Inactive' }; }
function makePending(_0: number): Pending { return { _tag: 'Pending', _0 }; }
```

Same shape as React. **Vue ADT support is the most polished part of the Vue emitter.**


## Worked example — Counter component (best-case)

**Ion source (uses extern for ref):**

```ion
@foreign("vue", "ref", "ref($1)")
extern fn ref(initial: Int) -> Int

let count = ref(0)
let increment = () -> count + 1

let app = div("class=counter", [
  p([], count),
  button("onclick=increment", "+")
])
```

**Idealised Vue 3 output (target shape, NOT current emit):**

```vue
<template>
  <div class="counter">
    <p>{{ count }}</p>
    <button @click="increment">+</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
const count = ref(0);
const increment = () => count.value++;
</script>

<style scoped>
/* styles go here */
</style>
```

**Actual emit shape (with current gaps):**

```vue
<template>
  <div class="counter">
    <p>${count}</p>
    <button onclick="increment">+</button>
  </div>
</template>

<script setup lang="ts">
const ref = (initial) => ref(initial);
const count = ref(0);
const increment = () => count + 1;
</script>

<style scoped>
/* styles go here */
</style>
```

Three problems:
1. `${count}` should be `{{ count }}` for Vue interpolation.
2. `onclick="increment"` should be `@click="increment"` (Vue v-on shorthand) for proper event binding.
3. The `ref` extern emits a self-referential lambda; the actual `import { ref } from 'vue'` is missing.

**All three need either hand-editing the emitted SFC or filing emitter enhancements.** Until then, Vue emit is best treated as a **structural skeleton** that you fill in by hand for reactivity and event wiring.


## Gap summary — Vue target

| Feature | Status | Workaround |
|---|---|---|
| `<template>`/`<script setup>`/`<style>` envelope | ✅ works | — |
| Static elements in template | ✅ works | — |
| Non-element decls in `<script setup>` | ✅ works | — |
| ADT type union + factories | ✅ works (best-of-emit) | — |
| Var refs become `{{ name }}` Vue interpolation | ❌ emit `${name}` instead | hand-edit or `raw("{{ name }}")` |
| Event handlers as `@click="fn"` | ❌ emit `onclick="fn"` (legacy DOM) | hand-edit |
| Reactivity (`ref`, `reactive`, `computed`) | ❌ no auto-wrap | `extern fn ref` (partial) or hand-edit |
| `import { ref } from 'vue'` | ❌ not emitted | hand-add |
| Multiple top-level template roots | ❌ only last decl rendered | wrap in single root |
| `<style>` content from Ion | ❌ always placeholder | hand-edit or external `.css` |
| `v-if`/`v-for` attributes | ⚠️ via attribute string `v-if=cond` (untested) | hand-edit if it doesn't compile |
| `props` and `emits` declarations | ❌ no surface | hand-edit `<script setup>` |


## When to use Vue target

- **Component skeletons** with mostly-static templates and a few reactive bits — let Ion handle the structural shell, hand-fill reactivity.
- **ADT-heavy state machines** — Vue's emit of the type union is clean, and you can wire it to template branches (after fixing the interpolation gap).

## When to NOT use Vue target

- **Anything where Vue's reactivity model is load-bearing** — `ref`, `reactive`, `computed`, watchers don't have clean surface-syntax paths today.
- **Form-heavy pages with two-way binding** — `v-model="..."` requires both attribute generation AND a `setter` half from Vue's reactive layer; neither is well-supported.
- **Composition API helpers (composables)** — these are TypeScript files exporting functions; build with `--target typescript` instead.


## Recommended workflow

1. Sketch the **template tree** in Ion using HTML elements + `data` ADTs for state shape.
2. Build with `--target vue` (once CLI-wired) — get the SFC envelope.
3. Hand-edit the `<template>`:
   - Replace `${name}` with `{{ name }}` for Vue interpolation.
   - Replace `onclick="fn"` with `@click="fn"` (and `onchange` → `@change`, `onsubmit` → `@submit`, etc.).
   - Add `v-if`/`v-for` directives where conditional rendering or list iteration is needed (the emitter doesn't generate them).
4. Hand-edit `<script setup>`:
   - Add `import { ref, computed, watch } from 'vue';` at the top.
   - Wrap reactive state in `ref(...)`.
   - Add `defineProps<...>()` if the component takes props.
5. Run `vue-tsc --noEmit` against the result to catch the type/import gaps.

The Vue target is **further from production-ready than React** today. If you have a choice, prefer `--target react` for component-heavy work; the React emitter has tighter integration with the IR.
