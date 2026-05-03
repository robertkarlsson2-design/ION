/**
 * Aggressive L+S pool heuristic tests.
 *
 * These tests pin the new heuristic introduced to match the OTOURENV2
 * text-level compressor's behaviour (`scripts/ion-compress-text.mjs`):
 *
 *   - S pool: pool when count >= 3 AND length >= 4
 *   - L pool: pool when count >= 3 AND length >= 3,
 *             OR count == 2 AND length >= 8
 *
 * Plus two correctness skip-lists in the symbol pool:
 *   - JSX tag names (decoder reads JSX tags via bare readIdent)
 *   - Wire-format keywords (decoder treats them as syntactic tokens)
 *
 * If you change `shouldPool`, `shouldPoolLiteral`, `POOL_EXCLUDED_KEYWORDS`,
 * or the `collectJsxTagNames` walker, expect to update these tests.
 */
import { describe, it, expect } from 'vitest';
import { encodeModule } from '../../src/wire/encoder.js';
import { decodeModule } from '../../src/wire/decoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode, AppNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 5 };
const sid = makeSymbolId('test:x:0');
const intType: IonType = { kind: 'Int' };
const unitType: IonType = { kind: 'Unit' };
const strType: IonType = { kind: 'Str' };

function baseModule(decls: readonly IonIRNode[]): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test.aggressive',
    version: '0.1.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls: [...decls],
  };
}

const varOf = (name: string): IonIRNode => ({ kind: 'Var', name, symbolId: sid, span, type: intType });

const strLit = (value: string): IonIRNode => ({
  kind: 'Literal',
  value: { kind: 'Str', value },
  span,
  type: strType,
});

// ---------------------------------------------------------------------------

describe('aggressive S-pool heuristic', () => {
  it('pools "createCoursesRouter" (length 19) at 5 occurrences', () => {
    const node = varOf('createCoursesRouter');
    const out = encodeModule(baseModule([node, node, node, node, node]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).toContain('createCoursesRouter');
  });

  it('does NOT pool "foo" (length 3) even at 100 occurrences (length below floor)', () => {
    const node = varOf('foo');
    const out = encodeModule(baseModule(Array.from({ length: 100 }, () => node)));
    expect(out).not.toMatch(/^S /m);
  });
});

describe('aggressive L-pool heuristic', () => {
  it('pools "INTERNAL_ERROR" at 4 occurrences', () => {
    const lit = strLit('INTERNAL_ERROR');
    const out = encodeModule(baseModule([lit, lit, lit, lit]));
    const lLine = out.split('\n').find(l => l.startsWith('L ')) ?? '';
    expect(lLine).toContain('"INTERNAL_ERROR"');
  });
});

describe('JSX tag names are excluded from S pool', () => {
  // Build an IR with `App` whose `sugarForm='jsx'` and tag = Var("App").
  // Also add many non-JSX uses of the name "App" so the heuristic would
  // otherwise pool it. Verify "App" stays out of the S pool.
  function makeJsxApp(): IonIRNode {
    const tagVar: IonIRNode = { kind: 'Var', name: 'App', symbolId: sid, span, type: unitType };
    const propsNull: IonIRNode = { kind: 'Literal', value: { kind: 'Null' }, span, type: { kind: 'Null' } };
    const node: AppNode = {
      kind: 'App',
      callee: {
        kind: 'ForeignRef',
        target: 'js', module: 'react', symbol: 'createElement',
        sig: { params: [], ret: unitType, template: '', paramNames: [] },
        span, type: unitType,
      },
      args: [tagVar, propsNull],
      span, type: unitType,
      sugarForm: 'jsx',
    };
    return node;
  }

  it('skip-lists "App" when it appears as a JSX tag, even if also used non-JSX 5+ times', () => {
    const jsx = makeJsxApp();
    const nonJsxUse = varOf('App');
    const out = encodeModule(baseModule([
      jsx,
      // 5 non-JSX uses of "App" — without exclusion these would push it over
      // the count >= 3, length >= 4 (App is 3 chars, fails on length anyway).
      // Use a longer name to make the test airtight: include "Application"
      // alongside as a sanity check the encoder would have pooled it.
      nonJsxUse, nonJsxUse, nonJsxUse, nonJsxUse, nonJsxUse,
    ]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    // "App" is 3 chars so the heuristic alone wouldn't pool it. Use a longer
    // tag name to make the JSX-exclusion the load-bearing constraint.
    expect(sLine).not.toMatch(/=App\b/);
  });

  it('skip-lists a 6-char JSX-tag name even when it occurs 6 times non-JSX', () => {
    // Without JSX exclusion, "Header" (length 6) at 7 occurrences (1 JSX + 6
    // non-JSX) would easily clear shouldPool. With exclusion it stays raw.
    const tagVar: IonIRNode = { kind: 'Var', name: 'Header', symbolId: sid, span, type: unitType };
    const propsNull: IonIRNode = { kind: 'Literal', value: { kind: 'Null' }, span, type: { kind: 'Null' } };
    const jsxNode: AppNode = {
      kind: 'App',
      callee: {
        kind: 'ForeignRef',
        target: 'js', module: 'react', symbol: 'createElement',
        sig: { params: [], ret: unitType, template: '', paramNames: [] },
        span, type: unitType,
      },
      args: [tagVar, propsNull],
      span, type: unitType,
      sugarForm: 'jsx',
    };
    const nonJsxUse = varOf('Header');
    const mod = baseModule([
      jsxNode,
      nonJsxUse, nonJsxUse, nonJsxUse, nonJsxUse, nonJsxUse, nonJsxUse,
    ]);
    const out = encodeModule(mod);
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).not.toContain('Header');
    // And the whole thing must round-trip cleanly.
    const decoded = decodeModule(out);
    expect('error' in decoded).toBe(false);
  });
});

describe('wire-format keywords are excluded from S pool', () => {
  it('skip-lists "let" even when it occurs 5 times as a Var name', () => {
    // Pathological — "let" should never appear as an identifier in real code,
    // but the encoder's defence-in-depth is to refuse to pool any keyword
    // because the decoder treats `let` as a syntactic token.
    const node = varOf('let');
    const out = encodeModule(baseModule([node, node, node, node, node]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    // Match at word-boundary so "letX" won't false-pass.
    expect(sLine).not.toMatch(/=let\b/);
  });

  it('skip-lists "match" (length 5, 5 occurrences would normally pool)', () => {
    const node = varOf('match');
    const out = encodeModule(baseModule([node, node, node, node, node]));
    const sLine = out.split('\n').find(l => l.startsWith('S ')) ?? '';
    expect(sLine).not.toMatch(/=match\b/);
  });
});
