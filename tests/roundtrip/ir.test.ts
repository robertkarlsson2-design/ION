import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { makeSymbolId } from '../../src/types.js';
import { serialize, deserialize, IonIRSerdeError } from '../../src/ir/serde.js';
import type { Span, SymbolId } from '../../src/types.js';
import type { EffectTag } from '../../src/ast/types.js';
import type {
  IonIRModule,
  IonIRNode,
  IonIRDialect,
  LiteralValue,
  Param,
  CasePattern,
  CaseArm,
  ForeignSignature,
  OopMethod,
  OopMember,
  AdtVariant,
  AdtArm,
  EffectOp,
  EffectHandler,
  ModuleRefNode,
  AdtDeclNode,
} from '../../src/ir/nodes.js';
import type { IonType, EffectSet } from '../../src/ir/types.js';

// ---------------------------------------------------------------------------
// Non-recursive base arbitraries
// ---------------------------------------------------------------------------

const arbSpan: fc.Arbitrary<Span> = fc.record({
  file: fc.string({ minLength: 1, maxLength: 20 }),
  startLine: fc.integer({ min: 1, max: 1000 }),
  startCol: fc.integer({ min: 0, max: 200 }),
  endLine: fc.integer({ min: 1, max: 1000 }),
  endCol: fc.integer({ min: 0, max: 200 }),
});

const arbSymbolId: fc.Arbitrary<SymbolId> = fc
  .string({ minLength: 1, maxLength: 12 })
  .map(s => makeSymbolId('sym:' + s));

const arbEffectTag: fc.Arbitrary<EffectTag> = fc.constantFrom<EffectTag>('io', 'async', 'llm');

const arbEffectSet: fc.Arbitrary<EffectSet> = fc
  .array(arbEffectTag, { maxLength: 3 })
  .map(arr => new Set(arr) as EffectSet);

// -0, Infinity, -Infinity, and NaN cannot round-trip through JSON.stringify/parse.
const arbJsonSafeFloat: fc.Arbitrary<number> = fc
  .float({ noNaN: true, noDefaultInfinity: true })
  .filter(v => !Object.is(v, -0));

const arbLiteralValue: fc.Arbitrary<LiteralValue> = fc.oneof(
  fc.record({ kind: fc.constant('Int' as const), value: fc.integer() }),
  fc.record({ kind: fc.constant('Float' as const), value: arbJsonSafeFloat }),
  fc.record({ kind: fc.constant('Str' as const), value: fc.string() }),
  fc.record({ kind: fc.constant('Bool' as const), value: fc.boolean() }),
  fc.constant({ kind: 'Null' as const }),
);

// ---------------------------------------------------------------------------
// Depth-limited recursive arbitraries
// ---------------------------------------------------------------------------

function makeArbType(depth: number): fc.Arbitrary<IonType> {
  const leaves: fc.Arbitrary<IonType> = fc.oneof(
    fc.constant<IonType>({ kind: 'Int' }),
    fc.constant<IonType>({ kind: 'Float' }),
    fc.constant<IonType>({ kind: 'Str' }),
    fc.constant<IonType>({ kind: 'Bool' }),
    fc.constant<IonType>({ kind: 'Null' }),
    fc.constant<IonType>({ kind: 'Unit' }),
    fc.constant<IonType>({ kind: 'Never' }),
    fc.record<TypeVar>({ kind: fc.constant('TypeVar' as const), id: fc.string({ minLength: 1, maxLength: 8 }) }),
  );

  if (depth <= 0) return leaves;

  const sub = (): fc.Arbitrary<IonType> => makeArbType(depth - 1);

  return fc.oneof(
    { weight: 4, arbitrary: leaves },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('List' as const), elem: sub() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('Map' as const), key: sub(), value: sub() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('Option' as const), inner: sub() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('Result' as const), ok: sub(), err: sub() }) },
    {
      weight: 1, arbitrary: fc.record({
        kind: fc.constant('Fn' as const),
        params: fc.array(sub(), { maxLength: 3 }),
        ret: sub(),
        effects: arbEffectSet,
      }),
    },
    {
      weight: 1, arbitrary: fc.record({
        kind: fc.constant('User' as const),
        name: fc.string({ minLength: 1, maxLength: 10 }),
        symbolId: arbSymbolId,
        args: fc.array(sub(), { maxLength: 2 }),
      }),
    },
  );
}

// TypeVar interface for record typing
interface TypeVar { kind: 'TypeVar'; id: string; }

function makeArbParam(typeArb: fc.Arbitrary<IonType>): fc.Arbitrary<Param> {
  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 10 }),
    symbolId: arbSymbolId,
    type: typeArb,
    span: arbSpan,
  });
}

function makeArbForeignSig(typeArb: fc.Arbitrary<IonType>): fc.Arbitrary<ForeignSignature> {
  return fc.record({
    params: fc.array(typeArb, { maxLength: 3 }),
    ret: typeArb,
    template: fc.string({ minLength: 1, maxLength: 30 }),
  });
}

function makeArbOopMember(typeArb: fc.Arbitrary<IonType>): fc.Arbitrary<OopMember> {
  return fc.record({
    name: fc.string({ minLength: 1, maxLength: 10 }),
    symbolId: arbSymbolId,
    type: typeArb,
    span: arbSpan,
  });
}

function makeArbCasePattern(depth: number): fc.Arbitrary<CasePattern> {
  const leaves: fc.Arbitrary<CasePattern> = fc.oneof(
    fc.record({ kind: fc.constant('Wildcard' as const), span: arbSpan }),
    fc.record({
      kind: fc.constant('Var' as const),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      span: arbSpan,
    }),
    fc.record({ kind: fc.constant('Literal' as const), value: arbLiteralValue, span: arbSpan }),
  );

  if (depth <= 0) return leaves;

  return fc.oneof(
    { weight: 3, arbitrary: leaves },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('Constructor' as const),
        ctorName: fc.string({ minLength: 1, maxLength: 10 }),
        symbolId: arbSymbolId,
        fields: fc.array(makeArbCasePattern(depth - 1), { maxLength: 2 }),
        span: arbSpan,
      }),
    },
  );
}

function makeArbNode(depth: number, typeArb: fc.Arbitrary<IonType>): fc.Arbitrary<IonIRNode> {
  const param = makeArbParam(typeArb);
  const foreignSig = makeArbForeignSig(typeArb);
  const oopMember = makeArbOopMember(typeArb);
  const casePattern = makeArbCasePattern(2);

  // Leaf nodes — no sub-nodes
  const leafNodes: fc.Arbitrary<IonIRNode>[] = [
    fc.record({
      kind: fc.constant('Var' as const),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      span: arbSpan,
      type: typeArb,
    }),
    fc.record({ kind: fc.constant('Literal' as const), value: arbLiteralValue, span: arbSpan, type: typeArb }),
    fc.record({ kind: fc.constant('OopThis' as const), span: arbSpan, type: typeArb }),
    fc.record({
      kind: fc.constant('ModuleRef' as const),
      modulePath: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 3 }),
      symbolId: arbSymbolId,
      span: arbSpan,
      type: typeArb,
    }),
    fc.record({
      kind: fc.constant('ForeignRef' as const),
      target: fc.string({ minLength: 1, maxLength: 10 }),
      module: fc.string({ minLength: 1, maxLength: 10 }),
      symbol: fc.string({ minLength: 1, maxLength: 10 }),
      sig: foreignSig,
      span: arbSpan,
      type: typeArb,
    }),
    fc.record({
      kind: fc.constant('AdtDecl' as const),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      variants: fc.constant([]),
      span: arbSpan,
      type: typeArb,
    }),
    fc.record({
      kind: fc.constant('OopInterface' as const),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      members: fc.array(oopMember, { maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    fc.record({
      kind: fc.constant('EffectDecl' as const),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      operations: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 10 }),
          params: fc.array(param, { maxLength: 2 }),
          retType: typeArb,
          span: arbSpan,
        }),
        { maxLength: 2 },
      ),
      span: arbSpan,
      type: typeArb,
    }),
  ];

  if (depth <= 0) {
    return fc.oneof(...leafNodes);
  }

  const sub = (): fc.Arbitrary<IonIRNode> => makeArbNode(depth - 1, typeArb);

  const arbEffectHandler: fc.Arbitrary<EffectHandler> = fc.record({
    operation: fc.string({ minLength: 1, maxLength: 10 }),
    params: fc.array(param, { maxLength: 2 }),
    body: sub(),
    span: arbSpan,
  });

  const arbAdtArm: fc.Arbitrary<AdtArm> = fc.record({
    tag: fc.string({ minLength: 1, maxLength: 10 }),
    bindings: fc.array(param, { maxLength: 2 }),
    body: sub(),
    span: arbSpan,
  });

  const arbAdtVariantWithBody: fc.Arbitrary<AdtVariant> = fc.record({
    tag: fc.string({ minLength: 1, maxLength: 10 }),
    symbolId: arbSymbolId,
    fields: fc.array(param, { maxLength: 2 }),
    span: arbSpan,
  });

  const arbOopMethod: fc.Arbitrary<OopMethod> = fc.oneof(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      params: fc.array(param, { maxLength: 2 }),
      retType: typeArb,
      isAbstract: fc.constant(true),
      isStatic: fc.boolean(),
      span: arbSpan,
    }),
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      params: fc.array(param, { maxLength: 2 }),
      retType: typeArb,
      body: sub(),
      isAbstract: fc.constant(false),
      isStatic: fc.boolean(),
      span: arbSpan,
    }),
  );

  const arbCaseArmWithGuard: fc.Arbitrary<CaseArm> = fc.oneof(
    fc.record({ pattern: casePattern, body: sub(), span: arbSpan }),
    fc.record({ pattern: casePattern, guard: sub(), body: sub(), span: arbSpan }),
  );

  const recursiveNodes: fc.Arbitrary<IonIRNode>[] = [
    // App
    fc.record({
      kind: fc.constant('App' as const),
      callee: sub(),
      args: fc.array(sub(), { maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // Abs
    fc.record({
      kind: fc.constant('Abs' as const),
      params: fc.array(param, { maxLength: 2 }),
      body: sub(),
      captures: fc.array(arbSymbolId, { maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // Let
    fc.record({
      kind: fc.constant('Let' as const),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      bindingType: typeArb,
      value: sub(),
      body: sub(),
      span: arbSpan,
      type: typeArb,
    }),
    // Case
    fc.record({
      kind: fc.constant('Case' as const),
      scrutinee: sub(),
      arms: fc.array(arbCaseArmWithGuard, { minLength: 1, maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // Constructor
    fc.record({
      kind: fc.constant('Constructor' as const),
      ctorName: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      args: fc.array(sub(), { maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // Accessor
    fc.record({
      kind: fc.constant('Accessor' as const),
      receiver: sub(),
      member: fc.string({ minLength: 1, maxLength: 10 }),
      span: arbSpan,
      type: typeArb,
    }),
    // Effect
    fc.record({
      kind: fc.constant('Effect' as const),
      effectTag: arbEffectTag,
      body: sub(),
      span: arbSpan,
      type: typeArb,
    }),
    // OopClass (with optional superClass)
    fc.oneof(
      fc.record({
        kind: fc.constant('OopClass' as const),
        name: fc.string({ minLength: 1, maxLength: 10 }),
        symbolId: arbSymbolId,
        interfaces: fc.array(arbSymbolId, { maxLength: 2 }),
        fields: fc.array(param, { maxLength: 2 }),
        methods: fc.array(arbOopMethod, { maxLength: 2 }),
        span: arbSpan,
        type: typeArb,
      }),
      fc.record({
        kind: fc.constant('OopClass' as const),
        name: fc.string({ minLength: 1, maxLength: 10 }),
        symbolId: arbSymbolId,
        superClass: arbSymbolId,
        interfaces: fc.array(arbSymbolId, { maxLength: 2 }),
        fields: fc.array(param, { maxLength: 2 }),
        methods: fc.array(arbOopMethod, { maxLength: 2 }),
        span: arbSpan,
        type: typeArb,
      }),
    ),
    // OopNew
    fc.record({
      kind: fc.constant('OopNew' as const),
      ctorSymbolId: arbSymbolId,
      args: fc.array(sub(), { maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // OopVirtualCall
    fc.record({
      kind: fc.constant('OopVirtualCall' as const),
      receiver: sub(),
      method: fc.string({ minLength: 1, maxLength: 10 }),
      args: fc.array(sub(), { maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // AsyncBlock
    fc.record({ kind: fc.constant('AsyncBlock' as const), body: sub(), span: arbSpan, type: typeArb }),
    // Await
    fc.record({ kind: fc.constant('Await' as const), expr: sub(), span: arbSpan, type: typeArb }),
    // AdtDecl with variants
    fc.record({
      kind: fc.constant('AdtDecl' as const),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      symbolId: arbSymbolId,
      variants: fc.array(arbAdtVariantWithBody, { maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // AdtMatch
    fc.record({
      kind: fc.constant('AdtMatch' as const),
      scrutinee: sub(),
      arms: fc.array(arbAdtArm, { minLength: 1, maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // Perform
    fc.record({
      kind: fc.constant('Perform' as const),
      effectSymbolId: arbSymbolId,
      operation: fc.string({ minLength: 1, maxLength: 10 }),
      args: fc.array(sub(), { maxLength: 2 }),
      span: arbSpan,
      type: typeArb,
    }),
    // Handle (with optional returnClause)
    fc.oneof(
      fc.record({
        kind: fc.constant('Handle' as const),
        body: sub(),
        handlers: fc.array(arbEffectHandler, { maxLength: 2 }),
        span: arbSpan,
        type: typeArb,
      }),
      fc.record({
        kind: fc.constant('Handle' as const),
        body: sub(),
        handlers: fc.array(arbEffectHandler, { maxLength: 2 }),
        returnClause: sub(),
        span: arbSpan,
        type: typeArb,
      }),
    ),
    // Resume
    fc.record({ kind: fc.constant('Resume' as const), value: sub(), span: arbSpan, type: typeArb }),
  ];

  return fc.oneof(
    { weight: 3, arbitrary: fc.oneof(...leafNodes) },
    { weight: 2, arbitrary: fc.oneof(...recursiveNodes) },
  );
}

const arbType: fc.Arbitrary<IonType> = makeArbType(2);
const arbNode: fc.Arbitrary<IonIRNode> = makeArbNode(2, arbType);

const arbModuleRefNode: fc.Arbitrary<ModuleRefNode> = fc.record({
  kind: fc.constant('ModuleRef' as const),
  modulePath: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 3 }),
  symbolId: arbSymbolId,
  span: arbSpan,
  type: arbType,
});

const arbAdtDeclNode: fc.Arbitrary<AdtDeclNode> = fc.record({
  kind: fc.constant('AdtDecl' as const),
  name: fc.string({ minLength: 1, maxLength: 10 }),
  symbolId: arbSymbolId,
  variants: fc.constant([]),
  span: arbSpan,
  type: arbType,
});

const arbDialect: fc.Arbitrary<IonIRDialect> = fc.constantFrom<IonIRDialect>(
  'core', 'ion-oop', 'ion-async', 'ion-adt', 'ion-effects',
);

const arbModule: fc.Arbitrary<IonIRModule> = fc.record({
  ionir: fc.constant('1.0' as const),
  module: fc.string({ minLength: 1, maxLength: 20 }),
  version: fc.string({ minLength: 1, maxLength: 10 }),
  dialects: fc.array(arbDialect, { maxLength: 3 }),
  imports: fc.array(arbModuleRefNode, { maxLength: 2 }),
  data: fc.array(arbAdtDeclNode, { maxLength: 2 }),
  decls: fc.array(arbNode, { maxLength: 3 }),
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('IonIR JSON serde round-trip', () => {
  it('deserialize(serialize(m)) deep-equals m for all modules', () => {
    fc.assert(
      fc.property(arbModule, m => {
        expect(deserialize(serialize(m))).toEqual(m);
      }),
      { numRuns: 10000 },
    );
  });

  it('serialize is deterministic: serialize(deserialize(serialize(m))) === serialize(m)', () => {
    fc.assert(
      fc.property(arbModule, m => {
        const s1 = serialize(m);
        const s2 = serialize(deserialize(s1));
        expect(s2).toBe(s1);
      }),
      { numRuns: 10000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Error-rejection unit tests
// ---------------------------------------------------------------------------

describe('IonIRSerdeError — rejects invalid input', () => {
  it('throws on non-JSON input', () => {
    expect(() => deserialize('not json')).toThrowError(IonIRSerdeError);
  });

  it('throws on wrong version', () => {
    expect(() =>
      deserialize(JSON.stringify({ ionir: '2.0', module: 'x', version: '1', dialects: [], imports: [], data: [], decls: [] })),
    ).toThrowError(IonIRSerdeError);
  });

  it('throws on unknown node kind', () => {
    expect(() =>
      deserialize(
        JSON.stringify({
          ionir: '1.0',
          module: 'x',
          version: '1',
          dialects: [],
          imports: [],
          data: [],
          decls: [{ kind: 'UnknownKind', span: { file: 'x', startLine: 1, startCol: 0, endLine: 1, endCol: 1 }, type: { kind: 'Int' } }],
        }),
      ),
    ).toThrowError(IonIRSerdeError);
  });

  it('throws on unknown type kind', () => {
    const span = { file: 'x', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
    expect(() =>
      deserialize(
        JSON.stringify({
          ionir: '1.0',
          module: 'x',
          version: '1',
          dialects: [],
          imports: [],
          data: [],
          decls: [{ kind: 'Var', name: 'x', symbolId: 'sym:x', span, type: { kind: 'ComplexNumber' } }],
        }),
      ),
    ).toThrowError(IonIRSerdeError);
  });

  it('throws on missing required fields', () => {
    expect(() => deserialize(JSON.stringify({ ionir: '1.0' }))).toThrowError(IonIRSerdeError);
  });

  it('throws on unknown dialect', () => {
    expect(() =>
      deserialize(
        JSON.stringify({
          ionir: '1.0',
          module: 'x',
          version: '1',
          dialects: ['unknown-dialect'],
          imports: [],
          data: [],
          decls: [],
        }),
      ),
    ).toThrowError(IonIRSerdeError);
  });
});
