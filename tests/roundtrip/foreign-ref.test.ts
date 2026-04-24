import { describe, it, expect } from 'vitest';
import { serializeModule, deserializeModule } from '../../src/ir/serde.js';
import { encodeModule } from '../../src/wire/encoder.js';
import { decodeModule } from '../../src/wire/decoder.js';
import { prettyPrintModule } from '../../src/wire/pretty.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const intType: IonType = { kind: 'Int' };
const sig = { params: [] as IonType[], ret: intType, template: '$1' };

function makeForeignRefModule(module: string, symbol: string): IonIRModule {
  const decl: IonIRNode = {
    kind: 'ForeignRef',
    target: `${module}::${symbol}`,
    module,
    symbol,
    sig,
    span,
    type: intType,
  };
  return {
    ionir: '1.0',
    module: 'test.foreign',
    version: '0.1.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls: [decl],
  };
}

// ---------------------------------------------------------------------------
// Suite A — JSON serde roundtrip: ForeignRef field preservation
// ---------------------------------------------------------------------------

describe('ForeignRef — JSON serde roundtrip', () => {
  it('preserves double-quote in module field', () => {
    const mod = makeForeignRefModule('std::"foo"', 'log');
    const out = deserializeModule(serializeModule(mod));
    expect(out.decls[0]).toEqual(mod.decls[0]);
  });

  it('preserves backslash in module field', () => {
    const mod = makeForeignRefModule('path\\to\\mod', 'fn');
    const out = deserializeModule(serializeModule(mod));
    expect(out.decls[0]).toEqual(mod.decls[0]);
  });

  it('preserves double-quote in symbol field', () => {
    const mod = makeForeignRefModule('node:console', 'say"hi"');
    const out = deserializeModule(serializeModule(mod));
    expect(out.decls[0]).toEqual(mod.decls[0]);
  });

  it('preserves backslash in symbol field', () => {
    const mod = makeForeignRefModule('node:console', 'esc\\ape');
    const out = deserializeModule(serializeModule(mod));
    expect(out.decls[0]).toEqual(mod.decls[0]);
  });

  it('preserves both double-quote and backslash in both fields', () => {
    const mod = makeForeignRefModule('mod\\"x"', 'fn\\"y"');
    const out = deserializeModule(serializeModule(mod));
    expect(out.decls[0]).toEqual(mod.decls[0]);
  });
});

// ---------------------------------------------------------------------------
// Suite B — Pretty-print escaping (integration with pretty layer)
// ---------------------------------------------------------------------------

describe('ForeignRef — pretty-print escaping', () => {
  it('escapes double-quote in module field', () => {
    const out = prettyPrintModule(makeForeignRefModule('std::"foo"', 'log'));
    expect(out).toContain('\\"');
  });

  it('escapes backslash in module field', () => {
    const out = prettyPrintModule(makeForeignRefModule('path\\to\\mod', 'fn'));
    expect(out).toContain('\\\\');
  });

  it('escapes double-quote in symbol field', () => {
    const out = prettyPrintModule(makeForeignRefModule('node:console', 'say"hi"'));
    expect(out).toContain('\\"');
  });

  it('escapes backslash in symbol field', () => {
    const out = prettyPrintModule(makeForeignRefModule('node:console', 'esc\\ape'));
    expect(out).toContain('\\\\');
  });

  it('plain values render as canonical @foreign(...) form (regression guard)', () => {
    const out = prettyPrintModule(makeForeignRefModule('node:console', 'log'));
    expect(out).toContain('@foreign("node:console::log")');
  });
});

// ---------------------------------------------------------------------------
// Suite C — Wire encoder stability
// ---------------------------------------------------------------------------

describe('ForeignRef — wire encoder stability', () => {
  it('does not throw when encoding special characters', () => {
    expect(() => encodeModule(makeForeignRefModule('mod::"x"', 'sym\\bol'))).not.toThrow();
  });

  it('is deterministic across two calls with special characters', () => {
    const mod = makeForeignRefModule('mod::"x"', 'sym\\bol');
    expect(encodeModule(mod)).toBe(encodeModule(mod));
  });
});

// ---------------------------------------------------------------------------
// Suite D — Wire pool alias roundtrip
// ---------------------------------------------------------------------------

describe('ForeignRef — wire pool alias roundtrip', () => {
  // 10 identical decls cause target/module/symbol to meet shouldPool() threshold
  // (e.g. 'javascript' len=10 cost=3: 10*(3-1)=20 > 2+3=5 ✓)
  function makePoolableModule(): IonIRModule {
    const decl: IonIRNode = {
      kind: 'ForeignRef',
      target: 'javascript',
      module: 'node:console',
      symbol: 'consoleDotLog',
      sig,
      span,
      type: intType,
    };
    return {
      ionir: '1.0',
      module: 'test.pool',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: Array.from({ length: 10 }, () => ({ ...decl })),
    };
  }

  it('S line contains all three pooled ForeignRef field values', () => {
    const wire = encodeModule(makePoolableModule());
    const sLine = wire.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).toContain('=javascript');
    expect(sLine).toContain('=node:console');
    expect(sLine).toContain('=consoleDotLog');
  });

  it('F lines do not contain raw ForeignRef names inline', () => {
    const wire = encodeModule(makePoolableModule());
    const fLines = wire.split('\n').filter(l => l.startsWith('F '));
    for (const line of fLines) {
      expect(line).not.toContain('ffi:javascript');
      expect(line).not.toContain(':consoleDotLog');
    }
  });

  it('decodeModule restores original ForeignRef field values after encode', () => {
    const mod = makePoolableModule();
    const wire = encodeModule(mod);
    const result = decodeModule(wire);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const first = result.decls[0];
    expect(first).toMatchObject({
      kind: 'ForeignRef',
      target: 'javascript',
      module: 'node:console',
      symbol: 'consoleDotLog',
    });
  });
});
