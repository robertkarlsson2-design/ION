import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { serializeModule, deserializeModule, IonIRSerdeError, MAX_NESTING_DEPTH } from '../../src/ir/serde.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import type { IonType, EffectSet } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import type { EffectTag } from '../../src/ast/types.js';
import { moduleArb } from './helpers.js';

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

  it('round-trips Float(-0) preserving the sign of negative zero', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example.negzero',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Literal', value: { kind: 'Float', value: -0 }, span, type: intType }],
    };
    const out = deserializeModule(serializeModule(mod));
    const outVal = ((out.decls[0] as { value: { value: number } }).value as { value: number }).value;
    expect(Object.is(outVal, -0)).toBe(true);
  });
});

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

  it('throws IonIRSerdeError when serializing Float(Infinity)', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Literal', value: { kind: 'Float', value: Infinity }, span, type: intType }],
    };
    expect(() => serializeModule(mod)).toThrow(IonIRSerdeError);
    expect(() => serializeModule(mod)).toThrow('decls[0].value.value');
  });

  it('throws IonIRSerdeError when serializing Float(-Infinity)', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Literal', value: { kind: 'Float', value: -Infinity }, span, type: intType }],
    };
    expect(() => serializeModule(mod)).toThrow(IonIRSerdeError);
    expect(() => serializeModule(mod)).toThrow('decls[0].value.value');
  });

  it('throws IonIRSerdeError when serializing Float(NaN)', () => {
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'org.example',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Literal', value: { kind: 'Float', value: NaN }, span, type: intType }],
    };
    expect(() => serializeModule(mod)).toThrow(IonIRSerdeError);
    expect(() => serializeModule(mod)).toThrow('decls[0].value.value');
  });
});

// ---------------------------------------------------------------------------
// Suite D — depth limit guards
// ---------------------------------------------------------------------------

describe('IonIR serde — depth limit guards', () => {
  const testSpan = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
  const testSid = 'mod:x:0';

  function makeDeepLetJson(depth: number): unknown {
    const leaf = {
      kind: 'Var',
      name: 'x',
      symbolId: testSid,
      span: testSpan,
      type: { kind: 'Int' },
    };
    let node: unknown = leaf;
    for (let i = 0; i < depth; i++) {
      node = {
        kind: 'Let',
        name: 'x',
        symbolId: testSid,
        bindingType: { kind: 'Int' },
        value: leaf,
        body: node,
        span: testSpan,
        type: { kind: 'Int' },
      };
    }
    return node;
  }

  function makeDeepListTypeJson(depth: number): unknown {
    let type: unknown = { kind: 'Int' };
    for (let i = 0; i < depth; i++) {
      type = { kind: 'List', elem: type };
    }
    return type;
  }

  function makeDeepLetWithAdtDeclJson(depth: number): unknown {
    const leaf = {
      kind: 'Var',
      name: 'x',
      symbolId: testSid,
      span: testSpan,
      type: { kind: 'Int' },
    };
    let node: unknown = {
      kind: 'AdtDecl',
      name: 'T',
      symbolId: testSid,
      variants: [],
      span: testSpan,
      type: { kind: 'List', elem: { kind: 'List', elem: { kind: 'List', elem: { kind: 'Int' } } } },
    };
    for (let i = 0; i < depth; i++) {
      node = {
        kind: 'Let',
        name: 'x',
        symbolId: testSid,
        bindingType: { kind: 'Int' },
        value: leaf,
        body: node,
        span: testSpan,
        type: { kind: 'Int' },
      };
    }
    return node;
  }

  function wrapInModule(decl: unknown): string {
    return JSON.stringify({
      ionir: '1.0',
      module: 'org.test',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [decl],
    });
  }

  it('node depth: exactly at limit does not throw', () => {
    const json = wrapInModule(makeDeepLetJson(MAX_NESTING_DEPTH));
    expect(() => deserializeModule(json)).not.toThrow();
  });

  it('node depth: one past the limit throws IonIRSerdeError', () => {
    const json = wrapInModule(makeDeepLetJson(MAX_NESTING_DEPTH + 1));
    expect(() => deserializeModule(json)).toThrow(IonIRSerdeError);
  });

  it('node depth: error message contains "node nesting exceeds maximum depth"', () => {
    const json = wrapInModule(makeDeepLetJson(MAX_NESTING_DEPTH + 1));
    expect(() => deserializeModule(json)).toThrow(/node nesting exceeds maximum depth/);
  });

  it('type depth: exactly at limit does not throw', () => {
    const decl = {
      kind: 'Var',
      name: 'x',
      symbolId: testSid,
      span: testSpan,
      type: makeDeepListTypeJson(MAX_NESTING_DEPTH),
    };
    const json = wrapInModule(decl);
    expect(() => deserializeModule(json)).not.toThrow();
  });

  it('type depth: one past the limit throws IonIRSerdeError', () => {
    const decl = {
      kind: 'Var',
      name: 'x',
      symbolId: testSid,
      span: testSpan,
      type: makeDeepListTypeJson(MAX_NESTING_DEPTH + 1),
    };
    const json = wrapInModule(decl);
    expect(() => deserializeModule(json)).toThrow(IonIRSerdeError);
  });

  it('type depth: error message contains "type nesting exceeds maximum depth"', () => {
    const decl = {
      kind: 'Var',
      name: 'x',
      symbolId: testSid,
      span: testSpan,
      type: makeDeepListTypeJson(MAX_NESTING_DEPTH + 1),
    };
    const json = wrapInModule(decl);
    expect(() => deserializeModule(json)).toThrow(/type nesting exceeds maximum depth/);
  });

  it('depth error is an IonIRSerdeError instance', () => {
    const json = wrapInModule(makeDeepLetJson(MAX_NESTING_DEPTH + 1));
    let caught: unknown;
    try {
      deserializeModule(json);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IonIRSerdeError);
  });

  it('node depth: AdtDecl inside Let-chain at exactly the limit does not throw', () => {
    // 997 Lets + AdtDecl with 3-deep List type: peak type depth = 997 + 3 = 1000, within limit
    const json = wrapInModule(makeDeepLetWithAdtDeclJson(MAX_NESTING_DEPTH - 3));
    expect(() => deserializeModule(json)).not.toThrow();
  });

  it('node depth: AdtDecl inside Let-chain inherits outer depth', () => {
    // 998 Lets + AdtDecl with 3-deep List type: peak type depth = 998 + 3 = 1001 > 1000, throws
    const json = wrapInModule(makeDeepLetWithAdtDeclJson(MAX_NESTING_DEPTH - 2));
    expect(() => deserializeModule(json)).toThrow(IonIRSerdeError);
  });
});

// ---------------------------------------------------------------------------
// Suite E — serializer depth limit guards
// ---------------------------------------------------------------------------

describe('IonIR serde — serializer depth limit guards', () => {
  function makeDeepLetModule(n: number): IonIRModule {
    let node: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    for (let i = 0; i < n; i++) {
      node = {
        kind: 'Let',
        name: 'x',
        symbolId: sid,
        bindingType: intType,
        value: { kind: 'Var', name: 'x', symbolId: sid, span, type: intType },
        body: node,
        span,
        type: intType,
      };
    }
    return {
      ionir: '1.0',
      module: 'org.example.deep',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [node],
    };
  }

  it('deeply-nested module throws IonIRSerdeError', () => {
    expect(() => serializeModule(makeDeepLetModule(MAX_NESTING_DEPTH + 10))).toThrow(IonIRSerdeError);
  });

  it('error message matches /module exceeds max nesting depth/', () => {
    expect(() => serializeModule(makeDeepLetModule(MAX_NESTING_DEPTH + 10))).toThrow(/module exceeds max nesting depth/);
  });

  it('thrown value is instanceof IonIRSerdeError', () => {
    let caught: unknown;
    try {
      serializeModule(makeDeepLetModule(MAX_NESTING_DEPTH + 10));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IonIRSerdeError);
  });

  it('shallow module does not throw', () => {
    expect(() => serializeModule(makeDeepLetModule(2))).not.toThrow();
  });
});
