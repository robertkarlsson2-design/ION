# Writing a New ION Emitter — Contributor Skill

This is the end-to-end guide for an LLM contributor adding a new target language to ION. Follow it step by step and you will produce a working, fully-covered emitter that passes the test suite.

---

## What you are building

An ION emitter is a single TypeScript module at `emitters/{language}/emit.ts` that takes an `IonIRModule` and returns the compiled output as a string (or a structured output for multi-file targets like LWC).

```
IonIRModule  →  emitXxx(irModule)  →  "...target language code..."
```

The emitter has two jobs:
1. **Expression emitter** — recursively converts every `IonIRNode` to a string of target code.
2. **Module emitter** — iterates `irModule.decls` and `irModule.data`, assembles the full file.

---

## Folder structure to create

```
emitters/{language}/
├── emit.ts          ← the emitter (required)
├── emit.md          ← human-readable overview of design decisions (optional but good)
└── stdlib.ion       ← maps ION prelude calls to target-language equivalents (optional)
```

For multi-file targets (like LWC which outputs html + js + css + xml), the entry point returns a typed object instead of a plain string.

---

## Step 1 — Read the IR type definitions

Before writing any code, read these two files. Every node kind you must handle is defined here.

- `src/ir/nodes.ts` — all `IonIRNode` kinds and their fields
- `src/ir/types.ts` — `IonType` union: `Int | Float | Str | Bool | Unit | List | Map | Option | Result | Fn | User | TypeVar | Never | Tuple`

The `IonIRNode` union is:
```
CoreNode:    Var | Literal | App | Abs | Let | Case | Constructor | Accessor |
             ListLit | MapLit | ModuleRef | ForeignRef | Effect
OopNode:     OopClass | OopInterface | OopNew | OopVirtualCall | OopThis
AsyncNode:   AsyncBlock | Await
AdtNode:     AdtDecl | AdtMatch
EffectsNode: EffectDecl | Perform | Handle | Resume
Escape:      RawInject
```

That is **20 node kinds**. Your emitter must handle all of them in the expression switch. Declaration kinds (`OopClass`, `OopInterface`, `AdtDecl`, `EffectDecl`) may be stubs in expression position (see below).

---

## Step 2 — Create `emitters/{language}/emit.ts`

Start from this skeleton. Replace `{Language}` and `{language}` with the target name.

```typescript
import type {
  IonIRModule,
  IonIRNode,
  AbsNode,
  AppNode,
  LetNode,
  CaseNode,
  ForeignRefNode,
  AdtDeclNode,
  AdtMatchNode,
  VarNode,
  OopClassNode,
  OopInterfaceNode,
  EffectDeclNode,
  HandleNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';

// ---------------------------------------------------------------------------
// IonType → {Language} type string
// ---------------------------------------------------------------------------

function ionTypeTo{Language}(t: IonType): string {
  switch (t.kind) {
    case 'Int':     return '???';    // ← replace with target type
    case 'Float':   return '???';
    case 'Bool':    return '???';
    case 'Str':     return '???';
    case 'Unit':    return '???';
    case 'Null':    return '???';
    case 'List':    return `???<${ionTypeTo{Language}(t.elem)}>`;
    case 'Map':     return `???<${ionTypeTo{Language}(t.key)}, ${ionTypeTo{Language}(t.value)}>`;
    case 'Option':  return `${ionTypeTo{Language}(t.inner)} | ???`;
    case 'Result':  return `???`;
    case 'Fn':      return `???`;
    case 'User':    return t.args.length === 0 ? t.name : `${t.name}<${t.args.map(ionTypeTo{Language}).join(', ')}>`;
    case 'TypeVar': return 'Object';
    case 'Never':   return '???';
    case 'Tuple':   return `???<${t.elements.map(ionTypeTo{Language}).join(', ')}>`;
  }
}

// ---------------------------------------------------------------------------
// Builtin operator map  (covers __add__, __eq__, etc. from the prelude)
// ---------------------------------------------------------------------------

const BUILTIN_OPS: Record<string, string> = {
  __add__: '+', __sub__: '-', __mul__: '*', __div__: '/', __mod__: '%',
  __eq__: '==', __ne__: '!=', __lt__: '<', __gt__: '>', __le__: '<=', __ge__: '>=',
  __and__: '&&', __or__: '||', __neg__: '-', __not__: '!',
};

// ---------------------------------------------------------------------------
// Expression emitter — handles every node kind
// ---------------------------------------------------------------------------

function emit{Language}Expr(node: IonIRNode): string {
  switch (node.kind) {
    // ── Literals ────────────────────────────────────────────────────────────
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Bool')  return v.value ? '???' : '???';   // true/false in target
      if (v.kind === 'Null')  return '???';                      // null in target
      if (v.kind === 'Str')   return JSON.stringify(v.value);
      return String(v.value);
    }

    // ── Variable reference ──────────────────────────────────────────────────
    case 'Var': return node.name;

    // ── Function application ────────────────────────────────────────────────
    case 'App': {
      const app = node as AppNode;
      // Map builtin operators to infix
      if (app.callee.kind === 'Var') {
        const op = BUILTIN_OPS[(app.callee as VarNode).name];
        if (op && app.args.length === 2)
          return `(${emit{Language}Expr(app.args[0])} ${op} ${emit{Language}Expr(app.args[1])})`;
        if (op && app.args.length === 1)
          return `(${op}${emit{Language}Expr(app.args[0])})`;
      }
      return `${emit{Language}Expr(app.callee)}(${app.args.map(emit{Language}Expr).join(', ')})`;
    }

    // ── Lambda ──────────────────────────────────────────────────────────────
    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      return `(${params}) => ${emit{Language}Expr(abs.body)}`;  // adjust syntax per target
    }

    // ── Let binding (expression position) ──────────────────────────────────
    case 'Let': {
      const lt = node as LetNode;
      // In languages with no expression-level let, use an IIFE or nested function
      return `((${lt.name}) => ${emit{Language}Expr(lt.body)})(${emit{Language}Expr(lt.value)})`;
    }

    // ── Pattern match ────────────────────────────────────────────────────────
    case 'Case': {
      const c = node as CaseNode;
      const arms = c.arms.map(arm => {
        const pat = arm.pattern.kind === 'Wildcard' ? '_' :
                    arm.pattern.kind === 'Literal'  ? String(arm.pattern.value.value) :
                    arm.pattern.kind === 'Var'       ? arm.pattern.name : arm.pattern.ctorName;
        return `/* ${pat} */ ${emit{Language}Expr(arm.body)}`;
      });
      return `/* case */ ${arms[0] ?? 'undefined'}`;  // ← replace with target's match syntax
    }

    // ── Constructor application ──────────────────────────────────────────────
    case 'Constructor': {
      const args = node.args.map(emit{Language}Expr).join(', ');
      return `${node.ctorName}(${args})`;
    }

    // ── Field accessor ───────────────────────────────────────────────────────
    case 'Accessor': return `${emit{Language}Expr(node.receiver)}.${node.member}`;

    // ── Collection literals ──────────────────────────────────────────────────
    case 'ListLit': return `[${node.elements.map(emit{Language}Expr).join(', ')}]`;
    case 'MapLit': {
      const entries = node.entries.map(e =>
        `${emit{Language}Expr(e.key)}: ${emit{Language}Expr(e.value)}`
      ).join(', ');
      return `{${entries}}`;
    }

    // ── Module / foreign references ──────────────────────────────────────────
    case 'ModuleRef':  return node.modulePath.join('.');
    case 'ForeignRef': {
      const fr = node as ForeignRefNode;
      // Zero-arg foreign: expand template immediately
      if (fr.sig.params.length === 0) return expandTemplate(fr.sig.template, []);
      // Otherwise return a lambda that expands on call
      const pnames = fr.sig.paramNames.length > 0
        ? fr.sig.paramNames
        : fr.sig.params.map((_, i) => `_p${i + 1}`);
      return `(${pnames.join(', ')}) => ${expandTemplate(fr.sig.template, pnames.map(wrapEmitted))}`;
    }

    // ── Effect wrapper ───────────────────────────────────────────────────────
    case 'Effect': return emit{Language}Expr(node.body);

    // ── OOP ──────────────────────────────────────────────────────────────────
    case 'OopNew':
      return `new ${node.type.kind === 'User' ? node.type.name : '_ctor'}(${node.args.map(emit{Language}Expr).join(', ')})`;
    case 'OopVirtualCall':
      return `${emit{Language}Expr(node.receiver)}.${node.method}(${node.args.map(emit{Language}Expr).join(', ')})`;
    case 'OopThis': return 'this';   // or 'self' for Python-style targets

    // ── Async ────────────────────────────────────────────────────────────────
    case 'AsyncBlock': return `async () => ${emit{Language}Expr(node.body)}`;
    case 'Await':      return `await ${emit{Language}Expr(node.expr)}`;

    // ── ADT match ────────────────────────────────────────────────────────────
    case 'AdtMatch': {
      const subject = emit{Language}Expr(node.scrutinee);
      const arms = node.arms.map(arm => {
        const bindings = arm.bindings.map((b, i) => `const ${b.name} = _v._args[${i}];`).join(' ');
        return `if (_v._tag === '${arm.tag}') { ${bindings} return ${emit{Language}Expr(arm.body)}; }`;
      }).join(' else ');
      return `((_v) => { ${arms} })(${subject})`;
    }

    // ── Algebraic effects ─────────────────────────────────────────────────────
    case 'Perform':
      return `/* perform ${node.operation} */(${node.args.map(emit{Language}Expr).join(', ')})`;
    case 'Handle': return emit{Language}Expr(node.body);
    case 'Resume': return emit{Language}Expr(node.value);

    // ── Declaration nodes in expression position (no-op) ────────────────────
    case 'OopClass':    return `/* class ${node.name} */`;
    case 'OopInterface':return `/* interface ${node.name} */`;
    case 'AdtDecl':     return `/* adt ${node.name} */`;
    case 'EffectDecl':  return `/* effect ${node.name} */`;

    // ── Escape hatch — REQUIRED in every emitter ─────────────────────────────
    case 'RawInject': return node.code;
  }
}

// ---------------------------------------------------------------------------
// Declaration emitter — renders a top-level node as a statement/declaration
// ---------------------------------------------------------------------------

function emit{Language}Decl(node: IonIRNode): string {
  switch (node.kind) {
    case 'Let': {
      const lt = node as LetNode;
      if (lt.value.kind === 'Abs') {
        const abs = lt.value as AbsNode;
        const params = abs.params.map(p => p.name).join(', ');
        return `function ${lt.name}(${params}) {\n  return ${emit{Language}Expr(abs.body)};\n}`;
        // ↑ adjust to target's function declaration syntax
      }
      return `const ${lt.name} = ${emit{Language}Expr(lt.value)};`;
      // ↑ adjust to target's variable declaration syntax
    }

    case 'OopClass': {
      const cls = node as OopClassNode;
      const lines: string[] = [];
      lines.push(`class ${cls.name} {`);
      if (cls.fields.length > 0) {
        const fp = cls.fields.map(f => f.name).join(', ');
        const fa = cls.fields.map(f => `    this.${f.name} = ${f.name};`).join('\n');
        lines.push(`  constructor(${fp}) {\n${fa}\n  }`);
      }
      for (const m of cls.methods) {
        const params = m.params.map(p => p.name).join(', ');
        const body = m.body ? emit{Language}Expr(m.body) : 'undefined';
        lines.push(`  ${m.isStatic ? 'static ' : ''}${m.name}(${params}) {\n    return ${body};\n  }`);
      }
      lines.push('}');
      return lines.join('\n');
    }

    case 'OopInterface': {
      const iface = node as OopInterfaceNode;
      // Many targets have no interface keyword — emit as a comment or type alias
      return `// interface ${iface.name}: ${iface.members.map(m => m.name).join(', ')}`;
    }

    case 'AdtDecl': {
      const adt = node as AdtDeclNode;
      const lines = [`// ADT: ${adt.name}`];
      for (const v of adt.variants) {
        const fp = v.fields.map(f => f.name).join(', ');
        lines.push(`function ${v.tag}(${fp}) { return { _tag: '${v.tag}', _args: [${fp}] }; }`);
      }
      return lines.join('\n');
    }

    case 'EffectDecl': {
      const eff = node as EffectDeclNode;
      const ops = eff.operations.map(op => `  // ${op.name}(${op.params.map(p => p.name).join(', ')})`).join('\n');
      return `// effect ${eff.name}\n${ops}`;
    }

    case 'RawInject': return node.code;

    default:
      // Expression-level nodes as top-level statements
      return `${emit{Language}Expr(node)};`;
  }
}

// ---------------------------------------------------------------------------
// Module emitter — public entry point
// ---------------------------------------------------------------------------

export function emit{Language}(irModule: IonIRModule): string {
  // DCE: remove unused prelude declarations
  const decls = shakePreludeDecls(irModule);
  const parts: string[] = [];

  // Emit ADT type declarations first (forward declarations)
  for (const adt of irModule.data) {
    parts.push(emit{Language}Decl(adt));
  }

  // Emit top-level declarations
  for (const d of decls) {
    parts.push(emit{Language}Decl(d));
  }

  return parts.join('\n') + '\n';
}
```

---

## Step 3 — Fill in the type map

Replace every `'???'` in `ionTypeTo{Language}` with the real target type. Common mappings:

| IonType | TypeScript | Python | Java | Ruby | Go |
|---|---|---|---|---|---|
| `Int` | `number` | `int` | `int` | `Integer` | `int` |
| `Float` | `number` | `float` | `double` | `Float` | `float64` |
| `Bool` | `boolean` | `bool` | `boolean` | `TrueClass\|FalseClass` | `bool` |
| `Str` | `string` | `str` | `String` | `String` | `string` |
| `Unit` | `void` | `None` | `void` | `nil` | `struct{}` |
| `List<T>` | `T[]` | `List[T]` | `List<T>` | `Array` | `[]T` |
| `Option<T>` | `T \| null` | `Optional[T]` | `Optional<T>` | `T?` | `*T` |

---

## Step 4 — Handle target-specific syntax

Each target language has idioms that differ from the skeleton above. Common adjustments:

### Lambda syntax
| Target | Lambda |
|---|---|
| TypeScript/JS | `(x, y) => body` |
| Python | `lambda x, y: body` |
| Java | `(x, y) -> body` |
| Ruby | `lambda { \|x, y\| body }` |
| Go | `func(x, y T) T { return body }` |
| Apex | not supported — use raw() |

### Let (expression position)
Most targets can't have a `let` inside an expression. Two options:
1. **IIFE**: `((x) => body)(value)` — works in JS/TS
2. **Flatten to statements**: track a statements list alongside the expression — works in Python, Java, Go

### Boolean literals
| Target | true | false | null |
|---|---|---|---|
| TypeScript/JS | `true` | `false` | `null` |
| Python | `True` | `False` | `None` |
| Java | `true` | `false` | `null` |
| Ruby | `true` | `false` | `nil` |
| Apex | `true` | `false` | `null` |

### OOP
If the target is not OOP (e.g. Go, Rust), emit `OopClass` as a struct + standalone functions. If the target IS OOP but with different syntax (e.g. Python, Ruby), adjust the class emitter accordingly.

---

## Step 5 — The escape hatch rule (MANDATORY)

Every emitter MUST have this case in **both** the expression switch and the declaration emitter:

```typescript
case 'RawInject': return node.code;
```

This is the universal escape hatch. When an LLM writes `raw("verbatim target code")` in wire format, every emitter must pass it through unchanged. **Do not add any wrapping, formatting, or semicolons.** Return `node.code` as-is.

If this case is missing, the TypeScript compiler will warn about an exhaustive switch, and the emitter will break for any module that uses `raw(...)`.

---

## Step 6 — Wire up in `src/cli/build.ts`

Find the target dispatch table and add your emitter:

```typescript
// In src/cli/build.ts — find the switch/map that routes target → emitFn
import { emit{Language} } from '../../emitters/{language}/emit.js';

// Add to the target map:
case '{language}': return emit{Language}(irModule);
```

Also add to `scripts/compile-ion.mjs` if you want `.ion` files to compile to your target via the CLI.

---

## Step 7 — Write tests

Create `tests/emit/{language}.test.ts`. Use the same pattern as the existing tests:

```typescript
import { describe, it, expect } from 'vitest';
import { emit{Language} } from '../../emitters/{language}/emit.js';
import type { IonIRModule } from '../../src/ir/nodes.js';
import { makeSymbolId } from '../../src/types.js';

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const SYM = makeSymbolId('');

function makeModule(decls: IonIRModule['decls']): IonIRModule {
  return { ionir: '1.0', module: 'test', version: '0.0.0', dialects: [], imports: [], data: [], decls };
}

describe('emit{Language}', () => {
  it('emits integer literal', () => {
    const mod = makeModule([{
      kind: 'Let', name: 'x', symbolId: SYM, bindingType: { kind: 'Int' },
      value: { kind: 'Literal', value: { kind: 'Int', value: 42 }, span: SPAN, type: { kind: 'Int' } },
      body: { kind: 'Var', name: 'x', symbolId: SYM, span: SPAN, type: { kind: 'Int' } },
      span: SPAN, type: { kind: 'Int' },
    }]);
    const out = emit{Language}(mod);
    expect(out).toContain('42');
  });

  it('passes raw() through unchanged', () => {
    const mod = makeModule([{
      kind: 'RawInject', code: 'VERBATIM_CODE', span: SPAN, type: { kind: 'Unit' },
    }]);
    expect(emit{Language}(mod)).toContain('VERBATIM_CODE');
  });

  // Add a test for every node kind you implement
});
```

Run with:
```bash
npx vitest run tests/emit/{language}.test.ts
```

---

## Step 8 — Typecheck

```bash
npx tsc --noEmit
```

The switch in `emit{Language}Expr` must be exhaustive. If TypeScript reports `Type 'XNode' is not assignable to type 'never'` in the `default` branch, you have a missing case. Add it.

A useful pattern to guarantee exhaustiveness:

```typescript
default: {
  const _: never = node;  // compile error if any case is missing
  throw new Error(`Unhandled IonIRNode kind: ${(node as IonIRNode).kind}`);
}
```

At runtime this throw will never fire if all cases are covered. It gives a clear error message if a new node kind is added to `IonIRNode` in the future and your emitter isn't updated yet.

---

## Reference implementations

Study these before starting. They progress from simple to complex:

| Emitter | What to study |
|---|---|
| `emitters/python/emit.ts` | Clean, simple, no framework. Great first reference. |
| `emitters/typescript/emit.ts` | Full type annotations, OOP, ADT, effects. The gold standard. |
| `emitters/javascript/emit.ts` | JsAST intermediate — good if you want a proper AST before printing. |
| `emitters/apex/emit.ts` | OOP-heavy target with no async. Shows how to map OOP idioms. |
| `emitters/lwc/emit.ts` | Multi-file output (`LwcOutput` return type). |

---

## Checklist

Before submitting:

- [ ] `emit{Language}(irModule)` is exported and handles all 20 node kinds
- [ ] `case 'RawInject': return node.code` is in the expression switch
- [ ] `case 'RawInject': return node.code` is in the declaration emitter
- [ ] `ionTypeTo{Language}` maps all 14 `IonType` kinds (no `???` remaining)
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npx vitest run` passes all existing tests
- [ ] New test file at `tests/emit/{language}.test.ts` with at least one test per node kind
- [ ] Wired up in `src/cli/build.ts`
- [ ] Added to the status table in `README.md`
