import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import { desugarModule } from '../../src/desugar/index.js';
import type { IonIRModule, LetNode, AbsNode, LiteralNode, VarNode, AppNode, CaseNode, ConstructorPattern, LiteralPattern } from '../../src/ir/nodes.js';

function desugar(src: string): IonIRModule {
  const tokens = lex(src, 'test.ion');
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bindResult = bindModule(ast, 'test');
  const checkResult = checkModule(ast, bindResult, 'test');
  return desugarModule(ast, bindResult, checkResult, 'test', '0.0.0');
}

// ---------------------------------------------------------------------------
// 1. Plain int literal
// ---------------------------------------------------------------------------

describe('desugarModule — plain int literal', () => {
  it('let x: Int = 42 → decls[0] value is LiteralNode { kind: Int, value: 42 }', () => {
    const ir = desugar('let x: Int = 42');
    expect(ir.decls).toHaveLength(1);
    const decl = ir.decls[0] as LetNode;
    expect(decl.kind).toBe('Let');
    const lit = decl.value as LiteralNode;
    expect(lit.kind).toBe('Literal');
    expect(lit.value).toEqual({ kind: 'Int', value: 42 });
  });
});

// ---------------------------------------------------------------------------
// 2. Ident → VarNode
// ---------------------------------------------------------------------------

describe('desugarModule — ident → VarNode', () => {
  it('fn id(x: Int) -> Int = x → body is VarNode with symbolId', () => {
    const ir = desugar('fn id(x: Int) -> Int = x');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    expect(abs.kind).toBe('Abs');
    const body = abs.body as VarNode;
    expect(body.kind).toBe('Var');
    expect(body.name).toBe('x');
    expect(typeof body.symbolId).toBe('string');
    expect(body.symbolId.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. PipelineExpr → AppNode
// ---------------------------------------------------------------------------

describe('desugarModule — |> → AppNode', () => {
  it('fn f(x: Int) -> Int = x |> id → AppNode { callee: right, args: [left] }', () => {
    const ir = desugar('fn id(x: Int) -> Int = x\nfn f(x: Int) -> Int = x |> id');
    const letF = ir.decls[1] as LetNode;
    const abs = letF.value as AbsNode;
    const app = abs.body as AppNode;
    expect(app.kind).toBe('App');
    expect(app.args).toHaveLength(1);
    // callee is the right side (id), arg is the left side (x)
    const calleeVar = app.callee as VarNode;
    expect(calleeVar.kind).toBe('Var');
    expect(calleeVar.name).toBe('id');
    const argVar = app.args[0] as VarNode;
    expect(argVar.kind).toBe('Var');
    expect(argVar.name).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// 4. BinopExpr + → AppNode with __add__
// ---------------------------------------------------------------------------

describe('desugarModule — BinopExpr + → AppNode', () => {
  it('fn add(a: Int, b: Int) -> Int = a + b → callee is VarNode { name: __add__ }', () => {
    const ir = desugar('fn add(a: Int, b: Int) -> Int = a + b');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    const app = abs.body as AppNode;
    expect(app.kind).toBe('App');
    expect(app.args).toHaveLength(2);
    const callee = app.callee as VarNode;
    expect(callee.kind).toBe('Var');
    expect(callee.name).toBe('__add__');
  });
});

// ---------------------------------------------------------------------------
// 5. IfElseExpr → CaseNode with 2 arms
// ---------------------------------------------------------------------------

describe('desugarModule — IfElse → CaseNode', () => {
  it('if b then 1 else 0 → CaseNode with arms[0] as LiteralPattern(Bool true)', () => {
    const ir = desugar('fn choose(b: Bool) -> Int = if b then 1 else 0');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    const caseNode = abs.body as CaseNode;
    expect(caseNode.kind).toBe('Case');
    expect(caseNode.arms).toHaveLength(2);
    const firstArm = caseNode.arms[0]!;
    expect(firstArm.pattern.kind).toBe('Literal');
    const litPat = firstArm.pattern as LiteralPattern;
    expect(litPat.value).toEqual({ kind: 'Bool', value: true });
  });
});

// ---------------------------------------------------------------------------
// 6. MatchExpr → CaseNode
// ---------------------------------------------------------------------------

describe('desugarModule — MatchExpr → CaseNode', () => {
  it('match with 3 arms → CaseNode with 3 arms', () => {
    const src = `
      data Color = Red | Green | Blue
      fn describe(c: Color) -> Int = match c | Red -> 1 | Green -> 2 | Blue -> 3
    `;
    const ir = desugar(src);
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    const caseNode = abs.body as CaseNode;
    expect(caseNode.kind).toBe('Case');
    expect(caseNode.arms).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 7. LambdaExpr → AbsNode with empty captures
// ---------------------------------------------------------------------------

describe('desugarModule — LambdaExpr → AbsNode', () => {
  it('fn f(g: Int) -> Int = (x -> x)(g) → AbsNode.captures is []', () => {
    const ir = desugar('fn f(g: Int) -> Int = (x -> x)(g)');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    const app = abs.body as AppNode;
    expect(app.kind).toBe('App');
    const innerAbs = app.callee as AbsNode;
    expect(innerAbs.kind).toBe('Abs');
    expect(innerAbs.captures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. LetExpr → LetNode
// ---------------------------------------------------------------------------

describe('desugarModule — LetExpr → LetNode', () => {
  it('let y = x; y → LetNode.name = "y"', () => {
    const ir = desugar('fn f(x: Int) -> Int = let y = x; y');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    const letNode = abs.body as LetNode;
    expect(letNode.kind).toBe('Let');
    expect(letNode.name).toBe('y');
  });
});

// ---------------------------------------------------------------------------
// 9. String interpolation → concat AppNodes
// ---------------------------------------------------------------------------

describe('desugarModule — string interpolation → concat AppNodes', () => {
  it('"hello ${x}" → nested AppNode with __str_concat__', () => {
    const ir = desugar('fn greet(x: Str) -> Str = "hello ${x}"');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    const app = abs.body as AppNode;
    expect(app.kind).toBe('App');
    const callee = app.callee as VarNode;
    expect(callee.kind).toBe('Var');
    expect(callee.name).toBe('__str_concat__');
  });
});

// ---------------------------------------------------------------------------
// 10. Plain string → LiteralNode
// ---------------------------------------------------------------------------

describe('desugarModule — plain string → LiteralNode', () => {
  it('"hello" → LiteralNode { kind: Str, value: "hello" }', () => {
    const ir = desugar('let greeting: Str = "hello"');
    const letDecl = ir.decls[0] as LetNode;
    const lit = letDecl.value as LiteralNode;
    expect(lit.kind).toBe('Literal');
    expect(lit.value).toEqual({ kind: 'Str', value: 'hello' });
  });
});

// ---------------------------------------------------------------------------
// 11. DataDecl → AdtDeclNode in data[]
// ---------------------------------------------------------------------------

describe('desugarModule — DataDecl → AdtDeclNode', () => {
  it('data Shape = Circle | Square → data[0].variants has length 2', () => {
    const ir = desugar('data Shape = Circle | Square');
    expect(ir.data).toHaveLength(1);
    const adt = ir.data[0]!;
    expect(adt.kind).toBe('AdtDecl');
    expect(adt.name).toBe('Shape');
    expect(adt.variants).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 12. FnDecl → LetNode wrapping AbsNode
// ---------------------------------------------------------------------------

describe('desugarModule — FnDecl → LetNode(AbsNode)', () => {
  it('fn double(n: Int) -> Int = n + n → decls[0].kind=Let, value.kind=Abs', () => {
    const ir = desugar('fn double(n: Int) -> Int = n + n');
    const letDecl = ir.decls[0] as LetNode;
    expect(letDecl.kind).toBe('Let');
    expect(letDecl.name).toBe('double');
    expect(letDecl.value.kind).toBe('Abs');
  });
});

// ---------------------------------------------------------------------------
// 13. PropagateExpr on Result → 2-arm CaseNode
// ---------------------------------------------------------------------------

describe('desugarModule — PropagateExpr on Result', () => {
  it('fn f(x: Result<Int, Str>) -> Int = x? → 2-arm CaseNode with Ok/Err patterns', () => {
    const ir = desugar('fn f(x: Result<Int, Str>) -> Int = x?');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    const caseNode = abs.body as CaseNode;
    expect(caseNode.kind).toBe('Case');
    expect(caseNode.arms).toHaveLength(2);
    const okArm = caseNode.arms[0]!;
    const errArm = caseNode.arms[1]!;
    expect(okArm.pattern.kind).toBe('Constructor');
    expect((okArm.pattern as ConstructorPattern).ctorName).toBe('Ok');
    expect(errArm.pattern.kind).toBe('Constructor');
    expect((errArm.pattern as ConstructorPattern).ctorName).toBe('Err');
  });
});

// ---------------------------------------------------------------------------
// 14. Type annotation on every node
// ---------------------------------------------------------------------------

describe('desugarModule — type annotation', () => {
  it('fn f(x: Int) -> Int = x → every node has a type field', () => {
    const ir = desugar('fn f(x: Int) -> Int = x');
    const letDecl = ir.decls[0] as LetNode;
    expect(letDecl.type).toBeDefined();
    expect(letDecl.bindingType).toBeDefined();
    const abs = letDecl.value as AbsNode;
    expect(abs.type).toBeDefined();
    expect(abs.body as VarNode).toBeDefined();
    expect((abs.body as VarNode).type).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 15. UnaryExpr → AppNode with __neg__
// ---------------------------------------------------------------------------

describe('desugarModule — UnaryExpr → AppNode with __neg__', () => {
  it('fn negate(n: Int) -> Int = -n → callee is VarNode { name: __neg__ }', () => {
    const ir = desugar('fn negate(n: Int) -> Int = -n');
    const letDecl = ir.decls[0] as LetNode;
    const abs = letDecl.value as AbsNode;
    const app = abs.body as AppNode;
    expect(app.kind).toBe('App');
    expect(app.args).toHaveLength(1);
    const callee = app.callee as VarNode;
    expect(callee.kind).toBe('Var');
    expect(callee.name).toBe('__neg__');
  });
});
