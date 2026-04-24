import * as fc from 'fast-check';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode, IonIRDialect } from '../../src/ir/nodes.js';
import type { IonType, EffectSet } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import type { EffectTag } from '../../src/ast/types.js';

export const spanArb: fc.Arbitrary<Span> = fc.record({
  file: fc.string({ minLength: 1, maxLength: 20 }),
  startLine: fc.integer({ min: 1, max: 100 }),
  startCol: fc.integer({ min: 0, max: 80 }),
  endLine: fc.integer({ min: 1, max: 100 }),
  endCol: fc.integer({ min: 0, max: 80 }),
});

export const symbolIdArb = fc.string({ minLength: 1, maxLength: 20 }).map(s => makeSymbolId(s));

export const effectTagArb: fc.Arbitrary<EffectTag> = fc.oneof(
  fc.constantFrom('io' as EffectTag, 'async' as EffectTag, 'llm' as EffectTag),
  fc.string({ minLength: 1, maxLength: 10 }),
);

export const effectSetArb: fc.Arbitrary<EffectSet> = fc
  .array(effectTagArb, { maxLength: 3 })
  .map(tags => new Set(tags));

export const { ionTypeArb, nodeArb } = fc.letrec<{ ionTypeArb: IonType; nodeArb: IonIRNode }>(tie => ({
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
    { depthSize: 0.5 },
    // Leaf: Var
    fc.record({ name: fc.string({ minLength: 1, maxLength: 10 }), symbolId: symbolIdArb, span: spanArb, type: tie('ionTypeArb') })
      .map<IonIRNode>(({ name, symbolId, span: s, type }) => ({ kind: 'Var', name, symbolId, span: s, type })),
    // Leaf: Literal
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

export const dialectArb: fc.Arbitrary<IonIRDialect> = fc.constantFrom(
  'core' as IonIRDialect,
  'ion-oop' as IonIRDialect,
  'ion-async' as IonIRDialect,
  'ion-adt' as IonIRDialect,
  'ion-effects' as IonIRDialect,
);

export const moduleRefArb = fc.record({
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

export const adtDeclArb = fc.record({
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

export const moduleArb: fc.Arbitrary<IonIRModule> = fc.record({
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
