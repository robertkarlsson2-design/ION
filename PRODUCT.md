# Product Vision

## What this product is

ION is a **token-efficient, AI-native programming language**. Source code is wire-format IR — terse, line-oriented, deterministic. The compiler emits idiomatic target-language code: TypeScript, JavaScript, Python, Java today; React/Vue/HTML/Apex/LWC emitters live in `emitters/` and get wired into the CLI as needs land. The goal is to make LLMs generate ~3-5× less source code per equivalent feature, while letting the compiler produce target code that hand-authored repos already accept.

The product is the compiler + the wire-format specification + the per-target emitters + the CLI. Consumers (Otouren v2, eventually TWF, possibly external) build apps in `.ion` files and integrate via `vite-plugin-ion` or by invoking `ion build` directly.

## Target users

- **LLM coding agent** (primary, oddly) — the Claude/Codex coding stage of the Tickster pipeline produces and modifies `.ion` files. The language exists primarily to make this loop cheaper + more accurate.
- **Human reviewer of LLM-produced changes** (secondary) — needs the wire format to be legible enough for sanity-check review. Diffs should make sense at a glance.
- **Downstream consumer** (Otouren v2, future projects) — uses the compiler to produce target-language artefacts integrated into normal builds.

## In scope

- **Wire-format specification** — line-oriented IR, first line `I1`, deterministic ordering
- **Surface-syntax (the readable `fn`/`data`/`let`/`case` form)** — exists for documentation, NOT for committed source. Tooling rejects surface-syntax `.ion` in repos that import this compiler.
- **TypeScript emitter** — primary target; the most polished
- **JavaScript, Python, Java emitters** — supported targets
- **React emitter** (`--target react`) — emits TSX for `vite-plugin-ion`
- **Vue, HTML, Apex, LWC emitters** — in `emitters/`, gated behind feature flags until ready
- **CLI**: `ion build` / `ion check` / `ion fmt`
- **Tests**: vitest unit tests + a per-emitter snapshot suite

## Out of scope (non-goals)

- **Hand-authored surface-syntax committed to consumer repos** — the surface form is for reading + docs only
- **A general-purpose IDE language server** — the compiler emits target code; the IDE works on the target
- **Runtime interpreter** — ION compiles, doesn't run
- **Tutorial / marketing site** — docs live in `README.md` + `docs/`; no separate brochure site
- **Hot module reload for `.ion` source** — covered by the target build tool (Vite handles it for the React emitter)

## Strategic bets for this cycle

- **Bet 1 — Token cost over surface ergonomics**. If a wire-format change saves tokens at the cost of being slightly harder to write by hand, that's a win. LLMs don't tire.
- **Bet 2 — Snapshot-based emitter tests**. Every emitter has snapshot tests against a golden corpus. Diff-on-PR is the primary review surface for emitter changes.
- **Bet 3 — Compiler stays deterministic**. Same input → same output, byte-for-byte. No timestamps, no random IDs, no ordering instability.

## How the Product Owner agent uses this file

Compare each ticket against:
- Does this advance the wire-format spec / a target emitter / the CLI ergonomics?
- Is this in support of an LLM coding agent's needs (Bet 1)?
- Does it keep snapshots green (Bet 2)?
- Does it preserve determinism (Bet 3)?

Advisory only — never blocks.
