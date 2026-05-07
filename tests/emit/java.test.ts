import { describe, it, expect } from 'vitest';
import { emitJava } from '../../emitters/java/emit.js';
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
    type: { kind: 'Fn', params: params.map(() => ({ kind: 'Int' as const })), ret: { kind: 'Int' }, effects: new Set<never>() },
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
    { pattern: { kind: 'Wildcard' as const, span: SPAN }, body: intLit(0) },
  ]);

  return {
    ionir: '1.0', module: 'test', version: '0.0.1', dialects: [], imports: [],
    data,
    decls: [letNode('area', absNode(['s'], areaBody))],
  };
}

describe('emitJava — constructor pattern bindings', () => {
  it('emits instanceof with Java 21 record pattern for Circle(r)', () => {
    const out = emitJava(makeShapeModule());
    expect(out).toContain('instanceof Circle(var r)');
  });

  it('emits instanceof with Java 21 record pattern for Rect(w, h)', () => {
    const out = emitJava(makeShapeModule());
    expect(out).toContain('instanceof Rect(var w, var h)');
  });

  it('emits plain instanceof for unit-variant constructors', () => {
    const data: IonIRModule['data'] = [{
      kind: 'AdtDecl',
      name: 'Color',
      variants: [
        { tag: 'Red', fields: [], span: SPAN, symbolId: SYM },
        { tag: 'Green', fields: [], span: SPAN, symbolId: SYM },
      ],
      span: SPAN,
      symbolId: SYM,
      type: UNIT,
    }];
    const body = caseNode(varNode('c'), [
      { pattern: ctorPat('Red', []), body: intLit(1) },
      { pattern: ctorPat('Green', []), body: intLit(2) },
    ]);
    const out = emitJava({
      ionir: '1.0', module: 'test', version: '0.0.1', dialects: [], imports: [],
      data,
      decls: [letNode('f', absNode(['c'], body))],
    });
    expect(out).toContain('instanceof Red');
    expect(out).not.toContain('instanceof Red(');
  });
});
