import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import { desugarModule } from '../../src/desugar/index.js';
import { encodeModule } from '../../src/wire/encoder.js';
import { decodeModule } from '../../src/wire/decoder.js';
import type { IonIRModule, LetNode, AbsNode } from '../../src/ir/nodes.js';

function compile(src: string): IonIRModule {
  const tokens = lex(src, 'test.ion');
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bindResult = bindModule(ast, 'test');
  if (bindResult.errors.length > 0) {
    const msgs = bindResult.errors.map(e => e.message).join(', ');
    throw new Error(`BindErrors: ${msgs}`);
  }
  const checkResult = checkModule(ast, bindResult, 'test');
  if (checkResult.errors.length > 0) {
    const msgs = checkResult.errors.map(e => e.message).join(', ');
    throw new Error(`CheckErrors: ${msgs}`);
  }
  return desugarModule(ast, bindResult, checkResult, 'test', '0.0.0');
}

describe('pipeline integration', () => {
  it('identity — minimal fn compiles without errors', () => {
    const ir = compile('fn id(x: Int) -> Int = x');
    expect(ir.decls).toHaveLength(1);
    expect(ir.dialects).toContain('core');
  });

  it('wire round-trip — encode then decode is structurally equivalent', () => {
    const ir = compile('fn id(x: Int) -> Int = x');
    const wireText = encodeModule(ir);
    const decoded = decodeModule(wireText);
    expect('error' in decoded).toBe(false);
    if (!('error' in decoded)) {
      expect(decoded.decls).toHaveLength(ir.decls.length);
      expect(decoded.module).toBe(ir.module);
    }
  });

  it('let binding — scoped name resolves correctly', () => {
    const ir = compile('fn foo(x: Int) -> Int = let y = x; y');
    expect(ir.decls).toHaveLength(1);
  });

  it('lambda — AbsNode.captures is present on top-level Abs', () => {
    const ir = compile('fn apply(g: Int) -> Int = (x -> x)(g)');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    expect(abs.kind).toBe('Abs');
    expect(Array.isArray(abs.captures)).toBe(true);
  });

  it('error propagation — undefined name surfaces as UndefinedName BindError', () => {
    const tokens = lex('fn bad() = undefined_var', 'test.ion');
    const cst = parseModule(tokens);
    const ast = buildModule(cst);
    const bindResult = bindModule(ast, 'test');
    const undefErrors = bindResult.errors.filter(e => e.kind === 'UndefinedName');
    expect(undefErrors.length).toBeGreaterThan(0);
    expect(undefErrors[0]?.message).toContain('undefined_var');
  });

  it('data decl round-trip — data field is non-empty after compile', () => {
    const ir = compile('data Color = Red | Green | Blue');
    expect(ir.data).toHaveLength(1);
    expect(ir.data[0]?.name).toBe('Color');
  });

  it('wire-encode then decode — ion-adt dialect preserved', () => {
    const src = `
      data Shape = Circle | Square
      fn describe(s: Shape) -> Int = match s | Circle -> 1 | Square -> 2
    `;
    const ir = compile(src);
    expect(ir.dialects).toContain('ion-adt');
    const wireText = encodeModule(ir);
    const decoded = decodeModule(wireText);
    expect('error' in decoded).toBe(false);
    if (!('error' in decoded)) {
      expect(decoded.dialects).toContain('ion-adt');
    }
  });
});
