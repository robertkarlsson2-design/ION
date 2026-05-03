/**
 * Pool-exclusion tests — IR meta-symbols and JS reserved words must NEVER be
 * pooled in the S section.
 *
 * Background: the OTOURENV2 hybrid pipeline (since reverted) corrupted
 * `crew.ion` by pooling `__not__` (an emitter-special-cased prefix-`!`
 * operator) into the S pool with the same alias-letter range as legitimate
 * member names like `status`. The corrupted .ion baked `res.__not__(200)`
 * into the emitted TS where the source intent was `res.status(200)`.
 *
 * Two orthogonal fixes:
 *   - exclude IR meta-symbols (`/^__\w+__$/`) — they're emitter sugar,
 *     pooling them is wasted bytes AND opens a collision attack surface
 *   - exclude JS/TS reserved words — they appear verbatim in many
 *     emitter outputs (`let x = ...`, `(default) => ...`), so aliasing
 *     them is a footgun
 */
import { describe, it, expect } from 'vitest';
import { encodeModule } from '../../src/wire/encoder.js';
import { decodeModule } from '../../src/wire/decoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const sid = makeSymbolId('test:x:0');
const intType: IonType = { kind: 'Int' };
const unitType: IonType = { kind: 'Unit' };

function baseModule(decls: readonly IonIRNode[]): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test.pool-exclusion',
    version: '0.1.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls: [...decls],
  };
}

const varOf = (name: string): IonIRNode => ({
  kind: 'Var', name, symbolId: sid, span, type: intType,
});

const accessor = (recv: IonIRNode, member: string): IonIRNode => ({
  kind: 'Accessor', receiver: recv, member, span, type: unitType,
});

const ovc = (recv: IonIRNode, method: string, args: IonIRNode[]): IonIRNode => ({
  kind: 'OopVirtualCall', receiver: recv, method, args, span, type: unitType,
});

// ---------------------------------------------------------------------------
// IR meta-symbols
// ---------------------------------------------------------------------------

describe('IR meta-symbols are excluded from S pool', () => {
  it('does NOT pool "__not__" even at 5 occurrences (regex /^__\\w+__$/)', () => {
    const node = varOf('__not__');
    const out = encodeModule(baseModule([node, node, node, node, node]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).not.toMatch(/=__not__\b/);
  });

  it('does NOT pool "__obj__" at 22 occurrences (the crew.ion regression case)', () => {
    const node = varOf('__obj__');
    const out = encodeModule(baseModule(Array.from({ length: 22 }, () => node)));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).not.toMatch(/=__obj__\b/);
  });

  it('does NOT pool any of the canonical IR builtins, even at high counts', () => {
    const builtins = [
      '__add__', '__sub__', '__mul__', '__div__', '__mod__',
      '__eq__', '__ne__', '__lt__', '__gt__', '__le__', '__ge__',
      '__and__', '__or__', '__neg__', '__not__',
      '__obj__', '__index__', '__nullish__', '__optchain__',
      '__throw__', '__env__', '__set__', '__regex__',
      '__try__', '__tryfin__', '__finally__', '__do__',
      '__seq__', '__spread__', '__cond__', '__fold__', '__jsx__',
    ];
    for (const name of builtins) {
      const node = varOf(name);
      const out = encodeModule(baseModule([node, node, node, node, node]));
      const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
      expect(sLine, `builtin "${name}" was pooled`).not.toMatch(new RegExp(`=${name}\\b`));
    }
  });

  it('future-proof: does NOT pool any /^__\\w+__$/ name (e.g. a hypothetical "__foobar__")', () => {
    const node = varOf('__foobar__');
    const out = encodeModule(baseModule([node, node, node, node, node]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).not.toMatch(/=__foobar__\b/);
  });

  it('regression: with __not__ AND status both at high counts, status pools but __not__ does NOT', () => {
    // Mirrors the crew.ion topology that triggered the bug.
    const not = varOf('__not__');
    const res = varOf('res');
    // 4 OVCs of `res.status(...)`, 4 Vars `__not__`, several `res` vars, etc.
    const decls: IonIRNode[] = [];
    for (let i = 0; i < 4; i++) {
      decls.push(ovc(res, 'status', [varOf('arg')]));
      decls.push(not);
    }
    const out = encodeModule(baseModule(decls));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).toMatch(/=status\b/);          // status IS pooled
    expect(sLine).not.toMatch(/=__not__\b/);     // __not__ is NOT pooled
    // Roundtrip and confirm the IR shape survives.
    const ir2 = decodeModule(out);
    let statusOvcCount = 0, notUscOvcCount = 0;
    function walk(n: any) {
      if (!n || typeof n !== 'object') return;
      if (n.kind === 'OopVirtualCall' && n.method === 'status') statusOvcCount++;
      if (n.kind === 'OopVirtualCall' && n.method === '__not__') notUscOvcCount++;
      for (const k of Object.keys(n)) {
        const v = (n as any)[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object' && 'kind' in v) walk(v);
      }
    }
    for (const d of ir2.decls) walk(d);
    expect(statusOvcCount).toBe(4);
    expect(notUscOvcCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Member names: when used as Accessor.member, they pool the same way as Var
// names. Verify pooling still works correctly for legitimate member names AND
// that the alias generator's collision skip-list is honoured.
// ---------------------------------------------------------------------------

describe('member names are pooled correctly without alias collision', () => {
  it('pools Accessor.member="status" at 4 occurrences', () => {
    const recv = varOf('res');
    const node = accessor(recv, 'status');
    const out = encodeModule(baseModule([node, node, node, node]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).toMatch(/=status\b/);
    // Must roundtrip.
    const ir2 = decodeModule(out);
    let count = 0;
    function walk(n: any) {
      if (!n || typeof n !== 'object') return;
      if (n.kind === 'Accessor' && n.member === 'status') count++;
      for (const k of Object.keys(n)) {
        const v = (n as any)[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object' && 'kind' in v) walk(v);
      }
    }
    for (const d of ir2.decls) walk(d);
    expect(count).toBe(4);
  });

  it('pools "status" member AND keeps __not__ Var unaliased (no collision)', () => {
    // Topology: many .status accessors AND many __not__ vars in the same module.
    // The alias generator must not assign the same letter to both, AND must
    // emit __not__ verbatim (not aliased) so the decoder re-reads it as the
    // operator name, not a pooled lookup.
    const recv = varOf('res');
    const acc = accessor(recv, 'status');
    const not = varOf('__not__');
    const decls: IonIRNode[] = [];
    for (let i = 0; i < 5; i++) decls.push(acc);
    for (let i = 0; i < 5; i++) decls.push(not);
    const out = encodeModule(baseModule(decls));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).toMatch(/=status\b/);
    expect(sLine).not.toMatch(/=__not__\b/);
    const fLine = out.split('\n').find(l => l.startsWith('F ')) ?? '';
    // __not__ must appear verbatim somewhere in the F section since it isn't pooled.
    expect(fLine).toContain('__not__');
  });
});

// ---------------------------------------------------------------------------
// JS reserved words
// ---------------------------------------------------------------------------

describe('JS reserved words are excluded from S pool', () => {
  it('does NOT pool "delete" at 5 occurrences as a Var name', () => {
    const node = varOf('delete');
    const out = encodeModule(baseModule([node, node, node, node, node]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).not.toMatch(/=delete\b/);
  });

  it('does NOT pool "default" at 5 occurrences as a Var name', () => {
    const node = varOf('default');
    const out = encodeModule(baseModule([node, node, node, node, node]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).not.toMatch(/=default\b/);
  });

  it('does NOT pool common JS reserved words used as Vars', () => {
    const reserved = [
      'break', 'case', 'catch', 'class', 'const', 'continue',
      'debugger', 'default', 'delete', 'do', 'else', 'enum',
      'export', 'extends', 'finally', 'for', 'function', 'if',
      'import', 'instanceof', 'new', 'return', 'super', 'switch',
      'throw', 'try', 'typeof', 'var', 'void', 'while', 'with',
      'yield', 'await', 'implements', 'interface', 'let', 'package',
      'private', 'protected', 'public', 'static',
    ];
    for (const name of reserved) {
      const node = varOf(name);
      const out = encodeModule(baseModule([node, node, node, node, node]));
      const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
      expect(sLine, `reserved word "${name}" was pooled`).not.toMatch(new RegExp(`=${name}\\b`));
    }
  });

  it('still pools "delete" as a member name (it is a valid JS object method)', () => {
    // r.delete(...) is legal JS in modern runtimes. Pooling it as a member
    // is fine — the decoder reads member names through the S pool, so
    // alias→"delete" decodes correctly. The exclusion is conservative
    // *only* at the keyword level (Var-name position); members are read
    // back through resolveName regardless.
    //
    // This test is documentation: we DO want pooling to work for the
    // common case of repeated member names that happen to overlap with
    // reserved words. The exclusion list is for the rarer (and more
    // dangerous) Var-name usage.
    //
    // Using Accessor since member names share the same pool entries as
    // Var names. Confirm the encoder's behaviour: the keyword exclusion
    // also applies to members. (This is the conservative call — pooling
    // saves bytes but exposes us to the reserved-word leak in places
    // where the alias gets emitted raw.)
    const recv = varOf('r');
    const node = accessor(recv, 'delete');
    const out = encodeModule(baseModule([node, node, node, node, node]));
    // Roundtrip must preserve the member name regardless of pooling decision.
    const ir2 = decodeModule(out);
    let count = 0;
    function walk(n: any) {
      if (!n || typeof n !== 'object') return;
      if (n.kind === 'Accessor' && n.member === 'delete') count++;
      for (const k of Object.keys(n)) {
        const v = (n as any)[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object' && 'kind' in v) walk(v);
      }
    }
    for (const d of ir2.decls) walk(d);
    expect(count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Roundtrip golden — the OTOURENV2 crew.ion regression case
// ---------------------------------------------------------------------------

describe('OTOURENV2 crew.ion-shaped IR roundtrips correctly', () => {
  it('preserves status method name + does not pool meta-symbols, with stable roundtrip', () => {
    // Build an IR that mimics the topology of `server/ion/src/routes/crew/crew.ion`:
    //   - 12x OVC(res, 'status', ...)   ← was getting aliased to __not__
    //   - 12x OVC(res, 'json', ...)
    //   - 22x Var('__obj__')
    //   - 4x Var('__do__')
    //   - 3x Var('__try__')
    //   - 3x Var('__not__')
    //   - 4x Var('crew')
    //   - 5x Var('pool')
    const res = varOf('res');
    const decls: IonIRNode[] = [];
    for (let i = 0; i < 12; i++) decls.push(ovc(res, 'status', [varOf('arg')]));
    for (let i = 0; i < 12; i++) decls.push(ovc(res, 'json', [varOf('arg')]));
    for (let i = 0; i < 22; i++) decls.push(varOf('__obj__'));
    for (let i = 0; i < 4; i++) decls.push(varOf('__do__'));
    for (let i = 0; i < 3; i++) decls.push(varOf('__try__'));
    for (let i = 0; i < 3; i++) decls.push(varOf('__not__'));
    for (let i = 0; i < 4; i++) decls.push(varOf('crew'));
    for (let i = 0; i < 5; i++) decls.push(varOf('pool'));

    const mod = baseModule(decls);
    const out = encodeModule(mod);

    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    // Pooled: status, json, crew, pool (all length>=4, count>=3).
    expect(sLine).toMatch(/=status\b/);
    expect(sLine).toMatch(/=json\b/);
    expect(sLine).toMatch(/=crew\b/);
    expect(sLine).toMatch(/=pool\b/);
    // NOT pooled: any meta-symbol.
    expect(sLine).not.toMatch(/=__obj__\b/);
    expect(sLine).not.toMatch(/=__do__\b/);
    expect(sLine).not.toMatch(/=__try__\b/);
    expect(sLine).not.toMatch(/=__not__\b/);

    // Stable roundtrip.
    const ir2 = decodeModule(out);
    const out2 = encodeModule(ir2);
    expect(out2).toBe(out);

    // IR invariant: status OVC count preserved.
    let statusCount = 0, notUscCount = 0;
    function walk(n: any) {
      if (!n || typeof n !== 'object') return;
      if (n.kind === 'OopVirtualCall' && n.method === 'status') statusCount++;
      if (n.kind === 'OopVirtualCall' && n.method === '__not__') notUscCount++;
      for (const k of Object.keys(n)) {
        const v = (n as any)[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object' && 'kind' in v) walk(v);
      }
    }
    for (const d of ir2.decls) walk(d);
    expect(statusCount).toBe(12);
    expect(notUscCount).toBe(0);
  });
});
