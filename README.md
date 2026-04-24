# Ion

**A token-efficient, AI-native programming language that compiles to anything.**

Write once in Ion. Ship idiomatic JavaScript, TypeScript, Java, Python, or any registered target. Ion is not a framework or a runtime — it compiles away entirely, leaving clean, human-readable output in your target language.

```ion
data User { id: Int, name: Str, email: Str, active: Bool = true }

fn get_active(users: List<User>) -> List<Str> =
  users
    |> filter(u -> u.active)
    |> map(u -> u.name)
```

Compiles to JavaScript:

```js
function getActive(users) {
  return users
    .filter(u => u.active)
    .map(u => u.name);
}
```

Compiles to Java:

```java
public static List<String> getActive(List<User> users) {
    return users.stream()
        .filter(u -> u.active)
        .map(u -> u.name)
        .toList();
}
```

Same Ion source. Same logic. Idiomatic output per target.

---

## Why Ion

**LLMs already know your target language.** When an agent writes Ion, it draws on everything it knows about JavaScript, Java, or Python — Ion is just a compressed grammar on top of that knowledge. The result is fewer tokens to write, fewer tokens to read, and cleaner output than asking an LLM to write Java directly.

**40–55% fewer tokens than equivalent source.** Ion's surface syntax eliminates structural noise — braces, semicolons, boilerplate constructors, verbose type annotations. The wire format goes further, achieving up to 90% effective cost reduction in cached multi-turn agent sessions.

**Two modes — one language.** Ion has a human-readable surface syntax for developers and a machine-optimized wire format for LLMs and the compiler. Your IDE always shows you the pretty form. The compiler and agents work on the wire form. You never see the difference.

**Adding a new target language is a folder, not a fork.** The plugin system is designed so that supporting a new output language means writing a skill folder — a few YAML pattern files, a stdlib mapping, and a SKILL.md. No changes to the compiler.

---

## Status

> Ion is in active development. The compiler frontend is complete. The JavaScript backend and `ion build` CLI are in progress.

| Component | Status |
|---|---|
| IonIR type system | ✅ Complete |
| Wire format encoder/decoder | ✅ Complete |
| Lexer | ✅ Complete |
| Parser | ✅ Complete |
| Binder (symbol resolution) | ✅ Complete |
| Type checker | ✅ Complete |
| AST desugarer → IonIR | ✅ Complete |
| `ion fmt` CLI | ✅ Complete |
| Pattern matching engine | ✅ Complete |
| VS Code extension | ✅ Complete |
| JavaScript emitter | 🔧 In progress |
| `ion build` CLI | 🔧 In progress |
| `ion ingest` (convert existing code) | 🔧 In progress |
| TypeScript plugin | 📋 Planned — Phase 4 |
| Java plugin | 📋 Planned — Phase 5 |
| Python plugin | 📋 Planned — Phase 5 |
| LSP server | 📋 Planned — Phase 4 |

---

## How it works

### The ion/ folder convention

Ion source lives inside an `ion/` folder at your project root. It mirrors the structure of your project exactly. When you compile, the output appears outside `ion/` with the same folder structure intact.

```
my-project/
├── ion/                        ← Ion source (you edit this)
│   ├── ion.config.json
│   └── src/
│       ├── api/
│       │   └── users.ion
│       └── web/
│           └── UserCard.ion
│
└── src/                        ← compiled output (never edit this)
    ├── api/
    │   └── users.js
    └── web/
        └── UserCard.jsx
```

Every `.ion` file produces exactly one output file. The mapping is always 1-to-1.

### The compiler pipeline

```
.ion source → Lexer → Parser → Type Checker → IonIR → Plugin → Output
```

IonIR is the stable intermediate representation shared by all target backends. It is versioned, JSON-serializable, and the boundary between the frontend and all plugins. Rewriting the frontend in Rust (planned) or adding a new backend requires no changes to the other side.

### Surface syntax vs wire format

Ion stores two representations of every file:

- **`.ion`** — human-readable surface syntax. This is what you write and read.
- **`.ionw`** — machine-optimized wire format. This is what the compiler and LLMs operate on.

Your IDE transparently shows you `.ion`. The wire format is an implementation detail.

```
# Surface syntax (~52 tokens on cl100k)
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

## Ion syntax

### Functions

```ion
// Single expression — preferred
fn double(x: Int) = x * 2

// Block form — when multiple statements are needed
fn process(items: List<Int>) -> Int {
  let total = items.fold(0, (acc, x) -> acc + x)
  total
}

// With effects declared in the signature
fn fetch_user(id: Int) -> Option<User> !async !io =
  db.query("SELECT * FROM users WHERE id = ?", [id]).first()
```

### Data classes

```ion
// Compiles to record/dataclass/struct in the target language
data User { id: Int, name: Str, email: Str, active: Bool = true }
```

### Pattern matching

```ion
match result
| Ok(value)  -> process(value)
| Err(e)     -> log_error(e)

match user.role
| Admin   -> full_access()
| Member  -> limited_access()
| Guest   -> read_only()
```

### Error propagation

```ion
// ? propagates Err upward — same as Rust
fn save(user: User) -> Result<Unit, Str> !io =
  validate(user)?
    |> db.insert
```

### Pipelines

```ion
fn report(users: List<User>) -> List<Str> =
  users
    |> filter(u -> u.active)
    |> map(u -> u.name)
    |> sort
```

### Imports

```ion
use std.http as http
use std.db: query, insert
use std.json: parse, stringify
```

### Effects

Effects appear in function signatures, not as ambient runtime context. They are visible to the compiler and to any agent reading the code.

```ion
fn send_email(to: Str, body: Str) -> Result<Unit, Str> !async !io
//                                                       ↑     ↑
//                                        async effect   IO effect
```

| Effect | Meaning |
|---|---|
| `!io` | Touches the file system, network, database, or terminal |
| `!async` | Returns a Promise / Future / coroutine |
| `!llm` | Makes an LLM call |

### FFI

```ion
@external(target="javascript", module="crypto", symbol="randomUUID")
fn new_uuid() -> Str !io
```

---

## Plugin system

Each target language is a plugin — a self-contained folder the compiler loads at build time.

```
skills/javascript/
├── SKILL.md          ← compiler config (YAML frontmatter) + LLM instructions (markdown body)
├── stdlib.ion        ← maps Ion stdlib calls to JS equivalents
├── patterns/         ← YAML rules for recognizing and converting JS idioms
│   ├── for-to-foreach.yaml
│   └── promise-to-async.yaml
└── examples/         ← Ion ↔ JS pairs used as few-shot prompts and regression tests
```

The `stdlib.ion` file is bidirectional — it drives both emission (Ion → JS) and ingestion (JS → Ion):

```ion
extern "javascript" {
  fn push(a: List<T>, x: T)    = "$1.push($2)";
  fn map(a: List<T>, f: T->U)  = "$1.map($2)";
  fn first(a: List<T>)         = "$1[0] ?? null";
  type List<T>                 = "Array<$T>";
  type Option<T>               = "$T | null";
}
```

**Adding a new target language** means creating a `skills/{language}/` folder with these files. No changes to the compiler.

---

## Converting existing code to Ion

`ion ingest` converts an existing source file to Ion using a three-layer pipeline:

1. **Tree-sitter parse** — produces a full CST, error-tolerant
2. **Pattern matching** — YAML rules handle ~80% of well-understood idioms deterministically
3. **LLM fallback** — Claude handles the remaining constructs with a compile-and-test verification loop

```bash
# Convert a single file
ion ingest src/api/users.js --skill javascript

# Convert an entire directory
ion ingest src/ --skill javascript --batch

# Preview without writing
ion ingest src/api/users.js --skill javascript --dry-run

# Get a breakdown of what was auto-converted vs LLM-assisted
ion ingest src/ --skill javascript --batch --report
```

The ingestion pipeline only writes to `ion/` — your original source files are never modified.

---

## ion.config.json

```json
{
  "version": "1",
  "target": "javascript",
  "outDir": "../",
  "rootDir": "./src",
  "wireFormat": true,
  "plugins": ["./skills/javascript"],
  "include": ["src/**/*.ion"],
  "exclude": ["**/*.test.ion"],
  "stdlib": "es2022",
  "sourceMap": true
}
```

| Field | Description |
|---|---|
| `target` | Primary output language |
| `outDir` | Where compiled output goes, relative to `ion/` |
| `rootDir` | Source root inside `ion/`. Mirrors to `outDir` exactly |
| `wireFormat` | Store `.ionw` wire-format files alongside `.ion` files |
| `plugins` | Paths to language skill folders |
| `stdlib` | Target stdlib variant (`es2022`, `node20`, `jdk21`, `py312`) |
| `sourceMap` | Emit source maps for IDE debugger integration |

---

## CLI

```bash
# Compile
ion build                          # compile all .ion files per ion.config.json
ion build --target java            # override target language
ion build --watch                  # watch mode, incremental recompile

# Type checking
ion check src/api/users.ion        # parse and type-check one file
ion check --all                    # check all files
ion check --json                   # structured JSON errors for LLM consumption

# Formatting
ion fmt src/api/users.ion          # format in place
ion fmt --wire src/api/users.ion   # convert to wire format
ion fmt --pretty src/api/users.ionw  # convert wire to surface syntax
ion fmt --check                    # exit non-zero if file would change (CI)

# Ingestion
ion ingest src/users.js --skill javascript
ion ingest src/ --skill javascript --batch --report

# Token analysis
ion tokens src/api/users.ion       # report wire vs pretty token counts

# Plugin management
ion plugin new rust                # scaffold a new language plugin folder
ion plugin validate skills/rust    # validate plugin against interface spec
```

---

## Getting started

```bash
# Install
npm install -g @ion-lang/compiler

# Create a new project
mkdir my-project && cd my-project
ion init --target javascript

# Write some Ion
cat > ion/src/hello.ion << 'EOF'
module hello

fn main() = console.log("Hello, World!")
EOF

# Compile
ion build

# Output appears at src/hello.js
cat src/hello.js
```

---

## Design decisions

**Why not just use TypeScript?** TypeScript is a superset of JavaScript, which means it inherits JavaScript's verbosity. Ion's structural compression (data classes replacing POJOs, `?` replacing try/catch, pipelines replacing nested calls) saves 40–55% tokens even against TypeScript. More importantly, Ion's wire format and constrained-decoding grammar make it the first language designed to be *written* by an LLM with systematically fewer errors.

**Why braces, not indentation?** Python's token efficiency advantage comes from training data volume, not indentation syntax. A new language cannot rely on that. Braces are unambiguous, familiar to LLMs from C/Java/JS/Rust training data, and parse correctly from partial files.

**Why hand-written parser?** Every production compiler that matters — V8, TypeScript, Rust, Go, Clang — uses hand-written recursive descent. Generated parsers are opaque, hard to extend, and produce worse error messages. Ion's grammar is small enough that a hand-written parser is not burdensome.

**Why a folder-based plugin system?** Reducing the authoring friction for new target languages is a design priority. A plugin author needs to write YAML pattern files, a stdlib mapping, and a markdown file — no compiler internals required.

---

## Contributing

Ion is early-stage and contributions are welcome, especially:

- **Language plugins** — new target language support
- **Ingestion patterns** — YAML rules for common idioms in existing languages
- **Golden file tests** — Ion source + expected output pairs for any target
- **Stdlib mappings** — expanding `stdlib.ion` coverage for existing plugins

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and the [implementation specification](./ion-implementation.md) for the full technical design.

---

## License

MIT
