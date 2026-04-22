import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { serializeModule, deserializeModule, IonIRSerdeError } from '../../src/ir/serde.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode, IonIRDialect } from '../../src/ir/nodes.js';
import type { IonType, EffectSet } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import type { EffectTag } from '../../src/ast/types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const sid = makeSymbolId('mod:x:0');
const intType: IonType = { kind: 'Int' };

const minimalModule: IonIRModule = {
  ionir: '1.0',
  module: 'org.example',
  version: '0.1.0',
  dialects: ['core'],
  imports: [],
  data: [],
  decls: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: intType }],
};

// ---------------------------------------------------------------------------
// Suite A — hand-crafted unit round-trips
// ---------------------------------------------------------------------------

describe('IonIR serde — unit round-trips', () => {
  it('round-trips a minimal module with one VarNode', () => {
    const out = deserializeModule(serializeModule(minimalModule));
    expect(out).toEqual(minimalModule);
  });

  it('round-trips a module with FnType carrying a non-empty EffectSet', () => {
    const effects: EffectSet = new Set<EffectTag>(['io', 'async']);
    const fnType: IonType = { kind: 'Fn', params: [intType], ret: intType, effects };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.effects',
      version: '1.0.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Var', name: 'f', symbolId: sid, span, type: fnType }],
    };
    const out = deserializeModule(serializeModule(mod));
    expect(out).toEqual(mod);
    const declType = (out.decls[0] as { type: IonType }).type as { kind: 'Fn'; effects: EffectSet };
    expect(declType.effects).toBeInstanceOf(Set);
    expect([...declType.effects].sort()).toEqual(['async', 'io']);
  });

  it('round-trips HandleNode with returnClause present', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const handleNode: IonIRNode = {
      kind: 'Handle',
      body: varNode,
      handlers: [],
      returnClause: varNode,
      span,
      type: intType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.handle',
      version: '0.1.0',
      dialects: ['core', 'ion-effects'],
      imports: [],
      data: [],
      decls: [handleNode],
    };
    const out = deserializeModule(serializeModule(mod));
    expect(out).toEqual(mod);
    const handle = out.decls[0];
    expect(handle.kind).toBe('Handle');
    if (handle.kind === 'Handle') {
      expect('returnClause' in handle).toBe(true);
    }
  });

  it('round-trips HandleNode with returnClause absent', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const handleNode: IonIRNode = {
      kind: 'Handle',
      body: varNode,
      handlers: [],
      span,
      type: intType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.handle2',
      version: '0.1.0',
      dialects: ['core', 'ion-effects'],
      imports: [],
      data: [],
      decls: [handleNode],
    };
    const out = deserializeModule(serializeModule(mod));
    expect(out).toEqual(mod);
    const handle = out.decls[0];
    if (handle.kind === 'Handle') {
      expect('returnClause' in handle).toBe(false);
    }
  });

  it('round-trips OopMethod with body present vs absent', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const classNode: IonIRNode = {
      kind: 'OopClass',
      name: 'Foo',
      symbolId: sid,
      interfaces: [],
      fields: [],
      methods: [
        {
          name: 'concrete',
          symbolId: sid,
          params: [],
          retType: intType,
          body: varNode,
          isAbstract: false,
          isStatic: false,
          span,
        },
        {
          name: 'abstract',
          symbolId: sid,
          params: [],
          retType: intType,
          isAbstract: true,
          isStatic: false,
          span,
        },
      ],
      span,
      type: intType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.oop',
      version: '0.1.0',
      dialects: ['core', 'ion-oop'],
      imports: [],
      data: [],
      decls: [classNode],
    };
    const out = deserializeModule(serializeModule(mod));
    expect(out).toEqual(mod);
  });

  it('round-trips OopClassNode with superClass present vs absent', () => {
    const superSid = makeSymbolId('mod:Base:0');
    const withSuper: IonIRNode = {
      kind: 'OopClass',
      name: 'Child',
      symbolId: sid,
      superClass: superSid,
      interfaces: [],
      fields: [],
      methods: [],
      span,
      type: intType,
    };
    const withoutSuper: IonIRNode = {
      kind: 'OopClass',
      name: 'Root',
      symbolId: sid,
      interfaces: [],
      fields: [],
      methods: [],
      span,
      type: intType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.oop2',
      version: '0.1.0',
      dialects: ['core', 'ion-oop'],
      imports: [],
      data: [],
      decls: [withSuper, withoutSuper],
    };
    const out = deserializeModule(serializeModule(mod));
    expect(out).toEqual(mod);
    expect('superClass' in out.decls[0]).toBe(true);
    expect('superClass' in out.decls[1]).toBe(false);
  });

  it('round-trips a module with all dialects and representative nodes', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.full',
      version: '1.0.0',
      dialects: ['core', 'ion-oop', 'ion-async', 'ion-adt', 'ion-effects'],
      imports: [
        {
          kind: 'ModuleRef',
          modulePath: ['org', 'example', 'utils'],
          symbolId: makeSymbolId('utils:0'),
          span,
          type: intType,
        },
      ],
      data: [
        {
          kind: 'AdtDecl',
          name: 'Maybe',
          symbolId: makeSymbolId('mod:Maybe:0'),
          variants: [
            { tag: 'Some', symbolId: makeSymbolId('mod:Some:0'), fields: [{ name: 'value', symbolId: sid, type: intType, span }], span },
            { tag: 'None', symbolId: makeSymbolId('mod:None:0'), fields: [], span },
          ],
          span,
          type: intType,
        },
      ],
      decls: [
        varNode,
        { kind: 'AsyncBlock', body: varNode, span, type: intType },
        { kind: 'Await', expr: varNode, span, type: intType },
        {
          kind: 'Handle',
          body: varNode,
          handlers: [
            { operation: 'read', params: [], body: varNode, span },
          ],
          span,
          type: intType,
        },
      ],
    };
    const out = deserializeModule(serializeModule(mod));
    expect(out).toEqual(mod);
  });
});

// ---------------------------------------------------------------------------
// Arbitraries for property tests
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

const { ionTypeArb, nodeArb } = fc.letrec<{ ionTypeArb: IonType; nodeArb: IonIRNode }>(tie => ({
  ionTypeArb: fc.oneof(
    { depthFactor: 0.5 },
    fc.constant<IonType>({ kind: 'Int' }),
    fc.constant<IonType>({ kind: 'Float' }),
    fc.constant<IonType>({ kind: 'Str' }),
    fc.constant<IonType>({ kind: 'Bool' }),
    fc.constant<IonType>({ kind: 'Null' }),
    fc.constant<IonType>({ kind: 'Unit' }),
    fc.constant<IonType>({ kind: 'Never' }),
    fc.string({ minLength: 1, maxLength: 8 }).map<IonType>(id => ({ kind: 'TypeVar', id })),
    tie('ionTypeArb').map<IonType>(elem => ({ kind: 'List', elem })),
    tie('ionTypeArb').map<IonType>(inner => ({ kind: 'Option', inner })),
    fc.record({ ok: tie('ionTypeArb'), err: tie('ionTypeArb') }).map<IonType>(({ ok, err }) => ({ kind: 'Result', ok, err })),
    fc.record({
      params: fc.array(tie('ionTypeArb'), { maxLength: 2 }),
      ret: tie('ionTypeArb'),
      effects: effectSetArb,
    }).map<IonType>(({ params, ret, effects }) => ({ kind: 'Fn', params, ret, effects })),
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      args: fc.array(tie('ionTypeArb'), { maxLength: 2 }),
    }).map<IonType>(({ name, symbolId, args }) => ({ kind: 'User', name, symbolId, args })),
  ),
  nodeArb: fc.oneof(
    { depthFactor: 0.5 },
    // Leaf: Var
    fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ name, symbolId, span: s, type }) => ({ kind: 'Var', name, symbolId, span: s, type })),
    // Leaf: Literal
    fc.oneof(
      fc.integer().map(v => ({ kind: 'Int' as const, value: v })),
      fc.double({ noNaN: true }).map(v => ({ kind: 'Float' as const, value: v })),
      fc.string({ maxLength: 20 }).map(v => ({ kind: 'Str' as const, value: v })),
      fc.boolean().map(v => ({ kind: 'Bool' as const, value: v })),
      fc.constant({ kind: 'Null' as const }),
    ).chain(value =>
      fc.record({ span: spanArb, type: tie('ionTypeArb') })
        .map<IonIRNode>(({ span: s, type }) => ({ kind: 'Literal', value, span: s, type }))
    ),
    // Leaf: OopThis
    fc.record({ span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ span: s, type }) => ({ kind: 'OopThis', span: s, type })),
    // Recursive: App
    fc.record({ callee: tie('nodeArb'), args: fc.array(tie('nodeArb'), { maxLength: 2 }), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ callee, args, span: s, type }) => ({ kind: 'App', callee, args, span: s, type })),
    // Recursive: Let
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      bindingType: tie('ionTypeArb'),
      value: tie('nodeArb'),
      body: tie('nodeArb'),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ name, symbolId, bindingType, value, body, span: s, type }) => ({
      kind: 'Let', name, symbolId, bindingType, value, body, span: s, type,
    })),
    // Recursive: AsyncBlock
    fc.record({ body: tie('nodeArb'), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ body, span: s, type }) => ({ kind: 'AsyncBlock', body, span: s, type })),
    // Recursive: Await
    fc.record({ expr: tie('nodeArb'), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ expr, span: s, type }) => ({ kind: 'Await', expr, span: s, type })),
    // Recursive: Resume
    fc.record({ value: tie('nodeArb'), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ value, span: s, type }) => ({ kind: 'Resume', value, span: s, type })),
  ),
}));

const dialectArb: fc.Arbitrary<IonIRDialect> = fc.constantFrom(
  'core' as IonIRDialect,
  'ion-oop' as IonIRDialect,
  'ion-async' as IonIRDialect,
  'ion-adt' as IonIRDialect,
  'ion-effects' as IonIRDialect,
);

const moduleRefArb = fc.record({
  modulePath: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 4 }),
  symbolId: symbolIdArb,
  span: spanArb,
  type: ionTypeArb,
}).map(({ modulePath, symbolId, span: s, type }) => ({
  kind: 'ModuleRef' as const,
  modulePath,
  symbolId,
  span: s,
  type,
}));

const adtDeclArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 10 }),
  symbolId: symbolIdArb,
  span: spanArb,
  type: ionTypeArb,
}).map(({ name, symbolId, span: s, type }) => ({
  kind: 'AdtDecl' as const,
  name,
  symbolId,
  variants: [],
  span: s,
  type,
}));

const moduleArb: fc.Arbitrary<IonIRModule> = fc.record({
  module: fc.string({ minLength: 1, maxLength: 30 }),
  version: fc.string({ minLength: 1, maxLength: 10 }),
  dialects: fc.uniqueArray(dialectArb, { maxLength: 5 }),
  imports: fc.array(moduleRefArb, { maxLength: 3 }),
  data: fc.array(adtDeclArb, { maxLength: 3 }),
  decls: fc.array(nodeArb, { maxLength: 5 }),
}).map(({ module: mod, version, dialects, imports, data, decls }) => ({
  ionir: '1.0' as const,
  module: mod,
  version,
  dialects,
  imports,
  data,
  decls,
}));

// ---------------------------------------------------------------------------
// Suite B — property tests
// ---------------------------------------------------------------------------

describe('IonIR serde — round-trip property', () => {
  it('deserializeModule(serializeModule(m)) deep-equals m for any valid module', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        const out = deserializeModule(serializeModule(m));
        expect(out).toEqual(m);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite C — error cases
// ---------------------------------------------------------------------------

describe('IonIR serde — error cases', () => {
  it('throws IonIRSerdeError on malformed JSON', () => {
    expect(() => deserializeModule('{')).toThrow(IonIRSerdeError);
  });

  it('throws IonIRSerdeError when ionir field is missing', () => {
    const raw = JSON.stringify({ module: 'x', version: '1', dialects: [], imports: [], data: [], decls: [] });
    expect(() => deserializeModule(raw)).toThrow(IonIRSerdeError);
  });

  it('throws IonIRSerdeError when ionir version is wrong', () => {
    const raw = JSON.stringify({ ionir: '2.0', module: 'x', version: '1', dialects: [], imports: [], data: [], decls: [] });
    expect(() => deserializeModule(raw)).toThrow(IonIRSerdeError);
  });

  it('throws IonIRSerdeError on unknown node kind in decls', () => {
    const raw = JSON.stringify({
      ionir: '1.0', module: 'x', version: '1', dialects: [], imports: [], data: [],
      decls: [{ kind: 'UnknownNode', span: {}, type: { kind: 'Int' } }],
    });
    expect(() => deserializeModule(raw)).toThrow(IonIRSerdeError);
  });

  it('throws IonIRSerdeError when imports element has wrong kind', () => {
    const raw = JSON.stringify({
      ionir: '1.0', module: 'x', version: '1', dialects: [], data: [], decls: [],
      imports: [{ kind: 'Var', name: 'x', symbolId: 'sid', span: {}, type: { kind: 'Int' } }],
    });
    expect(() => deserializeModule(raw)).toThrow(IonIRSerdeError);
  });

  it('throws IonIRSerdeError when data element has wrong kind', () => {
    const raw = JSON.stringify({
      ionir: '1.0', module: 'x', version: '1', dialects: [], imports: [], decls: [],
      data: [{ kind: 'Perform', effectSymbolId: 'sid', operation: 'op', args: [], span: {}, type: { kind: 'Int' } }],
    });
    expect(() => deserializeModule(raw)).toThrow(IonIRSerdeError);
  });

  it('throws IonIRSerdeError when a required field is missing on a node', () => {
    const raw = JSON.stringify({
      ionir: '1.0', module: 'x', version: '1', dialects: [], imports: [], data: [],
      decls: [{ kind: 'Var', symbolId: 'sid', span: { file: 'f', startLine: 1, startCol: 0, endLine: 1, endCol: 1 }, type: { kind: 'Int' } }],
      // missing 'name'
    });
    expect(() => deserializeModule(raw)).toThrow(IonIRSerdeError);
  });

  it('throws IonIRSerdeError when effects is not an array', () => {
    const raw = JSON.stringify({
      ionir: '1.0', module: 'x', version: '1', dialects: [], imports: [], data: [],
      decls: [{
        kind: 'Var', name: 'f', symbolId: 'sid',
        span: { file: 'f', startLine: 1, startCol: 0, endLine: 1, endCol: 1 },
        type: { kind: 'Fn', params: [], ret: { kind: 'Int' }, effects: 'io' },
      }],
    });
    expect(() => deserializeModule(raw)).toThrow(IonIRSerdeError);
  });
});
