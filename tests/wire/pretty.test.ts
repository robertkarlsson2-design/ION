import { describe, it, expect } from 'vitest';
import { prettyPrintType, prettyPrintNode, prettyPrintModule } from '../../src/wire/pretty.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode, IonIRDialect } from '../../src/ir/nodes.js';
import type { IonType, EffectSet } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import type { EffectTag } from '../../src/ast/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const sid = makeSymbolId('test:x:0');
const sid2 = makeSymbolId('test:y:1');
const intType: IonType = { kind: 'Int' };
const strType: IonType = { kind: 'Str' };
const boolType: IonType = { kind: 'Bool' };
const unitType: IonType = { kind: 'Unit' };

// ---------------------------------------------------------------------------
// Suite A — Type printer
// ---------------------------------------------------------------------------

describe('prettyPrintType — primitives', () => {
  it('Int', () => expect(prettyPrintType({ kind: 'Int' })).toBe('Int'));
  it('Float', () => expect(prettyPrintType({ kind: 'Float' })).toBe('Float'));
  it('Str', () => expect(prettyPrintType({ kind: 'Str' })).toBe('Str'));
  it('Bool', () => expect(prettyPrintType({ kind: 'Bool' })).toBe('Bool'));
  it('Null', () => expect(prettyPrintType({ kind: 'Null' })).toBe('Null'));
  it('Unit', () => expect(prettyPrintType({ kind: 'Unit' })).toBe('Unit'));
  it('Never', () => expect(prettyPrintType({ kind: 'Never' })).toBe('Never'));
  it('TypeVar', () => expect(prettyPrintType({ kind: 'TypeVar', id: 'a' })).toBe("'a"));
});

describe('prettyPrintType — compound types', () => {
  it('List<Int>', () => expect(prettyPrintType({ kind: 'List', elem: intType })).toBe('[Int]'));
  it('Option<Bool>', () => expect(prettyPrintType({ kind: 'Option', inner: boolType })).toBe('Bool?'));
  it('Map<Str, Int>', () => expect(prettyPrintType({ kind: 'Map', key: strType, value: intType })).toBe('{Str: Int}'));
  it('Result<Int, Str>', () => expect(prettyPrintType({ kind: 'Result', ok: intType, err: strType })).toBe('Result<Int, Str>'));

  it('Fn pure', () => {
    const t: IonType = { kind: 'Fn', params: [intType], ret: intType, effects: new Set<EffectTag>() };
    expect(prettyPrintType(t)).toBe('(Int) -> Int');
  });

  it('Fn with effects (sorted)', () => {
    const effects: EffectSet = new Set<EffectTag>(['io', 'async']);
    const t: IonType = { kind: 'Fn', params: [intType], ret: unitType, effects };
    expect(prettyPrintType(t)).toBe('(Int) -[async, io]-> Unit');
  });

  it('Fn with no params', () => {
    const t: IonType = { kind: 'Fn', params: [], ret: intType, effects: new Set<EffectTag>() };
    expect(prettyPrintType(t)).toBe('() -> Int');
  });

  it('User type no args', () => {
    const t: IonType = { kind: 'User', name: 'Foo', symbolId: sid, args: [] };
    expect(prettyPrintType(t)).toBe('Foo');
  });

  it('User type with args', () => {
    const t: IonType = { kind: 'User', name: 'Either', symbolId: sid, args: [intType, strType] };
    expect(prettyPrintType(t)).toBe('Either<Int, Str>');
  });

  it('nested List<Option<Int>>', () => {
    const t: IonType = { kind: 'List', elem: { kind: 'Option', inner: intType } };
    expect(prettyPrintType(t)).toBe('[Int?]');
  });
});

// ---------------------------------------------------------------------------
// Suite B — Leaf node printers
// ---------------------------------------------------------------------------

describe('prettyPrintNode — leaf nodes', () => {
  it('Var', () => {
    const node: IonIRNode = { kind: 'Var', name: 'myVar', symbolId: sid, span, type: intType };
    expect(prettyPrintNode(node)).toBe('myVar');
  });

  it('Literal Int', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Int', value: 42 }, span, type: intType };
    expect(prettyPrintNode(node)).toBe('42');
  });

  it('Literal Float', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Float', value: 3.14 }, span, type: { kind: 'Float' } };
    expect(prettyPrintNode(node)).toBe('3.14');
  });

  it('Literal Float integer value 1.0', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Float', value: 1.0 }, span, type: { kind: 'Float' } };
    expect(prettyPrintNode(node)).toBe('1.0');
  });

  it('Literal Float negative integer value -3.0', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Float', value: -3.0 }, span, type: { kind: 'Float' } };
    expect(prettyPrintNode(node)).toBe('-3.0');
  });

  it('Literal Float non-integer still works', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Float', value: 0.5 }, span, type: { kind: 'Float' } };
    expect(prettyPrintNode(node)).toBe('0.5');
  });

  it('Literal Str with escapes', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Str', value: 'he said "hi"\nbye' }, span, type: strType };
    expect(prettyPrintNode(node)).toBe('"he said \\"hi\\"\\nbye"');
  });

  it('Literal Bool true', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Bool', value: true }, span, type: boolType };
    expect(prettyPrintNode(node)).toBe('true');
  });

  it('Literal Bool false', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Bool', value: false }, span, type: boolType };
    expect(prettyPrintNode(node)).toBe('false');
  });

  it('Literal Null', () => {
    const node: IonIRNode = { kind: 'Literal', value: { kind: 'Null' }, span, type: { kind: 'Null' } };
    expect(prettyPrintNode(node)).toBe('null');
  });

  it('OopThis', () => {
    const node: IonIRNode = { kind: 'OopThis', span, type: intType };
    expect(prettyPrintNode(node)).toBe('this');
  });

  it('ModuleRef single segment', () => {
    const node: IonIRNode = { kind: 'ModuleRef', modulePath: ['org', 'example', 'utils'], symbolId: sid, span, type: unitType };
    expect(prettyPrintNode(node)).toBe('org.example.utils');
  });

  it('ForeignRef', () => {
    const sig = { params: [intType], ret: intType, template: '$1' };
    const node: IonIRNode = { kind: 'ForeignRef', target: 'console.log', module: 'node:console', symbol: 'log', sig, span, type: intType };
    expect(prettyPrintNode(node)).toBe('@foreign("node:console::log")');
  });

  it('ForeignRef — double-quote in module name', () => {
    const sig = { params: [], ret: intType, template: '$1' };
    const node: IonIRNode = { kind: 'ForeignRef', target: 'log', module: 'std::"foo"bar', symbol: 'log', sig, span, type: intType };
    expect(prettyPrintNode(node)).toBe('@foreign("std::\\"foo\\"bar::log")');
  });

  it('ForeignRef — double-quote in symbol name', () => {
    const sig = { params: [], ret: intType, template: '$1' };
    const node: IonIRNode = { kind: 'ForeignRef', target: 'say"hi"', module: 'node:console', symbol: 'say"hi"', sig, span, type: intType };
    expect(prettyPrintNode(node)).toBe('@foreign("node:console::say\\"hi\\"")');
  });

  it('ForeignRef — backslash in module name', () => {
    const sig = { params: [], ret: intType, template: '$1' };
    const node: IonIRNode = { kind: 'ForeignRef', target: 'fn', module: 'path\\to\\mod', symbol: 'fn', sig, span, type: intType };
    expect(prettyPrintNode(node)).toBe('@foreign("path\\\\to\\\\mod::fn")');
  });
});

// ---------------------------------------------------------------------------
// Suite C — Structural node printers
// ---------------------------------------------------------------------------

describe('prettyPrintNode — structural nodes', () => {
  const xVar: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
  const yVar: IonIRNode = { kind: 'Var', name: 'y', symbolId: sid2, span, type: intType };

  it('App with no args', () => {
    const node: IonIRNode = { kind: 'App', callee: xVar, args: [], span, type: unitType };
    expect(prettyPrintNode(node)).toBe('x()');
  });

  it('App with multiple args', () => {
    const node: IonIRNode = { kind: 'App', callee: xVar, args: [yVar, xVar], span, type: intType };
    expect(prettyPrintNode(node)).toBe('x(y, x)');
  });

  it('Abs with params and return type', () => {
    const fnType: IonType = { kind: 'Fn', params: [intType], ret: intType, effects: new Set<EffectTag>() };
    const node: IonIRNode = {
      kind: 'Abs',
      params: [{ name: 'x', symbolId: sid, type: intType, span }],
      body: xVar,
      captures: [],
      span,
      type: fnType,
    };
    expect(prettyPrintNode(node)).toBe('fn(x: Int): Int => x');
  });

  it('Abs with non-Fn node type falls back gracefully', () => {
    const node: IonIRNode = {
      kind: 'Abs',
      params: [],
      body: xVar,
      captures: [],
      span,
      type: intType,
    };
    expect(prettyPrintNode(node)).toBe('fn(): Int => x');
  });

  it('Let nested chain', () => {
    const inner: IonIRNode = { kind: 'Var', name: 'z', symbolId: sid, span, type: intType };
    const node: IonIRNode = {
      kind: 'Let',
      name: 'a',
      symbolId: sid,
      bindingType: intType,
      value: xVar,
      body: {
        kind: 'Let',
        name: 'b',
        symbolId: sid2,
        bindingType: strType,
        value: inner,
        body: xVar,
        span,
        type: intType,
      },
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('let a: Int = x');
    expect(result).toContain('let b: Str = z');
  });

  it('Constructor with no args', () => {
    const node: IonIRNode = { kind: 'Constructor', ctorName: 'None', symbolId: sid, args: [], span, type: intType };
    expect(prettyPrintNode(node)).toBe('None');
  });

  it('Constructor with args', () => {
    const node: IonIRNode = { kind: 'Constructor', ctorName: 'Some', symbolId: sid, args: [xVar], span, type: intType };
    expect(prettyPrintNode(node)).toBe('Some(x)');
  });

  it('Accessor', () => {
    const node: IonIRNode = { kind: 'Accessor', receiver: xVar, member: 'length', span, type: intType };
    expect(prettyPrintNode(node)).toBe('x.length');
  });

  it('Case with Wildcard pattern', () => {
    const node: IonIRNode = {
      kind: 'Case',
      scrutinee: xVar,
      arms: [
        { pattern: { kind: 'Wildcard', span }, body: yVar, span },
      ],
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('case x {');
    expect(result).toContain('_ => y');
  });

  it('Case with guard', () => {
    const guardNode: IonIRNode = { kind: 'Literal', value: { kind: 'Bool', value: true }, span, type: boolType };
    const node: IonIRNode = {
      kind: 'Case',
      scrutinee: xVar,
      arms: [
        { pattern: { kind: 'Var', name: 'v', symbolId: sid, span }, guard: guardNode, body: yVar, span },
      ],
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('v if true => y');
  });

  it('Case with Constructor pattern', () => {
    const node: IonIRNode = {
      kind: 'Case',
      scrutinee: xVar,
      arms: [
        {
          pattern: {
            kind: 'Constructor',
            ctorName: 'Some',
            symbolId: sid,
            fields: [{ kind: 'Var', name: 'inner', symbolId: sid2, span }],
            span,
          },
          body: yVar,
          span,
        },
      ],
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('Some(inner) => y');
  });

  it('Case with Literal pattern', () => {
    const node: IonIRNode = {
      kind: 'Case',
      scrutinee: xVar,
      arms: [
        {
          pattern: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span },
          body: yVar,
          span,
        },
      ],
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('0 => y');
  });

  it('Case with Float Literal pattern integer value', () => {
    const node: IonIRNode = {
      kind: 'Case',
      scrutinee: xVar,
      arms: [
        {
          pattern: { kind: 'Literal', value: { kind: 'Float', value: 2.0 }, span },
          body: yVar,
          span,
        },
      ],
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('2.0 => y');
  });

  it('Effect node', () => {
    const node: IonIRNode = { kind: 'Effect', effectTag: 'io', body: xVar, span, type: unitType };
    const result = prettyPrintNode(node);
    expect(result).toContain('@effect(io) {');
    expect(result).toContain('x');
  });
});

// ---------------------------------------------------------------------------
// Suite D — Dialect nodes
// ---------------------------------------------------------------------------

describe('prettyPrintNode — ADT dialect', () => {
  const xVar: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };

  it('AdtDecl empty', () => {
    const node: IonIRNode = {
      kind: 'AdtDecl',
      name: 'Empty',
      symbolId: sid,
      variants: [],
      span,
      type: unitType,
    };
    expect(prettyPrintNode(node)).toBe('data Empty {}');
  });

  it('AdtDecl single variant no fields', () => {
    const node: IonIRNode = {
      kind: 'AdtDecl',
      name: 'Unit',
      symbolId: sid,
      variants: [{ tag: 'Only', symbolId: sid, fields: [], span }],
      span,
      type: unitType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('data Unit {');
    expect(result).toContain('Only');
  });

  it('AdtDecl multiple variants with fields', () => {
    const node: IonIRNode = {
      kind: 'AdtDecl',
      name: 'Maybe',
      symbolId: sid,
      variants: [
        { tag: 'Some', symbolId: sid, fields: [{ name: 'value', symbolId: sid2, type: intType, span }], span },
        { tag: 'None', symbolId: sid2, fields: [], span },
      ],
      span,
      type: unitType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('data Maybe {');
    expect(result).toContain('Some(value: Int)');
    expect(result).toContain('| None');
  });

  it('AdtMatch with bindings', () => {
    const node: IonIRNode = {
      kind: 'AdtMatch',
      scrutinee: xVar,
      arms: [
        { tag: 'Some', bindings: [{ name: 'v', symbolId: sid, type: intType, span }], body: xVar, span },
        { tag: 'None', bindings: [], body: xVar, span },
      ],
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('match x {');
    expect(result).toContain('Some(v) => x');
    expect(result).toContain('None => x');
  });
});

describe('prettyPrintNode — OOP dialect', () => {
  const xVar: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };

  it('OopClass empty', () => {
    const node: IonIRNode = {
      kind: 'OopClass',
      name: 'Empty',
      symbolId: sid,
      interfaces: [],
      fields: [],
      methods: [],
      span,
      type: unitType,
    };
    expect(prettyPrintNode(node)).toBe('class Empty {}');
  });

  it('OopClass with superClass and interface', () => {
    const node: IonIRNode = {
      kind: 'OopClass',
      name: 'Dog',
      symbolId: sid,
      superClass: makeSymbolId('Animal'),
      interfaces: [makeSymbolId('Runnable')],
      fields: [{ name: 'name', symbolId: sid, type: strType, span }],
      methods: [],
      span,
      type: unitType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('class Dog extends Animal: Runnable {');
    expect(result).toContain('name: Str');
  });

  it('OopClass with abstract and concrete methods', () => {
    const node: IonIRNode = {
      kind: 'OopClass',
      name: 'Base',
      symbolId: sid,
      interfaces: [],
      fields: [],
      methods: [
        {
          name: 'abstractFn',
          symbolId: sid,
          params: [],
          retType: intType,
          isAbstract: true,
          isStatic: false,
          span,
        },
        {
          name: 'concreteFn',
          symbolId: sid2,
          params: [{ name: 'x', symbolId: sid, type: intType, span }],
          retType: intType,
          body: xVar,
          isAbstract: false,
          isStatic: false,
          span,
        },
      ],
      span,
      type: unitType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('fn abstractFn(): Int');
    expect(result).toContain('fn concreteFn(x: Int): Int {');
    expect(result).toContain('x');
  });

  it('OopInterface', () => {
    const node: IonIRNode = {
      kind: 'OopInterface',
      name: 'Printable',
      symbolId: sid,
      members: [{ name: 'label', symbolId: sid, type: strType, span }],
      span,
      type: unitType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('interface Printable {');
    expect(result).toContain('label: Str');
  });

  it('OopInterface empty', () => {
    const node: IonIRNode = {
      kind: 'OopInterface',
      name: 'Marker',
      symbolId: sid,
      members: [],
      span,
      type: unitType,
    };
    expect(prettyPrintNode(node)).toBe('interface Marker {}');
  });

  it('OopNew', () => {
    const ctorId = makeSymbolId('Dog:ctor:0');
    const node: IonIRNode = {
      kind: 'OopNew',
      ctorSymbolId: ctorId,
      args: [xVar],
      span,
      type: intType,
    };
    expect(prettyPrintNode(node)).toBe(`new ${ctorId}(x)`);
  });

  it('OopVirtualCall', () => {
    const node: IonIRNode = {
      kind: 'OopVirtualCall',
      receiver: xVar,
      method: 'bark',
      args: [xVar],
      span,
      type: unitType,
    };
    expect(prettyPrintNode(node)).toBe('x.bark(x)');
  });
});

describe('prettyPrintNode — async dialect', () => {
  const xVar: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };

  it('AsyncBlock', () => {
    const node: IonIRNode = { kind: 'AsyncBlock', body: xVar, span, type: intType };
    const result = prettyPrintNode(node);
    expect(result).toContain('async {');
    expect(result).toContain('x');
  });

  it('Await', () => {
    const node: IonIRNode = { kind: 'Await', expr: xVar, span, type: intType };
    expect(prettyPrintNode(node)).toBe('await x');
  });
});

describe('prettyPrintNode — effects dialect', () => {
  const xVar: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };

  it('EffectDecl empty', () => {
    const node: IonIRNode = {
      kind: 'EffectDecl',
      name: 'Log',
      symbolId: sid,
      operations: [],
      span,
      type: unitType,
    };
    expect(prettyPrintNode(node)).toBe('effect Log {}');
  });

  it('EffectDecl with operations', () => {
    const node: IonIRNode = {
      kind: 'EffectDecl',
      name: 'State',
      symbolId: sid,
      operations: [
        { name: 'get', params: [], retType: intType, span },
        { name: 'set', params: [{ name: 'v', symbolId: sid, type: intType, span }], retType: unitType, span },
      ],
      span,
      type: unitType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('effect State {');
    expect(result).toContain('get(): Int');
    expect(result).toContain('set(v: Int): Unit');
  });

  it('Perform', () => {
    const effectId = makeSymbolId('State:0');
    const node: IonIRNode = {
      kind: 'Perform',
      effectSymbolId: effectId,
      operation: 'get',
      args: [],
      span,
      type: intType,
    };
    expect(prettyPrintNode(node)).toBe(`perform ${effectId}.get()`);
  });

  it('Handle without returnClause', () => {
    const node: IonIRNode = {
      kind: 'Handle',
      body: xVar,
      handlers: [
        {
          operation: 'get',
          params: [],
          body: xVar,
          span,
        },
      ],
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('handle {');
    expect(result).toContain('with {');
    expect(result).toContain('get() => x');
    expect(result).not.toContain('return =>');
  });

  it('Handle with returnClause', () => {
    const retNode: IonIRNode = { kind: 'Var', name: 'r', symbolId: sid2, span, type: intType };
    const node: IonIRNode = {
      kind: 'Handle',
      body: xVar,
      handlers: [],
      returnClause: retNode,
      span,
      type: intType,
    };
    const result = prettyPrintNode(node);
    expect(result).toContain('return => r');
  });

  it('Resume', () => {
    const node: IonIRNode = { kind: 'Resume', value: xVar, span, type: unitType };
    expect(prettyPrintNode(node)).toBe('resume(x)');
  });
});

// ---------------------------------------------------------------------------
// Suite E — Module printer
// ---------------------------------------------------------------------------

describe('prettyPrintModule', () => {
  const xVar: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };

  it('minimal module', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [xVar],
    };
    const result = prettyPrintModule(mod);
    expect(result).toContain('module org.example  "0.1.0"');
    expect(result).toContain('// dialects: core');
    expect(result).toContain('x');
  });

  it('module with imports', () => {
    const importNode = {
      kind: 'ModuleRef' as const,
      modulePath: ['org', 'example', 'utils'],
      symbolId: sid,
      span,
      type: unitType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.app',
      version: '1.0.0',
      dialects: ['core'],
      imports: [importNode],
      data: [],
      decls: [],
    };
    const result = prettyPrintModule(mod);
    expect(result).toContain('import org.example.utils');
  });

  it('module with data declarations', () => {
    const adtDecl = {
      kind: 'AdtDecl' as const,
      name: 'Color',
      symbolId: sid,
      variants: [
        { tag: 'Red', symbolId: sid, fields: [], span },
        { tag: 'Green', symbolId: sid2, fields: [], span },
      ],
      span,
      type: unitType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.color',
      version: '0.1.0',
      dialects: ['core', 'ion-adt'],
      imports: [],
      data: [adtDecl],
      decls: [],
    };
    const result = prettyPrintModule(mod);
    expect(result).toContain('data Color {');
    expect(result).toContain('| Green');
  });

  it('module with top-level let chain unrolled', () => {
    const chain: IonIRNode = {
      kind: 'Let',
      name: 'a',
      symbolId: sid,
      bindingType: intType,
      value: xVar,
      body: {
        kind: 'Let',
        name: 'b',
        symbolId: sid2,
        bindingType: strType,
        value: xVar,
        body: xVar,
        span,
        type: intType,
      },
      span,
      type: intType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.lets',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [chain],
    };
    const result = prettyPrintModule(mod);
    const lines = result.split('\n');
    const letA = lines.findIndex(l => l.includes('let a: Int = x'));
    const letB = lines.findIndex(l => l.includes('let b: Str = x'));
    expect(letA).toBeGreaterThanOrEqual(0);
    expect(letB).toBeGreaterThan(letA);
  });

  it('sections separated by blank lines', () => {
    const importNode = {
      kind: 'ModuleRef' as const,
      modulePath: ['org', 'example', 'utils'],
      symbolId: sid,
      span,
      type: unitType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example',
      version: '0.1.0',
      dialects: ['core'],
      imports: [importNode],
      data: [],
      decls: [xVar],
    };
    const result = prettyPrintModule(mod);
    expect(result).toContain('\n\n');
  });
});

// ---------------------------------------------------------------------------
// Suite F — Determinism / idempotency
// ---------------------------------------------------------------------------

describe('determinism', () => {
  const xVar: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };

  it('prettyPrintModule is deterministic across two calls', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [xVar],
    };
    expect(prettyPrintModule(mod)).toBe(prettyPrintModule(mod));
  });

  it('effect sets sorted regardless of insertion order', () => {
    const effectsZA: EffectSet = new Set<EffectTag>(['zzz', 'aaa']);
    const effectsAZ: EffectSet = new Set<EffectTag>(['aaa', 'zzz']);
    const t1: IonType = { kind: 'Fn', params: [], ret: unitType, effects: effectsZA };
    const t2: IonType = { kind: 'Fn', params: [], ret: unitType, effects: effectsAZ };
    expect(prettyPrintType(t1)).toBe(prettyPrintType(t2));
    expect(prettyPrintType(t1)).toContain('-[aaa, zzz]->');
  });

  it('custom indentSize: 4 produces wider indentation', () => {
    const node: IonIRNode = {
      kind: 'Case',
      scrutinee: xVar,
      arms: [{ pattern: { kind: 'Wildcard', span }, body: xVar, span }],
      span,
      type: intType,
    };
    const default2 = prettyPrintNode(node);
    const wide4 = prettyPrintNode(node, 0, { indentSize: 4 });
    expect(wide4).toContain('    ');
    expect(default2).not.toContain('    ');
  });
});
