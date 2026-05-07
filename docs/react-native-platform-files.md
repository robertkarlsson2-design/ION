# React Native Platform-Suffix File Splitting

## Background — why `.ios.tsx` / `.android.tsx` matters

Metro (React Native's bundler) resolves `Foo.ios.tsx` over `Foo.tsx` on iOS
devices and `Foo.android.tsx` over `Foo.tsx` on Android devices at bundle
time. This is Metro's platform-specific file resolution convention, not a
runtime check — the platform variant is picked before the bundle is built.

An author who ships split files gets:

- **Smaller per-platform bundles** — Android code never ships in the iOS
  bundle and vice versa.
- **No dead code** — no `if (Platform.OS === 'ios')` guards, no tree-shaking
  needed.
- **Clean platform-native API use** — iOS Haptics, Android back-button
  handling, etc. can be called directly without runtime guards.

Currently, ION maps every `.ion` source file to a single `.tsx` output file.
The `__platform__` and `__platform_select__` builtins provide per-expression
branching but do **not** produce split files. Authors must choose: one file
with runtime `Platform.OS` checks, or no platform splitting at all.

## Current state

`__platform__(ios: expr, android: expr)` emits a runtime ternary:

```tsx
(Platform.OS === "ios" ? <ios-expr> : <android-expr>)
```

`__platform_select__(ios: expr, android: expr)` emits:

```tsx
Platform.select({ ios: <ios-expr>, android: <android-expr> })
```

Both builtins are wired in `emitters/react-native/emit.ts` via
`_rnImports.add('Platform')`, which adds `Platform` to the `react-native`
import set automatically when either builtin is used.

Neither builtin produces a split output file. The output is always a single
`.tsx` file, regardless of how much platform-conditional content it contains.

## Three options

### Option A — Source filename suffix (`.ios.ion` → `.ios.tsx`)

The author names the file `Button.ios.ion` (or `Button.android.ion`). The
CLI's `resolveOutputPath` in `src/cli/build.ts` (line 218) currently does:

```ts
const withExt = rel.replace(/\.ion$/, ext);
```

To implement Option A, change this to detect and pass through the `.ios` /
`.android` infix:

```ts
const withExt = rel.replace(
  /(?:\.(ios|android))?\.ion$/,
  (_, plat) => (plat ? '.' + plat : '') + ext,
);
```

`Button.ios.ion` → `Button.ios.tsx`, `Button.android.ion` →
`Button.android.tsx`, `Button.ion` → `Button.tsx` (unchanged).

Only one file needs changing when this is implemented:
`src/cli/build.ts:resolveOutputPath` (one line).

**Pros:**

- Zero IR / parser / checker / desugarer changes.
- Follows Metro's own naming convention — no new concepts.
- The existing `**/*.ion` glob in `ion.config.json` already captures
  `.ios.ion` and `.android.ion` files; no config change needed.
- The LWC emitter set the precedent that output-path shaping lives in
  `src/cli/build.ts`, not inside an emitter.
- `compileFile` does not need to know it is building a platform-specific
  module; it emits normal RN TSX into the correctly-named file.

**Cons:**

- No compiler-level validation that `.ios.ion` is only used with the
  `react-native` target. Compiling `Button.ios.ion` with `--target
  typescript` would silently produce `Button.ios.ts`.
- Platform intent lives in the filename, not inside the file — can be
  surprising to readers unfamiliar with Metro conventions.
- Authors must maintain two separate files for components with large
  per-platform divergence. For mostly-shared components, `__platform__`
  inside a single file may remain the better choice.

### Option B — `@platform("ios")` module-level annotation

A new surface annotation on the module declaration signals the compiler to
write a `platform` field onto `IonIRModule`; the CLI reads it and adjusts
the output filename accordingly.

Files that would need changing:

- `src/parser/declarations.ts` — parse `@platform`
- `src/ir/nodes.ts` — add `platform?: string` to `IonIRModule`
- `src/checker/` — validate values are `"ios" | "android"`
- `src/desugar/` — propagate annotation to IR
- `src/cli/build.ts` — read `ir.platform` and insert infix
- `llm-skills/write-ion.md` — document the annotation
- `wire-format.md` — version bump required

**Pros:**

- Self-documenting: the platform intent is declared inside the file.
- Compiler can validate and reject unsupported values.
- Future-extensible to other platform targets (`web`, `windows`, etc.).

**Cons:**

- High implementation scope: 6+ files plus a wire-format version bump.
- Over-engineered for what is purely a filename convention. The compiled
  TSX does not change at all — only the output path differs. Adding parser,
  IR, and checker machinery for a one-path-segment change is difficult to
  justify.

### Option C — Keep `__platform__` per-expression only (status quo)

No changes. Authors use `__platform__` and `__platform_select__` inside a
single `.tsx` output file for all platform-conditional logic.

**Pros:**

- Already implemented and tested.
- Ideal for mostly-shared components where only a few expressions differ per
  platform — avoids duplicating two near-identical files.

**Cons:**

- Cannot produce split files; Metro's file-resolution mechanism is
  unavailable.
- Both iOS and Android code ship in every bundle, increasing bundle size and
  preventing Metro tree-shaking.
- Platform-only APIs still require runtime checks.

## Trade-off summary table

| | A — filename suffix | B — @platform annotation | C — status quo |
|---|---|---|---|
| Implementation effort | Minimal (1 line) | High (6+ files + version bump) | Zero |
| Metro file splitting | Yes | Yes | No |
| Compiler validation | No | Yes | N/A |
| Wire-format version bump | No | Yes | No |
| LLM author ergonomics | Good (Metro-idiomatic) | Good | Good (intra-file branching) |

## Recommendation

**Adopt Option A.**

The RN emitter already produces correct platform-aware TSX; the only missing
capability is landing that TSX in the correctly-named file. Option A achieves
this with a one-line change to `resolveOutputPath` — the smallest possible
diff for the largest practical payoff.

Annotations (Option B) are warranted when the compiler must validate or
transform logic. Here, the compiler does nothing different — only the output
filename changes. Adding parser/IR/checker machinery for that is
disproportionate to the gain.

Option C remains the right default for intra-file platform branches. Authors
may combine it with Option A: use `__platform__` inside `.ios.ion` files for
any residual per-expression branching that doesn't warrant a full file split.

## Migration from current `__platform__`-only state

1. Identify components with whole-module platform divergence — those where
   nearly every prop or expression is wrapped in `__platform__`.
2. Split the component into `Foo.ios.ion` and `Foo.android.ion`. Remove
   `__platform__` calls and use platform-native APIs directly in each file.
3. If a shared generic implementation exists, keep it in `Foo.ion`; it
   continues to compile to `Foo.tsx` and Metro falls back to it on platforms
   not matched by a suffix file.
4. No `ion.config.json` `include` change is needed — the default `**/*.ion`
   glob already captures `.ios.ion` and `.android.ion` files.
5. Existing `__platform__` usage remains fully valid; no forced migration.

## Open questions for the operator

1. **Target mismatch warning:** Should the CLI warn or error when a
   `.ios.ion` / `.android.ion` file is compiled with a non-`react-native`
   target (e.g., `ion build --target typescript` on `Button.ios.ion`)? It
   could silently produce `Button.ios.ts`, which Metro would never resolve.
2. **Configurable platform suffix set:** Should `ion.config.json` gain a
   `platformSuffix: ["ios", "android"]` array so the set of recognized
   infixes is configurable (e.g., adding `"windows"` for React Native Windows
   targets), or is hard-coding `ios` and `android` sufficient for now?
3. **Source maps:** `Button.ios.tsx.map` would automatically reference
   `Button.ios.ion` because `generateSourceMap` takes the ion path directly —
   no code change needed. Confirm this assumption during implementation.
