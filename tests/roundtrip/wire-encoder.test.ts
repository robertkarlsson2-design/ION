import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encodeModule, WireEncodeError } from '../../src/wire/encoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode, IonIRDialect, CasePattern } from '../../src/ir/nodes.js';
import type { IonType, EffectSet } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import type { EffectTag } from '../../src/ast/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const sid = makeSymbolId('mod:x:0');
const intType: IonType = { kind: 'Int' };

function makeMinimal(name: string, version: string, dialects: IonIRDialect[]): IonIRModule {
  return {
    ionir: '1.0',
    module: name,
    version,
    dialects,
    imports: [],
    data: [],
    decls: [],
  };
}

// ---------------------------------------------------------------------------
// Suite A — structural / unit tests
// ---------------------------------------------------------------------------

describe('wire encoder — unit tests', () => {
  it('A1: minimal module (no decls, no data) produces only I1 and M lines', () => {
    const mod = makeMinimal('test', '1.0', ['core']);
    const out = encodeModule(mod);
    expect(out).toBe('I1\nM test v=1.0 d=core\n');
  });

  it('A2: single VarNode in decls produces an F line', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: intType }],
    };
    const out = encodeModule(mod);
    expect(out).toContain('\nF ');
  });

  it('A3: single ADT declaration in data produces a D line', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core', 'ion-adt'],
      imports: [],
      data: [
        {
          kind: 'AdtDecl',
          name: 'Maybe',
          symbolId: makeSymbolId('mod:Maybe:0'),
          variants: [
            { tag: 'Some', symbolId: makeSymbolId('mod:Some:0'), fields: [], span },
            { tag: 'None', symbolId: makeSymbolId('mod:None:0'), fields: [], span },
          ],
          span,
          type: intType,
        },
      ],
      decls: [],
    };
    const out = encodeModule(mod);
    expect(out).toContain('\nD ');
  });

  it('A4: ModuleRef import produces an X line', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core'],
      imports: [
        {
          kind: 'ModuleRef',
          modulePath: ['org', 'example', 'utils'],
          symbolId: makeSymbolId('utils:0'),
          span,
          type: intType,
        },
      ],
      data: [],
      decls: [],
    };
    const out = encodeModule(mod);
    expect(out).toContain('\nX import ');
  });

  it('A5: long repeated name gets pooled in S section', () => {
    const longName = 'getUserByIdFromDatabase';
    const varNode: IonIRNode = { kind: 'Var', name: longName, symbolId: sid, span, type: intType };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [varNode, varNode, varNode, varNode, varNode],
    };
    const out = encodeModule(mod);
    expect(out).toContain('\nS ');
    expect(out).toContain(longName);
  });

  it('A6: short name appearing many times is NOT pooled', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: Array(10).fill(varNode) as IonIRNode[],
    };
    const out = encodeModule(mod);
    expect(out).not.toContain('\nS ');
  });

  it('A7: repeated complex type gets pooled in T section', () => {
    const complexType: IonType = { kind: 'Option', inner: { kind: 'List', elem: intType } };
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: complexType };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [varNode, varNode, varNode, varNode, varNode, varNode, varNode, varNode, varNode, varNode],
    };
    const out = encodeModule(mod);
    expect(out).toContain('\nT ');
  });

  it('A8: FnType with non-empty EffectSet encodes effects in type expression', () => {
    const effects: EffectSet = new Set<EffectTag>(['io', 'async']);
    const fnType: IonType = { kind: 'Fn', params: [intType], ret: intType, effects };
    // Use a Let binding so the bindingType is explicitly encoded in the F line.
    const letNode: IonIRNode = {
      kind: 'Let',
      name: 'f',
      symbolId: sid,
      bindingType: fnType,
      value: { kind: 'Var', name: 'g', symbolId: sid, span, type: intType },
      body: { kind: 'Var', name: 'f', symbolId: sid, span, type: intType },
      span,
      type: intType,
    };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [letNode],
    };
    const out = encodeModule(mod);
    expect(out).toMatch(/!async,io/);
  });

  it('A9: all 5 dialects appear in M line d= field', () => {
    const mod = makeMinimal('test', '1.0', ['core', 'ion-oop', 'ion-async', 'ion-adt', 'ion-effects']);
    const out = encodeModule(mod);
    expect(out).toMatch(/^M test v=1\.0 d=core,ion-adt,ion-async,ion-effects,ion-oop$/m);
  });

  it('A10: all node kinds encode without crashing and produce non-empty output', () => {
    const varNode: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    const decls: IonIRNode[] = [
      // Var
      varNode,
      // Literal (all sub-kinds)
      { kind: 'Literal', value: { kind: 'Int', value: 42 }, span, type: intType },
      { kind: 'Literal', value: { kind: 'Float', value: 3.14 }, span, type: { kind: 'Float' } },
      { kind: 'Literal', value: { kind: 'Str', value: 'hello' }, span, type: { kind: 'Str' } },
      { kind: 'Literal', value: { kind: 'Bool', value: true }, span, type: { kind: 'Bool' } },
      { kind: 'Literal', value: { kind: 'Null' }, span, type: { kind: 'Null' } },
      // App
      { kind: 'App', callee: varNode, args: [varNode], span, type: intType },
      // Abs
      {
        kind: 'Abs',
        params: [{ name: 'p', symbolId: sid, type: intType, span }],
        body: varNode,
        captures: [],
        span,
        type: intType,
      },
      // Let
      { kind: 'Let', name: 'y', symbolId: sid, bindingType: intType, value: varNode, body: varNode, span, type: intType },
      // Case
      {
        kind: 'Case',
        scrutinee: varNode,
        arms: [
          { pattern: { kind: 'Wildcard', span }, body: varNode, span },
          { pattern: { kind: 'Var', name: 'v', symbolId: sid, span }, body: varNode, span },
          {
            pattern: {
              kind: 'Constructor',
              ctorName: 'Some',
              symbolId: sid,
              fields: [{ kind: 'Wildcard', span }],
              span,
            },
            guard: varNode,
            body: varNode,
            span,
          },
          { pattern: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span }, body: varNode, span },
        ],
        span,
        type: intType,
      },
      // Constructor
      { kind: 'Constructor', ctorName: 'Some', symbolId: sid, args: [varNode], span, type: intType },
      // Accessor
      { kind: 'Accessor', receiver: varNode, member: 'field', span, type: intType },
      // ModuleRef
      { kind: 'ModuleRef', modulePath: ['org', 'example'], symbolId: sid, span, type: intType },
      // ForeignRef
      {
        kind: 'ForeignRef',
        target: 'js',
        module: 'std',
        symbol: 'console_log',
        sig: { params: [intType], ret: { kind: 'Unit' }, template: '$1' },
        span,
        type: intType,
      },
      // Effect
      { kind: 'Effect', effectTag: 'io', body: varNode, span, type: intType },
      // OopNew
      { kind: 'OopNew', ctorSymbolId: makeSymbolId('mod:Foo:0'), args: [varNode], span, type: intType },
      // OopVirtualCall
      { kind: 'OopVirtualCall', receiver: varNode, method: 'doSomething', args: [varNode], span, type: intType },
      // OopThis
      { kind: 'OopThis', span, type: intType },
      // AsyncBlock
      { kind: 'AsyncBlock', body: varNode, span, type: intType },
      // Await
      { kind: 'Await', expr: varNode, span, type: intType },
      // AdtMatch
      {
        kind: 'AdtMatch',
        scrutinee: varNode,
        arms: [
          {
            tag: 'Some',
            bindings: [{ name: 'v', symbolId: sid, type: intType, span }],
            body: varNode,
            span,
          },
        ],
        span,
        type: intType,
      },
      // Perform
      {
        kind: 'Perform',
        effectSymbolId: makeSymbolId('mod:Logger:0'),
        operation: 'log',
        args: [varNode],
        span,
        type: intType,
      },
      // Handle
      {
        kind: 'Handle',
        body: varNode,
        handlers: [{ operation: 'read', params: [], body: varNode, span }],
        returnClause: varNode,
        span,
        type: intType,
      },
      // Resume
      { kind: 'Resume', value: varNode, span, type: intType },
    ];

    // Also test declaration-style nodes in decls (go to D section)
    const declNodes: IonIRNode[] = [
      // OopClass
      {
        kind: 'OopClass',
        name: 'Foo',
        symbolId: sid,
        interfaces: [],
        fields: [{ name: 'bar', symbolId: sid, type: intType, span }],
        methods: [
          {
            name: 'baz',
            symbolId: sid,
            params: [],
            retType: intType,
            body: varNode,
            isAbstract: false,
            isStatic: false,
            span,
          },
        ],
        span,
        type: intType,
      },
      // OopInterface
      {
        kind: 'OopInterface',
        name: 'IFoo',
        symbolId: sid,
        members: [{ name: 'qux', symbolId: sid, type: intType, span }],
        span,
        type: intType,
      },
      // EffectDecl
      {
        kind: 'EffectDecl',
        name: 'Logger',
        symbolId: sid,
        operations: [
          {
            name: 'log',
            params: [{ name: 'msg', symbolId: sid, type: { kind: 'Str' }, span }],
            retType: { kind: 'Unit' },
            span,
          },
        ],
        span,
        type: intType,
      },
    ];

    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core', 'ion-oop', 'ion-async', 'ion-adt', 'ion-effects'],
      imports: [],
      data: [],
      decls: [...decls, ...declNodes],
    };

    const out = encodeModule(mod);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('A11: encodeModule is deterministic for same object reference', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: intType }],
    };
    expect(encodeModule(mod)).toBe(encodeModule(mod));
  });

  it('A12: encodeModule is deterministic for structurally equal modules', () => {
    const makeModule = (): IonIRModule => ({
      ionir: '1.0',
      module: 'org.example',
      version: '1.0.0',
      dialects: ['core', 'ion-adt'],
      imports: [],
      data: [
        {
          kind: 'AdtDecl',
          name: 'Result',
          symbolId: makeSymbolId('mod:Result:0'),
          variants: [
            { tag: 'Ok', symbolId: makeSymbolId('mod:Ok:0'), fields: [], span },
            { tag: 'Err', symbolId: makeSymbolId('mod:Err:0'), fields: [], span },
          ],
          span,
          type: intType,
        },
      ],
      decls: [{ kind: 'Var', name: 'identity', symbolId: makeSymbolId('mod:identity:0'), span, type: intType }],
    });
    expect(encodeModule(makeModule())).toBe(encodeModule(makeModule()));
  });
});

// ---------------------------------------------------------------------------
// Arbitraries (reused from ir.test.ts pattern)
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
    fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ name, symbolId, span: s, type }) => ({ kind: 'Var', name, symbolId, span: s, type })),
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
    fc.record({ callee: tie('nodeArb'), args: fc.array(tie('nodeArb'), { maxLength: 2 }), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ callee, args, span: s, type }) => ({ kind: 'App', callee, args, span: s, type })),
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
    fc.record({ body: tie('nodeArb'), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ body, span: s, type }) => ({ kind: 'AsyncBlock', body, span: s, type })),
    fc.record({ expr: tie('nodeArb'), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ expr, span: s, type }) => ({ kind: 'Await', expr, span: s, type })),
    fc.record({ value: tie('nodeArb'), span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ value, span: s, type }) => ({ kind: 'Resume', value, span: s, type })),
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
// Suite B — property tests
// ---------------------------------------------------------------------------

describe('wire encoder — property tests', () => {
  it('B1: encodeModule is deterministic for any valid module (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(encodeModule(m)).toBe(encodeModule(m));
      }),
      { numRuns: 200 },
    );
  });

  it('B2: output always starts with I1\\n (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(encodeModule(m).startsWith('I1\n')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('B3: output always ends with \\n (200 runs)', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        expect(encodeModule(m).endsWith('\n')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
