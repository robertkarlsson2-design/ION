# ION LLM Skills

This directory contains skill guides for LLMs writing ION code. It is separate from `emitters/` (which holds the compiler's language-emitter plugins).

## Contents

| File | Purpose |
|---|---|
| `write-ion.md` | Primary workflow: write ION → compile → handle gaps → escape hatch |
| `ion-syntax.md` | Surface syntax quick reference |
| `wire-format.md` | Wire format reference (compact, zero-token encoding) |
| `typescript-patterns.md` | Patterns for targeting TypeScript from ION |

## Two-level architecture

```
llm-skills/        ← you are here — LLM-facing documentation
emitters/            ← compiler internals — one emitter per target language
  typescript/
  javascript/
  python/
  html/
  react/
  vue/
  lwc/
  apex/
```

The emitters in `emitters/` are TypeScript modules invoked by the ION compiler pipeline.  
The documents in `llm-skills/` are consumed by LLMs as context/skills.
