
# Writing Ion for React Native

The React Native emitter (`emitters/react-native/emit.ts`) compiles Ion to React Native TSX. It maps HTML element calls to RN primitives (`div`→`View`, `span`→`Text`, etc.), remaps event attributes (`onclick`→`onPress`), handles image source conventions, and auto-emits the `AppRegistry.registerComponent` call for the entry component.

The authoritative spec is `tests/emit/react-native.test.ts`. If a pattern is not tested there, treat it as unverified.


## ⚠️ Surface-syntax warning — IR-level reality

The React Native emitter is exercised entirely by **direct IR construction** in `tests/emit/react-native.test.ts`. There are zero `.ion` surface-syntax files in the test corpus that compile to React Native TSX. This means:

1. Every pattern in this doc is verified at the **IR level** (the emitter does what the table says).
2. The **surface-syntax form** that produces those IR nodes is **inferred** — use it with care.
3. **If a surface form doesn't compile, drop to wire format (`.ionw`)** and assemble the IR explicitly. The wire format is the canonical input the emitter is tested against.

**DO NOT use or document surface-syntax for `__platform__` / `__platform_select__` builtins.** Surface sugar for those is a future ticket (ION-RN-13). Document wire-format only.

For everything outside the most basic component, expect to use wire format or `raw(...)` heavily.


## The contract — what makes an RN component

The emitter recognises a component by these rules (`emit.ts:253-279`):

1. A top-level `let Name = ...` where the value is **either**:
   - An `App` whose callee is a `Var` with a recognised HTML tag name (checked via `isHtmlElement(value)`).
   - An `Abs` (lambda) whose **body** is JSX — the emitter calls `emitRnJsxNode` and checks that the result starts with `<` or `{/*`.
2. The name becomes the component identifier. The emitter wraps it as `const Name: React.FC = (params) => ( <jsx> );`.
3. Non-JSX scalar values emit as `const Name = value;`.

Module preamble is hard-coded and collected dynamically:

```tsx
"use strict";
import React from 'react';
import { View, Text, Pressable } from 'react-native';   // only components actually used
```

Only RN primitives actually referenced in the module appear in the import. `Platform`, `StyleSheet`, `AppRegistry`, etc. are added automatically when their features are triggered.

**Minimal example — Ion wire format:**

```
// Ion wire:
let Greeting = Abs([], App(Var("div"), [Str(""), Str("Hello RN")]))
```

**Emitted TSX:**

```tsx
"use strict";
import React from 'react';
import { View, Text } from 'react-native';

const Greeting: React.FC = () => (
  <View>
    {"Hello RN"}
  </View>
);
```


## RN primitive set

Drawn from `emitters/react-native/primitives.ts::RN_PRIMITIVES`.

### View (layout container)

| HTML tag | RN component |
|---|---|
| `div`, `header`, `footer`, `main`, `nav` | `View` |
| `section`, `article`, `aside` | `View` |
| `ul`, `ol`, `li` | `View` |
| `table`, `thead`, `tbody`, `tr`, `td` | `View` |
| `form`, `figure`, `blockquote`, `details` | `View` |
| `body`, `html` | `View` |

### Text

| HTML tag | RN component |
|---|---|
| `span`, `p` | `Text` |
| `h1`, `h2`, `h3`, `h4`, `h5`, `h6` | `Text` |
| `label`, `th`, `figcaption` | `Text` |
| `pre`, `code` | `Text` |
| `em`, `strong`, `small`, `mark`, `sup`, `sub`, `summary` | `Text` |

### Input and media

| HTML tag | RN component |
|---|---|
| `button`, `a` | `Pressable` |
| `input`, `textarea` | `TextInput` |
| `img` | `Image` |
| `dialog` | `Modal` |

### Silently dropped (no output)

`br`, `hr`, `meta`, `link`, `script`, `style`, `title`, `head`

### Comment placeholder only

`select`, `option` — emits:
```tsx
{/* <select> not supported on RN — use @react-native-picker/picker */}
```

### Before/after example

```
// Ion wire:
App(Var("div"), [Str(""), App(Var("span"), [Str(""), Str("Hello")])])
```

```tsx
<View>
  <Text>
    Hello
  </Text>
</View>
```


## Attribute conventions

Drawn from `emitters/react-native/primitives.ts::RN_ATTR_MAP`.

### Remapped attributes

| Ion attr | Emitted as |
|---|---|
| `onclick` | `onPress` |
| `onlongpress` | `onLongPress` |
| `onchange` | `onChange` |
| `onblur` | `onBlur` |
| `onfocus` | `onFocus` |
| `onsubmit` | `onSubmit` |
| `oninput` | `onInput` |
| `maxlength` | `maxLength` |

### Dropped with comment child

| Ion attr | What appears in the output |
|---|---|
| `class=card` | `{/* class=card (no-op on RN) */}` (comment child) |
| `href=https://...` | `{/* href=https://... (use onPress + navigation) */}` (comment child) |

### Silently dropped

`for`, `tabindex`, `type`, `readonly` — these are consumed by the input coercion step (see next section) or dropped with no output.

### Multi-word values

The `+` encoding still works exactly as in the React emitter. A space in an attribute value is written with `+`:

```
class=card+bg-white  →  {/* class=card bg-white (no-op on RN) */}
```


## Identifier vs. string values for event handlers

The emitter applies a simple heuristic to decide whether an event handler value becomes `{fn}` or `"string"`.

**Rule:** If the Ion attribute key maps through `RN_ATTR_MAP` to an `on*` name AND the raw value matches `/^[a-zA-Z_][a-zA-Z0-9_]*$/` (a JS identifier), the value is emitted as `{val}`. Otherwise it's a quoted string.

```
onclick=handlePress   →  onPress={handlePress}
onclick=do+something  →  onPress="do something"   // not an identifier
```

⚠️ **Inline lambdas are not supported as attribute values.** You cannot write `onclick=(e) -> ...` inline. Hoist the handler to a named `let` binding and reference it by name.


## `input` attribute coercion

Drawn from `coerceInputProps` in `emitters/react-native/primitives.ts`. Applies only to the `input` HTML tag (mapped to `TextInput`).

| `type=` value | Emitted prop |
|---|---|
| `email` | `keyboardType="email-address"` |
| `password` | `secureTextEntry={true}` |
| `number` | `keyboardType="numeric"` |
| `tel` | `keyboardType="phone-pad"` |

The `type=` attribute is consumed entirely — it does NOT appear in the output.

Additionally, `readonly` (any value) is consumed and becomes `editable={false}`.

**Example:**

```
// Ion wire attr string: "type=password"
App(Var("input"), [Str("type=password")])
```

```tsx
<TextInput secureTextEntry={true} />
```

```
// Ion wire attr string: "type=email readonly"
App(Var("input"), [Str("type=email readonly")])
```

```tsx
<TextInput keyboardType="email-address" editable={false} />
```


## Auto-wrap rules — bare text in containers

The emitter tracks `inTextContext` per node. The rule:

- **Text containers** (`Text` component — i.e. `span`, `p`, `h1`–`h6`, `label`, `th`, `figcaption`, `pre`, `code`, `em`, `strong`, `small`, `mark`, `sup`, `sub`, `summary`) set `inTextContext = true`. Their string children emit as **bare text** — no `{}` wrapper.
- **Layout containers** (`View`, `Pressable`, `Modal`, `ScrollView`, `SafeAreaView`, `KeyboardAvoidingView`) set `inTextContext = false`. Their string children emit as `{"string"}`.

**Text context (bare text):**

```
// Ion wire:
App(Var("span"), [Str(""), Str("Hello world")])
```

```tsx
<Text>
  Hello world
</Text>
```

**Container context (JSON string):**

```
// Ion wire:
App(Var("div"), [Str(""), Str("Hello world")])
```

```tsx
<View>
  {"Hello world"}
</View>
```

⚠️ **Gap: `Pressable` with text label crashes at runtime.** `Pressable` is a container (`inTextContext = false`), so a string child emits as `{"label"}`. React Native will crash with `"Text strings must be rendered within a <Text>"`. Always wrap text labels inside a `span` (→ `Text`):

```
// Wrong — crashes at RN runtime:
App(Var("button"), [Str(""), Str("Submit")])
// Emits: <Pressable>{"Submit"}</Pressable>  ← runtime crash

// Correct:
App(Var("button"), [Str(""), App(Var("span"), [Str(""), Str("Submit")])])
// Emits: <Pressable><Text>Submit</Text></Pressable>  ✅
```


## Conditional rendering

The emitter follows the same two-arm `Case` → JSX ternary pattern as the React emitter.

**Ion wire format:**

```
Case(
  scrutinee=cond,
  arms=[
    { pattern=Lit(true),  body=App(Var("div"), [Str(""), Str("Yes")]) },
    { pattern=Wildcard,   body=App(Var("div"), [Str(""), Str("No")])  },
  ]
)
```

**Emitted TSX:**

```tsx
{cond ? (
  <View>
    {"Yes"}
  </View>
) : (
  <View>
    {"No"}
  </View>
)}
```

⚠️ **Gap: 3+ arm `Case` silently drops all but the first arm.** Nest two-arm Cases to model multi-branch conditionals.


## List rendering

A `ListLit` node emits as a JSX fragment (`<>...</>`).

**Ion wire format:**

```
ListLit([
  App(Var("div"), [Str(""), Str("Item 1")]),
  App(Var("div"), [Str(""), Str("Item 2")]),
])
```

**Emitted TSX:**

```tsx
<>
  <View>
    {"Item 1"}
  </View>
  <View>
    {"Item 2"}
  </View>
</>
```

⚠️ **Gap: the idiomatic RN pattern is `<FlatList>`, not a fragment.** For dynamic lists, use a `FlatList` component call directly — `FlatList` starts with uppercase, so the emitter treats it as a component reference. Use `propDict` to pass `data`, `renderItem`, and `keyExtractor`:

```
// Ion wire:
App(
  Var("FlatList"),
  [Str("")],          // empty attr string
  propDict=[
    { key: "data",         value: Var("items") },
    { key: "renderItem",   value: Abs([param("item")], App(Var("Card"), [Str(""), Var("item")])) },
    { key: "keyExtractor", value: Var("extractKey") },
  ]
)
```

**Emitted TSX:**

```tsx
<FlatList
  data={items}
  renderItem={(item) => (
    <Card>
      {item}
    </Card>
  )}
  keyExtractor={extractKey}
/>
```

`FlatList` is in `RN_NATIVE_IMPORTS` so it is auto-imported from `react-native`.


## State — `useState` via `raw(...)`

The React Native emitter has **no tested block-body `let`-chain component form**. Do not rely on it. Use `raw(...)` for hook lines:

```
// Ion wire (inside Abs body):
Let(
  name="state",
  value=RawInject("const [count, setCount] = useState(0)"),
  body=App(Var("div"), [...])
)
```

**Emitted TSX:**

```tsx
const Counter: React.FC = () => (
  const [count, setCount] = useState(0)
  <View>
    ...
  </View>
);
```

Note: `useState` must come in via an `extern` declaration or a `raw(...)` import line — the emitter never emits `import { useState } from 'react'` automatically.


## Style translation

### Inline styles via `propDict`

Pass styles using a `propDict` entry with `key: "style"` and a value built with `__obj__`. The emitter applies two transforms:

**Kebab-case → camelCase** with a `/* kebab→camel for RN */` comment:

```
// Ion wire:
propDict=[{ key: "style", value: App(Var("__obj__"), [Str("margin-top"), Int(8)]) }]
```

```tsx
style={{ marginTop: 8 /* kebab→camel for RN */ }}
```

**`"Npx"` string → bare integer:**

```
// Ion wire:
propDict=[{ key: "style", value: App(Var("__obj__"), [Str("padding"), Str("16px")]) }]
```

```tsx
style={{ padding: 16 }}
```

**Passthrough (Var value):** If the style value is a `Var` or `Accessor` node (not an `__obj__` literal), it passes through unchanged:

```
propDict=[{ key: "style", value: Var("myStyleVar") }]
// Emits: style={myStyleVar}
```

### StyleSheet.create hoisting

When the **same style object appears `≥ threshold` times** in the module (default threshold = 3, minimum clamped to 2), the emitter hoists it into `StyleSheet.create({...})` and replaces each occurrence with `styles.sN`.

Configure the threshold in `ion.config.json`:

```json
{
  "reactNative": {
    "styleHoistThreshold": 2
  }
}
```

`StyleSheet` is auto-imported. Styles inside `__platform__` / `__platform_select__` subtrees are **excluded** from the occurrence count.

**Example (threshold=3, style used 3 times):**

```
// Ion wire (same style propDict on 3 different nodes):
propDict=[{ key: "style", value: App(Var("__obj__"), [Str("flex"), Int(1)]) }]
// ... used 3 times across the module
```

```tsx
import { StyleSheet, View } from 'react-native';

const styles = StyleSheet.create({
  s1: { flex: 1 },
});

// Each occurrence replaced:
<View style={styles.s1} />
```

Style names are assigned sequentially (`s1`, `s2`, …) in order of first appearance.


## `__platform__` and `__platform_select__`

**Wire-format only.** Surface syntax for these builtins is ION-RN-13 — do not document or use surface forms.

### Wire format shape

```
App(Var("__platform__"), [
  Str("ios"),     iosExpr,
  Str("android"), androidExpr,
])
```

Both `"ios"` AND `"android"` arms are required. A duplicate arm (e.g. two `"android"` entries) throws:

```
Error: 'both "ios" and "android" arms are required'
```

### Emission rules

**Case 1 — Both arms are simple (literals or simple nodes) → ternary:**

```
App(Var("__platform__"), [Str("ios"), Str("light"), Str("android"), Str("dark")])
```

```tsx
(Platform.OS === "ios" ? "light" : "dark")
```

**Case 2 — Any non-simple arm OR a `"default"` arm → IIFE via `Platform.select`:**

```
App(Var("__platform__"), [
  Str("ios"),     Str("light"),
  Str("android"), App(Var("__add__"), [Int(1), Int(2)]),  // non-simple
])
```

```tsx
Platform.select({
  ios: () => "light",
  android: () => (1 + 2),
})()
```

**Case 3 — `__platform_select__` → `Platform.select` without IIFE call:**

```
App(Var("__platform_select__"), [Str("ios"), Int(1), Str("android"), Int(2)])
```

```tsx
Platform.select({ ios: 1, android: 2 })
```

Use `__platform_select__` when the result is a static object (e.g. a style value), not a value to execute.

`Platform` is auto-added to the `react-native` import whenever either builtin is used.


## Image source handling

The `img` HTML tag maps to `Image` (auto-imported). Source resolution rules:

| `src=` value | Emitted as |
|---|---|
| `src=https://example.com/photo.jpg` | `source={{ uri: "https://example.com/photo.jpg" }}` |
| `src=data:image/png;base64,...` | `source={{ uri: "data:image/png;base64,..." }}` |
| `src=require:./assets/logo.png` | `source={require("./assets/logo.png")}` |
| (no `src=` attr) | `{/* missing src on <Image> */}` (comment child) |
| `propDict` entry `source` | passes through verbatim: `source={expr}` |

The `src=` attribute is consumed entirely — it does not appear in the output. Other `img` attributes (e.g. `alt=Logo`) pass through after `src=` is stripped.

**`require:` example:**

```
// Ion wire:
App(Var("img"), [Str("src=require:./assets/logo.png alt=Logo")])
```

```tsx
<Image source={require("./assets/logo.png")} alt="Logo" />
```

**URI example:**

```
// Ion wire:
App(Var("img"), [Str("src=https://cdn.example.com/photo.jpg")])
```

```tsx
<Image source={{ uri: "https://cdn.example.com/photo.jpg" }} />
```


## AppRegistry auto-emit

When `emitReactNative` finds a top-level JSX component whose name equals `entryComponent` (default `"App"`), it automatically appends:

```tsx
AppRegistry.registerComponent('App', () => App);
```

and adds `AppRegistry` to the `react-native` imports.

### Suppress (library-mode component)

```json
{
  "reactNative": {
    "entryComponent": null
  }
}
```

No `AppRegistry` call is emitted.

### Custom entry name

```json
{
  "reactNative": {
    "entryComponent": "Root"
  }
}
```

Looks for a top-level component named `Root` and emits:

```tsx
AppRegistry.registerComponent('Root', () => Root);
```

### Default (entryComponent = "App")

```
// Ion wire:
let App = Abs([], App(Var("div"), [Str(""), Str("Hello")]))
```

```tsx
"use strict";
import React from 'react';
import { AppRegistry, View } from 'react-native';

const App: React.FC = () => (
  <View>
    {"Hello"}
  </View>
);
AppRegistry.registerComponent('App', () => App);
```


## SafeAreaView

`SafeAreaView` is treated as an uppercase-named component. Its import source depends on `safeAreaSource` config:

| `safeAreaSource` | Import source |
|---|---|
| `'context'` (default) | `react-native-safe-area-context` |
| `'rn-builtin'` | `react-native` |

**Default (context):**

```json
{ "reactNative": { "safeAreaSource": "context" } }
```

```tsx
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
```

**Built-in:**

```json
{ "reactNative": { "safeAreaSource": "rn-builtin" } }
```

```tsx
import { SafeAreaView, View } from 'react-native';
```


## Navigation gap

The emitter has no opinion on navigation. `href=` on `a` tags (→ `Pressable`) emits a comment child instead of an actual prop:

```tsx
{/* href=https://example.com (use onPress + navigation) */}
```

To handle navigation, use FFI to import the navigator:

```
// Ion wire (extern declaration):
ffi:js:@react-navigation/native:useNavigation
```

Then reference `useNavigation` via `raw(...)` or an `extern` binding and call it inside the component body.

**Minimal FFI pattern (wire format):**

```
// Module imports section:
{ ffi: "js", module: "@react-navigation/native", symbol: "useNavigation" }

// Inside component body — via raw():
Let(
  name="nav",
  value=RawInject("const navigation = useNavigation()"),
  body=App(Var("button"), [Str("onclick=handleNav"), Str("Go")])
)
```

```tsx
const navigation = useNavigation();
<Pressable onPress={handleNav}>
  <Text>Go</Text>
</Pressable>
```


## Worked example: Login screen

A complete login form component. Suppresses AppRegistry (library-mode). Includes an image, typed inputs, a button with a text label, and a platform-conditional hint.

### Ion wire format

```
// Declarations:

let LoginScreen = Abs([], 
  App(Var("div"), [Str(""),
    App(Var("img"), [Str("src=require:./assets/logo.png")]),
    App(Var("p"), [Str(""),
      App(Var("__platform__"), [
        Str("ios"),     Str("Sign in with Apple ID"),
        Str("android"), Str("Sign in with Google"),
      ])
    ]),
    App(Var("input"), [Str("type=email onchange=setEmail")]),
    App(Var("input"), [Str("type=password onchange=setPassword")]),
    App(Var("button"), [Str("onclick=handleLogin"),
      App(Var("span"), [Str(""), Str("Log In")])
    ]),
  ])
)
```

**`ion.config.json`:**

```json
{
  "target": "react-native",
  "reactNative": {
    "entryComponent": null
  }
}
```

### Emitted TSX

```tsx
"use strict";
import React from 'react';
import { Image, Platform, Pressable, Text, TextInput, View } from 'react-native';

const LoginScreen: React.FC = () => (
  <View>
    <Image source={require("./assets/logo.png")} />
    <Text>
      {(Platform.OS === "ios" ? "Sign in with Apple ID" : "Sign in with Google")}
    </Text>
    <TextInput keyboardType="email-address" onChange={setEmail} />
    <TextInput secureTextEntry={true} onChange={setPassword} />
    <Pressable onPress={handleLogin}>
      <Text>
        Log In
      </Text>
    </Pressable>
  </View>
);
```

No `AppRegistry` call because `entryComponent: null`. `Platform` is auto-imported because `__platform__` is used. Button label is wrapped in `span` (→ `Text`) to avoid the `Pressable`+bare-text runtime crash.


## Gap summary

| Feature | Status | Workaround |
|---|---|---|
| HTML → RN primitive mapping (`div`→`View`, `span`→`Text`, etc.) | ✅ works | — |
| Attribute remap (`onclick→onPress`, `maxlength→maxLength`, etc.) | ✅ works | — |
| `input` type coercion (`password→secureTextEntry`, `email→keyboardType`) | ✅ works | — |
| `class=` dropped + comment child | ✅ works | use `style=` propDict for styling |
| `href=` dropped + comment child | ✅ works | use `onPress` + navigation |
| Two-arm `Case` → JSX ternary | ✅ works | — |
| `ListLit` → `<>...</>` fragment | ✅ works | — |
| `img` `src=require:` → `source={require(...)}` | ✅ works | — |
| `img` `src=URL` → `source={{ uri: ... }}` | ✅ works | — |
| Style kebab→camelCase translation | ✅ works | — |
| Style `"Npx"` → integer coercion | ✅ works | — |
| StyleSheet.create hoisting (configurable threshold) | ✅ works | — |
| `__platform__` / `__platform_select__` builtins | ✅ works (IR/wire only) | surface sugar: ION-RN-13 |
| SafeAreaView routing (`context` vs `rn-builtin`) | ✅ works | — |
| AppRegistry auto-emit | ✅ works | suppress with `entryComponent: null` |
| `<Pressable>` with bare string child | ⚠️ emits `{"label"}` but crashes at RN runtime | wrap with `span("", "label")` |
| `select` / `option` | ❌ emits comment placeholder | use `@react-native-picker/picker` via FFI |
| `br`, `hr`, `meta`, `link`, `script`, `style`, `title`, `head` | ❌ silently dropped | not applicable in RN |
| 3+ arm `Case` in JSX | ❌ silently emits first arm only | nest two-arm Cases |
| `useState` block-body component | ❌ not tested for RN | `raw("const [v, setV] = useState(...)")` |
| Inline event-handler lambda | ❌ identifier-only value supported | hoist handler to named `let` |
| `FlatList` native sugar | ❌ no built-in sugar | uppercase-named component call via propDict |
| Navigation (`@react-navigation/native`) | ❌ no emitter opinion | FFI extern + `onPress` |
| Surface-syntax `__platform__` | ❌ not yet | ION-RN-13 |
| Component props typing | ❌ params untyped in emitted TSX | `OopClass` decl or a `.d.ts` sidecar |
