import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encodeModule } from '../../src/wire/encoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode, IonIRDialect, AdtDeclNode, CasePattern } from '../../src/ir/nodes.js';
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

const minimalModule: IonIRModule = {
  ionir: '1.0',
  module: 'org.example',
  version: '0.1.0',
  dialects: ['core'],
  imports: [],
  data: [],
  decls: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: intType }],
};

// Module where 'getUserByIdFromDatabase' (21 chars) appears 5×
function makeRepeatedNameModule(): IonIRModule {
  const longName = 'getUserByIdFromDatabase';
  const varNode: IonIRNode = { kind: 'Var', name: longName, symbolId: sid, span, type: intType };
  return {
    ionir: '1.0',
    module: 'org.example.pool',
    version: '1.0.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls: [varNode, varNode, varNode, varNode, varNode],
  };
}

// Module with a list<str> type appearing many times (to trigger type pool)
function makeRepeatedTypeModule(): IonIRModule {
  const listStr: IonType = { kind: 'List', elem: strType };
  const varNode: IonIRNode = { kind: 'Var', name: 'items', symbolId: sid, span, type: listStr };
  return {
    ionir: '1.0',
    module: 'org.example.types',
    version: '1.0.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls: [varNode, varNode, varNode, varNode, varNode, varNode, varNode, varNode, varNode, varNode],
  };
}

// Fixture with 5 functions, 2 ADTs, 3 imports
function makeLargeFixture(): IonIRModule {
  const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
  const absNode: IonIRNode = {
    kind: 'Abs',
    params: [{ name: 'n', symbolId: sid, type: intType, span }],
    body: varNode,
    captures: [],
    span,
    type: { kind: 'Fn', params: [intType], ret: intType, effects: new Set() },
  };

  const adt1: AdtDeclNode = {
    kind: 'AdtDecl',
    name: 'Maybe',
    symbolId: makeSymbolId('mod:Maybe:0'),
    variants: [
      { tag: 'Some', symbolId: makeSymbolId('mod:Some:0'), fields: [{ name: 'value', symbolId: sid, type: intType, span }], span },
      { tag: 'None', symbolId: makeSymbolId('mod:None:0'), fields: [], span },
    ],
    span,
    type: intType,
  };
  const adt2: AdtDeclNode = {
    kind: 'AdtDecl',
    name: 'Result',
    symbolId: makeSymbolId('mod:Result:0'),
    variants: [
      { tag: 'Ok', symbolId: makeSymbolId('mod:Ok:0'), fields: [{ name: 'val', symbolId: sid, type: intType, span }], span },
      { tag: 'Err', symbolId: makeSymbolId('mod:Err:0'), fields: [{ name: 'msg', symbolId: sid, type: strType, span }], span },
    ],
    span,
    type: intType,
  };

  return {
    ionir: '1.0',
    module: 'org.example.large',
    version: '2.0.0',
    dialects: ['core', 'ion-adt'],
    imports: [
      { kind: 'ModuleRef', modulePath: ['org', 'example', 'utils'], symbolId: makeSymbolId('utils:0'), span, type: intType },
      { kind: 'ModuleRef', modulePath: ['org', 'example', 'io'], symbolId: makeSymbolId('io:0'), span, type: intType },
      { kind: 'ModuleRef', modulePath: ['org', 'example', 'fmt'], symbolId: makeSymbolId('fmt:0'), span, type: intType },
    ],
    data: [adt1, adt2],
    decls: [absNode, absNode, absNode, absNode, absNode],
  };
}

// Module with OOP nodes for determinism check
function makeOopModule(): IonIRModule {
  const classNode: IonIRNode = {
    kind: 'OopClass',
    name: 'Greeter',
    symbolId: sid,
    interfaces: [],
    fields: [{ name: 'name', symbolId: sid, type: strType, span }],
    methods: [
      {
        name: 'greet',
        symbolId: sid,
        params: [],
        retType: strType,
        body: { kind: 'Var', name: 'name', symbolId: sid, span, type: strType },
        isAbstract: false,
        isStatic: false,
        span,
      },
    ],
    span,
    type: intType,
  };
  return {
    ionir: '1.0',
    module: 'org.example.oop',
    version: '0.1.0',
    dialects: ['core', 'ion-oop'],
    imports: [],
    data: [],
    decls: [classNode],
  };
}

// ---------------------------------------------------------------------------
// Suite A — Section ordering
// ---------------------------------------------------------------------------

describe('wire encoder — section ordering', () => {
  it('minimal module: first line is I1, second line is M', () => {
    const out = encodeModule(minimalModule);
    const lines = out.split('\n').filter(l => l.length > 0);
    expect(lines[0]).toBe('I1');
    expect(lines[1]).toMatch(/^M /);
  });

  it('repeated long names: S line present and appears before any F line', () => {
    const out = encodeModule(makeRepeatedNameModule());
    const lines = out.split('\n').filter(l => l.length > 0);
    const sIdx = lines.findIndex(l => l.startsWith('S '));
    const fIdx = lines.findIndex(l => l.startsWith('F '));
    expect(sIdx).toBeGreaterThan(-1);
    if (fIdx !== -1) expect(sIdx).toBeLessThan(fIdx);
  });

  it('T line (when present) precedes D and F lines', () => {
    const out = encodeModule(makeRepeatedTypeModule());
    const lines = out.split('\n').filter(l => l.length > 0);
    const tIdx = lines.findIndex(l => l.startsWith('T '));
    const dIdx = lines.findIndex(l => l.startsWith('D '));
    const fIdx = lines.findIndex(l => l.startsWith('F '));
    if (tIdx !== -1) {
      if (dIdx !== -1) expect(tIdx).toBeLessThan(dIdx);
      if (fIdx !== -1) expect(tIdx).toBeLessThan(fIdx);
    }
  });

  it('module with only single-occurrence names has no S line', () => {
    const out = encodeModule(minimalModule);
    const lines = out.split('\n');
    expect(lines.some(l => l.startsWith('S '))).toBe(false);
  });

  it('empty imports means no X line', () => {
    const out = encodeModule(minimalModule);
    expect(out).not.toMatch(/^X /m);
  });
});

// ---------------------------------------------------------------------------
// Suite B — Symbol pool correctness
// ---------------------------------------------------------------------------

describe('wire encoder — symbol pool', () => {
  it('single-occurrence name is not pooled (not in S line)', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.single',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Var', name: 'someUniqueName', symbolId: sid, span, type: intType }],
    };
    const out = encodeModule(mod);
    expect(out).not.toMatch(/^S /m);
  });

  it('getUserByIdFromDatabase (21 chars) × 5 is pooled', () => {
    const out = encodeModule(makeRepeatedNameModule());
    // tokenCost(21)=6, 5*(6-1)=25 > 2+6=8 → should pool
    expect(out).toMatch(/^S /m);
    expect(out).toContain('getUserByIdFromDatabase');
  });

  it('single-char name x × 100 is not pooled (zero savings)', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.short',
      version: '1.0.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: Array.from({ length: 100 }, () => varNode),
    };
    const out = encodeModule(mod);
    // tokenCost(1)=1, 100*(1-1)=0 > 2+1=3 → false, should NOT pool
    expect(out).not.toMatch(/^S /m);
  });

  it('pool entries are ordered by first-use position, not alphabetically', () => {
    // 'zebra' appears first, 'apple' appears second — pool should list zebra before apple
    const makeVar = (name: string): IonIRNode =>
      ({ kind: 'Var', name, symbolId: sid, span, type: intType });
    // each name used 5× to trigger pooling (5 chars → tokenCost=2, 5*(2-1)=5 > 2+2=4 ✓)
    const zebraNode = makeVar('zebra');
    const appleNode = makeVar('apple');
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.order',
      version: '1.0.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [zebraNode, zebraNode, zebraNode, zebraNode, zebraNode,
               appleNode, appleNode, appleNode, appleNode, appleNode],
    };
    const out = encodeModule(mod);
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    const zebraIdx = sLine.indexOf('zebra');
    const appleIdx = sLine.indexOf('apple');
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(appleIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeLessThan(appleIdx);
  });
});

// ---------------------------------------------------------------------------
// Suite C — Determinism
// ---------------------------------------------------------------------------

describe('wire encoder — determinism', () => {
  it('encodeModule(m) === encodeModule(m) for minimal module', () => {
    expect(encodeModule(minimalModule)).toBe(encodeModule(minimalModule));
  });

  it('encodeModule(m) === encodeModule(m) for large fixture', () => {
    const m = makeLargeFixture();
    expect(encodeModule(m)).toBe(encodeModule(m));
  });

  it('encodeModule(m) === encodeModule(m) for OOP module', () => {
    const m = makeOopModule();
    expect(encodeModule(m)).toBe(encodeModule(m));
  });
});

// ---------------------------------------------------------------------------
// Suite D — Token-count proxy
// ---------------------------------------------------------------------------

describe('wire encoder — token count proxy', () => {
  it('wire output is shorter than JSON for the large fixture', () => {
    const m = makeLargeFixture();
    const wire = encodeModule(m);
    const json = JSON.stringify(m);
    expect(wire.length).toBeLessThan(json.length);
  });
});

// ---------------------------------------------------------------------------
// Arbitraries (shared with property tests)
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

const { ionTypeArb, nodeArb } = fc.letrec<{ ionTypeArb: IonType; nodeArb: IonIRNode; casePatternArb: CasePattern }>(tie => ({
  ionTypeArb: fc.oneof(
    { depthSize: 0.5 },
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
    fc.record({ key: tie('ionTypeArb'), value: tie('ionTypeArb') })
      .map<IonType>(({ key, value }) => ({ kind: 'Map', key, value })),
    fc.record({ ok: tie('ionTypeArb'), err: tie('ionTypeArb') })
      .map<IonType>(({ ok, err }) => ({ kind: 'Result', ok, err })),
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
  casePatternArb: fc.oneof(
    { depthSize: 0.5 },
    spanArb.map<CasePattern>(s => ({ kind: 'Wildcard', span: s })),
    fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, span: spanArb })
      .map<CasePattern>(({ name, symbolId, span: s }) => ({ kind: 'Var', name, symbolId, span: s })),
    fc.record({
      ctorName: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      fields: fc.array(tie('casePatternArb'), { maxLength: 2 }),
      span: spanArb,
    }).map<CasePattern>(({ ctorName, symbolId, fields, span: s }) => ({
      kind: 'Constructor', ctorName, symbolId, fields, span: s,
    })),
    fc.oneof(
      fc.integer().map(v => ({ kind: 'Int' as const, value: v })),
      fc.double({ noNaN: true, noDefaultInfinity: true }).map(v => ({ kind: 'Float' as const, value: v })),
      fc.string({ maxLength: 20 }).map(v => ({ kind: 'Str' as const, value: v })),
      fc.boolean().map(v => ({ kind: 'Bool' as const, value: v })),
      fc.constant({ kind: 'Null' as const }),
    ).chain(value => spanArb.map<CasePattern>(s => ({ kind: 'Literal', value, span: s }))),
  ),
  nodeArb: fc.oneof(
    { depthSize: 0.5 },
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ name, symbolId, span: s, type }) =>
      ({ kind: 'Var', name, symbolId, span: s, type })
    ),
    fc.oneof(
      fc.integer().map(v => ({ kind: 'Int' as const, value: v })),
      fc.double({ noNaN: true, noDefaultInfinity: true }).map(v => ({ kind: 'Float' as const, value: v })),
      fc.string({ maxLength: 20 }).map(v => ({ kind: 'Str' as const, value: v })),
      fc.boolean().map(v => ({ kind: 'Bool' as const, value: v })),
      fc.constant({ kind: 'Null' as const }),
    ).chain(value =>
      fc.record({ span: spanArb, type: tie('ionTypeArb') })
        .map<IonIRNode>(({ span: s, type }) => ({ kind: 'Literal', value, span: s, type }))
    ),
    fc.record({ span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ span: s, type }) => ({ kind: 'OopThis', span: s, type })),
    fc.record({
      callee: tie('nodeArb'),
      args: fc.array(tie('nodeArb'), { maxLength: 2 }),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ callee, args, span: s, type }) =>
      ({ kind: 'App', callee, args, span: s, type })
    ),
    fc.record({
      body: tie('nodeArb'),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ body, span: s, type }) => ({ kind: 'AsyncBlock', body, span: s, type })),
    fc.record({
      value: tie('nodeArb'),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ value, span: s, type }) => ({ kind: 'Resume', value, span: s, type })),
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
    fc.record({ expr: tie('nodeArb'), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ expr, span: s, type }) => ({ kind: 'Await', expr, span: s, type })),
    fc.record({
      params: fc.array(
        fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, type: tie('ionTypeArb'), span: spanArb }),
        { maxLength: 2 },
      ),
      captures: fc.array(symbolIdArb, { maxLength: 2 }),
      body: tie('nodeArb'),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ params, captures, body, span: s, type }) => ({
      kind: 'Abs', params, captures, body, span: s, type,
    })),
    fc.record({
      scrutinee: tie('nodeArb'),
      arms: fc.array(
        fc.record({
          pattern: tie('casePatternArb'),
          guard: fc.option(tie('nodeArb'), { nil: undefined }),
          body: tie('nodeArb'),
          span: spanArb,
        }).map(({ pattern, guard, body, span: s }) => ({
          pattern, body, span: s, ...(guard !== undefined ? { guard } : {}),
        })),
        { maxLength: 2 },
      ),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ scrutinee, arms, span: s, type }) => ({
      kind: 'Case', scrutinee, arms, span: s, type,
    })),
    fc.record({
      ctorName: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      args: fc.array(tie('nodeArb'), { maxLength: 2 }),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ ctorName, symbolId, args, span: s, type }) => ({
      kind: 'Constructor', ctorName, symbolId, args, span: s, type,
    })),
    fc.record({
      receiver: tie('nodeArb'),
      member: fc.string({ minLength: 1, maxLength: 10 }),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ receiver, member, span: s, type }) => ({
      kind: 'Accessor', receiver, member, span: s, type,
    })),
    fc.record({
      modulePath: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 4 }),
      symbolId: symbolIdArb,
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ modulePath, symbolId, span: s, type }) => ({
      kind: 'ModuleRef', modulePath, symbolId, span: s, type,
    })),
    fc.record({
      target: fc.string({ minLength: 1, maxLength: 10 }),
      module: fc.string({ minLength: 1, maxLength: 10 }),
      symbol: fc.string({ minLength: 1, maxLength: 10 }),
      sig: fc.record({
        params: fc.array(tie('ionTypeArb'), { maxLength: 2 }),
        ret: tie('ionTypeArb'),
        template: fc.string({ maxLength: 20 }),
      }),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ target, module: mod, symbol, sig, span: s, type }) => ({
      kind: 'ForeignRef', target, module: mod, symbol, sig, span: s, type,
    })),
    fc.record({
      effectTag: effectTagArb,
      body: tie('nodeArb'),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ effectTag, body, span: s, type }) => ({
      kind: 'Effect', effectTag, body, span: s, type,
    })),
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      superClass: fc.option(symbolIdArb, { nil: undefined }),
      interfaces: fc.array(symbolIdArb, { maxLength: 2 }),
      fields: fc.array(
        fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, type: tie('ionTypeArb'), span: spanArb }),
        { maxLength: 2 },
      ),
      methods: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 10 }),
          symbolId: symbolIdArb,
          params: fc.array(
            fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, type: tie('ionTypeArb'), span: spanArb }),
            { maxLength: 1 },
          ),
          retType: tie('ionTypeArb'),
          body: fc.option(tie('nodeArb'), { nil: undefined }),
          isAbstract: fc.boolean(),
          isStatic: fc.boolean(),
          span: spanArb,
        }).map(({ name: mName, symbolId: mSid, params, retType, body, isAbstract, isStatic, span: ms }) => ({
          name: mName, symbolId: mSid, params, retType, isAbstract, isStatic, span: ms,
          ...(body !== undefined ? { body } : {}),
        })),
        { maxLength: 1 },
      ),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ name, symbolId, superClass, interfaces, fields, methods, span: s, type }) => ({
      kind: 'OopClass',
      name,
      symbolId,
      ...(superClass !== undefined ? { superClass } : {}),
      interfaces,
      fields,
      methods,
      span: s,
      type,
    })),
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      members: fc.array(
        fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, type: tie('ionTypeArb'), span: spanArb }),
        { maxLength: 2 },
      ),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ name, symbolId, members, span: s, type }) => ({
      kind: 'OopInterface', name, symbolId, members, span: s, type,
    })),
    fc.record({
      ctorSymbolId: symbolIdArb,
      args: fc.array(tie('nodeArb'), { maxLength: 2 }),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ ctorSymbolId, args, span: s, type }) => ({
      kind: 'OopNew', ctorSymbolId, args, span: s, type,
    })),
    fc.record({
      receiver: tie('nodeArb'),
      method: fc.string({ minLength: 1, maxLength: 10 }),
      args: fc.array(tie('nodeArb'), { maxLength: 2 }),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ receiver, method, args, span: s, type }) => ({
      kind: 'OopVirtualCall', receiver, method, args, span: s, type,
    })),
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      variants: fc.array(
        fc.record({
          tag: fc.string({ minLength: 1, maxLength: 10 }),
          symbolId: symbolIdArb,
          fields: fc.array(
            fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, type: tie('ionTypeArb'), span: spanArb }),
            { maxLength: 2 },
          ),
          span: spanArb,
        }),
        { maxLength: 2 },
      ),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ name, symbolId, variants, span: s, type }) => ({
      kind: 'AdtDecl', name, symbolId, variants, span: s, type,
    })),
    fc.record({
      scrutinee: tie('nodeArb'),
      arms: fc.array(
        fc.record({
          tag: fc.string({ minLength: 1, maxLength: 10 }),
          bindings: fc.array(
            fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, type: tie('ionTypeArb'), span: spanArb }),
            { maxLength: 2 },
          ),
          body: tie('nodeArb'),
          span: spanArb,
        }),
        { maxLength: 2 },
      ),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ scrutinee, arms, span: s, type }) => ({
      kind: 'AdtMatch', scrutinee, arms, span: s, type,
    })),
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      operations: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 10 }),
          params: fc.array(
            fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, type: tie('ionTypeArb'), span: spanArb }),
            { maxLength: 2 },
          ),
          retType: tie('ionTypeArb'),
          span: spanArb,
        }),
        { maxLength: 2 },
      ),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ name, symbolId, operations, span: s, type }) => ({
      kind: 'EffectDecl', name, symbolId, operations, span: s, type,
    })),
    fc.record({
      effectSymbolId: symbolIdArb,
      operation: fc.string({ minLength: 1, maxLength: 10 }),
      args: fc.array(tie('nodeArb'), { maxLength: 2 }),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ effectSymbolId, operation, args, span: s, type }) => ({
      kind: 'Perform', effectSymbolId, operation, args, span: s, type,
    })),
    fc.record({
      body: tie('nodeArb'),
      handlers: fc.array(
        fc.record({
          operation: fc.string({ minLength: 1, maxLength: 10 }),
          params: fc.array(
            fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, type: tie('ionTypeArb'), span: spanArb }),
            { maxLength: 2 },
          ),
          body: tie('nodeArb'),
          span: spanArb,
        }),
        { maxLength: 2 },
      ),
      returnClause: fc.option(tie('nodeArb'), { nil: undefined }),
      span: spanArb,
      type: tie('ionTypeArb'),
    }).map<IonIRNode>(({ body, handlers, returnClause, span: s, type }) => ({
      kind: 'Handle',
      body,
      handlers,
      ...(returnClause !== undefined ? { returnClause } : {}),
      span: s,
      type,
    })),
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
  variants: fc.array(
    fc.record({
      tag: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: symbolIdArb,
      fields: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 10 }),
          symbolId: symbolIdArb,
          type: ionTypeArb,
          span: spanArb,
        }),
        { maxLength: 3 },
      ),
      span: spanArb,
    }),
    { maxLength: 3 },
  ),
  span: spanArb,
  type: ionTypeArb,
}).map(({ name, symbolId, variants, span: s, type }) => ({
  kind: 'AdtDecl' as const,
  name,
  symbolId,
  variants,
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
// Suite F — Import path pool symmetry
// ---------------------------------------------------------------------------

describe('wire encoder — import path pool symmetry', () => {
  // organizationService: 19 chars, tokenCost=ceil(19/4)=5
  // shouldPool: count*(5-1) > 2+5 → count*4 > 7 → count>=2
  const orgSvcSegment = 'organizationService';
  const orgSvcSid = makeSymbolId('svc:0');

  function makePooledPathModule(): IonIRModule {
    // import uses the segment once, ModuleRef decl uses it once → 2 total → pooled
    const importRef: IonIRNode & { kind: 'ModuleRef' } = {
      kind: 'ModuleRef',
      modulePath: [orgSvcSegment],
      symbolId: orgSvcSid,
      span,
      type: intType,
    };
    return {
      ionir: '1.0',
      module: 'org.example.sym',
      version: '1.0.0',
      dialects: ['core'],
      imports: [{ kind: 'ModuleRef', modulePath: [orgSvcSegment], symbolId: orgSvcSid, span, type: intType }],
      data: [],
      decls: [importRef],
    };
  }

  it('F1: pooled segment is aliased consistently in both X and F lines', () => {
    const out = encodeModule(makePooledPathModule());
    const lines = out.split('\n').filter(l => l.length > 0);

    const sLine = lines.find(l => l.startsWith('S ')) ?? '';
    const xLine = lines.find(l => l.startsWith('X ')) ?? '';
    const fLine = lines.find(l => l.startsWith('F ')) ?? '';

    // segment was pooled
    expect(sLine).toContain(orgSvcSegment);
    // neither X nor F contain the raw segment
    expect(xLine).not.toContain(orgSvcSegment);
    expect(fLine).not.toContain(orgSvcSegment);

    // extract the alias from the S line, e.g. "a=organizationService"
    const aliasMatch = sLine.match(/(\w+)=organizationService/);
    expect(aliasMatch).not.toBeNull();
    const alias = aliasMatch![1];

    // both X and F use that same alias
    expect(xLine).toContain(alias);
    expect(fLine).toContain(alias);
  });

  it('F2: unpooled segment remains raw in both X and F lines', () => {
    const stdSid = makeSymbolId('std:0');
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.raw',
      version: '1.0.0',
      dialects: ['core'],
      imports: [{ kind: 'ModuleRef', modulePath: ['std', 'io'], symbolId: stdSid, span, type: intType }],
      data: [],
      decls: [{ kind: 'ModuleRef', modulePath: ['std', 'io'], symbolId: stdSid, span, type: intType }],
    };
    const out = encodeModule(mod);
    const lines = out.split('\n').filter(l => l.length > 0);

    // short segments not pooled → no S line
    expect(lines.some(l => l.startsWith('S '))).toBe(false);

    const xLine = lines.find(l => l.startsWith('X ')) ?? '';
    const fLine = lines.find(l => l.startsWith('F ')) ?? '';
    expect(xLine).toContain('std');
    expect(fLine).toContain('std');
  });

  it('F3: multi-segment path — pooled segment aliased, unpooled segment raw, in both X and F', () => {
    // organizationService pooled (2 occurrences), io not pooled (2 chars, cost 1)
    const mixedSid = makeSymbolId('mixed:0');
    const importRef: IonIRNode & { kind: 'ModuleRef' } = {
      kind: 'ModuleRef',
      modulePath: [orgSvcSegment, 'io'],
      symbolId: mixedSid,
      span,
      type: intType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.mixed',
      version: '1.0.0',
      dialects: ['core'],
      imports: [{ kind: 'ModuleRef', modulePath: [orgSvcSegment, 'io'], symbolId: mixedSid, span, type: intType }],
      data: [],
      decls: [importRef],
    };
    const out = encodeModule(mod);
    const lines = out.split('\n').filter(l => l.length > 0);

    const sLine = lines.find(l => l.startsWith('S ')) ?? '';
    const xLine = lines.find(l => l.startsWith('X ')) ?? '';
    const fLine = lines.find(l => l.startsWith('F ')) ?? '';

    // segment was pooled
    expect(sLine).toContain(orgSvcSegment);

    // raw segment absent from X and F
    expect(xLine).not.toContain(orgSvcSegment);
    expect(fLine).not.toContain(orgSvcSegment);

    // unpooled 'io' segment appears raw in both
    expect(xLine).toContain('io');
    expect(fLine).toContain('io');

    // alias consistent between X and F
    const aliasMatch = sLine.match(/(\w+)=organizationService/);
    expect(aliasMatch).not.toBeNull();
    const alias = aliasMatch![1];
    expect(xLine).toContain(alias);
    expect(fLine).toContain(alias);
  });
});

// ---------------------------------------------------------------------------
// Suite E — Property tests
// ---------------------------------------------------------------------------

describe('wire encoder — property tests', () => {
  it('encodeModule never throws for any valid IonIRModule', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(() => encodeModule(m)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it('output always starts with "I1\\n"', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(encodeModule(m)).toMatch(/^I1\n/);
      }),
      { numRuns: 500 },
    );
  });

  it('output is byte-stable: encoding twice yields identical string', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(encodeModule(m)).toBe(encodeModule(m));
      }),
      { numRuns: 500 },
    );
  });

  it('S line (when present) appears before D and F lines', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        const lines = encodeModule(m).split('\n').filter(l => l.length > 0);
        const sIdx = lines.findIndex(l => l.startsWith('S '));
        const dIdx = lines.findIndex(l => l.startsWith('D '));
        const fIdx = lines.findIndex(l => l.startsWith('F '));
        if (sIdx !== -1) {
          if (dIdx !== -1) expect(sIdx).toBeLessThan(dIdx);
          if (fIdx !== -1) expect(sIdx).toBeLessThan(fIdx);
        }
      }),
      { numRuns: 500 },
    );
  });
});
