# CLAUDE.md — ION

Project conventions and agent instructions. This file is auto-loaded by Claude Code at the start of every pipeline stage.

## What ION is

ION is a **token-efficient, AI-native programming language** that compiles to idiomatic TypeScript, JavaScript, Python, and Java (with React/Vue/HTML/Apex/LWC emitters in `emitters/` not yet wired into the CLI). The compiler eliminates structural boilerplate that bloats target-language output — interfaces, Promise wrappers, switch statements, type casts — letting LLMs generate clean intent-only source that the compiler expands.

See `README.md` for the full language reference.

## Stack

- **Compiler**: TypeScript on Node 22.
- **Tests**: vitest.
- **Build**: `npm run build` produces the CLI at `dist/cli/ion.js` (linked to `ion` via `npm link`).

## Project rules

- **Every emitter under `emitters/` is a self-contained module.** It exports one entry function (e.g. `emitReact(irModule) → string`) and consumes only `IonIRNode` / `IonType` from `src/ir/`. Emitters do NOT import from other emitters except `emitters/ui-shared.ts` (the shared HTML-tag set + attribute parser).
- **Adding a new emitter** is documented in `contributor-skills/new-emitter.md`. Follow that file step-by-step.
- **Wiring an existing emitter into the CLI** is a one-line addition to `getEmitter(target)` in `src/cli/build.ts`. After that, `target: "<name>"` works in `ion.config.json` and `ion build --target <name>` works on the command line.
- **Don't bypass IonIR.** The compiler frontend (lexer → parser → binder → checker → desugarer) feeds IonIR; emitters consume IonIR. Adding new "shortcuts" that skip the IR is rejected.
- **Tests are non-negotiable.** Every emitter has a corresponding `tests/emit/<name>.test.ts`. New behaviour gets a new test in the same file.
- **Never silently change wire format or surface syntax** without a version bump in `wire-format.md`. The format is consumed by external tooling (Vite plugin, LSP, etc.).
- **Skill files are user-facing source of truth.** When you change the language, update `llm-skills/write-ion.md` (and `ion-syntax.md` / `wire-format.md` where relevant) in the SAME PR.

## Verification (used by Coding, Fixing, QA stages)

```bash
cd /workspace/repo
npm install
npm run build               # compiles the CLI
npm test                    # full vitest suite
npm test -- tests/emit/     # emitter-specific suite
```

`/pre-pr-check` (added by ION-bootstrap-1 if not already present) runs all of the above plus `npx ion --version` to verify the CLI binary is callable.

## Code Review Rules

- New emitters live under `emitters/<name>/emit.ts`, NOT inside `src/`.
- Emitter code consumes only IR types from `src/ir/`. Does not import from `src/binder/`, `src/checker/`, or other CLI internals.
- New language constructs require: a parser change in `src/parser/`, an IR node addition in `src/ir/nodes.ts`, a checker rule in `src/checker/`, a desugarer step in `src/desugar/`, AND test coverage at all 4 levels.
- Skill file (`llm-skills/write-ion.md`) is updated alongside any user-visible language change.

## Security / safety rules

- **Don't write code that runs the user's untrusted Ion source as a side effect of `ion build`.** ION is a compiler. It must not execute target code unless explicitly invoked (e.g. `ion run` if that ever exists).
- **`raw(...)` blocks** are passed through verbatim to the target. The compiler must NOT eval / interpret them.

## Conflict Resolution Rules

- `package-lock.json` → keep both sides; `npm install` reconciles.
- `tests/emit/<name>.test.ts` → if both branches add cases, keep both.
- Generated files in `dist/` should never appear in a diff (gitignored).

## Deploy

Workflow file: `.github/workflows/<TBD>` (no production deploy today; the CLI is consumed via `npm link` or `git clone + npm install + npm run build`).

## Retro rule (multi-project — same pattern as Otouren / WhiteRabbit)

This is a non-Tickster project. The retro stage uses a two-tier action rule:

1. **Own-project stage-prompt issues** → update this project's prompt directly via `PUT /api/projects/{project_id}/agent-config`. Do NOT file a ticket.
2. **Tickster pipeline / orchestrator / infrastructure issues** → file a ticket in the **Tickster project** (`27e4223b-0c98-4301-bf47-76d0413dcbd6`), NOT this project.
3. **ION backlog improvements** (new emitters, new language features, language gaps that bit this project, perf issues) → file a ticket in this project (ION) using `ION-N` numbering.

## Tickster API

```bash
curl -sf "$TICKET_API_URL/api/work-items/$WORK_ITEM_ID" -H "Authorization: Bearer $TICKET_API_TOKEN"
curl -sf -X POST "$TICKET_API_URL/api/comments/$WORK_ITEM_ID" \
  -H "Authorization: Bearer $TICKET_API_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --arg body "Your markdown here" '{body:$body}')"
```

## Single-pod pipeline contract

Stage sequence:
```
scout → planning → architecture → coding → code_review → security_review → pr_creating → pr_review → merging → deploy_verify → retro
```

- `architecture` reads `ARCHITECTURE.md` + `planning.md` and refines the plan.
- Review stages emit anchored `^VERDICT: (pass|needs_fixes|rejected)$` as the final non-empty stdout line.
- Only `[tool]` headers and `VERDICT:` lines survive the log filter — post findings as ticket comments.
- The entrypoint auto-commits + pushes after `coding` and `fixing`.
