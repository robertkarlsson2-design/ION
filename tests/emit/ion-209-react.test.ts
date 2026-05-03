/**
 * React-emitter mirror of ION-209 regression tests. Same 4 categories;
 * confirms parity with the TS emitter.
 *
 * Cat 1 doesn't apply to the React emitter — it doesn't have its own
 * import-collection pass; it only emits `import React from 'react';` at
 * the top. Skipped here.
 */

import { describe, it, expect } from 'vitest';
import { emitTsExprForReact } from '../../emitters/react/emit.js';
import type { IonIRNode } from '../../src/ir/nodes.js';
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
function letNode(name: string, value: IonIRNode, body: IonIRNode): IonIRNode {
  return { kind: 'Let', name, symbolId: SYM, bindingType: ANY, value, body, span: SPAN, type: UNIT };
}
function awaitNode(expr: IonIRNode): IonIRNode {
  return { kind: 'Await', expr, span: SPAN, type: UNIT };
}

describe('ION-209 Cat 2 — React: async IIFE for nested await', () => {
  it('emits `async () =>` for Let-chain IIFE containing await', () => {
    const inner = letNode('r', awaitNode(varNode('p_query')), varNode('r'));
    const out = emitTsExprForReact(inner);
    expect(out).toMatch(/async\s*\(\s*\)\s*=>/);
  });

  it('emits sync IIFE for Let-chain without await', () => {
    const inner = letNode('r', intLit(1), varNode('r'));
    const out = emitTsExprForReact(inner);
    expect(out).toMatch(/\(\s*\(\s*\)\s*=>/);
    expect(out).not.toMatch(/async\s*\(\s*\)\s*=>/);
  });
});

describe('ION-209 Cat 3 — React: do-block sibling scoping (Let hoist)', () => {
  it('hoists Let bindings from __do__ arg into outer IIFE', () => {
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
    // Non-capitalized callee so the React emitter doesn't try to render it
    // as a component (capitalized callees route through emitJsxNode).
    const router = appVar('makeRouter');
    const firstStmt = letNode('r', router, rGet);
    const doApp = appVar('__do__', firstStmt, rPut, varNode('r'));
    const out = emitTsExprForReact(doApp);
    expect(out).toContain('const r = makeRouter()');
    expect(out).toContain('r.put');
    expect(out).toContain('r.get');
    const flat = out.replace(/\s+/g, ' ');
    expect(flat).toMatch(
      /\(\(\)\s*=>\s*\{\s*const r = makeRouter\(\);[^}]*r\.put[^}]*return r;\s*\}\)\(\)/,
    );
  });
});

describe('ION-209 Cat 4 — React: catch param annotated `: any`', () => {
  it('emits `catch (e: any)` for __try__', () => {
    const out = emitTsExprForReact(appVar('__try__', intLit(1), intLit(2)));
    expect(out).toContain('catch (e: any)');
    expect(out).not.toMatch(/catch\s*\(\s*e\s*\)/);
  });

  it('emits `catch (e: any)` for __tryfin__', () => {
    const out = emitTsExprForReact(appVar('__tryfin__', intLit(1), intLit(2), intLit(3)));
    expect(out).toContain('catch (e: any)');
  });
});
