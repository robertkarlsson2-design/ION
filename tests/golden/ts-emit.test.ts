import { describe, it, expect } from 'vitest';
import { emitTS } from '../../emitters/typescript/emit.js';
import type { IonIRModule, RawInjectNode, ForeignRefNode, LetNode, VarNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span, SymbolId } from '../../src/types.js';

const S: Span = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const UNIT: IonType = { kind: 'Unit' };
const sym = (s: string): SymbolId => s as SymbolId;

function makeVar(name: string, type: IonType = UNIT): VarNode {
  return { kind: 'Var', name, symbolId: sym(name), span: S, type };
}

function makeLet(name: string, value: import('../../src/ir/nodes.js').IonIRNode): LetNode {
  return {
    kind: 'Let',
    name,
    symbolId: sym(name),
    bindingType: value.type,
    value,
    body: makeVar(name, value.type),
    span: S,
    type: value.type,
  };
}

function makeModule(decls: IonIRModule['decls']): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test',
    version: '0.0.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls,
  };
}

// ---------------------------------------------------------------------------
// RawInject passthrough — top-level declaration loop
// ---------------------------------------------------------------------------

describe('emitTS — top-level RawInject passthrough', () => {
  it('emits raw code verbatim as a top-level declaration', () => {
    const node: RawInjectNode = {
      kind: 'RawInject',
      code: 'export const x = 42;',
      span: S,
      type: UNIT,
    };
    const out = emitTS(makeModule([node]));
    expect(out).toContain('export const x = 42;');
  });

  it('does not produce only "use strict;" when the sole decl is RawInject', () => {
    const node: RawInjectNode = {
      kind: 'RawInject',
      code: 'export const answer = 42;',
      span: S,
      type: UNIT,
    };
    const out = emitTS(makeModule([node]));
    expect(out.trim()).not.toBe('"use strict";');
  });
});

// ---------------------------------------------------------------------------
// cross-module ForeignRef imports
// ---------------------------------------------------------------------------

describe('emitTS — cross-module ForeignRef imports', () => {
  it("emits import { Router } from 'express' for ForeignRef with module=express", () => {
    const ref: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: 'express',
      symbol: 'Router',
      sig: { params: [], ret: UNIT, template: 'Router()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const out = emitTS(makeModule([makeLet('router', ref)]));
    expect(out).toContain("import { Router } from 'express'");
  });

  it('does not emit import for ForeignRef with empty module', () => {
    const ref: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: '',
      symbol: 'map',
      sig: { params: [], ret: UNIT, template: 'map()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const out = emitTS(makeModule([makeLet('mapFn', ref)]));
    expect(out).not.toContain('import');
  });

  it('does not emit import for Math (JS built-in global)', () => {
    const ref: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: 'Math',
      symbol: 'abs',
      sig: { params: [], ret: UNIT, template: 'Math.abs()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const out = emitTS(makeModule([makeLet('absFn', ref)]));
    expect(out).not.toContain('import');
  });

  it('groups multiple symbols from same module into one import statement', () => {
    const ref1: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: 'pg',
      symbol: 'Pool',
      sig: { params: [], ret: UNIT, template: 'Pool()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const ref2: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: 'pg',
      symbol: 'Client',
      sig: { params: [], ret: UNIT, template: 'Client()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const out = emitTS(makeModule([makeLet('pool', ref1), makeLet('client', ref2)]));
    const importLines = out.split('\n').filter(l => l.startsWith('import'));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toContain('Client');
    expect(importLines[0]).toContain('Pool');
    expect(importLines[0]).toContain("from 'pg'");
  });
});
