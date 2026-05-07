import { describe, it, expect } from 'vitest';
import { emitReactNative } from '../../emitters/react-native/emit.js';
import { emitTsExpr } from '../../emitters/ui-shared.js';
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

function platformApp(builtin: string, ...args: IonIRNode[]): IonIRNode {
  return { kind: 'App', callee: varNode(builtin), args, span: SPAN, type: UNIT };
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

  it('emits expression for non-JSX Let', () => {
    const out = emitReactNative(makeModule([letNode('count', intLit(42))]));
    expect(out).toContain('const count = 42;');
  });

  it('emits React.FC shell for HTML-element-call Let', () => {
    const out = emitReactNative(makeModule([letNode('MyComp', appNode('div', '', strLit('Hi')))]));
    expect(out).toContain('const MyComp: React.FC');
  });
});

describe('emitTsExpr (shared)', () => {
  it('__add__(1, 2) emits (1 + 2)', () => {
    const node: IonIRNode = {
      kind: 'App',
      callee: varNode('__add__'),
      args: [intLit(1), intLit(2)],
      span: SPAN,
      type: { kind: 'Int' },
    };
    expect(emitTsExpr(node, {})).toBe('(1 + 2)');
  });

  it('__platform__ with ios/android simple arms emits ternary form', () => {
    const node = platformApp('__platform__', strLit('ios'), strLit('light'), strLit('android'), strLit('dark'));
    expect(emitTsExpr(node, {})).toBe('(Platform.OS === "ios" ? "light" : "dark")');
  });

  it('__platform__ with non-simple arm emits Platform.select IIFE form', () => {
    const node = platformApp(
      '__platform__',
      strLit('ios'), strLit('light'),
      strLit('android'), platformApp('__add__', intLit(1), intLit(2)),
    );
    const out = emitTsExpr(node, {});
    expect(out).toContain('Platform.select({');
    expect(out).toContain('ios: () =>');
    expect(out).toContain('android: () =>');
    expect(out.trimEnd().endsWith('()')).toBe(true);
  });

  it('__platform__ with default arm forces IIFE form', () => {
    const node = platformApp(
      '__platform__',
      strLit('ios'), strLit('a'),
      strLit('android'), strLit('b'),
      strLit('default'), strLit('c'),
    );
    const out = emitTsExpr(node, {});
    expect(out).toContain('Platform.select({');
    expect(out).toContain('default: () =>');
    expect(out.trimEnd().endsWith('()')).toBe(true);
  });

  it('__platform_select__ emits Platform.select without IIFE call', () => {
    const node = platformApp('__platform_select__', strLit('ios'), intLit(1), strLit('android'), intLit(2));
    expect(emitTsExpr(node, {})).toBe('Platform.select({ ios: 1, android: 2 })');
  });
});

describe('emitReactNative platform import', () => {
  it('includes Platform in import when __platform__ builtin is used', () => {
    const out = emitReactNative(makeModule([
      letNode('theme', platformApp('__platform__', strLit('ios'), strLit('light'), strLit('android'), strLit('dark'))),
    ]));
    expect(out).toContain("import { View, Text, Platform } from 'react-native'");
  });
});
