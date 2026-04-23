import { describe, it, expect } from 'vitest';
import { encodeModule } from '../../src/wire/encoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';

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

/**
 * Builds a ForeignRef node using long field strings that exceed the pooling
 * threshold when repeated (tokenCost=3 for 9–12 char strings, needs count>=3).
 */
function makeForeignRef(target: string, module: string, symbol: string): IonIRNode {
  return {
    kind: 'ForeignRef',
    target,
    module,
    symbol,
    sig: { params: [], ret: intType, template: '$1()' },
    span,
    type: intType,
  };
}

// ---------------------------------------------------------------------------
// Suite P — ForeignRef symbol pool integration
// ---------------------------------------------------------------------------

describe('Suite P — ForeignRef symbol pool integration', () => {
  it('P1: repeated ForeignRef fields with long names are pooled as aliases', () => {
    // 'javascript' (10 chars): tokenCost=3, shouldPool if count*2 > 5 → count>=3
    // 'node_console' (12 chars): tokenCost=3, same threshold
    // 'fn_external' (11 chars): tokenCost=3, same threshold
    // Use 5 refs to comfortably exceed the threshold for all three fields.
    const ref = makeForeignRef('javascript', 'node_console', 'fn_external');
    const mod: IonIRModule = {
      ...makeMinimal(),
      decls: [ref, ref, ref, ref, ref],
    };
    const out = encodeModule(mod);

    // Symbol pool line must be present
    expect(out).toContain('S ');
    // Raw field values must NOT appear verbatim in the ffi: expression
    expect(out).not.toMatch(/ffi:javascript:/);
    // Aliases are short lowercase sequences (a, b, c, …)
    expect(out).toMatch(/ffi:[a-z]+:[a-z]+:[a-z]+/);
  });

  it('P2: single ForeignRef with short field names is not pooled (raw values emitted)', () => {
    // 'js' (2 chars): tokenCost=1, count*(1-1)=0 > 3 is always false → never pools
    // 'std' (3 chars): same
    // 'log' (3 chars): same
    const mod: IonIRModule = {
      ...makeMinimal(),
      decls: [makeForeignRef('js', 'std', 'log')],
    };
    const out = encodeModule(mod);

    expect(out).toContain('ffi:js:std:log');
    // No symbol pool line should appear
    expect(out).not.toContain('S ');
  });

  it('P3: mix of pooled and non-pooled ForeignRef fields encodes correctly', () => {
    // 'javascript' repeated 5×: pools. 'js' never pools regardless of count.
    const longRef = makeForeignRef('javascript', 'node_console', 'fn_external');
    const shortRef = makeForeignRef('js', 'std', 'log');
    const mod: IonIRModule = {
      ...makeMinimal(),
      decls: [longRef, longRef, longRef, longRef, longRef, shortRef],
    };
    const out = encodeModule(mod);

    // Pool line present due to long strings
    expect(out).toContain('S ');
    // Short strings still appear raw
    expect(out).toContain('ffi:js:std:log');
    // Long strings appear as aliases
    expect(out).not.toMatch(/ffi:javascript:/);
  });
});
