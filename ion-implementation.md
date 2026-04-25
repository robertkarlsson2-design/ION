# ION LANGUAGE — AGENT BUILD SPECIFICATION
> Version: 0.1 | Status: Ready for implementation
> This document is structured for a coding agent to parse into user stories and execute in order.
> Each section maps to a phase. Each task maps to one or more user stories. Dependencies are explicit.

---

## CONTEXT

Ion is a token-efficient, AI-native programming language that transpiles to idiomatic output in any supported target language. A developer or LLM writes code once in Ion; the compiler emits clean, human-readable JavaScript, Java, Python, Rust, or any other registered target.

Ion exists in two forms:
- **Surface syntax** — human-readable, used in IDEs and editors
- **Wire format** — machine-optimized, 45–55% fewer tokens, used by LLMs and the compiler pipeline

The language is general purpose. It is not AI-specific. An LLM writing Ion uses its existing knowledge of the target language — Ion is just a compressed grammar on top of that knowledge.

---

## REPOSITORY STRUCTURE

### Ion project (user's repo)

```
my-project/
├── ion/                          ← ALL Ion source lives here
│   ├── ion.config.json           ← compiler config
│   ├── src/
│   │   ├── api/
│   │   │   └── users.ion
│   │   ├── web/
│   │   │   └── components/
│   │   │       └── UserCard.ion
│   │   └── shared/
│   │       └── types.ion
│   └── emitters/                   ← language plugins (one folder per target)
│       ├── javascript/
│       │   ├── SKILL.md
│       │   ├── stdlib.ion
│       │   ├── patterns/
│       │   └── examples/
│       └── java/
│           └── ...
├── src/                          ← COMPILED OUTPUT (mirrors ion/src/ exactly)
│   ├── api/
│   │   └── users.js              ← compiled from ion/src/api/users.ion
│   └── web/
│       └── components/
│           └── UserCard.jsx
├── package.json
└── README.md
```

**Rule:** Every `.ion` file in `ion/src/` produces exactly one output file in the mirrored path outside `ion/`. The folder structure is always preserved 1-to-1.

### ion.config.json

```json
{
  "version": "1",
  "target": "javascript",
  "outDir": "../",
  "rootDir": "./src",
  "wireFormat": true,
  "plugins": ["./emitters/javascript"],
  "include": ["src/**/*.ion"],
  "exclude": ["**/*.test.ion"],
  "stdlib": "es2022",
  "sourceMap": true
}
```

### Compiler repo structure

```
ion-compiler/
├── src/
│   ├── lexer/          ← tokenizer (hand-written)
│   ├── parser/         ← recursive descent + Pratt (hand-written)
│   ├── ast/            ← AST node type definitions
│   ├── binder/         ← name resolution, symbol tables
│   ├── checker/        ← Hindley-Milner type checker
│   ├── ir/             ← IonIR node definitions + JSON serde
│   ├── desugar/        ← Typed AST → IonIR lowering
│   ├── optimizer/      ← DCE, inlining, constant folding
│   ├── wire/           ← wire format encoder + decoder
│   ├── emit/           ← base emitter interface
│   └── cli/            ← ion build / ion fmt / ion ingest / ion check
├── emitters/             ← built-in language plugins
│   ├── javascript/
│   ├── typescript/
│   ├── java/
│   ├── python/
│   └── rust/
├── tests/
│   ├── golden/         ← input → expected output test cases
│   ├── roundtrip/      ← parse → emit → parse invariants
│   └── token-count/    ← token benchmark per format
├── package.json
└── tsconfig.json
```

---

## ARCHITECTURE

### Compiler pipeline

```
.ion source
    │
    ▼
[Lexer]           → Token stream + source spans
    │
    ▼
[Parser]          → CST with trivia preserved
    │
    ▼
[AST Builder]     → AST (no trivia, tagged unions, source spans)
    │
    ▼
[Binder]          → Symbol tables, name resolution, module graph
    │
    ▼
[Type Checker]    → Typed AST (every expression has a resolved Type)
    │
    ▼
[Desugarer]       → IonIR (JSON-serializable IR)
    │
    ▼
[Optimizer]       → Optimized IonIR (DCE, inlining, constant folding)
    │
    ▼
[Wire Encoder]    → .ionw wire-format file (optional)
    │
    ▼
[Target Plugin]   → Target-language AST
    │
    ▼
[Pretty Printer]  → Output source file + .ion.map source map
```

### IonIR node set — Core dialect (required by every plugin)

| Node | Description |
|---|---|
| `Var` | Variable reference with resolved symbol ID and type |
| `Literal` | Int, Float, Str, Bool, Null — fully typed |
| `App` | Function application: callee + typed argument list |
| `Abs` | Lambda/closure: parameters + body + captured scope |
| `Let` | Immutable binding: name, type, value, in-expression |
| `Case` | Desugared pattern match: scrutinee + typed arm list |
| `Constructor` | Sum type constructor application |
| `Accessor` | Field or method access: receiver + member name |
| `ModuleRef` | Cross-module symbol reference (fully qualified) |
| `ForeignRef` | FFI call: target language, module, symbol, signature |
| `Effect` | Effectful operation marker: effect tag + wrapped expression |

### IonIR extension dialects (opt-in, lowered to Core if target doesn't support)

| Dialect | Description |
|---|---|
| `ion-oop` | Classes, interfaces, inheritance, virtual dispatch |
| `ion-async` | Async/await as a typed effect |
| `ion-adt` | Tagged union variants with exhaustive match |
| `ion-effects` | Algebraic effect rows (Koka-style capability passing) |

### Wire format

```
I1                                         ← version marker
M org.acme.users v=1.2.0                   ← module metadata
S a=getUserById b=User c=db.query          ← symbol pool (pool long/repeated names)
T i=int s=str u=b o=opt<u> l=list<u>      ← type pool
X import db from std.database              ← extern/imports
D b {id:i,name:s,email:s}                  ← data declaration
F a (id:i)->o { c("SELECT...",[id]).first().map(r->b(r.id,r.name,r.email)) }
```

**Pooling rule:** Only pool an identifier when `occurrences × (inline_tokens − ref_tokens) > declaration_cost`. In practice: fully-qualified names always win; short camelCase names almost never do. Cache amortization (Anthropic prompt cache = 10% of base cost) lowers break-even from ~22 occurrences to ~3 in multi-turn sessions.

**Wire format target metrics:**
- ≥ 30% token reduction vs pretty Ion (cl100k) per request
- ≥ 80% effective cost reduction in a 10-turn cached agent session

---

## PLUGIN SYSTEM

### Plugin folder layout

```
emitters/{language}/
├── SKILL.md              ← YAML frontmatter (compiler config) + markdown body (LLM instructions)
├── grammar.ref           ← tree-sitter package + node-types.json path
├── stdlib.ion            ← extern declarations mapping Ion stdlib → target stdlib
├── patterns/             ← ast-grep-style YAML match/rewrite rules
│   ├── for-to-foreach.yaml
│   ├── null-to-option.yaml
│   └── promise-to-async.yaml
├── examples/             ← Ion ↔ target diff pairs (few-shot prompts + regression tests)
│   ├── 01-hello.md
│   ├── 02-async.md
│   └── 03-data-class.md
└── emit.md               ← pretty-printer rules: indent, quotes, trailing commas
```

### SKILL.md format

```markdown
---
name: javascript
description: >
  Translate Ion ↔ JavaScript. Use for .js/.mjs/.cjs targets, Node or browser output.
target: javascript
tree-sitter: tree-sitter-javascript@0.25
stdlib: ./stdlib.ion
patterns: ./patterns/*.yaml
emit: ./emit.md
examples: ./examples/*.md
---

# Ion ⇄ JavaScript

## Key differences
- Ion `==` always emits `===` in JS output (no loose equality)
- Ion `Option<T>` emits as `T | null` in JS
- Ion `fn` emits as `function`; lambdas use arrow syntax

## LLM Examples
[5–15 Ion↔JS code pairs]
```

### stdlib.ion format

```ion
// emitters/javascript/stdlib.ion
extern "javascript" {
  fn print(s: Str)                    = "console.log($1)";
  fn len(a: List<T>)                  = "$1.length";
  fn push(a: List<T>, x: T)           = "$1.push($2)";
  fn map(a: List<T>, f: T->U)         = "$1.map($2)";
  fn filter(a: List<T>, f: T->Bool)   = "$1.filter($2)";
  fn first(a: List<T>) -> Option<T>   = "$1[0] ?? null";
  type List<T>                        = "Array<$T>";
  type Option<T>                      = "$T | null";
  type Map<K,V>                       = "Map<$K,$V>";
}
```

### Ingestion pipeline (existing code → Ion)

```
Input source file
    │
    ▼
Layer 1: tree-sitter parse
Produces CST. Error-tolerant — partial files do not abort.
    │
    ▼
Layer 2: pattern matching (patterns/*.yaml)
ast-grep-style rules match CST subtrees → IonIR nodes.
Covers ~80% of well-understood idioms deterministically.
    │
    ▼  (unmatched subtrees only)
Layer 3: LLM fallback
Unmatched subtrees sent to LLM with:
  - exact CST subtree
  - surrounding file context
  - IonIR schema as system prompt
  - 5–15 examples from examples/*.md
  - structured output constraint (JSON schema for IonIR)
Output validated against IonIR schema.
    │
    ▼
Compile + test gate
Emitted Ion must parse and type-check.
If test files exist → compile Ion and run original tests.
Failed gate → retry with error trace (max 3 retries).
    │
    ▼
.ion surface file written to ion/ mirror path
```

---

## ION SURFACE SYNTAX — REFERENCE

### Keywords (all single BPE tokens)
`fn` `let` `if` `else` `match` `data` `module` `use` `pub` `extern` `type`

### Types
`Int` `Float` `Str` `Bool` `List<T>` `Map<K,V>` `Option<T>` `Result<T,E>`

### Effect markers (in function signatures)
`!io` `!async` `!llm` — stack multiple: `-> Str !async !io`

### Function forms

```ion
// Single expression (preferred)
fn double(x: Int) = x * 2

// Block form (when statements required)
fn process(items: List<Int>) -> Int {
  let total = items.fold(0, (acc, x) -> acc + x)
  total
}

// With effects
fn fetch_user(id: Int) -> Option<User> !async !io =
  db.query("SELECT * FROM users WHERE id = ?", [id]).first()
```

### Data classes

```ion
data User { id: Int, name: Str, email: Str, active: Bool = true }
```

### Pattern matching

```ion
match result
| Ok(value) -> process(value)
| Err(e)    -> log_error(e)
```

### Error propagation

```ion
fn save(user: User) -> Result<Unit, Str> !io =
  db.insert(user)?    // ? propagates Err upward, same as Rust
```

### Pipeline operator

```ion
fn get_active_names(users: List<User>) -> List<Str> =
  users
    |> filter(u -> u.active)
    |> map(u -> u.name)
```

### Imports

```ion
use std.http as http
use std.db: query, insert
```

### String interpolation

```ion
fn greet(name: Str) -> Str = "Hello, {name}!"
```

### FFI / extern

```ion
@external(target="javascript", module="fs", symbol="readFileSync")
fn read_file(path: Str) -> Str !io
```

---

## PHASE 1 — IR FOUNDATION & WIRE FORMAT
> Duration: Months 1–3 | Team: 1 engineer | Language: TypeScript

**Goal:** Build the data model everything else depends on. Nothing compiles yet. Done when `ion fmt` converts between wire and pretty formats with zero information loss and wire tokens are ≤50% of pretty tokens on cl100k.

### TASK-001 — IonIR type definitions
- Define all Core dialect nodes as TypeScript tagged unions
- Every node carries: `kind`, source `Span`, resolved `Type`
- Nodes: `Var`, `Literal`, `App`, `Abs`, `Let`, `Case`, `Constructor`, `Accessor`, `ModuleRef`, `ForeignRef`, `Effect`
- Define extension dialect nodes: `ion-oop`, `ion-async`, `ion-adt`, `ion-effects`
- Output: `src/ir/nodes.ts`
- Estimate: 1 week

### TASK-002 — IonIR JSON serde
- Versioned JSON serializer: `IonIR → JSON string`
- Versioned JSON deserializer: `JSON string → IonIR`
- Schema validation on deserialize (reject unknown node kinds)
- Version field in JSON header (`"ionir": "1.0"`)
- Round-trip property tests with fast-check: `deserialize(serialize(ir)) deepEqual ir`
- Output: `src/ir/serde.ts` + `tests/roundtrip/ir.test.ts`
- Estimate: 1 week
- Depends on: TASK-001

### TASK-003 — Wire format encoder
- Input: IonIR JSON
- Output: `.ionw` text (byte-stable, deterministic)
- Sections in fixed order: version `I1`, module `M`, symbols `S`, types `T`, externs `X`, data `D`, functions `F`
- Symbol pool heuristic: only pool when `occurrences × (inline_tokens − ref_tokens) > declaration_cost`
- Aliases: single letters a–z then aa–zz (all valid identifier tokens in cl100k)
- Type pool: deduplicate recurring type expressions
- No whitespace inside function bodies; statements separated by `;`
- Section entries sorted deterministically (by first-use position for symbols, alphabetically for types)
- Output: `src/wire/encoder.ts`
- Estimate: 2 weeks
- Depends on: TASK-002

### TASK-004 — Wire format decoder
- Input: `.ionw` text
- Output: IonIR JSON (identical to what encoder's input would have been)
- Must be exact inverse of encoder: `decode(encode(ir)) deepEqual ir`
- Deterministic: same wire bytes always produce same IonIR
- Output: `src/wire/decoder.ts`
- Estimate: 1 week
- Depends on: TASK-003

### TASK-005 — Pretty printer (IonIR → surface Ion)
- Input: IonIR
- Output: human-readable `.ion` surface syntax
- Applies Ion formatting rules: 2-space indent, braces for blocks, `fn`/`let`/`data` keywords
- Idempotent: `pretty(parse(pretty(ir))) === pretty(ir)`
- Output: `src/wire/pretty.ts`
- Estimate: 1 week
- Depends on: TASK-001

### TASK-006 — ion fmt CLI
- Commands: `ion fmt --pretty <file>` and `ion fmt --wire <file>`
- `--pretty`: reads `.ionw`, writes `.ion` surface
- `--wire`: reads `.ion` surface (requires minimal parser), writes `.ionw`
- `--check`: exits non-zero if file would change (for CI)
- Idempotent: running twice produces identical output
- Output: `src/cli/fmt.ts`
- Estimate: 3 days
- Depends on: TASK-003, TASK-004, TASK-005

### TASK-007 — Round-trip test suite
- Property tests (fast-check): `parse(pretty(wire)) === wire` (up to canonicalization)
- Property tests: `wire(parse(pretty)) === pretty`
- Golden file tests: 10 sample `.ion`/`.ionw` pairs, both directions
- CI integration: run on every commit
- Output: `tests/roundtrip/`
- Estimate: 4 days
- Depends on: TASK-006

### TASK-008 — Token count benchmark CLI
- Command: `ion tokens <file> [--tokenizer cl100k|o200k]`
- Reports: tokens in wire format, tokens in pretty format, reduction %
- Uses tiktoken WASM binding for cl100k_base and o200k_base
- Outputs JSON for CI comparison
- Alert threshold: +2% increase in wire token count vs baseline is a CI failure
- Output: `src/cli/tokens.ts` + `tests/token-count/`
- Estimate: 2 days
- Depends on: TASK-003, TASK-005

**Phase 1 done criterion:**
- `ion fmt` converts a 500-line sample module between wire and pretty with zero information loss
- Wire format tokens ≤ 50% of pretty format tokens on cl100k on the sample module
- All round-trip property tests pass with 10,000 generated cases

---

## PHASE 2 — LEXER, PARSER & TYPE CHECKER
> Duration: Months 3–6 | Team: 1 engineer | Language: TypeScript

**Goal:** Full Ion frontend. Ion source parses and type-checks. No output yet. Done when `ion check` correctly type-checks a 1,000-line module in under 200ms and reports all errors with source locations.

### TASK-009 — Lexer
- Hand-written character-by-character tokenizer (no parser-generator)
- Token types: keyword, identifier, operator, literal (int, float, string, bool), punctuation, trivia (whitespace, comments)
- Every token carries: `kind`, `text`, `span` (start line/col, end line/col)
- String interpolation: tokenizes `"Hello, {name}!"` as `STRING_START`, `INTERP_EXPR`, `STRING_END` sequence
- Effect markers: `!io`, `!async`, `!llm` are single tokens
- Output: `src/lexer/index.ts`
- Estimate: 2 weeks

### TASK-010 — Parser — expressions
- Pratt parser for expression precedence
- Handles: literals, identifiers, binary operators, unary operators, function calls, lambdas (`x -> expr`), pipeline (`|>`), match expressions, if/else expressions, string interpolation, let bindings
- Precedence table: `|>` lowest, then `||`, `&&`, comparison, arithmetic, unary, postfix
- Named arguments: `fn(arg: value)` syntax
- Produces CST nodes with trivia preserved (for formatter)
- Output: `src/parser/expressions.ts`
- Estimate: 2 weeks
- Depends on: TASK-009

### TASK-011 — Parser — declarations
- Handles: `fn`, `let`, `data`, `module`, `use`, `pub`, `extern`, `type`, `@external`
- Recursive descent (no parser-generator)
- Effect annotations on fn: `fn foo() -> T !io !async`
- Data class fields with optional defaults: `data Foo { x: Int, y: Str = "default" }`
- Pattern matching arms: `| Pattern -> expr`
- Produces CST with source spans on every node
- Output: `src/parser/declarations.ts`
- Estimate: 2 weeks
- Depends on: TASK-010

### TASK-012 — AST builder
- CST → AST transformation
- Discards trivia (whitespace, comments) — AST is for semantic analysis
- Produces tagged union AST nodes
- Every AST node carries a `Span`
- No type information yet (that comes from type checker)
- Output: `src/ast/builder.ts` + `src/ast/nodes.ts`
- Estimate: 1 week
- Depends on: TASK-011

### TASK-013 — Binder
- Resolves all names to their declarations
- Builds per-module symbol tables
- Builds module dependency graph (topological order for compilation)
- Detects: undefined names, duplicate bindings in same scope, circular imports
- Produces: `SymbolTable` (name → declaration location + type stub)
- Output: `src/binder/index.ts`
- Estimate: 2 weeks
- Depends on: TASK-012

### TASK-014 — Type checker
- Algorithm W Hindley-Milner inference inside function bodies
- Explicit type annotations required at: function signatures, top-level `let` bindings, `extern` declarations
- Local inference: `let x = 42` infers `x: Int` without annotation
- Type unification with meaningful error on mismatch
- Checks: pattern match exhaustiveness, `?` operator only on `Result`/`Option`, effect consistency
- Produces: Typed AST (every expression node has a resolved `Type` field)
- Output: `src/checker/index.ts`
- Estimate: 3 weeks
- Depends on: TASK-013

### TASK-015 — Error messages
- Every error has: error code, source span, plain-English message, expected vs actual (for type errors), one-line fix suggestion
- Format: `error[E0012]: expected Int, found Str at users.ion:14:8`
- No "internal error" fallback — every reachable error state has a user-facing message
- Output: `src/checker/errors.ts` + `src/parser/errors.ts`
- Estimate: 1 week
- Depends on: TASK-014

### TASK-016 — ion check CLI
- Command: `ion check <file>` or `ion check --all` (reads ion.config.json)
- Default output: human-readable errors with source spans
- `--json` flag: structured JSON error list for LLM consumption
- Exit code 0 = no errors, 1 = errors, 2 = internal failure
- Output: `src/cli/check.ts`
- Estimate: 3 days
- Depends on: TASK-014, TASK-015

### TASK-017 — Grammar manifest
- Export Ion grammar as EBNF + JSON GBNF (for Outlines, llguidance, vLLM, llama.cpp)
- GBNF file: `ion.gbnf` — loadable by xgrammar and Outlines without modification
- JSON schema file: `ion-ir-schema.json` — used as structured output constraint for LLM fallback
- Output: `src/grammar/manifest.ts` + generated `ion.gbnf` + `ion-ir-schema.json`
- Estimate: 3 days
- Depends on: TASK-011

**Phase 2 done criterion:**
- `ion check` type-checks a 1,000-line Ion module in under 200ms
- All type errors include source location and a corrective suggestion
- `ion.gbnf` loads successfully in Outlines without modification
- Golden file test suite: 30 `.ion` files with expected error output

---

## PHASE 3 — JAVASCRIPT PLUGIN & FIRST COMPILER
> Duration: Months 6–9 | Team: 2 engineers | Language: TypeScript

**Goal:** End-to-end compilation. Ion source → idiomatic JavaScript output. Done when `ion build` compiles a 500-line Ion module to JS that passes its original test suite.

### TASK-018 — AST desugarer
- Typed AST → IonIR
- Lowers: `match` → decision tree (Case nodes), pipeline `|>` → nested App nodes, string interpolation → concat App nodes, tail calls → explicit loop nodes, `?` → match on Result/Option
- Extension dialects emitted where Core is insufficient (later lowered by target plugins)
- Output: `src/desugar/index.ts`
- Estimate: 2 weeks
- Depends on: TASK-014

### TASK-019 — JavaScript plugin — tree-sitter parser
- Wrap `tree-sitter-javascript@0.25`
- Expose: `parse(source: string) → CST` with typed node access via node-types.json
- Error-tolerant: partial files produce partial CST, do not throw
- Used for ingestion (Phase 4); wired up here for plugin interface completeness
- Output: `emitters/javascript/parser.ts`
- Estimate: 1 week
- Depends on: TASK-012

### TASK-020 — JavaScript stdlib.ion
- Extern declarations for ~150 most common JS/Node API calls
- Groups: console (log, error, warn), Array methods (map, filter, reduce, find, forEach, push, pop, slice, splice, includes, indexOf), Object (keys, values, entries, assign, fromEntries), Promise (all, race, resolve, reject), String (split, join, trim, includes, startsWith, endsWith, replace), Math (floor, ceil, round, abs, max, min), JSON (parse, stringify), fetch (basic), fs (readFile, writeFile, exists), path (join, resolve, dirname, basename)
- Format: `extern "javascript" { fn name(...) = "template"; }`
- Output: `emitters/javascript/stdlib.ion`
- Estimate: 2 weeks
- Depends on: TASK-019

### TASK-021 — JavaScript idiom patterns (30 rules)
- ast-grep YAML format with `ingest: true/false` and `emit: true/false` flags
- Required patterns:
  - counted for-loop → `Array.forEach`
  - `if (x === null)` → `Option` match
  - `Promise.then().catch()` → `async/await`
  - object literal with matching keys `{name: name}` → Ion shorthand `{name}`
  - `Array.prototype.find()` returning undefined → Ion `Option`
  - `try { } catch (e) { }` → `Result<T, E>`
  - `class Foo { constructor(...) { this.x = x; } }` → Ion `data`
  - `x !== undefined && x !== null` → Ion `?` null-safe chain
- Output: `emitters/javascript/patterns/*.yaml`
- Estimate: 2 weeks
- Depends on: TASK-020

### TASK-022 — JavaScript emitter (IonIR → JS AST)
- Input: optimized IonIR (Core dialect)
- Output: JavaScript AST (use `estree` types)
- Maps every Core node to idiomatic JS:
  - `Var` → `Identifier`
  - `App` → `CallExpression`
  - `Abs` → `ArrowFunctionExpression`
  - `Let` → `VariableDeclaration` (const)
  - `Case` → `if/else` chain or `switch`
  - `Constructor` → `new ClassName(...)` or object literal
  - `Accessor` → `MemberExpression`
  - `ForeignRef` → direct call/access per `extern` template
  - `Effect` → unwrap to sync or `await` expression
- Uses `stdlib.ion` templates for stdlib calls
- Output: `emitters/javascript/emitter.ts`
- Estimate: 2 weeks
- Depends on: TASK-021

### TASK-023 — JavaScript pretty printer (JS AST → source text)
- Input: JS AST (estree)
- Output: ES2022 JavaScript source string
- Rules from `emitters/javascript/emit.md`:
  - single quotes for strings
  - trailing commas in multiline arrays/objects
  - 2-space indent
  - arrow functions for lambdas
  - template literals for string interpolation
  - semicolons at statement end
- Output: `emitters/javascript/printer.ts`
- Estimate: 1 week
- Depends on: TASK-022

### TASK-024 — Source map generation
- ECMA-426 v3 JSON source maps
- Include `sourcesContent` inline (IDE debugging works without original files)
- Use `@parcel/source-map` for VLQ encoding
- Every emitted token maps back to its IonIR source span
- Output: `src/emit/sourcemap.ts`
- Estimate: 1 week
- Depends on: TASK-023

### TASK-025 — ion build CLI
- Command: `ion build` — reads `ion.config.json`, compiles all `.ion` files
- `--target <lang>` — override target language
- `--watch` — watch mode, incremental recompile on file change
- `--no-sourcemap` — skip source map emission
- Walks `ion/src/`, mirrors output to `outDir` preserving folder structure exactly
- Parallel compilation per file (Promise.all)
- Output: `src/cli/build.ts`
- Estimate: 1 week
- Depends on: TASK-018, TASK-024

### TASK-026 — Golden file test suite (JS target)
- 50+ test cases: `tests/golden/js/*.ion` → `tests/golden/js/*.expected.js`
- Categories: hello world, data classes, functions, pattern matching, async, error propagation, pipelines, imports, FFI
- Any change to `.expected.js` = deliberate decision, must update snapshot
- Run on every commit in CI
- Output: `tests/golden/js/`
- Estimate: 1 week
- Depends on: TASK-025

**Phase 3 done criterion:**
- `ion build` compiles a 500-line Ion module to JS that passes its original test suite
- Wire format token count verified ≥ 30% below pretty Ion on cl100k
- All 50 golden file tests pass
- Source maps load correctly in Chrome DevTools (breakpoints hit Ion source)

---

## PHASE 4 — INGESTION SYSTEM & TYPESCRIPT PLUGIN
> Duration: Months 9–12 | Team: 2 engineers | Language: TypeScript

**Goal:** Convert existing code TO Ion. TypeScript as second target proving the plugin interface generalizes. Done when `ion ingest` auto-converts ≥ 85% of a 10K-LOC JS project and the TypeScript plugin passes golden file tests.

### TASK-027 — Ingestion pipeline core
- Three-layer pipeline: tree-sitter → patterns → LLM fallback
- Plugin-agnostic pipeline runner: takes any plugin's `parse()` + pattern set + fallback config
- Tracks which layer handled each construct (for ingestion report)
- Output: `src/ingest/pipeline.ts`
- Estimate: 1 week
- Depends on: TASK-017

### TASK-028 — Pattern matching engine
- Loads `patterns/*.yaml` from plugin folder
- Implements ast-grep-style metavariable matching on CST nodes
- Metavariables: `$VAR` (single node), `$$$BODY` (node sequence), `$TYPE` (type expression)
- Conditions: `is-type`, `not-mutated-in`, `has-children`
- Transforms matched subtrees to IonIR nodes
- Output: `src/ingest/patterns.ts`
- Estimate: 2 weeks
- Depends on: TASK-027

### TASK-029 — LLM fallback integration
- Anthropic Claude API via `@anthropic-ai/sdk`
- System prompt: IonIR schema + plugin's SKILL.md body + examples from `examples/*.md`
- User message: unmatched CST subtree + surrounding context (±50 lines)
- Structured output: JSON schema constraint using `ion-ir-schema.json`
- Retry loop: on compile-gate failure, append error trace and retry (max 3)
- Token tracking: log tokens used per fallback call for cost monitoring
- Output: `src/ingest/llm-fallback.ts`
- Estimate: 2 weeks
- Depends on: TASK-028

### TASK-030 — Compile + test gate
- After ingestion: run `ion check` on emitted Ion (must pass type checker)
- If original project has test files: compile Ion → target, run original tests
- Test runner detection: package.json scripts (`npm test`), `jest.config.*`, `vitest.config.*`, `pytest.ini`, `pom.xml`
- Gate output: pass / fail-compile / fail-tests + error details
- On failure: feed error details to LLM fallback retry (TASK-029)
- Output: `src/ingest/gate.ts`
- Estimate: 1 week
- Depends on: TASK-029

### TASK-031 — ion ingest CLI
- Command: `ion ingest <file> --skill javascript`
- `--batch <dir>` — ingest all files in directory
- `--dry-run` — show what would be written without writing
- `--report` — output JSON ingestion report (% auto-converted, % LLM fallback, % flagged)
- Writes output to `ion/` mirror path (creates directories as needed)
- Output: `src/cli/ingest.ts`
- Estimate: 1 week
- Depends on: TASK-030

### TASK-032 — TypeScript plugin
- Second full plugin using the plugin interface established in Phase 3
- Extends JavaScript plugin: adds type annotation emission, removes type inference where TS has explicit types
- Tree-sitter: `tree-sitter-typescript@0.23`
- Emits `.d.ts` type declaration sidecar alongside `.js` output
- `stdlib.ion`: extends `emitters/javascript/stdlib.ion` with TypeScript-specific types
- Additional patterns: typed function signatures, interface → Ion `data`, enum → Ion sum type
- Output: `emitters/typescript/`
- Estimate: 3 weeks
- Depends on: TASK-025

### TASK-033 — TypeScript .d.ts emitter
- For every compiled Ion module targeting TypeScript: emit a `.d.ts` sidecar
- Export types matching Ion's data declarations and function signatures
- Consumers of compiled Ion output can import types without touching Ion source
- Output: `emitters/typescript/dts-emitter.ts`
- Estimate: 1 week
- Depends on: TASK-032

### TASK-034 — LSP server (minimal)
- Language Server Protocol server using `vscode-languageserver`
- Features: diagnostics (type errors → squiggles), hover (show inferred type), go-to-definition
- Reuses parser (TASK-011) and type checker (TASK-014) directly
- Incremental: re-parse + re-check only changed file on every keystroke
- Output: `src/lsp/server.ts`
- Estimate: 3 weeks
- Depends on: TASK-014

### TASK-035 — VS Code extension
- Extension wrapper around LSP server
- Activates on `.ion` files
- Commands: `Ion: Build`, `Ion: Check`, `Ion: Format`, `Ion: Ingest File`
- Status bar: current file target language
- Syntax highlighting: TextMate grammar derived from Ion grammar manifest
- Output: `ion-vscode/` (separate package in monorepo)
- Estimate: 1 week
- Depends on: TASK-034

**Phase 4 done criterion:**
- `ion ingest` auto-converts ≥ 85% of a 10K-LOC JS project without LLM fallback (patterns handle it)
- TypeScript plugin golden file tests all pass
- LSP provides diagnostics in VS Code within 100ms of keystroke
- `ion ingest --report` produces accurate JSON report with per-construct breakdown

---

## PHASE 5 — CACHE OPTIMIZATION & JAVA PLUGIN
> Duration: Months 12–15 | Team: 2 engineers | Language: TypeScript then Rust

**Goal:** Real-world performance. Java as first non-JS-family target proving the plugin system handles semantic mismatches. Rust compiler rewrite for production speed.

### TASK-036 — Prompt cache integration
- Audit wire format section ordering for cache-stability
- Stable prefix: `I1` + `M` + `S` + `T` + `X` (version, module, pools, imports) — never changes between compilations
- Dynamic suffix: `D` + `F` declarations — changes when source changes
- Emit Anthropic `cache_control` breakpoint annotation at stable/dynamic boundary
- Measure: cache hit rate in a simulated 10-turn agent session (target ≥ 80%)
- Output: `src/wire/cache.ts`
- Estimate: 2 weeks
- Depends on: TASK-008

### TASK-037 — Token count CI regression guard
- Run `ion tokens` on reference corpus (100 files from golden test suite) on every commit
- Fail CI if wire token count increases > 2% vs baseline on any file
- Baseline stored in `tests/token-count/baseline.json`
- Output: `tests/token-count/regression.test.ts`
- Estimate: 1 week
- Depends on: TASK-008

### TASK-038 — ion-oop dialect lowering
- Lowering pass: `ion-oop` IR nodes → Core + target-specific idioms
- Handles: class declarations, interface declarations, inheritance chains, virtual method dispatch, `this` binding
- Java-specific lowering: classes stay as classes; abstract methods stay abstract
- JS-specific lowering: classes become ES2022 class syntax
- Output: `src/desugar/oop-lowering.ts`
- Estimate: 2 weeks
- Depends on: TASK-018

### TASK-039 — Java plugin — emitter
- Input: optimized IonIR (Core + ion-oop after lowering)
- Output: Java AST
- Java version target: Java 21 (LTS)
- Uses Java 21 features: records (for Ion `data`), sealed classes (for Ion sum types), switch expressions (for Ion `match`), `var` inference, text blocks
- Maps Core nodes to Java idioms:
  - `Abs` → lambda or method reference
  - `Case` → switch expression
  - `Option<T>` → `Optional<T>`
  - `Result<T,E>` → custom `Result<T,E>` wrapper (emit once per module)
  - `ForeignRef` → direct Java method call per extern template
- Output: `emitters/java/emitter.ts`
- Estimate: 4 weeks
- Depends on: TASK-038

### TASK-040 — Java stdlib.ion
- Extern declarations for Java 21 stdlib
- Groups: System (out.println, err.println, exit), String (format, valueOf, split, join, trim, contains, startsWith, endsWith, replace, toUpperCase, toLowerCase), Collections (ArrayList, HashMap, HashSet — add, get, put, contains, remove, size, isEmpty, stream), Stream API (map, filter, findFirst, collect, toList), Optional (of, empty, isPresent, get, orElse, map), Math, Objects (requireNonNull, isNull, toString), Files (readString, writeString, exists, list)
- Output: `emitters/java/stdlib.ion`
- Estimate: 3 weeks
- Depends on: TASK-039

### TASK-041 — Java ingestion patterns (30 rules)
- POJO with getters/setters → Ion `data`
- `Optional<T>` chains → Ion `Option`
- `for (Item item : list)` → `list.forEach`
- `try { } catch (Exception e) { }` → `Result<T,E>`
- Builder pattern → Ion named arguments
- `if (x == null) throw new NullPointerException()` → `Objects.requireNonNull` → Ion `!` assertion
- `List.of(...)` / `Arrays.asList(...)` → Ion list literal
- Single-method interfaces (functional interfaces) → Ion lambda
- `instanceof` + cast → Ion pattern match arm
- Output: `emitters/java/patterns/*.yaml`
- Estimate: 2 weeks
- Depends on: TASK-040

### TASK-042 — Java pretty printer
- Input: Java AST
- Output: Java 21 source text
- Rules from `emitters/java/emit.md`: 4-space indent, Allman brace style, JavaDoc comments preserved, import organization
- Output: `emitters/java/printer.ts`
- Estimate: 1 week
- Depends on: TASK-039

### TASK-043 — Rust compiler rewrite — lexer + parser
- Rewrite `src/lexer/` and `src/parser/` in Rust
- IonIR serde in Rust using `serde_json`
- Wire encoder and decoder in Rust
- TypeScript layer becomes thin Node.js native binding wrapper (using `napi-rs`)
- Target: 10–20× speed improvement over TypeScript implementation
- All existing golden file tests must pass against Rust implementation
- Output: `ion-compiler-rs/` crate (separate Rust workspace)
- Estimate: 3 months (2 engineers in parallel)
- Depends on: all Phase 1–4 tasks (TypeScript implementation is specification)

**Phase 5 done criterion:**
- `ion build` compiles a 10K-LOC Ion project targeting Java in under 5 seconds
- Java output compiles with `javac --release 21` with zero warnings
- Prompt cache hit rate ≥ 80% in a 10-turn agent session (measured with Anthropic API)
- Rust compiler rewrite passes all golden file tests

---

## SUCCESS CRITERIA

### Token reduction (must measure before shipping each phase)

| Metric | Target | Minimum acceptable |
|---|---|---|
| Wire vs pretty Ion (cl100k, per request) | ≥ 45% reduction | ≥ 30% |
| Wire vs pretty Ion (cached, 10-turn session) | ≥ 85% cost reduction | ≥ 80% |
| Ion surface vs equivalent Java | ≥ 50% fewer tokens | ≥ 40% |
| Ion surface vs equivalent TypeScript | ≥ 25% fewer tokens | ≥ 20% |

### Ingestion accuracy

| Metric | Target | Minimum acceptable |
|---|---|---|
| JS first-try auto-conversion (no LLM fallback) | ≥ 85% of constructs | ≥ 75% |
| Java first-try auto-conversion | ≥ 80% of constructs | ≥ 70% |
| Round-trip semantic equivalence (original tests pass) | ≥ 95% of test files | ≥ 90% |
| LLM fallback cost per 1K lines ingested | < $0.30 | < $0.50 |

### Developer experience

| Metric | Target | Minimum acceptable |
|---|---|---|
| Compile time (1K-line project, JS target) | < 100ms | < 200ms |
| Compile time (10K-line project, JS target) | < 1s | < 2s |
| LSP diagnostic latency | < 50ms | < 100ms |
| Ingestion batch throughput (pattern layer only) | ≥ 2,000 lines/sec | ≥ 1,000 lines/sec |

---

## CLI REFERENCE

| Command | Description |
|---|---|
| `ion build` | Compile all `.ion` files per `ion.config.json` |
| `ion build --target java` | Override target language for this build |
| `ion build --watch` | Watch mode, incremental recompile |
| `ion check <file>` | Parse and type-check only |
| `ion check --json` | Structured JSON error output for LLM consumption |
| `ion fmt <file>` | Format in place (canonical pretty-printer) |
| `ion fmt --wire <file>` | Convert to wire format `.ionw` |
| `ion fmt --pretty <file>` | Convert wire format to human-readable |
| `ion fmt --check` | Exit non-zero if file would change (CI use) |
| `ion ingest <file> --skill javascript` | Convert existing file to Ion |
| `ion ingest --batch <dir>` | Batch ingest whole directory |
| `ion ingest --dry-run` | Preview without writing |
| `ion ingest --report` | JSON ingestion report with per-construct breakdown |
| `ion tokens <file>` | Report wire vs pretty token counts |
| `ion tokens --tokenizer o200k` | Specify tokenizer (cl100k default) |
| `ion plugin new <name>` | Scaffold a new language plugin folder |
| `ion plugin validate <dir>` | Validate plugin against interface spec |

---

## ANTI-PATTERNS — DO NOT IMPLEMENT

These approaches have been evaluated and rejected. Do not revisit without a measured counter-argument.

| Anti-pattern | Why rejected |
|---|---|
| Binary wire format (MessagePack, FlatBuffers) | BPE tokenizes random bytes at 1.5–2 tokens/byte. Mozilla BinAST was shelved for this reason. |
| Unicode operators (λ, →, ≠, ⟶) | Every non-ASCII codepoint costs 2–3 BPE tokens. APL's Unicode glyph approach confirmed worse than ASCII alternatives. |
| Significant whitespace as only block delimiter | Accuracy cost exceeds token savings for any non-Python-trained language. Python's advantage is training data volume, not indentation. |
| Pure-LLM ingestion without deterministic patterns | TransCoder, GPT-Migrate plateau at demo quality. Production tools (Amazon Q, Codemod) are all deterministic-first. |
| LLVM IR as Ion's IR | Too low-level. Loses class structure, generic types, async semantics needed for idiomatic Java/Kotlin output. |
| Global cross-file type inference | LLMs cannot reason about it in context. Explicit function signatures are the documented correct tradeoff (TypyBench, arXiv 2504.09246). |
| Custom sigils for pool references (@1, #2) | Valid identifiers (_a, _b) tokenize cheaper under cl100k/o200k and the model generates them more reliably. |
| Optional parentheses in ambiguous positions | CoffeeScript's fatal flaw. `a +b` ≠ `a + b` in CoffeeScript — this killed adoption. |
| Implicit variable declarations | CoffeeScript anti-pattern. Silent scope contamination breaks LLM reasoning. |

---

## DECISIONS LOG

| Decision | Rationale |
|---|---|
| TypeScript for bootstrap, Rust in Phase 5 | Fastest iteration. Every successful transpiler (SWC, Biome, Ruff) bootstrapped in a higher-level language first. |
| Hand-written parser, not ANTLR/Chevrotain | Every production compiler uses hand-written recursive descent. Generated parsers are opaque and hard to extend. |
| tree-sitter for ingestion only | tree-sitter is parse-only and not suitable as a compiler frontend. Correct use: CST for ingestion pipeline. |
| Plugin as folder, not npm package | Reduces plugin authoring friction. A community member can write a plugin as a folder of YAML and Markdown. |
| Braces for blocks, not indentation | Training data dominance: Python accuracy advantage comes from volume, not syntax. New language cannot rely on this. |
| ion/ folder convention | Mirrors outDir convention. Source of truth is always inside ion/. Compiled output is always outside ion/. |
| IonIR as stability boundary | Frontend (TypeScript → Rust) and backends (per-plugin) can evolve independently. PureScript/CoreFn pattern. |
| SKILL.md as dual artifact | Same file serves compiler config (YAML frontmatter) and LLM instructions (markdown body). Reduces plugin authoring surface. |
