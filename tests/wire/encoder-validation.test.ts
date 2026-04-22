import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encodeModule, WireEncodeError } from '../../src/wire/encoder.js';
import { makeSymbolId } from '../../src/types.js';
import type {
  IonIRModule,
  IonIRNode,
  IonIRDialect,
  AdtDeclNode,
  ModuleRefNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const sid = makeSymbolId('test:x:0');
const intType: IonType = { kind: 'Int' };

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

const varNode = (name: string): IonIRNode => ({
  kind: 'Var',
  name,
  symbolId: sid,
  span,
  type: intType,
});

// ---------------------------------------------------------------------------
// Suite V — newline validation (unit)
// ---------------------------------------------------------------------------

describe('Suite V — newline validation', () => {
  it('V1: module name with \\n throws WireEncodeError', () => {
    expect(() => encodeModule({ ...makeMinimal(), module: 'test\nmodule' }))
      .toThrow(WireEncodeError);
  });

  it('V2: module name with \\r throws WireEncodeError', () => {
    expect(() => encodeModule({ ...makeMinimal(), module: 'test\rmodule' }))
      .toThrow(WireEncodeError);
  });

  it('V3: dialect string with \\n throws WireEncodeError', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['core\n' as unknown as IonIRDialect],
    };
    expect(() => encodeModule(mod)).toThrow(WireEncodeError);
  });

  it('V4: Var node name with \\n throws WireEncodeError', () => {
    expect(() => encodeModule({ ...makeMinimal(), decls: [varNode('bad\nname')] }))
      .toThrow(WireEncodeError);
  });

  it('V5: Let binding name with \\n throws WireEncodeError', () => {
    const letNode: IonIRNode = {
      kind: 'Let',
      name: 'let\nbind',
      symbolId: sid,
      bindingType: intType,
      value: varNode('x'),
      body: varNode('x'),
      span,
      type: intType,
    };
    expect(() => encodeModule({ ...makeMinimal(), decls: [letNode] }))
      .toThrow(WireEncodeError);
  });

  it('V6: Abs param name with \\n throws WireEncodeError', () => {
    const absNode: IonIRNode = {
      kind: 'Abs',
      params: [{ name: 'param\nname', symbolId: sid, type: intType, span }],
      body: varNode('x'),
      captures: [],
      span,
      type: intType,
    };
    expect(() => encodeModule({ ...makeMinimal(), decls: [absNode] }))
      .toThrow(WireEncodeError);
  });

  it('V7: AdtDecl variant tag with \\n throws WireEncodeError', () => {
    const adtDecl: AdtDeclNode = {
      kind: 'AdtDecl',
      name: 'MyAdt',
      symbolId: sid,
      variants: [{ tag: 'Variant\nTag', symbolId: sid, fields: [], span }],
      span,
      type: intType,
    };
    expect(() =>
      encodeModule({ ...makeMinimal(), dialects: ['ion-adt'], data: [adtDecl] }),
    ).toThrow(WireEncodeError);
  });

  it('V8: import modulePath component with \\n throws WireEncodeError', () => {
    const importRef: ModuleRefNode = {
      kind: 'ModuleRef',
      modulePath: ['valid', 'path\ncomp'],
      symbolId: sid,
      span,
      type: intType,
    };
    expect(() => encodeModule({ ...makeMinimal(), imports: [importRef] }))
      .toThrow(WireEncodeError);
  });

  it('V9: ForeignRef.module with \\n throws WireEncodeError', () => {
    const foreignRef: IonIRNode = {
      kind: 'ForeignRef',
      target: 'js',
      module: 'some\nmodule',
      symbol: 'fn',
      sig: { params: [], ret: intType, template: '$1()' },
      span,
      type: intType,
    };
    expect(() => encodeModule({ ...makeMinimal(), decls: [foreignRef] }))
      .toThrow(WireEncodeError);
  });

  it('V10: thrown error is an instance of WireEncodeError', () => {
    let caught: unknown;
    try {
      encodeModule({ ...makeMinimal(), module: 'bad\nname' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireEncodeError);
  });

  it('V11: string literal containing \\n does not throw', () => {
    const litNode: IonIRNode = {
      kind: 'Literal',
      value: { kind: 'Str', value: 'hello\nworld' },
      span,
      type: intType,
    };
    expect(() => encodeModule({ ...makeMinimal(), decls: [litNode] })).not.toThrow();
  });

  it('V12: clean module with no newlines in any name does not throw', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      module: 'org.acme.users',
      dialects: ['core', 'ion-oop'],
      decls: [varNode('cleanName')],
    };
    expect(() => encodeModule(mod)).not.toThrow();
  });

  it('V13: module version with \\n throws WireEncodeError', () => {
    expect(() => encodeModule({ ...makeMinimal(), version: '1.0\nhijack' }))
      .toThrow(WireEncodeError);
  });

  it('V14: Fn type effect tag with \\n throws WireEncodeError', () => {
    const fnType: IonType = {
      kind: 'Fn',
      params: [{ kind: 'Int' }],
      ret: { kind: 'Int' },
      effects: new Set(['bad\neffect']),
    };
    const absNode: IonIRNode = {
      kind: 'Abs',
      params: [{ name: 'x', symbolId: sid, type: { kind: 'Int' }, span }],
      body: varNode('x'),
      captures: [],
      span,
      type: fnType,
    };
    expect(() => encodeModule({ ...makeMinimal(), decls: [absNode] }))
      .toThrow(WireEncodeError);
  });
});

// ---------------------------------------------------------------------------
// Suite W — property tests
// ---------------------------------------------------------------------------

describe('Suite W — property tests', () => {
  it('W1: any Var name containing \\n always causes encodeModule to throw WireEncodeError', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 10 }),
        fc.string({ minLength: 0, maxLength: 10 }),
        (prefix, suffix) => {
          const name = `${prefix}\n${suffix}`;
          const mod: IonIRModule = {
            ionir: '1.0',
            module: 'test',
            version: '1.0.0',
            dialects: [],
            imports: [],
            data: [],
            decls: [varNode(name)],
          };
          expect(() => encodeModule(mod)).toThrow(WireEncodeError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('W2: modules with no \\n/\\r in any name do not throw', () => {
    const cleanStr = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter(s => !s.includes('\n') && !s.includes('\r'));

    const cleanModule: fc.Arbitrary<IonIRModule> = fc
      .record({
        module: cleanStr,
        version: cleanStr,
        decls: fc.array(cleanStr.map<IonIRNode>(name => varNode(name)), { maxLength: 5 }),
      })
      .map(({ module: mod, version, decls }) => ({
        ionir: '1.0' as const,
        module: mod,
        version,
        dialects: [] as IonIRDialect[],
        imports: [],
        data: [],
        decls,
      }));

    fc.assert(
      fc.property(cleanModule, mod => {
        expect(() => encodeModule(mod)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });
});
