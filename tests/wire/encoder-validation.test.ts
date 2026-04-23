import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encodeModule, WireEncodeError, MAX_ENCODE_DEPTH } from '../../src/wire/encoder.js';
import { makeSymbolId } from '../../src/types.js';
import type {
  IonIRModule,
  IonIRNode,
  IonIRDialect,
  AdtDeclNode,
  ModuleRefNode,
  CasePattern,
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

  it('V15: ForeignRef.target with \\n throws WireEncodeError', () => {
    const foreignRef: IonIRNode = {
      kind: 'ForeignRef',
      target: 'bad\ntarget',
      module: 'legit',
      symbol: 'fn',
      sig: { params: [], ret: intType, template: '$1()' },
      span,
      type: intType,
    };
    expect(() => encodeModule({ ...makeMinimal(), decls: [foreignRef] }))
      .toThrow(WireEncodeError);
  });

  it('V16: ForeignRef.symbol with \\n throws WireEncodeError', () => {
    const foreignRef: IonIRNode = {
      kind: 'ForeignRef',
      target: 'js',
      module: 'legit',
      symbol: 'bad\nsym',
      sig: { params: [], ret: intType, template: '$1()' },
      span,
      type: intType,
    };
    expect(() => encodeModule({ ...makeMinimal(), decls: [foreignRef] }))
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
  it('V-TypeVar: TypeVar id with \\n throws WireEncodeError', () => {
    const fnType: IonType = {
      kind: 'Fn',
      params: [],
      ret: { kind: 'TypeVar', id: 'T\nbad' },
      effects: new Set(),
    };
    const absNode: IonIRNode = {
      kind: 'Abs',
      params: [],
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

// ---------------------------------------------------------------------------
// Depth limit fixture helpers
// ---------------------------------------------------------------------------

function makeLetChain(depth: number): IonIRNode {
  let node: IonIRNode = varNode('x');
  for (let i = 0; i < depth; i++) {
    node = {
      kind: 'Let',
      name: 'x',
      symbolId: sid,
      bindingType: intType,
      value: varNode('x'),
      body: node,
      span,
      type: intType,
    };
  }
  return node;
}

function makeListType(depth: number): IonType {
  let t: IonType = intType;
  for (let i = 0; i < depth; i++) {
    t = { kind: 'List', elem: t };
  }
  return t;
}

function makeAppChain(depth: number): IonIRNode {
  let node: IonIRNode = varNode('f');
  for (let i = 0; i < depth; i++) {
    node = {
      kind: 'App',
      callee: node,
      args: [],
      span,
      type: intType,
    };
  }
  return node;
}

function makeConstructorPattern(depth: number): CasePattern {
  let p: CasePattern = { kind: 'Wildcard', span };
  for (let i = 0; i < depth; i++) {
    p = { kind: 'Constructor', ctorName: 'C', symbolId: sid, fields: [p], span };
  }
  return p;
}

// ---------------------------------------------------------------------------
// Suite X — depth limit unit tests
// ---------------------------------------------------------------------------

describe('Suite X — depth limit unit tests', () => {
  it('X1: Let-chain of depth MAX_ENCODE_DEPTH+1 throws WireEncodeError', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      decls: [makeLetChain(MAX_ENCODE_DEPTH + 1)],
    };
    expect(() => encodeModule(mod)).toThrow(WireEncodeError);
  });

  it('X2: nested List type of depth MAX_ENCODE_DEPTH+1 throws WireEncodeError', () => {
    const deepType = makeListType(MAX_ENCODE_DEPTH + 1);
    const node: IonIRNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: deepType };
    const mod: IonIRModule = { ...makeMinimal(), decls: [node] };
    expect(() => encodeModule(mod)).toThrow(WireEncodeError);
  });

  it('X3: deeply nested App callee of depth MAX_ENCODE_DEPTH+1 throws WireEncodeError', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      decls: [makeAppChain(MAX_ENCODE_DEPTH + 1)],
    };
    expect(() => encodeModule(mod)).toThrow(WireEncodeError);
  });

  it('X4: nested Constructor pattern of depth MAX_ENCODE_DEPTH+1 in Case arm throws WireEncodeError', () => {
    const caseNode: IonIRNode = {
      kind: 'Case',
      scrutinee: varNode('x'),
      arms: [{
        pattern: makeConstructorPattern(MAX_ENCODE_DEPTH + 1),
        body: varNode('x'),
        span,
      }],
      span,
      type: intType,
    };
    const mod: IonIRModule = { ...makeMinimal(), decls: [caseNode] };
    expect(() => encodeModule(mod)).toThrow(WireEncodeError);
  });

  it('X5: Let-chain of depth exactly MAX_ENCODE_DEPTH does not throw', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      decls: [makeLetChain(MAX_ENCODE_DEPTH)],
    };
    expect(() => encodeModule(mod)).not.toThrow();
  });

  it('X6: thrown error is an instance of WireEncodeError', () => {
    let caught: unknown;
    try {
      encodeModule({ ...makeMinimal(), decls: [makeLetChain(MAX_ENCODE_DEPTH + 1)] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WireEncodeError);
  });
});

// ---------------------------------------------------------------------------
// Suite Y — depth limit property tests
// ---------------------------------------------------------------------------

describe('Suite Y — depth limit property tests', () => {
  it('Y1: Let-chain of depth MAX_ENCODE_DEPTH+n always throws WireEncodeError', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        n => {
          const mod: IonIRModule = {
            ...makeMinimal(),
            decls: [makeLetChain(MAX_ENCODE_DEPTH + n)],
          };
          expect(() => encodeModule(mod)).toThrow(WireEncodeError);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Y2: shallow modules (depth 1-3) do not throw due to depth', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        depth => {
          const mod: IonIRModule = {
            ...makeMinimal(),
            decls: [makeLetChain(depth)],
          };
          expect(() => encodeModule(mod)).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
});
