import { describe, it, expect } from 'vitest';
import { emitJS, emitJSWithSourceMap } from '../../skills/javascript/emit.js';
import type {
  IonIRModule,
  IonIRNode,
  LetNode,
  LiteralNode,
  AbsNode,
  AppNode,
  CaseNode,
  CaseArm,
  AccessorNode,
  OopClassNode,
  OopNewNode,
  OopVirtualCallNode,
  OopThisNode,
  AsyncBlockNode,
  AwaitNode,
  AdtDeclNode,
  AdtMatchNode,
  ForeignRefNode,
  VarNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import type { SymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const S: Span = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const sym = (s: string): SymbolId => s as SymbolId;

const INT: IonType = { kind: 'Int' };
const STR: IonType = { kind: 'Str' };
const BOOL: IonType = { kind: 'Bool' };
const FN1: IonType = { kind: 'Fn', params: [INT], ret: INT, effects: new Set() };

function makeVar(name: string, type: IonType = INT): VarNode {
  return { kind: 'Var', name, symbolId: sym(name), span: S, type };
}

function makeLiteralInt(n: number): LiteralNode {
  return { kind: 'Literal', value: { kind: 'Int', value: n }, span: S, type: INT };
}

function makeLiteralStr(s: string): LiteralNode {
  return { kind: 'Literal', value: { kind: 'Str', value: s }, span: S, type: STR };
}

function makeLet(name: string, value: IonIRNode): LetNode {
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

function makeModule(decls: readonly IonIRNode[], data: readonly AdtDeclNode[] = []): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test',
    version: '0.1.0',
    dialects: ['core'],
    imports: [],
    data,
    decls,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitJS', () => {
  it('emits Literal Int', () => {
    const mod = makeModule([makeLet('x', makeLiteralInt(42))]);
    expect(emitJS(mod)).toContain('const x = 42;');
  });

  it('emits Literal Float', () => {
    const node: LiteralNode = { kind: 'Literal', value: { kind: 'Float', value: 3.14 }, span: S, type: { kind: 'Float' } };
    const mod = makeModule([makeLet('pi', node)]);
    expect(emitJS(mod)).toContain('const pi = 3.14;');
  });

  it('emits Literal Str with double quotes', () => {
    const mod = makeModule([makeLet('msg', makeLiteralStr('hello'))]);
    expect(emitJS(mod)).toContain('const msg = "hello";');
  });

  it('emits Literal Str with escaped characters', () => {
    const mod = makeModule([makeLet('s', makeLiteralStr('a"b\\c\nd'))]);
    expect(emitJS(mod)).toContain('"a\\"b\\\\c\\nd"');
  });

  it('emits Literal Bool true', () => {
    const node: LiteralNode = { kind: 'Literal', value: { kind: 'Bool', value: true }, span: S, type: BOOL };
    const mod = makeModule([makeLet('t', node)]);
    expect(emitJS(mod)).toContain('const t = true;');
  });

  it('emits Literal Null', () => {
    const node: LiteralNode = { kind: 'Literal', value: { kind: 'Null' }, span: S, type: { kind: 'Null' } };
    const mod = makeModule([makeLet('n', node)]);
    expect(emitJS(mod)).toContain('const n = null;');
  });

  it('emits Abs 1-param as arrow without parens', () => {
    const abs: AbsNode = {
      kind: 'Abs',
      params: [{ name: 'x', symbolId: sym('x'), type: INT, span: S }],
      body: makeVar('x'),
      captures: [],
      span: S,
      type: FN1,
    };
    const mod = makeModule([makeLet('id', abs)]);
    expect(emitJS(mod)).toContain('x => x');
  });

  it('emits Abs n-param as arrow with parens', () => {
    const abs: AbsNode = {
      kind: 'Abs',
      params: [
        { name: 'a', symbolId: sym('a'), type: INT, span: S },
        { name: 'b', symbolId: sym('b'), type: INT, span: S },
      ],
      body: makeVar('a'),
      captures: [],
      span: S,
      type: { kind: 'Fn', params: [INT, INT], ret: INT, effects: new Set() },
    };
    const mod = makeModule([makeLet('f', abs)]);
    expect(emitJS(mod)).toContain('(a, b) => a');
  });

  it('emits Abs 0-param with parens', () => {
    const abs: AbsNode = {
      kind: 'Abs',
      params: [],
      body: makeLiteralInt(0),
      captures: [],
      span: S,
      type: { kind: 'Fn', params: [], ret: INT, effects: new Set() },
    };
    const mod = makeModule([makeLet('zero', abs)]);
    expect(emitJS(mod)).toContain('() => 0');
  });

  it('emits App as call expression', () => {
    const app: AppNode = {
      kind: 'App',
      callee: makeVar('f', FN1),
      args: [makeLiteralInt(1)],
      span: S,
      type: INT,
    };
    const mod = makeModule([makeLet('result', app)]);
    expect(emitJS(mod)).toContain('const result = f(1);');
  });

  it('wraps lambda callee in parens in App', () => {
    const abs: AbsNode = {
      kind: 'Abs',
      params: [{ name: 'x', symbolId: sym('x'), type: INT, span: S }],
      body: makeVar('x'),
      captures: [],
      span: S,
      type: FN1,
    };
    const app: AppNode = { kind: 'App', callee: abs, args: [makeLiteralInt(5)], span: S, type: INT };
    const mod = makeModule([makeLet('r', app)]);
    expect(emitJS(mod)).toContain('(x => x)(5)');
  });

  it('emits top-level Let as const declaration', () => {
    const mod = makeModule([makeLet('answer', makeLiteralInt(42))]);
    const out = emitJS(mod);
    expect(out).toContain('"use strict";');
    expect(out).toContain('const answer = 42;');
  });

  it('emits ForeignRef arity-1 as arrow lambda', () => {
    const ref: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'js',
      module: 'console',
      symbol: 'log',
      sig: { params: [STR], ret: { kind: 'Unit' }, template: 'console.log($1)' },
      span: S,
      type: FN1,
    };
    const mod = makeModule([makeLet('log', ref)]);
    expect(emitJS(mod)).toContain('_p1 => console.log(_p1)');
  });

  it('emits ForeignRef arity-2 as multi-param arrow', () => {
    const ref: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'js',
      module: 'array',
      symbol: 'push',
      sig: {
        params: [{ kind: 'List', elem: INT }, INT],
        ret: { kind: 'Unit' },
        template: '$1.push($2)',
      },
      span: S,
      type: { kind: 'Fn', params: [{ kind: 'List', elem: INT }, INT], ret: { kind: 'Unit' }, effects: new Set() },
    };
    const mod = makeModule([makeLet('push', ref)]);
    expect(emitJS(mod)).toContain('(_p1, _p2) => _p1.push(_p2)');
  });

  it('emits Case as if/else IIFE', () => {
    const trueBranch = makeLiteralStr('yes');
    const falseBranch = makeLiteralStr('no');
    const arm1: CaseArm = {
      pattern: { kind: 'Literal', value: { kind: 'Bool', value: true }, span: S },
      body: trueBranch,
      span: S,
    };
    const arm2: CaseArm = {
      pattern: { kind: 'Wildcard', span: S },
      body: falseBranch,
      span: S,
    };
    const caseNode: CaseNode = {
      kind: 'Case',
      scrutinee: makeVar('cond', BOOL),
      arms: [arm1, arm2],
      span: S,
      type: STR,
    };
    const mod = makeModule([makeLet('r', caseNode)]);
    const out = emitJS(mod);
    expect(out).toContain('if (cond === true)');
    expect(out).toContain('"yes"');
    expect(out).toContain('else');
    expect(out).toContain('"no"');
  });

  it('emits Case single-wildcard arm as plain body', () => {
    const caseNode: CaseNode = {
      kind: 'Case',
      scrutinee: makeVar('x'),
      arms: [{ pattern: { kind: 'Wildcard', span: S }, body: makeLiteralInt(99), span: S }],
      span: S,
      type: INT,
    };
    const mod = makeModule([makeLet('r', caseNode)]);
    // Should just emit the body, not wrap in IIFE
    expect(emitJS(mod)).toContain('const r = 99;');
  });

  it('emits Accessor as dot access', () => {
    const acc: AccessorNode = {
      kind: 'Accessor',
      receiver: makeVar('obj'),
      member: 'field',
      span: S,
      type: INT,
    };
    const mod = makeModule([makeLet('v', acc)]);
    expect(emitJS(mod)).toContain('const v = obj.field;');
  });

  it('emits OopClass with constructor and method', () => {
    const method = {
      name: 'area',
      symbolId: sym('area'),
      params: [] as [],
      retType: INT,
      body: makeVar('x', INT) as IonIRNode,
      isAbstract: false,
      isStatic: false,
      span: S,
    };
    const cls: OopClassNode = {
      kind: 'OopClass',
      name: 'Rect',
      symbolId: sym('Rect'),
      interfaces: [],
      fields: [
        { name: 'w', symbolId: sym('w'), type: INT, span: S },
        { name: 'h', symbolId: sym('h'), type: INT, span: S },
      ],
      methods: [method],
      span: S,
      type: { kind: 'User', name: 'Rect', symbolId: sym('Rect'), args: [] },
    };
    const mod = makeModule([cls]);
    const out = emitJS(mod);
    expect(out).toContain('class Rect {');
    expect(out).toContain('constructor(w, h)');
    expect(out).toContain('this.w = w;');
    expect(out).toContain('this.h = h;');
    expect(out).toContain('area()');
  });

  it('emits OopNew', () => {
    const newNode: OopNewNode = {
      kind: 'OopNew',
      ctorSymbolId: sym('Point'),
      args: [makeLiteralInt(1), makeLiteralInt(2)],
      span: S,
      type: { kind: 'User', name: 'Point', symbolId: sym('Point'), args: [] },
    };
    const mod = makeModule([makeLet('p', newNode)]);
    expect(emitJS(mod)).toContain('new Point(1, 2)');
  });

  it('emits OopVirtualCall', () => {
    const call: OopVirtualCallNode = {
      kind: 'OopVirtualCall',
      receiver: makeVar('obj'),
      method: 'greet',
      args: [makeLiteralStr('world')],
      span: S,
      type: STR,
    };
    const mod = makeModule([makeLet('r', call)]);
    expect(emitJS(mod)).toContain('obj.greet("world")');
  });

  it('emits OopThis', () => {
    const thisNode: OopThisNode = { kind: 'OopThis', span: S, type: { kind: 'User', name: 'Self', symbolId: sym('Self'), args: [] } };
    const acc: AccessorNode = { kind: 'Accessor', receiver: thisNode, member: 'value', span: S, type: INT };
    const mod = makeModule([makeLet('v', acc)]);
    expect(emitJS(mod)).toContain('this.value');
  });

  it('emits AsyncBlock and Await', () => {
    const awaitNode: AwaitNode = {
      kind: 'Await',
      expr: makeVar('promise'),
      span: S,
      type: INT,
    };
    const asyncBlock: AsyncBlockNode = {
      kind: 'AsyncBlock',
      body: awaitNode,
      span: S,
      type: { kind: 'Fn', params: [], ret: INT, effects: new Set(['async']) },
    };
    const mod = makeModule([makeLet('fn', asyncBlock)]);
    const out = emitJS(mod);
    expect(out).toContain('async () => {');
    expect(out).toContain('await promise');
  });

  it('emits AdtDecl as factory functions', () => {
    const adtDecl: AdtDeclNode = {
      kind: 'AdtDecl',
      name: 'Option',
      symbolId: sym('Option'),
      variants: [
        { tag: 'None', symbolId: sym('None'), fields: [], span: S },
        {
          tag: 'Some',
          symbolId: sym('Some'),
          fields: [{ name: 'value', symbolId: sym('value'), type: INT, span: S }],
          span: S,
        },
      ],
      span: S,
      type: { kind: 'User', name: 'Option', symbolId: sym('Option'), args: [] },
    };
    const mod = makeModule([], [adtDecl]);
    const out = emitJS(mod);
    expect(out).toContain('// ADT: Option');
    expect(out).toContain('const None = { _tag: "None" };');
    expect(out).toContain('const Some = (value) => ({ _tag: "Some", value });');
  });

  it('emits AdtMatch as switch on _tag', () => {
    const adtMatch: AdtMatchNode = {
      kind: 'AdtMatch',
      scrutinee: makeVar('opt'),
      arms: [
        {
          tag: 'None',
          bindings: [],
          body: makeLiteralInt(0),
          span: S,
        },
        {
          tag: 'Some',
          bindings: [{ name: 'value', symbolId: sym('value'), type: INT, span: S }],
          body: makeVar('value', INT),
          span: S,
        },
      ],
      span: S,
      type: INT,
    };
    const mod = makeModule([makeLet('r', adtMatch)]);
    const out = emitJS(mod);
    expect(out).toContain('switch (_s._tag)');
    expect(out).toContain('case "None"');
    expect(out).toContain('case "Some"');
    expect(out).toContain('const value = _s.value;');
  });

  it('emits a module with multiple decls in order', () => {
    const mod = makeModule([
      makeLet('a', makeLiteralInt(1)),
      makeLet('b', makeLiteralInt(2)),
      makeLet('c', makeLiteralInt(3)),
    ]);
    const out = emitJS(mod);
    const ia = out.indexOf('const a = 1;');
    const ib = out.indexOf('const b = 2;');
    const ic = out.indexOf('const c = 3;');
    expect(ia).toBeGreaterThan(-1);
    expect(ib).toBeGreaterThan(ia);
    expect(ic).toBeGreaterThan(ib);
  });

  it('emits use strict preamble at top of output', () => {
    const mod = makeModule([makeLet('x', makeLiteralInt(0))]);
    expect(emitJS(mod).startsWith('"use strict";\n')).toBe(true);
  });

  it('emits EffectPerform helper when Perform node is present', () => {
    const perform = {
      kind: 'Perform' as const,
      effectSymbolId: sym('IO'),
      operation: 'read',
      args: [],
      span: S,
      type: STR,
    };
    const mod = makeModule([makeLet('r', perform)]);
    const out = emitJS(mod);
    expect(out).toContain('class EffectPerform');
    expect(out).toContain('new EffectPerform("read"');
  });

  it('emits nested Let in expression context as IIFE', () => {
    const inner: LetNode = {
      kind: 'Let',
      name: 'tmp',
      symbolId: sym('tmp'),
      bindingType: INT,
      value: makeLiteralInt(10),
      body: makeVar('tmp'),
      span: S,
      type: INT,
    };
    const mod = makeModule([makeLet('r', inner)]);
    const out = emitJS(mod);
    expect(out).toContain('(() => {');
    expect(out).toContain('const tmp = 10;');
    expect(out).toContain('return tmp;');
  });
});

describe('emitJSWithSourceMap', () => {
  it('produces a non-empty map string that is valid ECMA v3 JSON', () => {
    const mod = makeModule([makeLet('x', makeLiteralInt(42))]);
    const { source, map } = emitJSWithSourceMap(mod, '/src/users.ion', 'let x = 42\n');
    expect(source).toContain('const x = 42;');
    expect(map.length).toBeGreaterThan(0);
    const parsed = JSON.parse(map);
    expect(parsed.version).toBe(3);
    expect(Array.isArray(parsed.sources)).toBe(true);
    expect(typeof parsed.mappings).toBe('string');
  });

  it('source output is identical to emitJS', () => {
    const mod = makeModule([
      makeLet('a', makeLiteralInt(1)),
      makeLet('b', makeLiteralInt(2)),
    ]);
    const plain = emitJS(mod);
    const { source } = emitJSWithSourceMap(mod, '/src/test.ion', '');
    expect(source).toBe(plain);
  });

  it('map has required ECMA v3 fields', () => {
    const mod = makeModule([makeLet('greeting', makeLiteralStr('hello'))]);
    const { map } = emitJSWithSourceMap(mod, '/src/greet.ion', 'let greeting = "hello"\n');
    const parsed = JSON.parse(map);
    expect(parsed.version).toBe(3);
    expect(Array.isArray(parsed.names)).toBe(true);
    expect(Array.isArray(parsed.sources)).toBe(true);
    expect(Array.isArray(parsed.sourcesContent)).toBe(true);
    expect(typeof parsed.mappings).toBe('string');
    expect(typeof parsed.file).toBe('string');
  });
});
