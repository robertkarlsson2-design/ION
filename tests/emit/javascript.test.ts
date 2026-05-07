import { describe, it, expect } from 'vitest';
import { emitJS } from '../../emitters/javascript/emit.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import { makeSymbolId } from '../../src/types.js';

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const SYM = makeSymbolId('');
const UNIT: IonIRNode['type'] = { kind: 'Unit' };
const INT: IonIRNode['type'] = { kind: 'Int' };

function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}

function intLit(value: number): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Int', value }, span: SPAN, type: INT };
}

function appNode(callee: string, ...args: IonIRNode[]): IonIRNode {
  return { kind: 'App', callee: varNode(callee), args, span: SPAN, type: UNIT };
}

function absNode(params: string[], body: IonIRNode): IonIRNode {
  return {
    kind: 'Abs',
    params: params.map(name => ({ name, symbolId: SYM, type: UNIT, span: SPAN })),
    body,
    captures: [],
    span: SPAN,
    type: UNIT,
  };
}

function letNode(name: string, value: IonIRNode, body: IonIRNode = intLit(0)): IonIRNode {
  return { kind: 'Let', name, symbolId: SYM, bindingType: UNIT, value, body, span: SPAN, type: UNIT };
}

function varPat(name: string): import('../../src/ir/nodes.js').CasePattern {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN };
}

function ctorPat(ctorName: string, fields: import('../../src/ir/nodes.js').CasePattern[]): import('../../src/ir/nodes.js').CasePattern {
  return { kind: 'Constructor', ctorName, fields, symbolId: SYM, span: SPAN };
}

function caseNode(
  scrutinee: IonIRNode,
  arms: Array<{ pattern: import('../../src/ir/nodes.js').CasePattern; body: IonIRNode }>,
): IonIRNode {
  return {
    kind: 'Case',
    scrutinee,
    arms: arms.map(a => ({ ...a, span: SPAN })),
    span: SPAN,
    type: UNIT,
  };
}

function makeShapeModule(): IonIRModule {
  const data: IonIRModule['data'] = [{
    kind: 'AdtDecl',
    name: 'Shape',
    variants: [
      { tag: 'Circle', fields: [{ name: 'radius', type: INT, span: SPAN, symbolId: SYM }], span: SPAN, symbolId: SYM },
      { tag: 'Rect', fields: [{ name: 'width', type: INT, span: SPAN, symbolId: SYM }, { name: 'height', type: INT, span: SPAN, symbolId: SYM }], span: SPAN, symbolId: SYM },
    ],
    span: SPAN,
    symbolId: SYM,
    type: UNIT,
  }];

  const areaBody = caseNode(varNode('s'), [
    { pattern: ctorPat('Circle', [varPat('r')]), body: appNode('__mul__', varNode('r'), varNode('r')) },
    { pattern: ctorPat('Rect', [varPat('w'), varPat('h')]), body: appNode('__mul__', varNode('w'), varNode('h')) },
  ]);

  return {
    ionir: '1.0', module: 'test', version: '0.0.1', dialects: [], imports: [],
    data,
    decls: [letNode('area', absNode(['s'], areaBody))],
  };
}

describe('emitJS — constructor pattern bindings', () => {
  it('emits _tag check for Circle', () => {
    const out = emitJS(makeShapeModule());
    expect(out).toContain('=== "Circle"');
  });

  it('emits const binding and field access for Circle(r)', () => {
    const out = emitJS(makeShapeModule());
    expect(out).toContain('const r =');
    expect(out).toContain('.radius');
  });

  it('emits _tag check for Rect', () => {
    const out = emitJS(makeShapeModule());
    expect(out).toContain('=== "Rect"');
  });

  it('emits const bindings for Rect(w, h)', () => {
    const out = emitJS(makeShapeModule());
    expect(out).toContain('const w =');
    expect(out).toContain('.width');
    expect(out).toContain('const h =');
    expect(out).toContain('.height');
  });
});
