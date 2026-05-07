import { describe, it, expect } from 'vitest';
import { emitReactNative } from '../../emitters/react-native/emit.js';
import { emitTsExpr } from '../../emitters/ui-shared.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import { makeSymbolId } from '../../src/types.js';
import {
  RN_PRIMITIVES, RN_ATTR_MAP, RN_STRIPPED_TAGS, RN_NATIVE_IMPORTS,
  coerceInputProps,
} from '../../emitters/react-native/primitives.js';
import { HTML_TAGS } from '../../emitters/ui-shared.js';

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

describe('primitives/RN_PRIMITIVES', () => {
  it('covers every HTML_TAGS entry (exhaustiveness)', () => {
    for (const tag of HTML_TAGS) {
      const covered =
        (RN_PRIMITIVES[tag] !== undefined && RN_PRIMITIVES[tag] !== '') ||
        RN_STRIPPED_TAGS.has(tag);
      expect(covered).toBe(true);
    }
  });

  it('div → View', () => expect(RN_PRIMITIVES['div']).toBe('View'));
  it('span → Text', () => expect(RN_PRIMITIVES['span']).toBe('Text'));
  it('button → Pressable', () => expect(RN_PRIMITIVES['button']).toBe('Pressable'));
  it('a → Pressable', () => expect(RN_PRIMITIVES['a']).toBe('Pressable'));
  it('input → TextInput', () => expect(RN_PRIMITIVES['input']).toBe('TextInput'));
  it('img → Image', () => expect(RN_PRIMITIVES['img']).toBe('Image'));
  it('dialog → Modal', () => expect(RN_PRIMITIVES['dialog']).toBe('Modal'));

  it('br is in RN_STRIPPED_TAGS', () => expect(RN_STRIPPED_TAGS.has('br')).toBe(true));
  it('hr is in RN_STRIPPED_TAGS', () => expect(RN_STRIPPED_TAGS.has('hr')).toBe(true));
  it('select is in RN_STRIPPED_TAGS', () => expect(RN_STRIPPED_TAGS.has('select')).toBe(true));
});

describe('primitives/RN_ATTR_MAP', () => {
  it('onclick → onPress', () => expect(RN_ATTR_MAP['onclick']).toBe('onPress'));
  it('onlongpress → onLongPress', () => expect(RN_ATTR_MAP['onlongpress']).toBe('onLongPress'));
  it('class → ""', () => expect(RN_ATTR_MAP['class']).toBe(''));
  it('for → ""', () => expect(RN_ATTR_MAP['for']).toBe(''));
  it('tabindex → ""', () => expect(RN_ATTR_MAP['tabindex']).toBe(''));
  it('maxlength → maxLength', () => expect(RN_ATTR_MAP['maxlength']).toBe('maxLength'));
});

describe('primitives/coerceInputProps', () => {
  it('type=email → keyboardType=email-address + type removed', () => {
    const result = coerceInputProps({ type: 'email' }, 'input');
    expect(result['keyboardType']).toBe('email-address');
    expect(result['type']).toBeUndefined();
  });

  it('type=password → secureTextEntry={true} + type removed', () => {
    const result = coerceInputProps({ type: 'password' }, 'input');
    expect(result['secureTextEntry']).toBe('{true}');
    expect(result['type']).toBeUndefined();
  });

  it('type=number → keyboardType=numeric + type removed', () => {
    const result = coerceInputProps({ type: 'number' }, 'input');
    expect(result['keyboardType']).toBe('numeric');
    expect(result['type']).toBeUndefined();
  });

  it('type=tel → keyboardType=phone-pad + type removed', () => {
    const result = coerceInputProps({ type: 'tel' }, 'input');
    expect(result['keyboardType']).toBe('phone-pad');
    expect(result['type']).toBeUndefined();
  });

  it('readonly → editable={false} + readonly removed', () => {
    const result = coerceInputProps({ readonly: '' }, 'input');
    expect(result['editable']).toBe('{false}');
    expect(result['readonly']).toBeUndefined();
  });

  it('non-input parent → same object reference (no-op)', () => {
    const attrs = { class: 'foo' };
    expect(coerceInputProps(attrs, 'div')).toBe(attrs);
  });
});

describe('primitives/sets', () => {
  it('RN_NATIVE_IMPORTS has View, Text, Pressable, TextInput, Image, StyleSheet, Platform', () => {
    expect(RN_NATIVE_IMPORTS.has('View')).toBe(true);
    expect(RN_NATIVE_IMPORTS.has('Text')).toBe(true);
    expect(RN_NATIVE_IMPORTS.has('Pressable')).toBe(true);
    expect(RN_NATIVE_IMPORTS.has('TextInput')).toBe(true);
    expect(RN_NATIVE_IMPORTS.has('Image')).toBe(true);
    expect(RN_NATIVE_IMPORTS.has('StyleSheet')).toBe(true);
    expect(RN_NATIVE_IMPORTS.has('Platform')).toBe(true);
  });
});

describe('emitReactNative/tag-emission', () => {
  it('div → <View>...</View>', () => {
    const out = emitReactNative(makeModule([letNode('MyComp', appNode('div', '', strLit('hello')))]));
    expect(out).toContain('<View>');
    expect(out).toContain('</View>');
    expect(out).toContain('"hello"');
  });

  it('button onclick=handlePress → onPress={handlePress}, no onclick', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', appNode('button', 'onclick=handlePress', strLit('Click me')))]),
    );
    expect(out).toContain('onPress={handlePress}');
    expect(out).not.toContain('onclick');
  });

  it('a href=url → <Pressable> with href comment, no href prop', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', appNode('a', 'href=url', strLit('link')))]),
    );
    expect(out).toContain('<Pressable');
    expect(out).toContain('{/* href=url (use onPress + navigation) */}');
    expect(out).not.toContain('href="');
    expect(out).not.toContain('href={');
  });

  it('class=container → comment child, no className prop', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', appNode('div', 'class=container', strLit('content')))]),
    );
    expect(out).toContain('{/* class=container (no-op on RN) */}');
    expect(out).not.toContain('className');
  });

  it('select in div → picker comment, no <Select', () => {
    const out = emitReactNative(
      makeModule([
        letNode(
          'MyComp',
          appNode('div', '', appNode('select', '', appNode('option', '', strLit('A')))),
        ),
      ]),
    );
    expect(out).toContain('{/* <select> not supported on RN — use @react-native-picker/picker */}');
    expect(out).not.toContain('<Select');
  });

  it('br in div → no <br, outer View emitted', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', appNode('div', '', appNode('br', '')))]),
    );
    expect(out).not.toContain('<br');
    expect(out).toContain('<View');
  });

  it('input type=password → secureTextEntry={true}, no type= or "password"', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', appNode('input', 'type=password'))]),
    );
    expect(out).toContain('secureTextEntry={true}');
    expect(out).not.toContain('type=');
    expect(out).not.toContain('password');
  });

  it('input type=email → keyboardType="email-address", no type=', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', appNode('input', 'type=email'))]),
    );
    expect(out).toContain('keyboardType="email-address"');
    expect(out).not.toContain('type=');
  });
});
