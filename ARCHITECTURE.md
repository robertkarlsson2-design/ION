# ION — Architecture

This file is the architectural source of truth for the ION compiler. The Architecture pipeline stage reads this when refining each ticket's plan; the Coding stage treats it as authoritative on file placement, layering, dependency direction, and patterns.

## Stack

- **Language**: TypeScript (target ES2022, module ESNext).
- **Runtime**: Node 22.
- **Tests**: vitest.
- **Tokenizer**: GPT tiktoken-equivalent for benchmark output.
- **CLI binary**: `ion`, exposed via `npm link`.

## Top-level structure

```
src/                          # Compiler frontend + CLI
  cli/
    ion.ts                    # binary entry point (the `ion` command)
    build.ts                  # `ion build` — orchestrates frontend → emitter
    check.ts                  # `ion check` — type-checks without emitting
    config.ts                 # ion.config.json schema + loader
    fmt.ts                    # `ion fmt`
    grammar.ts                # `ion grammar` (prints active grammar)
    ingest.ts                 # `ion ingest` (convert existing code to Ion)
    tokens.ts                 # `ion tokens` (token counts)
  lexer/                      # .ion → token stream
  parser/                     # tokens → AST
  binder/                     # symbol resolution
  checker/                    # type + effect checking
  desugar/                    # AST → IonIR (canonical form)
  ir/
    nodes.ts                  # IonIRNode union — every node kind
    types.ts                  # IonType union
  wire/                       # .ion / .ionw encode + decode
  types.ts                    # shared CLI / IR helpers
emitters/                     # backends (one folder per target)
  ui-shared.ts                # shared HTML tag / attribute helpers
  javascript/emit.ts          # IonIR → JS         [WIRED IN CLI]
  typescript/emit.ts          # IonIR → TS         [WIRED IN CLI]
  python/emit.ts              # IonIR → Py         [WIRED IN CLI]
  java/emit.ts                # IonIR → Java       [WIRED IN CLI]
  react/emit.ts               # IonIR → React TSX  [WIRED IN CLI]
  html/emit.ts                # IonIR → HTML       [code present, not wired]
  vue/emit.ts                 # IonIR → Vue SFC    [code present, not wired]
  apex/emit.ts                # IonIR → Apex       [code present, not wired]
  lwc/emit.ts                 # IonIR → LWC files  [code present, not wired]
tests/
  lexer/  parser/  binder/  checker/  desugar/  ir/  wire/  emit/  golden/
  cli/  integration/
ion/                          # self-hosted Ion examples + bootstrap
  src/                        # .ion sources used by tests/golden/
contributor-skills/
  new-emitter.md              # the canonical guide for adding an emitter
llm-skills/
  README.md
  write-ion.md                # USER-FACING — how an LLM should write Ion
  ion-syntax.md               # USER-FACING — full surface syntax reference
  wire-format.md              # USER-FACING — wire format spec (versioned)
package.json
tsconfig.json
README.md
ARCHITECTURE.md  CLAUDE.md
```

## Compiler pipeline

```
.ion source
  → src/lexer/        → tokens
  → src/parser/       → AST
  → src/binder/       → resolved AST (symbols)
  → src/checker/      → typed + effect-checked AST
  → src/desugar/      → IonIR (the contract between frontend + emitters)
  → emitters/<target> → output language source
```

**The IR is the single contract.** Frontend changes that are invisible at IR level need no emitter changes. Emitter changes need no frontend changes. This is the architectural fence — keep IR stable; version it explicitly when you must change shape.

## Layering rules

1. **`src/ir/`** — pure types. No imports from any other `src/` subdir.
2. **`src/lexer/`, `src/wire/`** — only depend on `src/ir/types.ts` and stdlib.
3. **`src/parser/`** — depends on `src/lexer/`, `src/ir/`.
4. **`src/binder/`, `src/checker/`, `src/desugar/`** — depend on `src/parser/`, `src/ir/`.
5. **`src/cli/`** — depends on everything in `src/` AND on `emitters/`.
6. **`emitters/<target>/`** — depend on `src/ir/` (types only) and `emitters/ui-shared.ts`. **Emitters do NOT import from `src/cli/`, `src/checker/`, etc.** They are pure functions of `IonIRModule → string` (or structured output for multi-file targets).

The Architecture stage rejects PRs that violate these import boundaries. Concretely: an `emitters/foo/emit.ts` that imports anything from `../../src/checker/` is a blocker.

## Wiring an emitter into the CLI

This is a one-line change in `src/cli/build.ts::getEmitter(target)`:

```ts
function getEmitter(target: string): EmitFn | null {
  if (target === 'javascript') return emitJS;
  if (target === 'typescript') return emitTS;
  if (target === 'react')      return emitReact;   // ← add this
  // ...
  return null;
}
```

Plus the corresponding `import` at the top of `build.ts`.

After wiring, the emitter is reachable via `ion build --target react` and via `"target": "react"` in `ion.config.json`. Acceptance criteria: a sample `.ion` file compiles cleanly to `.tsx` and the existing emitter tests still pass.

For multi-file emitters (LWC), `getEmitter` returns a different signature; see `contributor-skills/new-emitter.md` for that path.

## Patterns to follow

- **`emit.ts` exports one entry function** matching `(irModule: IonIRModule) → string` (or structured object for multi-file).
- **Per-node emit functions are non-exported helpers** with discriminated-union dispatch on `node.kind`.
- **`emitters/ui-shared.ts`** is the only shared module across emitters. It contains `HTML_TAGS`, `VOID_ELEMENTS`, `isHtmlElement(node)`, and `getAttrRaw(node)`. Reuse it; don't re-implement.
- **Test the emitter against synthetic IR nodes** (see `tests/emit/react.test.ts` for the canonical pattern — synthesise IR nodes directly, no parser involvement, then assert the output).
- **Snapshot tests are OK** for golden output, but every snapshot has a written assertion describing what it's testing.

## Anti-patterns (Architecture rejects)

- An emitter that imports from `src/checker/` or any other compiler-internal module.
- A new compiler stage that bypasses IonIR (e.g. parser → emitter directly).
- A parser change that doesn't update `tests/parser/` AND `tests/desugar/`.
- A new emitter without `tests/emit/<name>.test.ts`.
- A user-visible syntax / wire-format change without a corresponding update to `llm-skills/write-ion.md` (and `ion-syntax.md` / `wire-format.md` where relevant).
- `console.log` left in committed source. (`process.stderr.write` for legitimate error output is fine.)
- Emitters that read environment variables or files. They're pure `(IonIRModule) → string`.

## Build, test, and verification

```bash
npm install
npm run build               # tsc + bundles dist/cli/ion.js
npm test                    # full vitest suite
npm test -- tests/emit/     # just emitters
npm test -- tests/checker/  # just type-checker
npx ion --version           # CLI binary works
```

`/pre-pr-check` runs the above.

## Status of emitters (mirrors README's status table)

| Emitter | Wired in CLI | Test coverage |
|---|---|---|
| javascript | ✅ | tests/emit/javascript.test.ts |
| typescript | ✅ | tests/emit/typescript.test.ts |
| typescript-dts | ✅ | tests/emit/typescript-dts.test.ts |
| python | ✅ | tests/emit/python.test.ts |
| java | ✅ | tests/emit/java.test.ts |
| react | ✅ | tests/emit/react.test.ts |
| **html** | ❌ (code present) | tests/emit/html.test.ts |
| **vue** | ❌ (code present) | tests/emit/vue.test.ts |
| **apex** | ❌ (code present) | tests/emit/apex.test.ts (if present) |
| **lwc** | ❌ (multi-file; emit signature differs) | tests/emit/lwc.test.ts (if present) |

Wiring the unwired emitters is the next architectural priority — see ION-1+ in the Tickster ION project.

## Out of scope (don't restructure these without a dedicated ticket)

- Replacing the IonIR shape — the IR is a stable contract between frontend and emitters.
- Replacing vitest / TypeScript / Node version.
- Adding new compiler frontends (e.g. parsing TypeScript directly into IonIR) — that's `ion ingest` territory and lives in `src/cli/ingest.ts`.
- Replacing the wire format — wire format is versioned (`I1`); a new version is a major release.
