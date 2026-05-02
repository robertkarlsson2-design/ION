import { describe, it, expect } from 'vitest';
import { emitTS } from '../../emitters/typescript/emit.js';
import type { IonIRModule, RawInjectNode, ForeignRefNode, LetNode, VarNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span, SymbolId } from '../../src/types.js';
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
const sym = (s: string): SymbolId => s as SymbolId;

function makeVar(name: string, type: IonType = UNIT): VarNode {
  return { kind: 'Var', name, symbolId: sym(name), span: S, type };
}

function makeLet(name: string, value: import('../../src/ir/nodes.js').IonIRNode): LetNode {
  return {
    kind: 'Let',
    name,
    symbolId: sym(name),
    bindingType: value.type,
    value,
    body: makeVar(name, value.type),
    span: S,
    type: value.type,
  };
}

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

// ---------------------------------------------------------------------------
// cross-module ForeignRef imports
// ---------------------------------------------------------------------------

describe('emitTS — cross-module ForeignRef imports', () => {
  it("emits import { Router } from 'express' for ForeignRef with module=express", () => {
    const ref: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: 'express',
      symbol: 'Router',
      sig: { params: [], ret: UNIT, template: 'Router()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const out = emitTS(makeModule([makeLet('router', ref)]));
    expect(out).toContain("import { Router } from 'express'");
  });

  it('does not emit import for ForeignRef with empty module', () => {
    const ref: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: '',
      symbol: 'map',
      sig: { params: [], ret: UNIT, template: 'map()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const out = emitTS(makeModule([makeLet('mapFn', ref)]));
    expect(out).not.toContain('import');
  });

  it('does not emit import for Math (JS built-in global)', () => {
    const ref: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: 'Math',
      symbol: 'abs',
      sig: { params: [], ret: UNIT, template: 'Math.abs()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const out = emitTS(makeModule([makeLet('absFn', ref)]));
    expect(out).not.toContain('import');
  });

  it('groups multiple symbols from same module into one import statement', () => {
    const ref1: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: 'pg',
      symbol: 'Pool',
      sig: { params: [], ret: UNIT, template: 'Pool()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const ref2: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'ts',
      module: 'pg',
      symbol: 'Client',
      sig: { params: [], ret: UNIT, template: 'Client()', paramNames: [] },
      span: S,
      type: { kind: 'Fn', params: [], ret: UNIT, effects: new Set() },
    };
    const out = emitTS(makeModule([makeLet('pool', ref1), makeLet('client', ref2)]));
    const importLines = out.split('\n').filter(l => l.startsWith('import'));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toContain('Client');
    expect(importLines[0]).toContain('Pool');
    expect(importLines[0]).toContain("from 'pg'");
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

describe('TS emitter — FFI ref as callee (fix for empty `app(, args)` bug)', () => {
  // Compile from wire form to exercise the FOREIGN_SIG_PLACEHOLDER path that
  // the wire decoder uses for `ffi:js:<module>:<symbol>` refs.
  it('global FFI ref (console.log) emits as member access', async () => {
    const { decodeModule } = await import('../../src/wire/decoder.js');
    const wire = 'I1\nM test v=0.1.0 d=core\nF let f:fn(int)->unit=(x:int)->app(ffi:js:console:log,x);0';
    const ir = decodeModule(wire);
    const ts = emitTS(ir);
    expect(ts).toContain('console.log(x)');
    expect(ts).not.toContain('app(, x)');
    expect(ts).not.toMatch(/=>\s*\(\s*,/);
  });

  it('npm-package FFI ref emits as bare symbol (import-resolved name)', async () => {
    const { decodeModule } = await import('../../src/wire/decoder.js');
    const wire = 'I1\nM test v=0.1.0 d=core\nF let f:fn(int)->any=(x:int)->app(ffi:js:pg:Pool,x);0';
    const ir = decodeModule(wire);
    const ts = emitTS(ir);
    expect(ts).toContain('Pool(x)');
    expect(ts).not.toContain('pg.Pool');
  });
});


describe('TS emitter — operator builtins (__obj__, __index__, __nullish__, __optchain__)', () => {
  it('__obj__ emits object literal with parens around arrow body', async () => {
    const { decodeModule } = await import('../../src/wire/decoder.js');
    const wire = 'I1\nM test v=0.1.0 d=core\nF let mk:fn()->any=()->app(__obj__,"status","ok","code",200)';
    const ts = emitTS(decodeModule(wire));
    expect(ts).toContain('() => ({ status: "ok", code: 200 })');
  });

  it('__index__ emits bracket access', async () => {
    const { decodeModule } = await import('../../src/wire/decoder.js');
    const wire = 'I1\nM test v=0.1.0 d=core\nF let f:fn(any)->any=(r:any)->app(__index__,r.rows,0)';
    const ts = emitTS(decodeModule(wire));
    expect(ts).toContain('r.rows[0]');
  });

  it('__nullish__ emits coalescing', async () => {
    const { decodeModule } = await import('../../src/wire/decoder.js');
    const wire = 'I1\nM test v=0.1.0 d=core\nF let f:fn(any)->any=(x:any)->app(__nullish__,x,"default")';
    const ts = emitTS(decodeModule(wire));
    expect(ts).toContain('?? "default"');
  });

  it('__optchain__ emits ?. member access', async () => {
    const { decodeModule } = await import('../../src/wire/decoder.js');
    const wire = 'I1\nM test v=0.1.0 d=core\nF let f:fn(any)->any=(o:any)->app(__optchain__,o,"foo")';
    const ts = emitTS(decodeModule(wire));
    expect(ts).toContain('o?.foo');
  });
});
