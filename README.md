<p align="center">
  <img src="assets/logo.png" alt="Ion — The AI-Native Language" width="640">
</p>

# Ion

**A token-efficient, AI-native programming language that compiles to idiomatic TypeScript, JavaScript, Python, and Java.**

Ion eliminates the structural boilerplate that bloats target-language code — interface declarations, Promise wrappers, switch statements, type casts. Write once in Ion; the compiler emits clean, human-readable output in your target language. No runtime. No framework. Compiles away entirely.

```ion
data User { id: Int, name: Str, email: Str, active: Bool = true }

fn get_active(users: List<User>) -> List<Str> =
  users
    |> filter(u -> u.active)
    |> map(u -> u.name)
```

```ts
// compiled TypeScript
const getActive = (users: User[]): string[] =>
  users.filter(u => u.active).map(u => u.name);
```

```js
// compiled JavaScript
function getActive(users) {
  return users.filter(u => u.active).map(u => u.name);
}
```

```python
# compiled Python
def get_active(users):
    return list(map(lambda u: u.name, filter(lambda u: u.active, users)))
```

---

## Why Ion

**LLMs spend tokens on boilerplate.** A TypeScript interface, a Promise wrapper, a switch statement — these are tokens the model generates but that carry no domain information. Ion replaces them with structural primitives: `data` types, `match` patterns, `|>` pipelines, `!effect` annotations. The model writes less; the compiler handles the rest.

**Measured across real coding tasks:** the same plain-English prompt sent to a Claude coding agent writing Ion vs TypeScript shows Ion completing full db + API + frontend apps in **31–45% fewer output tokens at 38% lower cost**, consistent across three domains. The savings compound on larger apps because each additional type, route, and helper multiplies the boilerplate savings.

**Source files are also 15–38% smaller** in static token count (measured with `cl100k_base`): Ion is 38% smaller than Java, 27% smaller than TypeScript, 21% smaller than Python, 15% smaller than JavaScript.

**The LLM already knows your target language.** Ion is a compressed grammar on top of what the model already knows — not a new paradigm it has to learn. The `llm-skills/write-ion.md` skill file (a few hundred tokens) is the only one-time cost. In steady-state pipelines it is cached and costs nothing.

---

## Getting started

```bash
# Install from source (npm package coming soon)
git clone https://github.com/robertkarlsson2-design/ION.git
cd ION
npm install
npm run build
npm link              # exposes the `ion` binary on your PATH

# Create a project
mkdir -p my-project/ion/src && cd my-project

cat > ion/ion.config.json << 'EOF'
{
  "version": "1",
  "target": "typescript",
  "rootDir": "./src",
  "outDir": "../"
}
EOF

cat > ion/src/hello.ion << 'EOF'
module hello

fn main() = console.log("Hello, World!")
EOF

# Compile (run from the directory containing ion/)
ion build
# → src/hello.ts
```

---

## Language

### Data types

Single-constructor types use the compact form. Sum types (tagged unions) use the `= Ctor` form.

```ion
-- single-constructor record
data User { id: Int, name: Str, email: Str, active: Bool = true }
data Todo { id: Int, userId: Int, title: Str, done: Bool }

-- sum type
data Shape
  = Circle { radius: Float }
  | Rect   { width: Float, height: Float }
  | Point

data Result a e = Ok { value: a } | Err { error: e }
```

### Functions

```ion
-- pure, single-expression
fn double(x: Int) = x * 2

-- block form
fn clamp(x: Int, lo: Int, hi: Int) -> Int {
  let low  = if x < lo then lo else x
  if low > hi then hi else low
}

-- effectful: effects declared in the signature
fn save_user(u: User) -> Result User AppError !db
fn fetch(url: Str) -> Response !http !async
```

### Pattern matching

```ion
fn area(s: Shape) -> Float =
  match s
  | Circle { radius }      -> 3.14159 * radius * radius
  | Rect   { width, height } -> width * height
  | Point                  -> 0.0
```

Compiles to:

```ts
function area(s: Shape): number {
  switch (s.kind) {
    case 'Circle': return 3.14159 * s.radius * s.radius;
    case 'Rect':   return s.width * s.height;
    case 'Point':  return 0;
  }
}
```

### Pipelines and error propagation

```ion
fn process(userId: Int) -> Result Report AppError !db =
  userId
    |> findUser
    |> validateUser?
    |> buildReport

-- ? propagates Err upward (same as Rust)
fn save(u: User) -> Result Unit AppError !db =
  validate(u)?
    |> db.insert
```

### Effects

Effects appear in function signatures, visible to the compiler and to any agent reading the code.

```ion
fn send_email(to: Str, body: Str) -> Result Unit Str !async !io
fn query_db(sql: Str) -> List Row !db
fn call_llm(prompt: Str) -> Str !llm !async
```

| Effect | Meaning |
|---|---|
| `!io` | File system, network, database, terminal |
| `!db` | Database access specifically |
| `!async` | Returns a Promise / Future / coroutine |
| `!http` | Outbound HTTP call |
| `!llm` | Makes an LLM call |

### Imports and FFI

```ion
use std.http as http
use std.db: query, insert

@external(target="javascript", module="crypto", symbol="randomUUID")
fn new_uuid() -> Str !io
```

---

## Token efficiency — measured

### Static source size (`cl100k_base`)

Five benchmarks tokenized with the GPT-4 / Claude tokenizer. Reproduce with `node bench/count-tokens.mjs`.

| Benchmark | Ion | JavaScript | TypeScript | Python | Java |
|---|---:|---:|---:|---:|---:|
| fibonacci | 34 | 32 (0.94×) | 35 (1.03×) | 35 (1.03×) | 38 (1.12×) |
| list pipeline | 92 | 103 (1.12×) | 131 (1.42×) | 113 (1.23×) | 146 (1.59×) |
| stats | 99 | 110 (1.11×) | 133 (1.34×) | 140 (1.41×) | 160 (1.62×) |
| primes | 73 | 125 (1.71×) | 135 (1.85×) | 94 (1.29×) | 130 (1.78×) |
| string ops | 84 | 78 (0.93×) | 92 (1.10×) | 101 (1.20×) | 138 (1.64×) |
| **total** | **382** | **448 (1.17×)** | **526 (1.38×)** | **483 (1.26×)** | **612 (1.60×)** |

Multipliers show cost relative to Ion. On pure numeric code, Ion and JavaScript are comparable — Ion's type annotations cost roughly what JS saves by omitting them. The gap widens on typed, pipeline-heavy backend code.

Every `ion build` prints a token-savings summary:

```
3 file(s) compiled, 0 error(s)
tokens (cl100k): Ion 264 → TS 709 — saved 445 (63%) vs writing TS directly
```

Add `--json` for machine-readable per-file output, or `--no-token-report` to suppress.

### Live LLM coding agent benchmark

Same plain-English app description sent to two arms of a Claude Sonnet 4 agent: one outputs Ion (with `llm-skills/write-ion.md` in the system prompt), one outputs TypeScript (minimal system prompt). Measured output tokens and API cost from the Claude CLI, `--no-session-persistence`, 1 turn each.

| Task (db + API + frontend) | Ion tokens | TS tokens | Δ output | Δ cost |
|---|---:|---:|---:|---:|
| Todo app (users, todos, CRUD) | 23,839 | 38,300 | **−38%** | **−47%** |
| Blog (posts, comments, tags) | 38,547 | 41,692 | **−8%** | **−12%** |
| Inventory (products, orders, stock) | 30,298 | 54,819 | **−45%** | **−50%** |
| **Total** | **92,684** | **134,811** | **−31%** | **−38%** |

The savings grow with app complexity because every additional `data` type, route handler, and error variant compounds the boilerplate savings. Blog saves least (−8%) because its frontend is HTML/JS-heavy; inventory saves most (−45%) because it has the deepest domain model.

---

## How it works

### Project layout

Ion source lives in an `ion/` folder at your project root and mirrors your output structure exactly.

```
my-project/
├── ion/                     ← Ion source (you edit this)
│   ├── ion.config.json
│   └── src/
│       └── api/users.ion
└── src/                     ← compiled output (never edit this)
    └── api/users.ts
```

Every `.ion` file produces exactly one output file. Mapping is always 1-to-1.

### Compiler pipeline

```
.ion → Lexer → Parser → AST → Binder → Type Checker → Desugarer → IonIR → Emitter → output
```

**IonIR** is the stable intermediate representation shared by all backends. It is versioned, JSON-serializable, and the only contract between the frontend and any emitter. Adding a new backend or rewriting the frontend requires no changes to the other side.

### Surface syntax and wire format

Ion stores two representations:

- **`.ion`** — human-readable surface syntax. This is what you write and read.
- **`.ionw`** — machine-optimized wire format. Symbol pooling and 1-letter aliases compress further (~46% vs surface) for LLM and compiler consumption.

```
# Surface syntax (~52 tokens)
data User { id: Int, name: Str, email: Str }
fn get_user(id: Int) -> Option<User> !io = db.find(id)

# Wire format (~28 tokens — 46% reduction)
I1
M app v=1.0.0
S a=get_user b=User c=db.find
T i=int s=str u=b o=opt<u>
D b {id:i,name:s,email:s}
F a (id:i)->o { c(id) }
```

---

## Status

> Ion is in active development. The compiler frontend, IR, and JS/TS/Python/Java backends are wired into the `ion build` CLI. Frontend and Salesforce emitters exist as code but are not yet exposed through the CLI.

| Component | Status |
|---|---|
| Lexer | ✅ Complete |
| Parser | ✅ Complete |
| Binder (symbol resolution) | ✅ Complete |
| Type checker (incl. effect tracking) | ✅ Complete |
| AST desugarer → IonIR | ✅ Complete |
| IonIR type system | ✅ Complete |
| Wire format encoder/decoder | ✅ Complete |
| Pattern matching + exhaustiveness check | ✅ Complete |
| `raw(...)` escape hatch | ✅ Complete |
| `ion build` CLI | ✅ Complete (JS, TS, Python, Java) |
| `ion check` CLI | ✅ Complete |
| `ion fmt` CLI | ✅ Complete |
| `ion ingest` (convert existing code) | ✅ Complete |
| `ion tokens` CLI | ✅ Complete |
| `ion grammar` CLI | ✅ Complete |
| JavaScript emitter | ✅ Complete |
| TypeScript emitter | ✅ Complete |
| Python emitter | ✅ Complete |
| Java emitter | ✅ Wired (experimental) |
| HTML emitter | 🚧 Code present, not wired into CLI |
| React (JSX/TSX) emitter | 🚧 Code present, not wired into CLI |
| Vue SFC emitter | 🚧 Code present, not wired into CLI |
| Lightning Web Component emitter | 🚧 Code present, not wired into CLI |
| Salesforce Apex emitter | 🚧 Code present, not wired into CLI |
| VS Code extension | ✅ Syntax highlighting + formatter |
| LSP server | 🚧 Code present, no `ion lsp` launcher yet |
| LLM skill guides (`llm-skills/`) | ✅ Complete |

---

## CLI reference

```bash
# Compile
ion build                          # compile per ion.config.json
ion build --target typescript      # javascript | typescript | python | java
ion build --watch                  # incremental watch mode
ion build --no-token-report        # suppress token-savings summary

# Type check
ion check src/api/users.ion
ion check --all
ion check --json                   # structured JSON output for tooling

# Format
ion fmt src/api/users.ion          # format in place
ion fmt --wire src/api/users.ion   # convert to wire format
ion fmt --pretty src/api/users.ionw
ion fmt --check                    # exit non-zero if file would change (CI)

# Ingest (convert existing code to Ion)
ion ingest src/users.js --skill javascript
ion ingest src/ --skill javascript --batch --report

# Utilities
ion tokens src/api/users.ion       # wire vs surface token counts
ion grammar                        # print the active grammar
```

---

## ion.config.json

```json
{
  "version": "1",
  "target": "typescript",
  "rootDir": "./src",
  "outDir": "../",
  "wireFormat": true,
  "include": ["src/**/*.ion"],
  "exclude": ["**/*.test.ion"],
  "stdlib": "es2022",
  "sourceMap": true
}
```

| Field | Description |
|---|---|
| `target` | Output language |
| `rootDir` | Source root inside `ion/`. Mirrored to `outDir`. |
| `outDir` | Where compiled output goes, relative to `ion/` |
| `wireFormat` | Store `.ionw` files alongside `.ion` files |
| `stdlib` | Target stdlib variant: `es2022`, `node20`, `jdk21`, `py312` |
| `sourceMap` | Emit source maps for debugger integration |

---

## Adding a new target

Each target is a self-contained folder under `emitters/`:

```
emitters/javascript/
├── emit.ts        ← walks IonIR, produces target source
├── emit.md        ← style guide and conventions
├── patterns/      ← YAML rules for ion ingest
├── parser.ts      ← Tree-sitter wrapper
└── printer.ts     ← formatting helpers
```

Each emitter exports one function:

```ts
export function emitJS(module: IonIRModule): string;
```

Register it in `src/cli/build.ts`:

```ts
function getEmitter(target: string): EmitFn | null {
  if (target === 'javascript') return emitJS;
  if (target === 'typescript') return emitTS;
  // add new target here
  return null;
}
```

The IonIR spec lives in `src/ir/nodes.ts` — that is the only contract the emitter must conform to. A folder-discovered plugin loader is on the roadmap; today the registration step is one line.

---

## Escape hatch

When an emitter doesn't yet support a construct, use `raw(...)` inline:

```ion
fn legacy(x: Int) -> Str =
  raw("someUnsupportedBuiltin(x).toString()")
```

Every emitter passes `raw(...)` through unchanged. This means an LLM can always make forward progress — write as much as possible in Ion, drop to `raw(...)` only for unsupported parts, and file an issue. See `llm-skills/write-ion.md` for the full gap-handling workflow.

---

## Design decisions

**Why not just use TypeScript?** TypeScript inherits JavaScript's verbosity. Ion source is ~27% smaller than the TypeScript it compiles to. The structural compression — `data` replacing POJOs, `?` replacing try/catch, pipelines replacing nested calls — drives that gap. Ion's wire format and constrained-decoding grammar also make it more amenable to LLM generation with fewer errors.

**Why braces, not indentation?** Python's token efficiency advantage comes from training-data volume, not syntax. A new language can't rely on that shortcut. Braces are unambiguous, familiar to LLMs from C/Java/JS/Rust training data, and parse correctly from partial files.

**Why a hand-written parser?** Every production compiler that matters — V8, TypeScript, Rust, Go, Clang — uses hand-written recursive descent. Generated parsers are opaque, hard to extend, and produce worse error messages. Ion's grammar is small enough that the parser is not burdensome.

---

## Contributing

Ion is early-stage. Contributions are welcome, especially:

- **New emitters** — additional target language support
- **Ingest patterns** — YAML rules for common idioms in existing languages
- **Golden file tests** — Ion source + expected output pairs for any target
- **Stdlib mappings** — expanding `stdlib.ion` coverage for existing targets

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and [ion-implementation.md](./ion-implementation.md) for the full technical spec.

---

## License

MIT
