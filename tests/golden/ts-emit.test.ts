import { describe, it, expect } from 'vitest';
import { emitTS } from '../../emitters/typescript/emit.js';
import type { IonIRModule, RawInjectNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';

const S: Span = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const UNIT: IonType = { kind: 'Unit' };

function makeModule(decls: IonIRModule['decls']): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test',
    version: '0.0.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls,
  };
}

// ---------------------------------------------------------------------------
// RawInject passthrough — top-level declaration loop
// ---------------------------------------------------------------------------

describe('emitTS — top-level RawInject passthrough', () => {
  it('emits raw code verbatim as a top-level declaration', () => {
    const node: RawInjectNode = {
      kind: 'RawInject',
      code: 'export const x = 42;',
      span: S,
      type: UNIT,
    };
    const out = emitTS(makeModule([node]));
    expect(out).toContain('export const x = 42;');
  });

  it('does not produce only "use strict;" when the sole decl is RawInject', () => {
    const node: RawInjectNode = {
      kind: 'RawInject',
      code: 'export const answer = 42;',
      span: S,
      type: UNIT,
    };
    const out = emitTS(makeModule([node]));
    expect(out.trim()).not.toBe('"use strict";');
  });
});
