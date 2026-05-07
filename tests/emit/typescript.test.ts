import { describe, it, expect } from 'vitest';
import { emitTS } from '../../emitters/typescript/emit.js';
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

function wildcardPat(): import('../../src/ir/nodes.js').CasePattern {
  return { kind: 'Wildcard', span: SPAN };
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

function makeModule(decls: IonIRNode[], data: IonIRModule['data'] = []): IonIRModule {
  return { ionir: '1.0', module: 'test', version: '0.0.1', dialects: [], imports: [], data, decls };
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

  const decls: IonIRNode[] = [
    letNode('area', absNode(['s'], areaBody)),
  ];

  return makeModule(decls, data);
}

describe('emitTS — constructor pattern bindings', () => {
  it('emits _tag check for Circle', () => {
    const out = emitTS(makeShapeModule());
    expect(out).toContain('._tag === "Circle"');
  });

  it('emits IIFE with const binding for single-field constructor (Circle r)', () => {
    const out = emitTS(makeShapeModule());
    expect(out).toContain('const r =');
    expect(out).toContain('.radius');
  });

  it('emits _tag check for Rect', () => {
    const out = emitTS(makeShapeModule());
    expect(out).toContain('._tag === "Rect"');
  });

  it('emits IIFE with const bindings for two-field constructor (Rect w h)', () => {
    const out = emitTS(makeShapeModule());
    expect(out).toContain('const w =');
    expect(out).toContain('.width');
    expect(out).toContain('const h =');
    expect(out).toContain('.height');
  });

  it('emits no IIFE for unit-variant constructors (no fields)', () => {
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
    const mod = makeModule([letNode('f', absNode(['c'], body))], data);
    const out = emitTS(mod);
    expect(out).toContain('._tag === "Red"');
    expect(out).toContain('._tag === "Green"');
    expect(out).not.toContain('() =>');
  });

  it('resets ctorFields between calls (no stale state)', () => {
    const out1 = emitTS(makeShapeModule());
    expect(out1).toContain('.radius');
    const out2 = emitTS(makeModule([]));
    expect(out2).not.toContain('.radius');
  });
});

describe('emitTS — platform builtin fallback', () => {
  it('__platform__ does not crash TS emitter and emits comment fallback', () => {
    const node = appNode('__platform__', intLit(0), intLit(1), intLit(2), intLit(3));
    const out = emitTS(makeModule([letNode('x', node)]));
    expect(out).toContain('__platform__ requires --target react-native');
  });
});

describe('emitTS — __throw__ emission', () => {
  it('emits throw EXPR directly, no new Error wrapper', () => {
    const node = appNode('__throw__', varNode('err'));
    const out = emitTS(makeModule([letNode('x', node)]));
    expect(out).toContain('(() => { throw err; })()');
    expect(out).not.toContain('new Error(err)');
  });

  it('with RawInject arg does not double-wrap', () => {
    const raw: IonIRNode = { kind: 'RawInject', code: 'new Error("boom")', span: SPAN, type: UNIT };
    const node = appNode('__throw__', raw);
    const out = emitTS(makeModule([letNode('x', node)]));
    expect(out).toContain('(() => { throw new Error("boom"); })()');
    expect(out).not.toContain('new Error(new Error');
  });
});
