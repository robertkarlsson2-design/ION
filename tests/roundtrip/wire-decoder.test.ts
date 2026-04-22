import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encodeModule } from '../../src/wire/encoder.js';
import { decodeModule, WireDecodeError } from '../../src/wire/decoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode, IonIRDialect, AdtDeclNode } from '../../src/ir/nodes.js';
import type { IonType, EffectSet } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import type { EffectTag } from '../../src/ast/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const sid = makeSymbolId('mod:x:0');
const intType: IonType = { kind: 'Int' };
const strType: IonType = { kind: 'Str' };
const WIRE_SPAN: Span = { file: '<wire>', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const UNIT = { kind: 'Unit' as const };

function makeMinimal(name: string, version: string, dialects: IonIRDialect[]): IonIRModule {
  return { ionir: '1.0', module: name, version, dialects, imports: [], data: [], decls: [] };
}

function roundtrip(mod: IonIRModule): IonIRModule {
  return decodeModule(encodeModule(mod));
}

// ---------------------------------------------------------------------------
// Suite A — section-level unit tests
// ---------------------------------------------------------------------------

describe('wire decoder — section tests', () => {
  it('A1: minimal module (no sections) round-trips header fields', () => {
    const mod = makeMinimal('test', '1.0', ['core']);
    const decoded = roundtrip(mod);
    expect(decoded.ionir).toBe('1.0');
    expect(decoded.module).toBe('test');
    expect(decoded.version).toBe('1.0');
    expect(decoded.dialects).toEqual(['core']);
    expect(decoded.imports).toEqual([]);
    expect(decoded.data).toEqual([]);
    expect(decoded.decls).toEqual([]);
  });

  it('A2: multiple dialects are sorted in wire and decoded correctly', () => {
    const mod = makeMinimal('test', '1.0', ['core', 'ion-oop', 'ion-adt']);
    const decoded = roundtrip(mod);
    expect(decoded.dialects).toEqual(['core', 'ion-adt', 'ion-oop']);
  });

  it('A3: symbol pool aliases resolved back to original names', () => {
    const longName = 'getUserByIdFromDatabase';
    const varNode: IonIRNode = { kind: 'Var', name: longName, symbolId: sid, span, type: intType };
    const mod: IonIRModule = {
      ionir: '1.0', module: 'test', version: '1.0', dialects: ['core'],
      imports: [], data: [],
      decls: [varNode, varNode, varNode, varNode, varNode],
    };
    const decoded = roundtrip(mod);
    expect(decoded.decls.length).toBe(5);
    for (const decl of decoded.decls) {
      expect((decl as { name: string }).name).toBe(longName);
    }
  });

  it('A4: type pool aliases resolved correctly', () => {
    const complexType: IonType = { kind: 'Option', inner: { kind: 'List', elem: intType } };
    // Need enough occurrences to trigger type pooling
    const params = Array.from({ length: 10 }, () => ({ name: 'x', symbolId: sid, type: complexType, span }));
    const absNode: IonIRNode = { kind: 'Abs', params, body: { kind: 'Var', name: 'x', symbolId: sid, span, type: intType }, captures: [], span, type: intType };
    const mod: IonIRModule = { ionir: '1.0', module: 'test', version: '1.0', dialects: ['core'], imports: [], data: [], decls: [absNode] };
    const decoded = roundtrip(mod);
    const decodedAbs = decoded.decls[0];
    expect(decodedAbs?.kind).toBe('Abs');
    if (decodedAbs?.kind === 'Abs') {
      for (const p of decodedAbs.params) {
        expect(p.type).toEqual({ kind: 'Option', inner: { kind: 'List', elem: { kind: 'Int' } } });
      }
    }
  });

  it('A5: import section reconstructed', () => {
    const importSid = makeSymbolId('utils:0');
    const mod: IonIRModule = {
      ionir: '1.0', module: 'test', version: '1.0', dialects: ['core'],
      imports: [{ kind: 'ModuleRef', modulePath: ['org', 'example', 'utils'], symbolId: importSid, span, type: intType }],
      data: [], decls: [],
    };
    const decoded = roundtrip(mod);
    expect(decoded.imports).toHaveLength(1);
    expect(decoded.imports[0]?.modulePath).toEqual(['org', 'example', 'utils']);
    expect(decoded.imports[0]?.symbolId).toBe(importSid);
  });

  it('A6: data section with variants and typed fields reconstructed', () => {
    const adt: AdtDeclNode = {
      kind: 'AdtDecl', name: 'Maybe', symbolId: makeSymbolId('m:Maybe:0'),
      variants: [
        { tag: 'Some', symbolId: makeSymbolId('m:Some:0'), fields: [{ name: 'value', symbolId: sid, type: intType, span }], span },
        { tag: 'None', symbolId: makeSymbolId('m:None:0'), fields: [], span },
      ],
      span, type: intType,
    };
    const mod: IonIRModule = { ionir: '1.0', module: 'test', version: '1.0', dialects: ['core', 'ion-adt'], imports: [], data: [adt], decls: [] };
    const decoded = roundtrip(mod);
    expect(decoded.data).toHaveLength(1);
    const d = decoded.data[0]!;
    expect(d.name).toBe('Maybe');
    expect(d.variants).toHaveLength(2);
    expect(d.variants[0]?.tag).toBe('Some');
    expect(d.variants[0]?.fields[0]?.name).toBe('value');
    expect(d.variants[0]?.fields[0]?.type).toEqual({ kind: 'Int' });
    expect(d.variants[1]?.tag).toBe('None');
  });
});

// ---------------------------------------------------------------------------
// Suite B — node kind unit tests
// ---------------------------------------------------------------------------

describe('wire decoder — node kinds', () => {
  function decodeDecl(node: IonIRNode): IonIRNode {
    const mod: IonIRModule = { ionir: '1.0', module: 'test', version: '1.0', dialects: ['core', 'ion-oop', 'ion-async', 'ion-adt', 'ion-effects'], imports: [], data: [], decls: [node] };
    const decoded = roundtrip(mod);
    return decoded.decls[0]!;
  }

  it('B1: Var node', () => {
    const n = decodeDecl({ kind: 'Var', name: 'myVar', symbolId: sid, span, type: intType });
    expect(n.kind).toBe('Var');
    if (n.kind === 'Var') expect(n.name).toBe('myVar');
  });

  it('B2: Literal Int', () => {
    const n = decodeDecl({ kind: 'Literal', value: { kind: 'Int', value: 42 }, span, type: intType });
    expect(n.kind).toBe('Literal');
    if (n.kind === 'Literal') expect(n.value).toEqual({ kind: 'Int', value: 42 });
  });

  it('B3: Literal Float', () => {
    const n = decodeDecl({ kind: 'Literal', value: { kind: 'Float', value: 3.14 }, span, type: { kind: 'Float' } });
    expect(n.kind).toBe('Literal');
    if (n.kind === 'Literal') expect(n.value).toEqual({ kind: 'Float', value: 3.14 });
  });

  it('B4: Literal Str', () => {
    const n = decodeDecl({ kind: 'Literal', value: { kind: 'Str', value: 'hello world' }, span, type: strType });
    expect(n.kind).toBe('Literal');
    if (n.kind === 'Literal') expect(n.value).toEqual({ kind: 'Str', value: 'hello world' });
  });

  it('B5: Literal Bool true', () => {
    const n = decodeDecl({ kind: 'Literal', value: { kind: 'Bool', value: true }, span, type: { kind: 'Bool' } });
    if (n.kind === 'Literal') expect(n.value).toEqual({ kind: 'Bool', value: true });
  });

  it('B6: Literal Null', () => {
    const n = decodeDecl({ kind: 'Literal', value: { kind: 'Null' }, span, type: { kind: 'Null' } });
    if (n.kind === 'Literal') expect(n.value).toEqual({ kind: 'Null' });
  });

  it('B7: App', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'fn', symbolId: sid, span, type: intType };
    const argNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const n = decodeDecl({ kind: 'App', callee: varNode, args: [argNode], span, type: intType });
    expect(n.kind).toBe('App');
    if (n.kind === 'App') {
      expect(n.callee.kind).toBe('Var');
      expect(n.args).toHaveLength(1);
    }
  });

  it('B8: Abs with typed params', () => {
    const n = decodeDecl({
      kind: 'Abs',
      params: [{ name: 'p', symbolId: sid, type: strType, span }],
      body: { kind: 'Var', name: 'p', symbolId: sid, span, type: strType },
      captures: [],
      span, type: intType,
    });
    expect(n.kind).toBe('Abs');
    if (n.kind === 'Abs') {
      expect(n.params[0]?.name).toBe('p');
      expect(n.params[0]?.type).toEqual({ kind: 'Str' });
    }
  });

  it('B9: Let', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const n = decodeDecl({ kind: 'Let', name: 'y', symbolId: sid, bindingType: intType, value: varNode, body: varNode, span, type: intType });
    expect(n.kind).toBe('Let');
    if (n.kind === 'Let') expect(n.name).toBe('y');
  });

  it('B10: Case with Wildcard, Var, Constructor, Literal patterns', () => {
    const scrutinee: IonIRNode = { kind: 'Var', name: 'v', symbolId: sid, span, type: intType };
    const body: IonIRNode = { kind: 'Var', name: 'v', symbolId: sid, span, type: intType };
    const n = decodeDecl({
      kind: 'Case', scrutinee,
      arms: [
        { pattern: { kind: 'Wildcard', span }, body, span },
        { pattern: { kind: 'Var', name: 'v', symbolId: sid, span }, body, span },
        { pattern: { kind: 'Constructor', ctorName: 'Some', symbolId: sid, fields: [{ kind: 'Wildcard', span }], span }, body, span },
        { pattern: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span }, body, span },
      ],
      span, type: intType,
    });
    expect(n.kind).toBe('Case');
    if (n.kind === 'Case') {
      expect(n.arms).toHaveLength(4);
      expect(n.arms[0]?.pattern.kind).toBe('Wildcard');
      expect(n.arms[1]?.pattern.kind).toBe('Var');
      expect(n.arms[2]?.pattern.kind).toBe('Constructor');
      expect(n.arms[3]?.pattern.kind).toBe('Literal');
    }
  });

  it('B11: Accessor', () => {
    const receiver: IonIRNode = { kind: 'Var', name: 'obj', symbolId: sid, span, type: intType };
    const n = decodeDecl({ kind: 'Accessor', receiver, member: 'field', span, type: intType });
    expect(n.kind).toBe('Accessor');
    if (n.kind === 'Accessor') expect(n.member).toBe('field');
  });

  it('B12: ModuleRef', () => {
    const n = decodeDecl({ kind: 'ModuleRef', modulePath: ['org', 'example'], symbolId: makeSymbolId('ex:0'), span, type: intType });
    expect(n.kind).toBe('ModuleRef');
    if (n.kind === 'ModuleRef') {
      expect(n.modulePath).toEqual(['org', 'example']);
    }
  });

  it('B13: ForeignRef (sig is stubbed)', () => {
    const n = decodeDecl({
      kind: 'ForeignRef', target: 'js', module: 'std', symbol: 'log',
      sig: { params: [intType], ret: { kind: 'Unit' }, template: '$1' },
      span, type: intType,
    });
    expect(n.kind).toBe('ForeignRef');
    if (n.kind === 'ForeignRef') {
      expect(n.target).toBe('js');
      expect(n.module).toBe('std');
      expect(n.symbol).toBe('log');
      // sig is stubbed
      expect(n.sig.params).toEqual([]);
      expect(n.sig.template).toBe('');
    }
  });

  it('B14: Effect', () => {
    const body: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const n = decodeDecl({ kind: 'Effect', effectTag: 'io', body, span, type: intType });
    expect(n.kind).toBe('Effect');
    if (n.kind === 'Effect') expect(n.effectTag).toBe('io');
  });

  it('B15: OopClass', () => {
    const body: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const n = decodeDecl({
      kind: 'OopClass', name: 'Foo', symbolId: sid, interfaces: [],
      fields: [{ name: 'bar', symbolId: sid, type: strType, span }],
      methods: [{
        name: 'baz', symbolId: sid, params: [], retType: intType, body,
        isAbstract: false, isStatic: false, span,
      }],
      span, type: intType,
    });
    expect(n.kind).toBe('OopClass');
    if (n.kind === 'OopClass') {
      expect(n.name).toBe('Foo');
      expect(n.fields[0]?.name).toBe('bar');
      expect(n.fields[0]?.type).toEqual({ kind: 'Str' });
      expect(n.methods[0]?.name).toBe('baz');
      expect(n.interfaces).toEqual([]);
    }
  });

  it('B16: OopInterface', () => {
    const n = decodeDecl({
      kind: 'OopInterface', name: 'IFoo', symbolId: sid,
      members: [{ name: 'qux', symbolId: sid, type: intType, span }],
      span, type: intType,
    });
    expect(n.kind).toBe('OopInterface');
    if (n.kind === 'OopInterface') {
      expect(n.name).toBe('IFoo');
      expect(n.members[0]?.name).toBe('qux');
    }
  });

  it('B17: OopNew', () => {
    const args: IonIRNode[] = [{ kind: 'Var', name: 'x', symbolId: sid, span, type: intType }];
    const n = decodeDecl({ kind: 'OopNew', ctorSymbolId: makeSymbolId('mod:Foo:0'), args, span, type: intType });
    expect(n.kind).toBe('OopNew');
    if (n.kind === 'OopNew') expect(n.args).toHaveLength(1);
  });

  it('B18: OopVirtualCall', () => {
    const receiver: IonIRNode = { kind: 'Var', name: 'obj', symbolId: sid, span, type: intType };
    const n = decodeDecl({
      kind: 'OopVirtualCall', receiver, method: 'doThing',
      args: [receiver], span, type: intType,
    });
    expect(n.kind).toBe('OopVirtualCall');
    if (n.kind === 'OopVirtualCall') expect(n.method).toBe('doThing');
  });

  it('B19: OopThis', () => {
    const n = decodeDecl({ kind: 'OopThis', span, type: intType });
    expect(n.kind).toBe('OopThis');
  });

  it('B20: AsyncBlock', () => {
    const body: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const n = decodeDecl({ kind: 'AsyncBlock', body, span, type: intType });
    expect(n.kind).toBe('AsyncBlock');
  });

  it('B21: Await', () => {
    const expr: IonIRNode = { kind: 'Var', name: 'p', symbolId: sid, span, type: intType };
    const n = decodeDecl({ kind: 'Await', expr, span, type: intType });
    expect(n.kind).toBe('Await');
  });

  it('B22: AdtDecl', () => {
    const n = decodeDecl({
      kind: 'AdtDecl', name: 'Color', symbolId: sid,
      variants: [
        { tag: 'Red', symbolId: sid, fields: [], span },
        { tag: 'Green', symbolId: sid, fields: [], span },
      ],
      span, type: intType,
    });
    expect(n.kind).toBe('AdtDecl');
    if (n.kind === 'AdtDecl') {
      expect(n.name).toBe('Color');
      expect(n.variants).toHaveLength(2);
      expect(n.variants[0]?.tag).toBe('Red');
    }
  });

  it('B23: AdtMatch', () => {
    const scrutinee: IonIRNode = { kind: 'Var', name: 'c', symbolId: sid, span, type: intType };
    const body: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const n = decodeDecl({
      kind: 'AdtMatch', scrutinee,
      arms: [{ tag: 'Some', bindings: [{ name: 'v', symbolId: sid, type: strType, span }], body, span }],
      span, type: intType,
    });
    expect(n.kind).toBe('AdtMatch');
    if (n.kind === 'AdtMatch') {
      expect(n.arms[0]?.tag).toBe('Some');
      expect(n.arms[0]?.bindings[0]?.type).toEqual({ kind: 'Str' });
    }
  });

  it('B24: EffectDecl', () => {
    const n = decodeDecl({
      kind: 'EffectDecl', name: 'Logger', symbolId: sid,
      operations: [{
        name: 'log',
        params: [{ name: 'msg', symbolId: sid, type: strType, span }],
        retType: { kind: 'Unit' },
        span,
      }],
      span, type: intType,
    });
    expect(n.kind).toBe('EffectDecl');
    if (n.kind === 'EffectDecl') {
      expect(n.name).toBe('Logger');
      expect(n.operations[0]?.name).toBe('log');
      expect(n.operations[0]?.retType).toEqual({ kind: 'Unit' });
    }
  });

  it('B25: Perform', () => {
    const n = decodeDecl({
      kind: 'Perform', effectSymbolId: makeSymbolId('mod:Logger:0'), operation: 'log',
      args: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: intType }],
      span, type: intType,
    });
    expect(n.kind).toBe('Perform');
    if (n.kind === 'Perform') expect(n.operation).toBe('log');
  });

  it('B26: Handle with returnClause', () => {
    const body: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const n = decodeDecl({
      kind: 'Handle', body,
      handlers: [{ operation: 'read', params: [], body, span }],
      returnClause: body,
      span, type: intType,
    });
    expect(n.kind).toBe('Handle');
    if (n.kind === 'Handle') {
      expect(n.handlers[0]?.operation).toBe('read');
      expect(n.returnClause).toBeDefined();
    }
  });

  it('B27: Resume', () => {
    const value: IonIRNode = { kind: 'Var', name: 'r', symbolId: sid, span, type: intType };
    const n = decodeDecl({ kind: 'Resume', value, span, type: intType });
    expect(n.kind).toBe('Resume');
  });

  it('B28: Case arm with guard', () => {
    const v: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const n = decodeDecl({
      kind: 'Case', scrutinee: v,
      arms: [{ pattern: { kind: 'Var', name: 'y', symbolId: sid, span }, guard: v, body: v, span }],
      span, type: intType,
    });
    if (n.kind === 'Case') expect(n.arms[0]?.guard).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Suite C — round-trip property tests
// ---------------------------------------------------------------------------

const spanArb: fc.Arbitrary<Span> = fc.record({
  file: fc.string({ minLength: 1, maxLength: 20 }),
  startLine: fc.integer({ min: 1, max: 100 }),
  startCol: fc.integer({ min: 0, max: 80 }),
  endLine: fc.integer({ min: 1, max: 100 }),
  endCol: fc.integer({ min: 0, max: 80 }),
});

const symbolIdArb = fc.string({ minLength: 1, maxLength: 20 }).map(s => makeSymbolId(s));

const effectTagArb: fc.Arbitrary<EffectTag> = fc.oneof(
  fc.constantFrom('io' as EffectTag, 'async' as EffectTag, 'llm' as EffectTag),
  fc.string({ minLength: 1, maxLength: 10 }),
);

const effectSetArb: fc.Arbitrary<EffectSet> = fc
  .array(effectTagArb, { maxLength: 3 })
  .map(tags => new Set(tags));

// Type arbitrary — uses Unit only at leaves so decoded type (Unit) always matches
const ionTypeArb: fc.Arbitrary<IonType> = fc.oneof(
  fc.constant<IonType>({ kind: 'Unit' }),
  fc.constant<IonType>({ kind: 'Int' }),
  fc.constant<IonType>({ kind: 'Str' }),
);

const dialectArb: fc.Arbitrary<IonIRDialect> = fc.constantFrom(
  'core' as IonIRDialect, 'ion-oop' as IonIRDialect,
  'ion-async' as IonIRDialect, 'ion-adt' as IonIRDialect,
  'ion-effects' as IonIRDialect,
);

// Identifiers safe for the wire format (no spaces, no keywords)
const RESERVED = new Set(['null', 'true', 'false', 'this', 'let', 'match', 'adt', 'class', 'iface', 'new', 'async', 'await', 'effect', 'resume', 'handle', 'perf', 'eff', 'ffi']);
const identArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,11}$/)
  .filter(s => !RESERVED.has(s));

// Simple node arbitrary using only node kinds that roundtrip cleanly
const simpleNodeArb: fc.Arbitrary<IonIRNode> = fc.letrec<{ node: IonIRNode }>(tie => ({
  node: fc.oneof(
    { depthFactor: 0.5 },
    fc.record({ name: identArb, symbolId: symbolIdArb, span: spanArb, type: ionTypeArb })
      .map<IonIRNode>(({ name, symbolId, span: s, type }) => ({ kind: 'Var', name, symbolId, span: s, type })),
    fc.constant<IonIRNode>({ kind: 'Literal', value: { kind: 'Null' }, span: { file: 'x', startLine: 1, startCol: 0, endLine: 1, endCol: 4 }, type: UNIT }),
    fc.record({ body: tie('node'), span: spanArb, type: ionTypeArb })
      .map<IonIRNode>(({ body, span: s, type }) => ({ kind: 'AsyncBlock', body, span: s, type })),
    fc.record({ value: tie('node'), span: spanArb, type: ionTypeArb })
      .map<IonIRNode>(({ value, span: s, type }) => ({ kind: 'Resume', value, span: s, type })),
  ),
})).node;

// SymbolId that survives the wire round-trip (valid identifier, no colons)
const safeSymIdArb = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/).map(s => makeSymbolId(s));

const adtDeclArb = fc.record({
  name: identArb,
  symbolId: safeSymIdArb,
  span: spanArb,
}).map(({ name, symbolId, span: s }) => ({
  kind: 'AdtDecl' as const,
  name, symbolId,
  variants: [],
  span: s,
  type: UNIT,
}));

const moduleRefArb = fc.record({
  modulePath: fc.array(identArb, { minLength: 1, maxLength: 3 }),
  symbolId: safeSymIdArb,
  span: spanArb,
}).map(({ modulePath, symbolId, span: s }) => ({
  kind: 'ModuleRef' as const,
  modulePath,
  symbolId,
  span: s,
  type: UNIT,
}));

const moduleArb: fc.Arbitrary<IonIRModule> = fc.record({
  module: fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_.]{0,19}$/),
  version: fc.stringMatching(/^[0-9][0-9a-zA-Z._-]{0,9}$/),
  dialects: fc.uniqueArray(dialectArb, { maxLength: 5 }),
  imports: fc.array(moduleRefArb, { maxLength: 2 }),
  data: fc.array(adtDeclArb, { maxLength: 2 }),
  decls: fc.array(simpleNodeArb, { maxLength: 4 }),
}).map(({ module: mod, version, dialects, imports, data, decls }) => ({
  ionir: '1.0' as const,
  module: mod, version, dialects, imports, data, decls,
}));

describe('wire decoder — round-trip property tests', () => {
  it('C1: decode(encode(ir)).module === ir.module (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(roundtrip(m).module).toBe(m.module);
      }),
      { numRuns: 200 },
    );
  });

  it('C2: decode(encode(ir)).version === ir.version (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(roundtrip(m).version).toBe(m.version);
      }),
      { numRuns: 200 },
    );
  });

  it('C3: decode(encode(ir)) has same dialect count (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(roundtrip(m).dialects).toHaveLength(m.dialects.length);
      }),
      { numRuns: 200 },
    );
  });

  it('C4: decode(encode(ir)) has same decl count (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(roundtrip(m).decls).toHaveLength(m.decls.length);
      }),
      { numRuns: 200 },
    );
  });

  it('C5: decode(encode(ir)) has same import count and module paths (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        const decoded = roundtrip(m);
        expect(decoded.imports).toHaveLength(m.imports.length);
        for (let i = 0; i < m.imports.length; i++) {
          expect(decoded.imports[i]?.modulePath).toEqual(m.imports[i]?.modulePath);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('C6: decodeModule never throws for any encodeModule output (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(() => decodeModule(encodeModule(m))).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it('C7: Var names roundtrip exactly', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).filter(s => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s)),
        name => {
          const varNode: IonIRNode = { kind: 'Var', name, symbolId: sid, span, type: intType };
          const mod: IonIRModule = { ionir: '1.0', module: 'test', version: '1.0', dialects: ['core'], imports: [], data: [], decls: [varNode] };
          const decoded = roundtrip(mod);
          expect(decoded.decls[0]?.kind).toBe('Var');
          if (decoded.decls[0]?.kind === 'Var') expect(decoded.decls[0].name).toBe(name);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite D — error cases
// ---------------------------------------------------------------------------

describe('wire decoder — error cases', () => {
  it('D1: missing version line throws WireDecodeError', () => {
    expect(() => decodeModule('M test v=1.0 d=core\n')).toThrow(WireDecodeError);
  });

  it('D2: wrong version (I2) throws WireDecodeError', () => {
    expect(() => decodeModule('I2\nM test v=1.0 d=core\n')).toThrow(WireDecodeError);
  });

  it('D3: malformed module line (missing v=) throws WireDecodeError', () => {
    expect(() => decodeModule('I1\nM test 1.0\n')).toThrow(WireDecodeError);
  });

  it('D4: unclosed bracket in node expression throws WireDecodeError', () => {
    expect(() => decodeModule('I1\nM test v=1.0 d=core\nF match(x){\n')).toThrow(WireDecodeError);
  });

  it('D5: empty string throws WireDecodeError', () => {
    expect(() => decodeModule('')).toThrow(WireDecodeError);
  });
});
