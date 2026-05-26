# ION — Roadmap

This file is the **PO agent's authoritative source for what to file next**. Operator-owned. PO never edits it.

The product is **actively shipping compiler + emitter work**. 10 tickets in `implement`, 74 backlog (1 urgent, 3 high, 19 medium, 44 low, 7 none). Recent focus: React Native emitter polish (ION-210/217/220/221/223/224/225/226/227). This ROADMAP frames the remaining compiler stability + emitter targets per PRODUCT.md.

Strategic bets from PRODUCT.md:
- **Bet 1 — Token cost over surface ergonomics.**
- **Bet 2 — Snapshot-based emitter tests.**
- **Bet 3 — Compiler stays deterministic.**

---

## Now — recently shipped + 10 in flight

Recently merged (last 10 days):
- ✅ ION-217 — Image source handling (uri vs require) + AppRegistry auto-emit
- ✅ ION-219 — StyleSheet.create hoist mode for repeated styles
- ✅ ION-220 — Dynamic import collector for the React Native module preamble
- ✅ ION-221 — llm-docs/react-native.md + write-ion.md update
- ✅ ION-223 — react-native emitter raw(...) blocks fix
- ✅ ION-224 — ui-shared.ts → ui-shared/ subdirectory module
- ✅ ION-225 — Unescaped double-quotes in parseRnAttrString fix
- ✅ ION-226 — Clarify emitter-layer dependency on src/prelude/dce.js
- ✅ ION-227 — Guard missing ios/android arms before non-null assertions
- ✅ ION-210 — `throw expr` emits `throw ` directly (not `throw new Error(...)`)

10 in `implement` — heavy compile-pipeline week. PO should NOT file anything overlapping React Native emitter, the prelude DCE pass, or wire-format encoder.

---

## Next — compiler stability + remaining v1 emitter targets (PO files here first)

### M-RN-1 — React Native emitter v1 hardening 🟡

The RN emitter is the freshest. Squash remaining glitches before declaring v1.

- Suggested split:
  - **M-RN-1.1** — Snapshot pass: every fixture in `tests/snapshots/react-native/` produces a runnable RN app
  - **M-RN-1.2** — Per-platform branching (`if Platform.OS === 'ios' / 'android'`) properly emitted with type-narrowing TSX
  - **M-RN-1.3** — Smoke harness: a tiny RN app that consumes ION-emitted code and runs `pod install + expo start` clean in CI
- Prereq: in-flight tickets land.

### M-COMP-1 — Wire-format encoder edge cases 🟡

The recent wire-format encoder churn (multiple ION_REF bumps for OTV2 consumers) shows there are still pool-exclusion / JSX-attr decoder edge cases.

- Suggested split:
  - **M-COMP-1.1** — Property-based test: random source → encode → decode → re-encode produces byte-identical output (Bet 3 determinism)
  - **M-COMP-1.2** — Audit pool-exclusion logic; any string in a pool MUST round-trip
  - **M-COMP-1.3** — JSX attribute decoder: deny ambiguity (no "bare value vs string" guessing)
- Prereq: none.

### M-VUE-1 — Vue emitter wire-up 🟡

Per PRODUCT.md, the Vue emitter lives in `emitters/` but isn't wired into the CLI. Wire it up if a real consumer is queued (check operator).

- Acceptance: `ion build --target vue` produces a working `.vue` SFC; snapshot suite seeded with 3 fixtures.
- Prereq: operator confirms a real Vue consumer exists. If not, push to "Later".

### M-DOC-1 — `llm-skills/write-ion.md` parity across all targets 🟡

Each target language (TS / JS / Python / Java / React / React Native / Vue / HTML / Apex / LWC) needs equivalent LLM-facing reference docs.

- Suggested split: one ticket per target whose docs don't match the others' shape.

---

## After — sequenced milestones (PO files once "Next" empties)

### M-HTML-1 — HTML emitter v1

The HTML target exists in `emitters/` but isn't wired. Out-of-scope until a clear consumer exists.

### M-APEX-1 / M-LWC-1 — Salesforce-side targets

Apex + LWC emitters exist in `emitters/` from earlier exploration. Same gating as Vue/HTML — only wire when there's a real consumer.

### M-IDE-1 — VS Code language-server-lite

Per PRODUCT.md, the compiler emits target code and the IDE works on the target. A *lite* LSP (just error reporting + go-to-definition for `.ion` → emitted TSX) is borderline but might help. Re-evaluate only if LLM-driven authoring shows it'd cut token cost.

### M-PERF-1 — Compile latency

Target: `<100ms` per file in incremental mode. Profile, find hot paths, optimise. Don't optimise prematurely — only file if real consumers complain.

### M-FMT-1 — `ion fmt` deterministic formatter

Wire-format already has a canonical form. `ion fmt` enforces it. Tests assert byte-identical reformatting.

---

## Later (parking lot — many are explicit non-goals from PRODUCT.md)

- General-purpose IDE language server (the compiler emits to target; IDE works on target — non-goal)
- Runtime interpreter (non-goal — ION compiles, doesn't run)
- Tutorial / marketing site (non-goal — docs in README + docs/)
- Hot module reload for `.ion` source (covered by target build tool)
- Web playground / online compiler
- Surface-syntax mode for committed source (the surface form is for reading + docs only — non-goal)

---

## How the PO agent reads this file

1. Find the first "Next" milestone that isn't already filed.
2. File the smallest ticket that advances it. ≤5 per run.
3. Cross-check the 74-item backlog before filing — many milestones may already have sub-tickets.
4. With 10 tickets in flight, the constraint is concurrency, not filing volume. PO should err toward re-ranking + closing stale this week, not piling more on.
5. **Never** edit this file.
