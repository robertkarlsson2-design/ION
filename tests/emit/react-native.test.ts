import { describe, it, expect } from 'vitest';
import { emitReactNative } from '../../emitters/react-native/emit.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import { makeSymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const SYM = makeSymbolId('');
const UNIT: IonIRNode['type'] = { kind: 'Unit' };

function strLit(value: string): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Str', value }, span: SPAN, type: { kind: 'Str' } };
}

function intLit(value: number): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Int', value }, span: SPAN, type: { kind: 'Int' } };
}

function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}

function appNode(tag: string, attrStr: string, ...children: IonIRNode[]): IonIRNode {
  return {
    kind: 'App',
    callee: varNode(tag),
    args: [strLit(attrStr), ...children],
    span: SPAN,
    type: UNIT,
  };
}

function letNode(name: string, value: IonIRNode): IonIRNode {
  return {
    kind: 'Let',
    name,
    symbolId: SYM,
    bindingType: UNIT,
    value,
    body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span: SPAN, type: { kind: 'Int' } },
    span: SPAN,
    type: UNIT,
  };
}

function makeModule(decls: IonIRNode[]): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test',
    version: '0.0.1',
    dialects: [],
    imports: [],
    data: [],
    decls,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitReactNative', () => {
  it('empty module starts with "use strict" and has react-native import', () => {
    const out = emitReactNative(makeModule([]));
    expect(out.startsWith('"use strict";')).toBe(true);
    expect(out).toContain("import { View, Text } from 'react-native'");
  });

  it('emits React import', () => {
    const out = emitReactNative(makeModule([]));
    expect(out).toContain("import React from 'react'");
  });

  it('emits TODO placeholder for non-JSX Let', () => {
    const out = emitReactNative(makeModule([letNode('count', intLit(42))]));
    expect(out).toContain('const count = /* TODO */;');
  });

  it('emits React.FC shell for HTML-element-call Let', () => {
    const out = emitReactNative(makeModule([letNode('MyComp', appNode('div', '', strLit('Hi')))]));
    expect(out).toContain('const MyComp: React.FC');
  });
});
