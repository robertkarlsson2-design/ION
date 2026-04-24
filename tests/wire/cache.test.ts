import { describe, it, expect } from 'vitest';
import { splitWire, toCacheBlocks, WireCacheError } from '../../src/wire/cache.js';
import { encodeModule } from '../../src/wire/encoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode, AdtDeclNode } from '../../src/ir/nodes.js';
import type { Span } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
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

const varNode = (name: string): IonIRNode => ({
  kind: 'Var',
  name,
  symbolId: sid,
  span,
  type: { kind: 'Int' },
});

// ---------------------------------------------------------------------------
// Suite C — splitWire / toCacheBlocks unit tests
// ---------------------------------------------------------------------------

describe('Suite C — wire cache split', () => {
  it('T1: full module (I1+M+S+T+X+D+F) splits at D boundary', () => {
    // Build a module that produces S, T, X, D, and F sections.
    const adtDecl: AdtDeclNode = {
      kind: 'AdtDecl',
      name: 'MyColor',
      symbolId: sid,
      variants: [
        { tag: 'Red', symbolId: sid, fields: [], span },
        { tag: 'Green', symbolId: sid, fields: [], span },
      ],
      span,
      type: { kind: 'Unit' },
    };
    const mod: IonIRModule = {
      ...makeMinimal(),
      module: 'org.example',
      dialects: ['ion-adt'],
      data: [adtDecl],
      decls: [varNode('result')],
    };
    const wire = encodeModule(mod);
    const { stablePrefix, dynamicSuffix } = splitWire(wire);

    // Stable prefix must NOT contain D or F lines
    const stableLines = stablePrefix.split('\n').filter(l => l.length > 0);
    for (const line of stableLines) {
      expect(line[0]).not.toMatch(/^[DF]/);
    }

    // Dynamic suffix must start with D (since D comes before F in section order)
    expect(dynamicSuffix.trimStart()[0]).toBe('D');

    // stablePrefix must end with a newline
    expect(stablePrefix.endsWith('\n')).toBe(true);
    expect(dynamicSuffix.endsWith('\n')).toBe(true);
  });

  it('T2: module with no D or F produces empty dynamicSuffix and one block', () => {
    const wire = encodeModule(makeMinimal());
    const { stablePrefix, dynamicSuffix } = splitWire(wire);

    expect(dynamicSuffix).toBe('');
    expect(stablePrefix.startsWith('I1\n')).toBe(true);

    const blocks = toCacheBlocks(wire);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('T3: module with D but no F splits at D boundary', () => {
    const adtDecl: AdtDeclNode = {
      kind: 'AdtDecl',
      name: 'Shape',
      symbolId: sid,
      variants: [{ tag: 'Circle', symbolId: sid, fields: [], span }],
      span,
      type: { kind: 'Unit' },
    };
    const mod: IonIRModule = {
      ...makeMinimal(),
      dialects: ['ion-adt'],
      data: [adtDecl],
      decls: [],
    };
    const wire = encodeModule(mod);
    expect(wire).toMatch(/\nD /);

    const { dynamicSuffix } = splitWire(wire);
    expect(dynamicSuffix.trimStart().startsWith('D')).toBe(true);
  });

  it('T4: module with F but no D splits at F boundary', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      data: [],
      decls: [varNode('x')],
    };
    const wire = encodeModule(mod);
    expect(wire).toMatch(/\nF /);

    const { dynamicSuffix } = splitWire(wire);
    expect(dynamicSuffix.trimStart().startsWith('F')).toBe(true);
  });

  it('T5: toCacheBlocks with dynamic present returns 2 blocks; block[0] has cache_control, block[1] does not', () => {
    const mod: IonIRModule = {
      ...makeMinimal(),
      decls: [varNode('main')],
    };
    const wire = encodeModule(mod);
    const blocks = toCacheBlocks(wire);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[1]!.cache_control).toBeUndefined();
    expect(blocks[0]!.type).toBe('text');
    expect(blocks[1]!.type).toBe('text');
  });

  it('T6: toCacheBlocks with no dynamic returns 1 block with cache_control', () => {
    const wire = encodeModule(makeMinimal());
    const blocks = toCacheBlocks(wire);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('T7: stable prefix is identical across edits that only change function bodies', () => {
    const base: IonIRModule = {
      ...makeMinimal(),
      module: 'org.session',
      version: '1.0.0',
    };
    const modA: IonIRModule = { ...base, decls: [varNode('funcA')] };
    const modB: IonIRModule = { ...base, decls: [varNode('funcB')] };

    const blocksA = toCacheBlocks(encodeModule(modA));
    const blocksB = toCacheBlocks(encodeModule(modB));

    expect(blocksA[0]!.text).toBe(blocksB[0]!.text);
  });

  it('T8: splitWire throws WireCacheError for input not starting with I1', () => {
    expect(() => splitWire('M foo\nF bar\n')).toThrow(WireCacheError);
    expect(() => splitWire('')).toThrow(WireCacheError);
    expect(() => splitWire('I2\nM foo\n')).toThrow(WireCacheError);
  });

  it('T9: stablePrefix + dynamicSuffix reconstructs original wire exactly', () => {
    const mods: IonIRModule[] = [
      makeMinimal(),
      { ...makeMinimal(), decls: [varNode('x')] },
      {
        ...makeMinimal(),
        dialects: ['ion-adt'],
        data: [
          {
            kind: 'AdtDecl',
            name: 'Color',
            symbolId: sid,
            variants: [{ tag: 'Blue', symbolId: sid, fields: [], span }],
            span,
            type: { kind: 'Unit' },
          } satisfies AdtDeclNode,
        ],
        decls: [varNode('paint')],
      },
    ];

    for (const mod of mods) {
      const wire = encodeModule(mod);
      const { stablePrefix, dynamicSuffix } = splitWire(wire);
      expect(stablePrefix + dynamicSuffix).toBe(wire);
    }
  });
});
