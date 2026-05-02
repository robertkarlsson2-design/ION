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

/** End-to-end pipeline: Ion source string → emitted TypeScript string. */
function compile(src: string, moduleName = 'TestModule'): string {
  const tokens = lex(src, `${moduleName}.ion`);
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bind = bindModule(ast, moduleName);
  const check = checkModule(ast, bind, moduleName);
  const ir = desugarModule(ast, bind, check, moduleName, '0.0.0');
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

describe('emitTS — data declarations', () => {
  it('emits a single-ctor data type as a plain interface (no _tag)', () => {
    const out = compile('data User = User { id: Int; email: Str }');
    expect(out).toContain('interface User {');
    expect(out).toContain('id: number');
    expect(out).toContain('email: string');
    expect(out).not.toContain('_tag');
    expect(out).not.toContain('type User =');
  });

  it('emits a multi-ctor data type as a discriminated union', () => {
    const out = compile('data Shape = Circle { r: Float } | Rect { w: Float; h: Float }');
    expect(out).toContain('type Shape =');
    expect(out).toContain('"Circle"');
    expect(out).toContain('"Rect"');
    expect(out).toContain('_tag');
  });

  it('emits data declaration before function declarations', () => {
    const out = compile('data User = User { id: Int }\npub fn show(u: User) -> Str = "user"');
    expect(out.indexOf('interface User')).toBeLessThan(out.indexOf('const show'));
  });
});
