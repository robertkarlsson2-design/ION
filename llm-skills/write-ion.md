---
name: write-ion
description: ENTRY POINT for writing Ion code. Read this FIRST any time you're authoring or modifying `.ion` source. It is short (~80 lines) and tells you the workflow + which sub-skill to load next based on the build target. Sub-skills (`writing-ion-for-typescript`, `writing-ion-for-react`, `writing-ion-for-python`, etc.) cover target-specific idioms; `ion-syntax` and `wire-format` are full surface/wire references.
---

# Writing Ion — entry skill

Ion compiles one source language to several target languages. **The Ion you write is target-agnostic at the type/IR level, but emission idioms differ per target** (TypeScript uses interfaces, Python uses dataclasses, React uses JSX-as-function-calls, etc.). One skill file per target keeps your context lean — load only what's relevant for the task.

## Workflow

Three steps. Always do them in this order.

### Step 1 — Read this entry skill (you're doing it)

You're here. After this, you'll know which sub-skill to load next.

### Step 2 — Pick + load the per-target sub-skill

Look at `ion.config.json`'s `target` field, or the `--target` CLI flag, or the project's CLAUDE.md. Then load **one** of these skills:

| `target` value | Skill to load | Use when |
|---|---|---|
| `typescript` (or `typescript-dts`) | `writing-ion-for-typescript` | Server-side Node code, type definitions, Express/pg/Node stdlib |
| `javascript` | `writing-ion-for-typescript` (skim — JS emission is mostly TS without types) | Plain JS targets without type info |
| `react` | `writing-ion-for-react` | React TSX components, hooks, JSX, event handlers |
| `python` | `writing-ion-for-python` | Python 3.10+ code, dataclasses, typing.Protocol |
| `java` | `writing-ion-for-java` | Java 21+, records, sealed interfaces |
| `html` | `writing-ion-for-html` | Static HTML output (no JS) |
| `vue` | `writing-ion-for-vue` | Vue Single-File Components |
| `apex` | `writing-ion-for-apex` | Salesforce Apex classes |
| `lwc` | `writing-ion-for-lwc` | Lightning Web Components |
| `react-native` | `writing-ion-for-react` (use as base; RN-specific notes below) | React Native mobile apps |

If the project uses **multiple targets** (e.g., backend in TypeScript, frontend in React), load both. They mostly compose without conflict.

### Step 3 — Reference skills (lookup-only — load only when needed)

Don't load these proactively. Reach for them when you need to confirm a token-level detail.

- `ion-syntax` — full surface-syntax reference (every keyword, type, operator). Use when you're writing surface and need to check exact syntax.
- `wire-format` — full wire-format reference (every section letter, every node kind, every dialect). Use when you're authoring wire-format `.ionw` or `.ion` files and need to verify the binary encoding.
- `ion-wire-format-by-example` (only present in projects that mandate wire format, e.g., Otouren v2) — verified wire-format patterns extracted from ION's roundtrip golden tests. Authoritative for projects that have it.

## File extension + format detection

- `.ion` files contain **either surface syntax OR wire format**. The compiler auto-detects from the first line:
  - Starts with `I1` → wire format
  - Anything else → surface syntax
- `.ionw` files are explicit wire format (used as parallel storage when `wireFormat: true` in `ion.config.json`).

## Build, check, format

Always verify before committing:

```bash
cd <project>
npx ion check --all      # type-check without emitting (surface-only — wire skips frontend)
npx ion build            # compile to target
npx ion fmt --check ion/src/   # CI guard (surface-only)
```

`ion build` accepts both formats.

## When the language can't express what you need

Priority order — try in sequence:

1. **`@external(target="javascript", module="...", symbol="...")`** (surface) or **`ffi:js:<module>:<symbol>`** (wire) — for ANY third-party call. Almost always sufficient.
2. **A `data` type with deferred fields** — if a foreign object's full shape isn't expressible, declare a `data` for the fields you DO use; access remaining fields via `ffi:` getters.
3. **`raw("expression")` at the LINE level** (valid in **surface syntax** and wire format) — for ONE expression that even FFI can't reach (a complex generic instantiation, a runtime-only construct). The function around it stays in real Ion. Document each use in a project-local `docs/spec.md`.
4. **NOT permitted**: `raw("entire-module-body")`, `raw("multiple statements")`, or stashing TS in a `dist-overrides/` directory. The architecture stage of pipeline projects rejects these.

## Hard rules

- **One module per file.** File path mirrors module name: `src/routes/health.ion` declares `module org.<area>.routes.health` (surface) or `M org.<area>.routes.health v=...` (wire).
- **`raw()` is line-level only.** A whole-function `raw()` is a code smell.
- **Use `data` types.** They cost almost nothing (a single `D` line in wire, a `data X { ... }` line in surface) and earn the type checker's protection. Emission idioms per target: single-ctor → TS `interface`, Python `@dataclass`, Java `record`; multi-ctor → TS discriminated union (`type T = A | B`), Python `@dataclass` classes + `Union[A, B]` alias, Java `sealed interface` + `record` variants.
- **Use FFI annotations** for every third-party call — never inline `import` statements via `raw()`.
- **Don't hand-write `S` / `T` / `L` pool lines or `&alias` references.** Projects with the auto-compressor (e.g. Otouren v2 — `npm run ion:compress`) will hoist them on save. Write naturally with full names + inline string literals; the compressor handles deduplication. You only need to read pool aliases when reviewing already-compressed files. See `wire-format` skill, "Build-time auto-compression" section.

## What's wired today

Wired emitters (callable via `--target <name>` or `target: "<name>"` in config):
- `javascript` ✅
- `typescript`, `typescript-dts` ✅
- `python` ✅
- `java` ✅
- `react` ✅
- `html` ✅
- `vue` ✅
- `apex` ✅ (experimental)
- `lwc` ✅ (multi-file output)
- `react-native` ✅ — maps HTML tags to RN primitives (`div`→`View`, `span`→`Text`, `img`→`Image`, etc.); `src=require:./path` emits `source={require("./path")}`, any other `src=` value emits `source={{ uri: "..." }}`; auto-emits `AppRegistry.registerComponent` for the entry component (default `"App"`, suppress with `"reactNative": { "entryComponent": null }` in `ion.config.json`)

Each has a corresponding `writing-ion-for-<target>` skill — load the relevant one in Step 2.

## In doubt? Default behaviour

If the per-target skill doesn't cover the pattern you need:
1. First search `tests/emit/<target>.test.ts` in the ION repo for a test exercising it. Test cases ARE the spec.
2. Try writing the most natural Ion you can. Run `ion build`. If it compiles, you're good.
3. If it errors, the error message often points at the specific IR limitation. File an ION-N follow-up ticket describing the gap.
