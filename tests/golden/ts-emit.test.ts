import { describe, it, expect } from 'vitest';
import { emitTS } from '../../emitters/typescript/emit.js';
import type { IonIRModule, RawInjectNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import { desugarModule } from '../../src/desugar/index.js';

function compileSurface(src: string): string {
  const tokens = lex(src, 'test.ion');
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bindResult = bindModule(ast, 'test');
  const checkResult = checkModule(ast, bindResult, 'test');
  const ir = desugarModule(ast, bindResult, checkResult, 'test', '0.0.0');
  return emitTS(ir);
}

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

// ---------------------------------------------------------------------------
// raw() surface-syntax → RawInject verbatim emit
// ---------------------------------------------------------------------------

describe('emitTS — raw() surface syntax passthrough', () => {
  it('let x: Str = raw("`json`") → output contains `json` verbatim', () => {
    const out = compileSurface('let x: Str = raw("`json`")');
    expect(out).toContain('`json`');
  });
});
