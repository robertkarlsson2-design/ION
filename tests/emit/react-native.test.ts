import { describe, it, expect } from 'vitest';
import { emitReactNative } from '../../emitters/react-native/emit.js';
import { emitTsExpr } from '../../emitters/ui-shared.js';
import type { IonIRModule, IonIRNode, AppNode } from '../../src/ir/nodes.js';
import { translateStyleObject } from '../../emitters/react-native/styles.js';
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

function typedVarNode(name: string, typeKind: 'Str' | 'Int' | 'Float' | 'Bool'): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: { kind: typeKind } };
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

function objLit(...kvPairs: IonIRNode[]): IonIRNode {
  return { kind: 'App', callee: varNode('__obj__'), args: kvPairs, span: SPAN, type: UNIT };
}

function appNodeWithProps(
  tag: string,
  attrStr: string,
  propDict: readonly { key: string; value: IonIRNode }[],
  ...children: IonIRNode[]
): IonIRNode {
  return { kind: 'App', callee: varNode(tag), args: [strLit(attrStr), ...children], propDict, span: SPAN, type: UNIT };
}

function accessorNode(receiver: string, member: string): IonIRNode {
  return { kind: 'App', callee: varNode('__optchain__'), args: [varNode(receiver), strLit(member)], span: SPAN, type: UNIT };
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

function appNodeWithPropDict(
  tag: string,
  attrStr: string,
  propDict: { key: string; value: IonIRNode }[],
  ...children: IonIRNode[]
): IonIRNode {
  return {
    kind: 'App',
    callee: varNode(tag),
    args: [strLit(attrStr), ...children],
    propDict,
    span: SPAN,
    type: UNIT,
  };
}

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

  it('attribute value with embedded double-quote → escaped in JSX prop', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', appNode('div', 'title=foo"bar'))]),
    );
    expect(out).toContain('title="foo\\"bar"');
  });
});

describe('translateStyleObject', () => {
  it('kebab key → camelCase', () => {
    const result = translateStyleObject(objLit(strLit('margin-top'), intLit(8)) as AppNode);
    const key = result.args[0]!;
    expect(key.kind).toBe('Literal');
    if (key.kind === 'Literal' && key.value.kind === 'Str') {
      expect(key.value.value).toBe('marginTop');
    }
  });

  it('"Npx" string value → Int', () => {
    const result = translateStyleObject(objLit(strLit('marginTop'), strLit('8px')) as AppNode);
    const val = result.args[1]!;
    expect(val.kind).toBe('Literal');
    if (val.kind === 'Literal') {
      expect(val.value.kind).toBe('Int');
      if (val.value.kind === 'Int') expect(val.value.value).toBe(8);
    }
  });

  it('already-camelCase key unchanged (same reference)', () => {
    const input = objLit(strLit('marginTop'), intLit(8)) as AppNode;
    const result = translateStyleObject(input);
    expect(result.args[0]).toBe(input.args[0]);
  });

  it('non-px string value unchanged', () => {
    const result = translateStyleObject(objLit(strLit('color'), strLit('red')) as AppNode);
    const val = result.args[1]!;
    expect(val.kind).toBe('Literal');
    if (val.kind === 'Literal' && val.value.kind === 'Str') {
      expect(val.value.value).toBe('red');
    }
  });

  it('two-pair pairing preserved', () => {
    const result = translateStyleObject(
      objLit(strLit('margin-top'), intLit(4), strLit('padding-bottom'), strLit('8px')) as AppNode,
    );
    expect(result.args.length).toBe(4);
    const k0 = result.args[0]!;
    const k2 = result.args[2]!;
    const v3 = result.args[3]!;
    if (k0.kind === 'Literal' && k0.value.kind === 'Str') expect(k0.value.value).toBe('marginTop');
    if (k2.kind === 'Literal' && k2.value.kind === 'Str') expect(k2.value.value).toBe('paddingBottom');
    if (v3.kind === 'Literal') {
      expect(v3.value.kind).toBe('Int');
      if (v3.value.kind === 'Int') expect(v3.value.value).toBe(8);
    }
  });
});

describe('emitReactNative/style-propDict', () => {
  it('kebab→camel emitted with comment', () => {
    const out = emitReactNative(makeModule([
      letNode('C', appNodeWithProps('div', '', [{ key: 'style', value: objLit(strLit('margin-top'), intLit(8)) }])),
    ]));
    expect(out).toContain('marginTop: 8');
    expect(out).toContain('kebab→camel for RN');
  });

  it('"Npx" coerced to int', () => {
    const out = emitReactNative(makeModule([
      letNode('C', appNodeWithProps('div', '', [{ key: 'style', value: objLit(strLit('marginTop'), strLit('8px')) }])),
    ]));
    expect(out).toContain('marginTop: 8');
    expect(out).not.toContain('"8px"');
  });

  it('Var passthrough', () => {
    const out = emitReactNative(makeModule([
      letNode('C', appNodeWithProps('div', '', [{ key: 'style', value: varNode('myStyles') }])),
    ]));
    expect(out).toContain('style={myStyles}');
  });

  it('Accessor passthrough', () => {
    const out = emitReactNative(makeModule([
      letNode('C', appNodeWithProps('div', '', [{ key: 'style', value: accessorNode('styles', 'card') }])),
    ]));
    expect(out).toContain('style={styles?.card}');
  });

  it('already-camelCase: no kebab comment', () => {
    const out = emitReactNative(makeModule([
      letNode('C', appNodeWithProps('div', '', [{ key: 'style', value: objLit(strLit('color'), strLit('red')) }])),
    ]));
    expect(out).toContain('color: "red"');
    expect(out).not.toContain('kebab');
  });
});

describe('emitReactNative/bare-text-auto-wrap', () => {
  it('string literal in container (div/View) is wrapped in {JSON}', () => {
    const out = emitReactNative(makeModule([letNode('MyComp', appNode('div', '', strLit('hello')))]));
    expect(out).toContain('{"hello"}');
  });

  it('Int-typed Var in container (div/View) emits {name}, no double-wrap', () => {
    const out = emitReactNative(makeModule([letNode('MyComp', appNode('div', '', typedVarNode('count', 'Int')))]));
    expect(out).toContain('{count}');
    expect(out).not.toContain('{{count}}');
  });

  it('string literal in Text context (span/Text) emits bare text, no {JSON} wrapper', () => {
    const out = emitReactNative(makeModule([letNode('MyComp', appNode('span', '', strLit('hello world')))]));
    expect(out).toContain('hello world');
    expect(out).not.toContain('{"hello world"}');
  });

  it('Var in container emits {name} with no double-wrap', () => {
    const out = emitReactNative(makeModule([letNode('MyComp', appNode('div', '', varNode('foo')))]));
    expect(out).toContain('{foo}');
    expect(out).not.toContain('{{foo}}');
  });

  it('button → <Pressable> and string child is wrapped in {JSON}', () => {
    const out = emitReactNative(makeModule([letNode('MyComp', appNode('button', '', strLit('click')))]));
    expect(out).toContain('<Pressable');
    expect(out).toContain('{"click"}');
  });

  it('button with string child and nested View: string wrapped, View not wrapped', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', appNode('button', '', strLit('click'), appNode('div', '')))]),
    );
    expect(out).toContain('{"click"}');
    expect(out).toContain('<View');
    expect(out).not.toContain('{<View');
  });
});

describe('emitReactNative/Image source', () => {
  it('remote URL src → source={{ uri: "..." }}', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', absNode([], appNode('img', 'src=https://example.com/photo.jpg')))]),
    );
    expect(out).toContain('source={{ uri: "https://example.com/photo.jpg" }}');
    expect(out).toContain('<Image');
    expect(out).not.toContain('src=');
    expect(out).toContain("import { View, Text, Image } from 'react-native'");
  });

  it('data: URI → source={{ uri: "data:..." }}', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', absNode([], appNode('img', 'src=data:image/png;base64,abc123==')))]),
    );
    expect(out).toContain('source={{ uri: "data:image/png;base64,abc123==" }}');
    expect(out).not.toContain('src=');
  });

  it('require: prefix → source={require("./path")}', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', absNode([], appNode('img', 'src=require:./assets/logo.png')))]),
    );
    expect(out).toContain('source={require("./assets/logo.png")}');
    expect(out).not.toContain('src=');
    expect(out).not.toContain('uri:');
  });

  it('missing src → <Image with missing-src comment', () => {
    const out = emitReactNative(
      makeModule([letNode('MyComp', absNode([], appNode('img', '')))]),
    );
    expect(out).toContain('<Image');
    expect(out).toContain('{/* missing src on <Image> */}');
    expect(out).not.toContain('source=');
  });

  it('propDict source passthrough → source={imgSrc}', () => {
    const imgWithSource = appNodeWithPropDict('img', '', [{ key: 'source', value: varNode('imgSrc') }]);
    const out = emitReactNative(
      makeModule([letNode('MyComp', absNode([], imgWithSource))]),
    );
    expect(out).toContain('source={imgSrc}');
    expect(out).not.toContain('uri:');
    expect(out).not.toContain('require(');
  });
});

describe('emitReactNative/AppRegistry', () => {
  it('default entry "App" → AppRegistry.registerComponent emitted', () => {
    const out = emitReactNative(
      makeModule([letNode('App', absNode([], appNode('div', '', strLit('Hello'))))]),
    );
    expect(out).toContain("AppRegistry.registerComponent('App', () => App)");
    expect(out).toContain("AppRegistry");
    expect(out).toContain("import { View, Text, AppRegistry } from 'react-native'");
  });

  it('entryComponent: null → AppRegistry suppressed', () => {
    const out = emitReactNative(
      makeModule([letNode('App', absNode([], appNode('div', '', strLit('Hello'))))]),
      { reactNative: { entryComponent: null } },
    );
    expect(out).not.toContain('AppRegistry');
  });

  it('custom entryComponent name → registerComponent uses that name', () => {
    const out = emitReactNative(
      makeModule([letNode('Root', absNode([], appNode('div', '', strLit('Hello'))))]),
      { reactNative: { entryComponent: 'Root' } },
    );
    expect(out).toContain("AppRegistry.registerComponent('Root', () => Root)");
    expect(out).not.toContain("'App'");
  });

  it('non-JSX let App = 42 → no AppRegistry', () => {
    const out = emitReactNative(makeModule([letNode('App', intLit(42))]));
    expect(out).not.toContain('AppRegistry');
  });
});

describe('emitReactNative/style-hoisting', () => {
  // Case 1: 3 identical styles at default threshold=3 → hoisted as s1
  it('3 identical styles at default threshold → hoisted, StyleSheet.create emitted', () => {
    const styleObj = objLit(strLit('marginTop'), intLit(8));
    const comp = absNode([], appNode('div', '',
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
    ));
    const out = emitReactNative(makeModule([letNode('App', comp)]));
    expect(out.match(/style=\{styles\.s1\}/g)?.length).toBe(3);
    expect(out).toContain('StyleSheet.create(');
    expect(out).toContain('s1: { marginTop: 8 }');
    expect(out).toContain('StyleSheet');
  });

  // Case 2: 2 identical styles below default threshold=3 → inline, no StyleSheet
  it('2 identical styles below default threshold → inline, no StyleSheet.create', () => {
    const styleObj = objLit(strLit('marginTop'), intLit(8));
    const comp = absNode([], appNode('div', '',
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
    ));
    const out = emitReactNative(makeModule([letNode('App', comp)]));
    expect(out).not.toContain('StyleSheet.create(');
    expect(out).toContain('style={{ marginTop: 8 }}');
  });

  // Case 3: styleA ×2 + styleB ×1 → neither reaches threshold, both inline
  it('two different styles neither reaching threshold → both inline', () => {
    const styleA = objLit(strLit('marginTop'), intLit(8));
    const styleB = objLit(strLit('padding'), intLit(4));
    const comp = absNode([], appNode('div', '',
      appNodeWithProps('div', '', [{ key: 'style', value: styleA }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleA }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleB }]),
    ));
    const out = emitReactNative(makeModule([letNode('App', comp)]));
    expect(out).not.toContain('StyleSheet.create(');
    expect(out).toContain('style={{ marginTop: 8 }}');
    expect(out).toContain('style={{ padding: 4 }}');
  });

  // Case 4: 2 identical styles + styleHoistThreshold: 2 → hoisted
  it('2 identical styles with threshold=2 → hoisted', () => {
    const styleObj = objLit(strLit('color'), strLit('red'));
    const comp = absNode([], appNode('div', '',
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
    ));
    const out = emitReactNative(
      makeModule([letNode('App', comp)]),
      { reactNative: { styleHoistThreshold: 2 } },
    );
    expect(out).toContain('style={styles.s1}');
    expect(out).toContain('s1: { color: "red" }');
    expect(out).toContain('StyleSheet.create(');
  });

  // Case 5: confirms default threshold=3: styleA ×3 hoisted, styleB ×2 inline
  it('default threshold is 3: 3 occurrences hoisted, 2 occurrences inline', () => {
    const styleA = objLit(strLit('marginTop'), intLit(16));
    const styleB = objLit(strLit('padding'), intLit(4));
    const comp = absNode([], appNode('div', '',
      appNodeWithProps('div', '', [{ key: 'style', value: styleA }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleA }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleA }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleB }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleB }]),
    ));
    const out = emitReactNative(makeModule([letNode('App', comp)]));
    expect(out).toContain('StyleSheet.create(');
    expect(out).toContain('s1: { marginTop: 16 }');
    expect(out.match(/style=\{styles\.s1\}/g)?.length).toBe(3);
    expect(out).toContain('style={{ padding: 4 }}');
    expect(out).not.toContain('s2:');
  });

  // Case 6: style with Var value (non-literal) × 3 → not hoistable, rendered inline
  it('style with Var value × 3 → not hoisted (non-literal value)', () => {
    const styleObj = objLit(strLit('color'), varNode('theme'));
    const comp = absNode([], appNode('div', '',
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
    ));
    const out = emitReactNative(makeModule([letNode('App', comp)]));
    expect(out).not.toContain('StyleSheet.create(');
    expect(out).toContain('style={{ color: theme }}');
  });

  // Case 7: occurrences inside __platform__ subtree are not counted
  it('style inside __platform__ subtree not counted: 2 inside + 1 outside → not hoisted', () => {
    const styleObj = objLit(strLit('marginTop'), intLit(8));
    const platformSubtree = platformApp('__platform__',
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
    );
    const comp = absNode([], appNode('div', '',
      platformSubtree,
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
    ));
    const out = emitReactNative(makeModule([letNode('App', comp)]));
    expect(out).not.toContain('StyleSheet.create(');
  });

  // Case 8: 5 identical styles with MAX_SAFE_INTEGER threshold → no hoisting
  it('5 identical styles with MAX_SAFE_INTEGER threshold → inline, no StyleSheet.create', () => {
    const styleObj = objLit(strLit('marginTop'), intLit(8));
    const comp = absNode([], appNode('div', '',
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
      appNodeWithProps('div', '', [{ key: 'style', value: styleObj }]),
    ));
    const out = emitReactNative(
      makeModule([letNode('App', comp)]),
      { reactNative: { styleHoistThreshold: Number.MAX_SAFE_INTEGER } },
    );
    expect(out).not.toContain('StyleSheet.create(');
    expect(out).toContain('style={{ marginTop: 8 }}');
  });
});
