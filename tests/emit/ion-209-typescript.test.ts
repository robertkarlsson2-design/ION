/**
 * Regression tests for ION-209 — four bugs in the TypeScript emitter that
 * were surfaced when the default-import fix unmasked ~170 latent tsc errors
 * in OTOURENV2's compiled output.
 *
 *   Cat 1 — `import { ... } from 'globalThis'` should never be emitted; the
 *           call-site emitter already produces `globalThis.parseInt`-style
 *           member access for these refs.
 *   Cat 2 — IIFEs whose body contains a top-level `await` (not inside an
 *           inner Abs/AsyncBlock) must be `async () => ...`, otherwise tsc
 *           rejects with TS1308.
 *   Cat 3 — When a do-block (`__do__`) argument is a Let chain, its
 *           bindings must be hoisted into the outer IIFE so sibling
 *           statements can see them. Without the hoist, `let r=Router(); ;
 *           r.put(...)` produces "Cannot find name 'r'".
 *   Cat 4 — Try/catch blocks emit `catch (e: any)` (not bare `catch (e)`)
 *           so `e` is usable under tsconfig `strict` (which enables
 *           `useUnknownInCatchVariables`). Same `: any` annotation is
 *           applied to Abs params whose type is `unknown` so they don't
 *           trigger TS7006 implicit-any errors.
 */

import { describe, it, expect } from 'vitest';
import { emitTS } from '../../emitters/typescript/emit.js';
import type {
  IonIRModule,
  IonIRNode,
  ForeignSignature,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import { makeSymbolId } from '../../src/types.js';

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const SYM = makeSymbolId('');
const UNIT: IonType = { kind: 'Unit' };
const ANY: IonType = { kind: 'TypeVar', id: '?' };

function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}

function intLit(value: number): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Int', value }, span: SPAN, type: UNIT };
}

function strLit(value: string): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Str', value }, span: SPAN, type: UNIT };
}

function appNode(callee: IonIRNode, args: IonIRNode[]): IonIRNode {
  return { kind: 'App', callee, args, span: SPAN, type: UNIT };
}

function appVar(callee: string, ...args: IonIRNode[]): IonIRNode {
  return appNode(varNode(callee), args);
}

function absNode(params: string[], body: IonIRNode, paramType: IonType = UNIT): IonIRNode {
  return {
    kind: 'Abs',
    params: params.map(name => ({ name, symbolId: SYM, type: paramType, span: SPAN })),
    body,
    captures: [],
    span: SPAN,
    type: UNIT,
  };
}

function letNode(name: string, value: IonIRNode, body: IonIRNode): IonIRNode {
  return { kind: 'Let', name, symbolId: SYM, bindingType: ANY, value, body, span: SPAN, type: UNIT };
}

function awaitNode(expr: IonIRNode): IonIRNode {
  return { kind: 'Await', expr, span: SPAN, type: UNIT };
}

function asyncBlock(body: IonIRNode): IonIRNode {
  return { kind: 'AsyncBlock', body, span: SPAN, type: UNIT };
}

const PLACEHOLDER_SIG: ForeignSignature = {
  params: [],
  ret: UNIT,
  template: '',
  paramNames: [],
};

function foreignRef(target: string, module: string, symbol: string): IonIRNode {
  return {
    kind: 'ForeignRef',
    target,
    module,
    symbol,
    sig: PLACEHOLDER_SIG,
    span: SPAN,
    type: UNIT,
  };
}

function makeModule(decls: IonIRNode[]): IonIRModule {
  return { ionir: '1.0', module: 'test', version: '0.0.1', dialects: [], imports: [], data: [], decls };
}

// ---------------------------------------------------------------------------
// Cat 1 — globalThis (and friends) must never produce an import line
// ---------------------------------------------------------------------------

describe('ION-209 Cat 1 — globalThis import-collection skip', () => {
  // Build a module whose body uses `ffi:js:globalThis:parseInt` as a callee.
  // Expected: no `import { parseInt } from 'globalThis';`, call site is
  // `globalThis.parseInt(...)`.
  it('does not emit `from \'globalThis\'` for ffi:js:globalThis:parseInt', () => {
    const fr = foreignRef('js', 'globalThis', 'parseInt');
    const body = appNode(fr, [strLit('42')]);
    const decl = letNode('x', body, varNode('x'));
    const out = emitTS(makeModule([decl]));
    expect(out).not.toContain("from 'globalThis'");
    expect(out).not.toMatch(/import\s*\{[^}]*\}\s*from\s*'globalThis'/);
    // Call site should still resolve — uses `globalThis.parseInt`.
    expect(out).toContain('globalThis.parseInt');
  });

  it('does not emit imports for window or document refs either', () => {
    const w = foreignRef('js', 'window', 'alert');
    const d = foreignRef('js', 'document', 'getElementById');
    const body1 = appNode(w, [strLit('hi')]);
    const body2 = appNode(d, [strLit('root')]);
    const decl1 = letNode('a', body1, varNode('a'));
    const decl2 = letNode('b', body2, varNode('b'));
    const out = emitTS(makeModule([decl1, decl2]));
    expect(out).not.toContain("from 'window'");
    expect(out).not.toContain("from 'document'");
    expect(out).toContain('window.alert');
    expect(out).toContain('document.getElementById');
  });

  it('still emits imports for non-global modules', () => {
    const fr = foreignRef('js', 'express', 'Router');
    const body = appNode(fr, []);
    const decl = letNode('r', body, varNode('r'));
    const out = emitTS(makeModule([decl]));
    expect(out).toContain("from 'express'");
    expect(out).toContain('Router');
  });
});

// ---------------------------------------------------------------------------
// Cat 2 — IIFEs containing await must be async
// ---------------------------------------------------------------------------

describe('ION-209 Cat 2 — async IIFE for nested await', () => {
  // Repro shape: outer Abs is async (its body is an AsyncBlock). Inside,
  // a Let-chain wraps an Await — the Let's IIFE wrapper must be async,
  // otherwise tsc emits TS1308 "'await' expressions are only allowed
  // within async functions".
  it('emits `async () =>` for a Let-chain IIFE containing an Await', () => {
    const inner = letNode('r', awaitNode(varNode('p_query')), varNode('r'));
    const decl = letNode('f', absNode(['p'], asyncBlock(inner)), varNode('f'));
    const out = emitTS(makeModule([decl]));
    // Find the inner IIFE: there's an outer `(async () => { ... })()` from
    // the AsyncBlock and an inner one from the Let chain. Both must be async.
    // We at minimum need at least one async IIFE that comes from the Let
    // expansion (i.e. carrying `const r = await`).
    expect(out).toMatch(/async\s*\(\s*\)\s*=>\s*\{[\s\S]*const r[^;]*=\s*await/);
  });

  it('emits `async () =>` for a do-block that contains await in any arg', () => {
    // `__do__(await foo(), bar)`
    const doBlock = appVar('__do__',
      awaitNode(appVar('foo')),
      varNode('bar'),
    );
    const decl = letNode('f', absNode([], doBlock), varNode('f'));
    const out = emitTS(makeModule([decl]));
    expect(out).toMatch(/async\s*\(\s*\)\s*=>/);
    // Sanity: bare `() =>` without async should not appear for the do-block.
    // (The outer Abs `() =>` is fine — that's the function declaration; it
    // doesn't need to be async at the Abs level. We just want at least one
    // async IIFE from __do__.)
  });

  it('does NOT mark IIFE async when await lives inside a nested Abs', () => {
    // `let f = (() => awaitInsideInnerAbs)()` — the await belongs to the
    // inner Abs, not the outer IIFE. Outer IIFE should remain `() =>`.
    const innerAbs = absNode(['x'], awaitNode(varNode('x')));
    const inner = letNode('g', innerAbs, varNode('g'));
    const decl = letNode('f', absNode([], inner), varNode('f'));
    const out = emitTS(makeModule([decl]));
    // The Let-chain IIFE (the const-binding body) should NOT be async, since
    // the only await is inside an inner Abs.
    expect(out).not.toMatch(/async\s*\(\s*\)\s*=>\s*\{\s*const g/);
  });
});

// ---------------------------------------------------------------------------
// Cat 3 — do-block sibling-IIFE scoping: hoist Let bindings out of __do__ args
// ---------------------------------------------------------------------------

describe('ION-209 Cat 3 — do-block sibling scoping (Let hoist)', () => {
  // Repro: `let r = Router(); r.get(...); r.put(...); r`
  //
  // Wire IR: `__do__(Let(r=Router(), OVC(r.get,...)), OVC(r.put,...), Var(r))`
  //
  // Bad emit:
  //   (() => { (() => { const r = Router(); return r.get(...); })();
  //            r.put(...);   // r out of scope here
  //            return r; })()
  //
  // Good emit (after fix):
  //   (() => { const r = Router(); r.get(...); r.put(...); return r; })()
  it('hoists Let bindings from __do__ arg into outer IIFE', () => {
    // OVC node: r.get(...) and r.put(...) (use OopVirtualCall directly)
    const rGet: IonIRNode = {
      kind: 'OopVirtualCall',
      receiver: varNode('r'),
      method: 'get',
      args: [strLit('/a')],
      span: SPAN,
      type: UNIT,
    };
    const rPut: IonIRNode = {
      kind: 'OopVirtualCall',
      receiver: varNode('r'),
      method: 'put',
      args: [strLit('/b')],
      span: SPAN,
      type: UNIT,
    };
    // First do-block stmt is `Let(r=Router(), OVC(r.get,...))`.
    const router = appVar('Router');
    const firstStmt = letNode('r', router, rGet);
    const doApp = appVar('__do__', firstStmt, rPut, varNode('r'));
    const decl = letNode('mk', absNode([], doApp), varNode('mk'));
    const out = emitTS(makeModule([decl]));
    // The `const r = ...` should be at the SAME nesting level as the
    // `r.put(...)` call (single IIFE), not deeper.
    // Easiest assertion: the substring `const r = Router()` and `r.put`
    // must both occur, AND there must NOT be an inner `(() => { const r =`
    // followed by `r.put` outside that IIFE.
    expect(out).toContain('const r = Router()');
    expect(out).toContain('r.put');
    expect(out).toContain('r.get');
    // Ensure r.put is not preceded immediately by a `})();` boundary that
    // the const-r block closes — i.e. there is exactly ONE IIFE wrapping
    // both the const and the r.put call.
    //
    // Heuristic check: count occurrences of `const r =` (should be 1) and
    // verify they appear inside the same IIFE region. We use a stronger
    // structural assertion: the emitted output for the outer Abs body
    // matches `(() => { const r = Router(); ... r.put(...); ... return r; })()`
    // (whitespace-insensitive).
    const flat = out.replace(/\s+/g, ' ');
    expect(flat).toMatch(
      /\(\(\)\s*=>\s*\{\s*const r = Router\(\);[^}]*r\.put[^}]*return r;\s*\}\)\(\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// Cat 4 — catch params + Abs params get `: any` annotation
// ---------------------------------------------------------------------------

describe('ION-209 Cat 4 — catch param and unknown-typed Abs param annotations', () => {
  it('emits `catch (e: any)` for __try__', () => {
    const tryE = appVar('__try__', intLit(1), intLit(2));
    const decl = letNode('t', tryE, varNode('t'));
    const out = emitTS(makeModule([decl]));
    expect(out).toContain('catch (e: any)');
    expect(out).not.toMatch(/catch\s*\(\s*e\s*\)/);
  });

  it('emits `catch (e: any)` for __tryfin__', () => {
    const tf = appVar('__tryfin__', intLit(1), intLit(2), intLit(3));
    const decl = letNode('t', tf, varNode('t'));
    const out = emitTS(makeModule([decl]));
    expect(out).toContain('catch (e: any)');
  });

  it('emits unknown-typed Abs params as `: any` (not bare)', () => {
    // (err) => process.stderr.write(err)
    // With the Abs param `err` having unknown type, the emitter must annotate
    // it as `: any` so tsc strict mode doesn't fire TS7006.
    const body = appVar('write', varNode('err'));
    const fn = absNode(['err'], body, ANY);  // unknown-typed param
    const decl = letNode('cb', fn, varNode('cb'));
    const out = emitTS(makeModule([decl]));
    expect(out).toContain('err: any');
    // Specifically: the emitted const should have `(err: any) =>`, not bare `(err) =>`.
    expect(out).toMatch(/\(err:\s*any\)\s*=>/);
  });
});
