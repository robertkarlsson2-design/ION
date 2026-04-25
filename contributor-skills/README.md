# ION Contributor Skills

Skill guides for LLMs contributing to the ION compiler itself. Separate from `llm-skills/` (which is for LLMs *using* ION to write code).

## Contents

| File | Purpose |
|---|---|
| `new-emitter.md` | End-to-end guide: build a new target language emitter from scratch |

## Directory map

```
llm-skills/          ← for LLMs writing ION code (end-users)
contributor-skills/  ← for LLMs extending the compiler (contributors)  ← you are here
emitters/            ← the actual emitter implementations
src/                 ← compiler frontend (lexer, parser, type checker, IR)
tests/               ← test suite
```
