import { describe, it, expect } from 'vitest';
import { decodeModule, WireDecodeError } from '../../src/wire/decoder.js';
import { encodeModule } from '../../src/wire/encoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule } from '../../src/ir/nodes.js';
import type { Span } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
const sid = makeSymbolId('test:x:0');

function makeMinimal(): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test.module',
    version: '1.0.0',
    dialects: [],
    imports: [],
    data: [],
    decls: [],
  };
}

// A module where all node.type fields are primitive (Unit) so pool construction
// is unaffected by the placeholder types used by the decoder.
const roundTripModule: IonIRModule = {
  ionir: '1.0',
  module: 'org.example',
  version: '0.1.0',
  dialects: ['core'],
  imports: [],
  data: [],
  decls: [
    {
      kind: 'Let',
      name: 'result',
      symbolId: sid,
      bindingType: { kind: 'Int' },
      value: {
        kind: 'App',
        callee: { kind: 'Var', name: 'add', symbolId: sid, span, type: { kind: 'Unit' } },
        args: [
          { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: { kind: 'Int' } },
          { kind: 'Literal', value: { kind: 'Int', value: 2 }, span, type: { kind: 'Int' } },
        ],
        span,
        type: { kind: 'Unit' },
      },
      body: { kind: 'Var', name: 'result', symbolId: sid, span, type: { kind: 'Unit' } },
      span,
      type: { kind: 'Unit' },
    },
  ],
};

// ---------------------------------------------------------------------------
// D1 — minimal module (no pools, no sections)
// ---------------------------------------------------------------------------

describe('D1: minimal module', () => {
  it('decodes a bare I1/M module', () => {
    const wire = 'I1\nM test.module v=1.0.0\n';
    const result = decodeModule(wire);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.module).toBe('test.module');
    expect(result.version).toBe('1.0.0');
    // The decoder defaults missing `d=` to ["core"] (wire-format sugar). The
    // round-trip property no longer holds for empty-dialects encodings —
    // encoder emits no `d=` for [], decoder reads as ["core"]. That's an
    // accepted API change — agents should always think of "core" as the
    // default dialect now.
    expect(result.dialects).toEqual(['core']);
    expect(result.imports).toHaveLength(0);
    expect(result.data).toHaveLength(0);
    expect(result.decls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D2 — symbol pool alias resolution
// ---------------------------------------------------------------------------

describe('D2: symbol pool', () => {
  it('resolves sym-pool aliases in identifiers', () => {
    // Build a module with a poolable name and encode it.
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core'],
      decls: [
        {
          kind: 'Var',
          name: 'longIdentifierName',
          symbolId: sid,
          span,
          type: { kind: 'Unit' },
        },
        {
          kind: 'Var',
          name: 'longIdentifierName',
          symbolId: sid,
          span,
          type: { kind: 'Unit' },
        },
        {
          kind: 'Var',
          name: 'longIdentifierName',
          symbolId: sid,
          span,
          type: { kind: 'Unit' },
        },
      ],
    };
    const wire = encodeModule(mod);
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    // All three decls should resolve to the original name.
    expect(decoded.decls[0]).toMatchObject({ kind: 'Var', name: 'longIdentifierName' });
    expect(decoded.decls[1]).toMatchObject({ kind: 'Var', name: 'longIdentifierName' });
    expect(decoded.decls[2]).toMatchObject({ kind: 'Var', name: 'longIdentifierName' });
  });
});

// ---------------------------------------------------------------------------
// D3 — type pool alias resolution
// ---------------------------------------------------------------------------

describe('D3: type pool', () => {
  it('resolves type-pool aliases in type expressions', () => {
    const complexType = {
      kind: 'Fn' as const,
      params: [{ kind: 'Int' as const }],
      ret: { kind: 'Str' as const },
      effects: new Set<string>(),
    };
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core'],
      decls: [
        { kind: 'Let', name: 'a', symbolId: sid, bindingType: complexType, value: { kind: 'Var', name: 'a', symbolId: sid, span, type: { kind: 'Unit' } }, body: { kind: 'Var', name: 'a', symbolId: sid, span, type: { kind: 'Unit' } }, span, type: { kind: 'Unit' } },
        { kind: 'Let', name: 'b', symbolId: sid, bindingType: complexType, value: { kind: 'Var', name: 'b', symbolId: sid, span, type: { kind: 'Unit' } }, body: { kind: 'Var', name: 'b', symbolId: sid, span, type: { kind: 'Unit' } }, span, type: { kind: 'Unit' } },
        { kind: 'Let', name: 'c', symbolId: sid, bindingType: complexType, value: { kind: 'Var', name: 'c', symbolId: sid, span, type: { kind: 'Unit' } }, body: { kind: 'Var', name: 'c', symbolId: sid, span, type: { kind: 'Unit' } }, span, type: { kind: 'Unit' } },
      ],
    };
    const wire = encodeModule(mod);
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    // The Let nodes should have the correct bindingType resolved.
    const letNode = decoded.decls[0];
    expect(letNode).toBeDefined();
    if (letNode?.kind === 'Let') {
      expect(letNode.bindingType).toMatchObject({ kind: 'Fn' });
    }
  });
});

// ---------------------------------------------------------------------------
// D4 — imports (X section)
// ---------------------------------------------------------------------------

describe('D4: imports (X section)', () => {
  it('decodes module imports', () => {
    const imp = {
      kind: 'ModuleRef' as const,
      modulePath: ['org', 'utils'],
      symbolId: makeSymbolId('utils:fn:0'),
      span,
      type: { kind: 'Unit' as const },
    };
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core'],
      imports: [imp],
      decls: [],
    };
    const wire = encodeModule(mod);
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    expect(decoded.imports).toHaveLength(1);
    expect(decoded.imports[0]?.modulePath).toEqual(['org', 'utils']);
    expect(decoded.imports[0]?.symbolId).toBe('utils:fn:0');
  });
});

// ---------------------------------------------------------------------------
// D5 — data declarations (D section)
// ---------------------------------------------------------------------------

describe('D5: data declarations (D section)', () => {
  it('decodes ADT declarations with variants', () => {
    const adt = {
      kind: 'AdtDecl' as const,
      name: 'Color',
      symbolId: sid,
      variants: [
        { tag: 'Red', symbolId: sid, fields: [], span },
        {
          tag: 'Rgb',
          symbolId: sid,
          fields: [
            { name: 'r', symbolId: sid, type: { kind: 'Int' as const }, span },
            { name: 'g', symbolId: sid, type: { kind: 'Int' as const }, span },
          ],
          span,
        },
      ],
      span,
      type: { kind: 'Unit' as const },
    };
    const mod: IonIRModule = { ...makeMinimal(), dialects: ['core', 'ion-adt'], data: [adt], decls: [] };
    const wire = encodeModule(mod);
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    expect(decoded.data).toHaveLength(1);
    expect(decoded.data[0]?.name).toBe('Color');
    expect(decoded.data[0]?.variants).toHaveLength(2);
    expect(decoded.data[0]?.variants[0]?.tag).toBe('Red');
    expect(decoded.data[0]?.variants[1]?.tag).toBe('Rgb');
    expect(decoded.data[0]?.variants[1]?.fields).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// D6 — Let, Var, Abs, App, Literal, Case nodes in F section
// ---------------------------------------------------------------------------

describe('D6: core nodes', () => {
  it('decodes Let/Var/Abs/App/Literal/Case nodes', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core'],
      decls: [
        // Let: let x:int=42;x
        {
          kind: 'Let',
          name: 'x',
          symbolId: sid,
          bindingType: { kind: 'Int' },
          value: { kind: 'Literal', value: { kind: 'Int', value: 42 }, span, type: { kind: 'Int' } },
          body: { kind: 'Var', name: 'x', symbolId: sid, span, type: { kind: 'Int' } },
          span,
          type: { kind: 'Int' },
        },
        // Abs: (n:int)->n
        {
          kind: 'Abs',
          params: [{ name: 'n', symbolId: sid, type: { kind: 'Int' }, span }],
          body: { kind: 'Var', name: 'n', symbolId: sid, span, type: { kind: 'Int' } },
          captures: [],
          span,
          type: { kind: 'Unit' },
        },
        // App: add(1,2)
        {
          kind: 'App',
          callee: { kind: 'Var', name: 'add', symbolId: sid, span, type: { kind: 'Unit' } },
          args: [
            { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: { kind: 'Int' } },
            { kind: 'Literal', value: { kind: 'Int', value: 2 }, span, type: { kind: 'Int' } },
          ],
          span,
          type: { kind: 'Int' },
        },
        // Case: match(x){_->0}
        {
          kind: 'Case',
          scrutinee: { kind: 'Var', name: 'x', symbolId: sid, span, type: { kind: 'Int' } },
          arms: [
            {
              pattern: { kind: 'Wildcard', span },
              body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: { kind: 'Int' } },
              span,
            },
          ],
          span,
          type: { kind: 'Int' },
        },
      ],
    };
    const wire = encodeModule(mod);
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    expect(decoded.decls).toHaveLength(4);
    expect(decoded.decls[0]?.kind).toBe('Let');
    expect(decoded.decls[1]?.kind).toBe('Abs');
    expect(decoded.decls[2]?.kind).toBe('App');
    expect(decoded.decls[3]?.kind).toBe('Case');
    // Verify Let structure
    if (decoded.decls[0]?.kind === 'Let') {
      expect(decoded.decls[0].name).toBe('x');
      expect(decoded.decls[0].bindingType).toEqual({ kind: 'Int' });
    }
    // Verify Abs params
    if (decoded.decls[1]?.kind === 'Abs') {
      expect(decoded.decls[1].params[0]?.name).toBe('n');
    }
  });
});

// ---------------------------------------------------------------------------
// D7 — ForeignRef node
// ---------------------------------------------------------------------------

describe('D7: ForeignRef node', () => {
  it('decodes ffi: prefixed ForeignRef nodes', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core'],
      decls: [
        {
          kind: 'ForeignRef',
          target: 'js',
          module: 'console',
          symbol: 'log',
          sig: { params: [{ kind: 'Str' }], ret: { kind: 'Unit' }, template: '$1.log($2)', paramNames: ['msg'] },
          span,
          type: { kind: 'Unit' },
        },
      ],
    };
    const wire = encodeModule(mod);
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    expect(decoded.decls[0]?.kind).toBe('ForeignRef');
    if (decoded.decls[0]?.kind === 'ForeignRef') {
      expect(decoded.decls[0].target).toBe('js');
      expect(decoded.decls[0].module).toBe('console');
      expect(decoded.decls[0].symbol).toBe('log');
    }
  });
});

// ---------------------------------------------------------------------------
// D8 — Round-trip byte stability
// ---------------------------------------------------------------------------

describe('D8: round-trip byte stability', () => {
  it('encodeModule(decodeModule(encodeModule(m))) === encodeModule(m)', () => {
    const w1 = encodeModule(roundTripModule);
    const decoded = decodeModule(w1);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    const w2 = encodeModule(decoded);
    expect(w2).toBe(w1);
  });

  it('is also stable for the minimal module', () => {
    const minimal: IonIRModule = {
      ionir: '1.0',
      module: 'org.example',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: { kind: 'Int' } }],
    };
    const w1 = encodeModule(minimal);
    const decoded = decodeModule(w1);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    expect(encodeModule(decoded)).toBe(w1);
  });
});

// ---------------------------------------------------------------------------
// D9 — Non-wire input returns error
// ---------------------------------------------------------------------------

describe('D9: non-wire input', () => {
  it('returns { error } for a JSON string without throwing', () => {
    const json = JSON.stringify({ ionir: '1.0', module: 'x', version: '1.0', dialects: [] });
    const result = decodeModule(json);
    expect('error' in result).toBe(true);
    expect(() => decodeModule(json)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// D10 — Wrong version header
// ---------------------------------------------------------------------------

describe('D10: wrong version header', () => {
  it('returns { error } for I2 header', () => {
    const wire = 'I2\nM test.module v=1.0.0\n';
    const result = decodeModule(wire);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('I1');
    }
  });
});

// ---------------------------------------------------------------------------
// D11 — Truncated / malformed input
// ---------------------------------------------------------------------------

describe('D11: truncated input', () => {
  it('returns { error } for a wire file missing the M line', () => {
    const result = decodeModule('I1\n');
    expect('error' in result).toBe(true);
  });

  it('returns { error } for a truncated F section node', () => {
    const wire = 'I1\nM test.module v=1.0.0\nF let x:\n';
    const result = decodeModule(wire);
    expect('error' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D12 — TupleType wire encoding and decoding
// ---------------------------------------------------------------------------

describe('D12: TupleType wire roundtrip', () => {
  it('encodes and decodes a Let with TupleType bindingType', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core'],
      decls: [
        {
          kind: 'Let',
          name: 'pair',
          symbolId: sid,
          bindingType: { kind: 'Tuple', elements: [{ kind: 'Int' }, { kind: 'Str' }] },
          value: { kind: 'Var', name: 'pair', symbolId: sid, span, type: { kind: 'Unit' } },
          body: { kind: 'Var', name: 'pair', symbolId: sid, span, type: { kind: 'Unit' } },
          span,
          type: { kind: 'Unit' },
        },
      ],
    };
    const wire = encodeModule(mod);
    expect(wire).toContain('tup<int,str>');
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    const letNode = decoded.decls[0];
    expect(letNode?.kind).toBe('Let');
    if (letNode?.kind === 'Let') {
      expect(letNode.bindingType).toEqual({ kind: 'Tuple', elements: [{ kind: 'Int' }, { kind: 'Str' }] });
    }
  });

  it('encodes and decodes an empty tuple tup<>', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core'],
      decls: [
        {
          kind: 'Let',
          name: 'empty',
          symbolId: sid,
          bindingType: { kind: 'Tuple', elements: [] },
          value: { kind: 'Var', name: 'empty', symbolId: sid, span, type: { kind: 'Unit' } },
          body: { kind: 'Var', name: 'empty', symbolId: sid, span, type: { kind: 'Unit' } },
          span,
          type: { kind: 'Unit' },
        },
      ],
    };
    const wire = encodeModule(mod);
    expect(wire).toContain('tup<>');
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    const letNode = decoded.decls[0];
    if (letNode?.kind === 'Let') {
      expect(letNode.bindingType).toEqual({ kind: 'Tuple', elements: [] });
    }
  });

  it('is byte-stable through a double roundtrip', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core'],
      decls: [
        {
          kind: 'Let',
          name: 'triple',
          symbolId: sid,
          bindingType: { kind: 'Tuple', elements: [{ kind: 'Int' }, { kind: 'Str' }, { kind: 'Bool' }] },
          value: { kind: 'Var', name: 'triple', symbolId: sid, span, type: { kind: 'Unit' } },
          body: { kind: 'Var', name: 'triple', symbolId: sid, span, type: { kind: 'Unit' } },
          span,
          type: { kind: 'Unit' },
        },
      ],
    };
    const w1 = encodeModule(mod);
    const d1 = decodeModule(w1);
    expect('error' in d1).toBe(false);
    if ('error' in d1) return;
    expect(encodeModule(d1)).toBe(w1);
  });
});

// ---------------------------------------------------------------------------
// WireDecodeError — class exists and has correct name
// ---------------------------------------------------------------------------

describe('WireDecodeError', () => {
  it('has name WireDecodeError', () => {
    const e = new WireDecodeError('test');
    expect(e.name).toBe('WireDecodeError');
    expect(e).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// D10: list literal [...]  — decoder parity with encoder
// ---------------------------------------------------------------------------

describe('D10: list literal', () => {
  it('decodes an empty list literal []', () => {
    const wire = `I1\nM test v=0.1.0\nS\nF let xs:never=[];0\n`;
    const mod = decodeModule(wire);
    expect('error' in mod).toBe(false);
    if ('error' in mod) return;
    const decl = mod.decls[0];
    expect(decl?.kind).toBe('Let');
    if (decl?.kind !== 'Let') return;
    expect(decl.value.kind).toBe('ListLit');
    if (decl.value.kind !== 'ListLit') return;
    expect(decl.value.elements).toHaveLength(0);
  });

  it('decodes a single-element list [x]', () => {
    const wire = `I1\nM test v=0.1.0\nS\nF let xs:never=[42];0\n`;
    const mod = decodeModule(wire);
    expect('error' in mod).toBe(false);
    if ('error' in mod) return;
    const decl = mod.decls[0];
    if (decl?.kind !== 'Let') return;
    expect(decl.value.kind).toBe('ListLit');
    if (decl.value.kind !== 'ListLit') return;
    expect(decl.value.elements).toHaveLength(1);
    const el = decl.value.elements[0];
    expect(el?.kind).toBe('Literal');
    if (el?.kind !== 'Literal') return;
    expect(el.value).toEqual({ kind: 'Int', value: 42 });
  });

  it('decodes a multi-element list ["a","b","c"]', () => {
    const wire = `I1\nM test v=0.1.0\nS\nF let xs:never=["a","b","c"];0\n`;
    const mod = decodeModule(wire);
    expect('error' in mod).toBe(false);
    if ('error' in mod) return;
    const decl = mod.decls[0];
    if (decl?.kind !== 'Let') return;
    if (decl.value.kind !== 'ListLit') return;
    expect(decl.value.elements).toHaveLength(3);
    expect((decl.value.elements[1] as any).value).toEqual({ kind: 'Str', value: 'b' });
  });

  it('round-trips a ListLit through encode → decode', () => {
    const mod: IonIRModule = {
      ionir: '1.0', module: 'test', version: '0.1.0',
      // explicit ["core"] (instead of []) so the round-trip equality holds:
      // encoder emits `d=core`, decoder reads it as ["core"].
      dialects: ['core'], imports: [], data: [],
      decls: [{
        kind: 'Let', name: 'nums', symbolId: sid,
        bindingType: { kind: 'Unit' },
        value: {
          kind: 'ListLit',
          elements: [
            { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: { kind: 'Int' } },
            { kind: 'Literal', value: { kind: 'Int', value: 2 }, span, type: { kind: 'Int' } },
          ],
          span, type: { kind: 'Unit' },
        },
        body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: { kind: 'Int' } },
        span, type: { kind: 'Unit' },
      }],
    };
    const w1 = encodeModule(mod);
    const decoded = decodeModule(w1);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    expect(encodeModule(decoded)).toBe(w1);
  });
});

// ---------------------------------------------------------------------------
// D13 — TuplePattern wire round-trip
// ---------------------------------------------------------------------------

describe('D13: TuplePattern wire round-trip', () => {
  const varSid = makeSymbolId('test:a:0');

  const tuplePatternModule: IonIRModule = {
    ...makeMinimal(),
    dialects: ['core'],
    decls: [
      {
        kind: 'Case',
        scrutinee: { kind: 'Var', name: 'x', symbolId: sid, span, type: { kind: 'Unit' } },
        arms: [
          {
            pattern: {
              kind: 'Tuple',
              fields: [
                { kind: 'Var', name: 'a', symbolId: varSid, span },
                { kind: 'Wildcard', span },
              ],
              span,
            },
            body: { kind: 'Var', name: 'a', symbolId: varSid, span, type: { kind: 'Int' } },
            span,
          },
        ],
        span,
        type: { kind: 'Int' },
      },
    ],
  };

  it('encodes and decodes a TuplePattern (Var + Wildcard)', () => {
    const wire = encodeModule(tuplePatternModule);
    const decoded = decodeModule(wire);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    const caseDecl = decoded.decls[0];
    expect(caseDecl?.kind).toBe('Case');
    if (caseDecl?.kind !== 'Case') return;
    const arm = caseDecl.arms[0];
    expect(arm?.pattern.kind).toBe('Tuple');
    if (arm?.pattern.kind !== 'Tuple') return;
    expect(arm.pattern.fields).toHaveLength(2);
    expect(arm.pattern.fields[0]?.kind).toBe('Var');
    expect(arm.pattern.fields[1]?.kind).toBe('Wildcard');
  });

  it('is byte-stable through a double roundtrip', () => {
    const w1 = encodeModule(tuplePatternModule);
    const decoded = decodeModule(w1);
    expect('error' in decoded).toBe(false);
    if ('error' in decoded) return;
    expect(encodeModule(decoded)).toBe(w1);
  });
});

// ---------------------------------------------------------------------------
// Wire-form support for app(callee, ...args), async{...}, await(...)
// ---------------------------------------------------------------------------

describe('wire decoder — special forms for app/async/await', () => {
  it('app(callee, ...args) treats first arg as the callee', () => {
    const wire = 'I1\nM test v=0.1.0 d=core\nF let f:fn(int)->unit=(x:int)->app(ffi:js:console:log,x);0';
    const mod = decodeModule(wire) as IonIRModule;
    expect(mod.decls.length).toBeGreaterThan(0);
    // The body of the lambda should be App(ForeignRef, [Var x])
    // Walk: decls[0] is the let, value is Abs, body is App
    type AnyNode = { kind: string; callee?: AnyNode; body?: AnyNode; value?: AnyNode };
    const decl = mod.decls[0] as unknown as AnyNode;
    const lambda = (decl as { value?: AnyNode }).value;
    expect(lambda?.kind).toBe('Abs');
    const appNode = lambda?.body;
    expect(appNode?.kind).toBe('App');
    expect(appNode?.callee?.kind).toBe('ForeignRef');
  });

  it('async{body} parses to AsyncBlock', () => {
    const wire = 'I1\nM test v=0.1.0 d=core\nF let f:fn()->unit=()->async{0};0';
    const mod = decodeModule(wire) as IonIRModule;
    type AnyNode = { kind: string; body?: AnyNode; value?: AnyNode };
    const decl = mod.decls[0] as unknown as AnyNode;
    const lambda = (decl as { value?: AnyNode }).value;
    expect(lambda?.body?.kind).toBe('AsyncBlock');
  });

  it('await(expr) parses to Await', () => {
    const wire = 'I1\nM test v=0.1.0 d=core\nF let f:fn(any)->unit=(p:any)->await(p);0';
    const mod = decodeModule(wire) as IonIRModule;
    type AnyNode = { kind: string; body?: AnyNode; value?: AnyNode };
    const decl = mod.decls[0] as unknown as AnyNode;
    const lambda = (decl as { value?: AnyNode }).value;
    expect(lambda?.body?.kind).toBe('Await');
  });

});
