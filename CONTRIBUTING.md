# Contributing to Ion

Thank you for your interest in contributing to Ion.

## Getting started

```bash
git clone https://github.com/robertkarlsson2-design/ION.git
cd ION
npm install -g pnpm
pnpm install
pnpm build
pnpm test
```

All tests should pass before you submit a PR.

## What to work on

The best places to contribute right now:

- **Language plugins** — new target language support (Java, Python, TypeScript, Rust). Each plugin is a self-contained folder; see `skills/javascript/` as the reference implementation.
- **Ingestion patterns** — YAML rules in `skills/javascript/patterns/` for recognizing common JavaScript idioms and converting them to Ion.
- **Golden file tests** — add `.ion` source + expected JS output pairs to `tests/`. These are the primary regression guard for the emitter.
- **Stdlib mappings** — expand `skills/javascript/` coverage to cover more of the Ion standard library.
- **Bug reports** — open an issue with a minimal `.ion` file that reproduces the problem.

## Project structure

```
src/
├── lexer/        Token stream from .ion source
├── parser/       Recursive-descent parser → AST
├── binder/       Symbol resolution and scope analysis
├── checker/      Type inference and unification
├── desugar/      AST → IonIR lowering
├── emit/         IonIR → target language output
├── ir/           IonIR type definitions and serialization
├── wire/         Wire format encoder/decoder
├── lsp/          Language Server Protocol implementation
└── cli/          ion build / ion check / ion fmt / ion tokens

skills/
└── javascript/   JavaScript language plugin

tests/
├── roundtrip/    IR serialization round-trip tests
├── wire/         Wire format encode/decode tests
├── parser/       Parser golden tests
└── skills/       Per-plugin compiler tests
```

## Code style

- TypeScript strict mode — no `any`, no `// @ts-ignore`
- No `console.log` in library code (use the structured error types in `src/*/errors.ts`)
- New compiler stages must have golden file tests in `tests/`
- Property-based tests (`fast-check`) are welcome alongside example-based tests

## Submitting a PR

1. Fork the repo and create a branch: `git checkout -b feature/my-change`
2. Make your changes and add tests
3. Run `pnpm build && pnpm test` — both must pass
4. Open a PR against `main` with a clear description of what you changed and why

## Reporting bugs

Open a GitHub issue with:
- The `.ion` source that triggers the bug
- The actual output or error message
- The expected output

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
