import { describe, it, expect } from 'vitest';
import type {
  VarNode,
  LiteralNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  ConstructorNode,
  AccessorNode,
  ForeignRefNode,
  EffectNode,
  AsyncBlockNode,
  AwaitNode,
  IonIRModule,
} from '../../src/ir/nodes.js';
import type { Span, SymbolId } from '../../src/types.js';
import type { IonType } from '../../src/ir/types.js';
import { emitModule } from '../../skills/javascript/emitter.js';
import type {
  JsIdentifier,
  JsLiteral,
  JsCallExpression,
  JsArrowFunctionExpression,
  JsVariableDeclaration,
  JsObjectExpression,
  JsMemberExpression,
  JsConditionalExpression,
  JsAwaitExpression,
} from '../../skills/javascript/js-ast.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 10 };
const tInt: IonType = { kind: 'Int' };
const tStr: IonType = { kind: 'Str' };
const tBool: IonType = { kind: 'Bool' };
const tUnit: IonType = { kind: 'Unit' };

function sid(s: string): SymbolId {
  return s as SymbolId;
}

function makeModule(decls: IonIRModule['decls']): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test',
    version: '0.1.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls,
  };
}

// ---------------------------------------------------------------------------
// Helper: emit a single expression via a trivial module
// ---------------------------------------------------------------------------

function emitExpr(decls: IonIRModule['decls']) {
  return emitModule(makeModule(decls));
}

// ---------------------------------------------------------------------------
// VarNode
// ---------------------------------------------------------------------------

describe('emitVar', () => {
  it('emits mangled identifier for Var', () => {
    const varNode: VarNode = { kind: 'Var', name: 'x', symbolId: sid('mod:x:0'), span, type: tInt };
    const literalNode: LiteralNode = { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt };
    const letNode: LetNode = {
      kind: 'Let',
      name: 'y',
      symbolId: sid('mod:y:1'),
      bindingType: tInt,
      value: varNode,
      body: literalNode,
      span,
      type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { type: string; declarations: Array<{ id: JsIdentifier; init: JsIdentifier }> };
    expect(decl.type).toBe('VariableDeclaration');
    const init = decl.declarations[0].init as JsIdentifier;
    expect(init.type).toBe('Identifier');
    expect(init.name).toBe('x_mod_x_0');
  });

  it('emits raw name when mangling disabled', () => {
    const varNode: VarNode = { kind: 'Var', name: 'x', symbolId: sid('mod:x:0'), span, type: tInt };
    const literalNode: LiteralNode = { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt };
    const letNode: LetNode = {
      kind: 'Let',
      name: 'y',
      symbolId: sid('mod:y:1'),
      bindingType: tInt,
      value: varNode,
      body: literalNode,
      span,
      type: tInt,
    };
    const prog = emitModule(makeModule([letNode]), { mangleSymbols: false });
    const decl = prog.body[0] as { type: string; declarations: Array<{ id: JsIdentifier; init: JsIdentifier }> };
    const init = decl.declarations[0].init as JsIdentifier;
    expect(init.name).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// LiteralNode
// ---------------------------------------------------------------------------

describe('emitLiteral', () => {
  function litDecl(lit: LiteralNode): LiteralNode {
    return lit;
  }

  function emitLit(lit: LiteralNode): JsLiteral {
    const prog = emitExpr([
      {
        kind: 'Let',
        name: 'v',
        symbolId: sid('m:v:0'),
        bindingType: tInt,
        value: lit,
        body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
        span,
        type: tInt,
      },
    ]);
    const decl = prog.body[0] as { type: string; declarations: Array<{ init: JsLiteral }> };
    return decl.declarations[0].init;
  }

  it('Int literal', () => {
    const lit = emitLit(litDecl({ kind: 'Literal', value: { kind: 'Int', value: 42 }, span, type: tInt }));
    expect(lit.type).toBe('Literal');
    expect(lit.value).toBe(42);
  });

  it('Float literal', () => {
    const lit = emitLit(litDecl({ kind: 'Literal', value: { kind: 'Float', value: 3.14 }, span, type: { kind: 'Float' } }));
    expect(lit.type).toBe('Literal');
    expect(lit.value).toBeCloseTo(3.14);
  });

  it('Str literal', () => {
    const lit = emitLit(litDecl({ kind: 'Literal', value: { kind: 'Str', value: 'hello' }, span, type: tStr }));
    expect(lit.type).toBe('Literal');
    expect(lit.value).toBe('hello');
  });

  it('Bool literal true', () => {
    const lit = emitLit(litDecl({ kind: 'Literal', value: { kind: 'Bool', value: true }, span, type: tBool }));
    expect(lit.value).toBe(true);
  });

  it('Bool literal false', () => {
    const lit = emitLit(litDecl({ kind: 'Literal', value: { kind: 'Bool', value: false }, span, type: tBool }));
    expect(lit.value).toBe(false);
  });

  it('Null literal', () => {
    const lit = emitLit(litDecl({ kind: 'Literal', value: { kind: 'Null' }, span, type: { kind: 'Null' } }));
    expect(lit.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AppNode (regular call)
// ---------------------------------------------------------------------------

describe('emitApp (regular call)', () => {
  it('emits JsCallExpression for a normal function application', () => {
    const fn: VarNode = { kind: 'Var', name: 'f', symbolId: sid('m:f:1'), span, type: tInt };
    const arg: LiteralNode = { kind: 'Literal', value: { kind: 'Int', value: 5 }, span, type: tInt };
    const app: AppNode = { kind: 'App', callee: fn, args: [arg], span, type: tInt };
    const letNode: LetNode = {
      kind: 'Let', name: 'r', symbolId: sid('m:r:2'), bindingType: tInt,
      value: app,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsCallExpression }> };
    const call = decl.declarations[0].init;
    expect(call.type).toBe('CallExpression');
    expect((call.callee as JsIdentifier).name).toBe('f_m_f_1');
    expect(call.arguments).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AppNode (ForeignRef call via template expansion)
// ---------------------------------------------------------------------------

describe('emitApp (ForeignRef template expansion)', () => {
  it('expands ForeignRef template to JsRawExpression', () => {
    const foreignRef: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'js',
      module: 'std',
      symbol: 'console_log',
      sig: { params: [tStr], ret: tUnit, template: 'console.log($1)' },
      span,
      type: { kind: 'Fn', params: [tStr], ret: tUnit, effects: new Set() },
    };
    const letForeign: LetNode = {
      kind: 'Let', name: 'console_log', symbolId: sid('m:console_log:0'), bindingType: tUnit,
      value: foreignRef,
      body: {
        kind: 'Let', name: 'result', symbolId: sid('m:result:1'), bindingType: tUnit,
        value: {
          kind: 'App',
          callee: { kind: 'Var', name: 'console_log', symbolId: sid('m:console_log:0'), span, type: tUnit },
          args: [{ kind: 'Literal', value: { kind: 'Str', value: 'hi' }, span, type: tStr }],
          span,
          type: tUnit,
        } satisfies AppNode,
        body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
        span, type: tUnit,
      },
      span, type: tUnit,
    };
    const prog = emitExpr([letForeign]);
    // First stmt is ForeignRef (skipped), second stmt is `result`
    const decl = prog.body[0] as { declarations: Array<{ init: { type: string; raw: string } }> };
    expect(decl.declarations[0].init.type).toBe('RawExpression');
    expect(decl.declarations[0].init.raw).toBe('console.log("hi")');
  });
});

// ---------------------------------------------------------------------------
// AbsNode
// ---------------------------------------------------------------------------

describe('emitAbs', () => {
  it('emits single-param arrow function', () => {
    const abs: AbsNode = {
      kind: 'Abs',
      params: [{ name: 'x', symbolId: sid('m:x:0'), type: tInt, span }],
      body: { kind: 'Var', name: 'x', symbolId: sid('m:x:0'), span, type: tInt },
      captures: [],
      span,
      type: { kind: 'Fn', params: [tInt], ret: tInt, effects: new Set() },
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'id', symbolId: sid('m:id:1'), bindingType: tInt,
      value: abs,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsArrowFunctionExpression }> };
    const arrow = decl.declarations[0].init;
    expect(arrow.type).toBe('ArrowFunctionExpression');
    expect(arrow.params).toHaveLength(1);
    expect(arrow.async).toBe(false);
  });

  it('emits multi-param arrow function', () => {
    const abs: AbsNode = {
      kind: 'Abs',
      params: [
        { name: 'a', symbolId: sid('m:a:0'), type: tInt, span },
        { name: 'b', symbolId: sid('m:b:1'), type: tInt, span },
      ],
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      captures: [],
      span,
      type: { kind: 'Fn', params: [tInt, tInt], ret: tInt, effects: new Set() },
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'add', symbolId: sid('m:add:2'), bindingType: tInt,
      value: abs,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsArrowFunctionExpression }> };
    expect(decl.declarations[0].init.params).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// LetNode (top-level → const declaration)
// ---------------------------------------------------------------------------

describe('emitLet (top-level)', () => {
  it('emits const declaration for top-level Let', () => {
    const letNode: LetNode = {
      kind: 'Let', name: 'answer', symbolId: sid('m:answer:0'), bindingType: tInt,
      value: { kind: 'Literal', value: { kind: 'Int', value: 42 }, span, type: tInt },
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as JsVariableDeclaration;
    expect(decl.type).toBe('VariableDeclaration');
    expect(decl.kind).toBe('const');
    expect(decl.declarations[0].id.name).toBe('answer_m_answer_0');
    expect((decl.declarations[0].init as JsLiteral).value).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// LetNode (expression context → IIFE)
// ---------------------------------------------------------------------------

describe('emitLetExpr (nested let as IIFE)', () => {
  it('emits IIFE for nested Let in expression context', () => {
    // Abs body is a Let — emitted as IIFE
    const innerLet: LetNode = {
      kind: 'Let', name: 'tmp', symbolId: sid('m:tmp:0'), bindingType: tInt,
      value: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: tInt },
      body: { kind: 'Var', name: 'tmp', symbolId: sid('m:tmp:0'), span, type: tInt },
      span, type: tInt,
    };
    const abs: AbsNode = {
      kind: 'Abs',
      params: [{ name: 'x', symbolId: sid('m:x:1'), type: tInt, span }],
      body: innerLet,
      captures: [],
      span,
      type: { kind: 'Fn', params: [tInt], ret: tInt, effects: new Set() },
    };
    const outerLet: LetNode = {
      kind: 'Let', name: 'fn', symbolId: sid('m:fn:2'), bindingType: tInt,
      value: abs,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([outerLet]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsArrowFunctionExpression }> };
    const arrow = decl.declarations[0].init;
    expect(arrow.type).toBe('ArrowFunctionExpression');
    // Body is an IIFE (CallExpression)
    expect((arrow.body as { type: string }).type).toBe('CallExpression');
  });
});

// ---------------------------------------------------------------------------
// CaseNode (2-arm ternary)
// ---------------------------------------------------------------------------

describe('emitCase (ternary)', () => {
  it('emits ternary for 2-arm wildcard case', () => {
    const caseNode: CaseNode = {
      kind: 'Case',
      scrutinee: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: tInt },
      arms: [
        {
          pattern: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span },
          body: { kind: 'Literal', value: { kind: 'Str', value: 'one' }, span, type: tStr },
          span,
        },
        {
          pattern: { kind: 'Wildcard', span },
          body: { kind: 'Literal', value: { kind: 'Str', value: 'other' }, span, type: tStr },
          span,
        },
      ],
      span,
      type: tStr,
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'r', symbolId: sid('m:r:0'), bindingType: tStr,
      value: caseNode,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tStr,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsConditionalExpression }> };
    const ternary = decl.declarations[0].init;
    expect(ternary.type).toBe('ConditionalExpression');
  });

  it('emits IIFE for 3-arm case with guard', () => {
    const guard: LiteralNode = { kind: 'Literal', value: { kind: 'Bool', value: true }, span, type: tBool };
    const caseNode: CaseNode = {
      kind: 'Case',
      scrutinee: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: tInt },
      arms: [
        {
          pattern: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span },
          guard,
          body: { kind: 'Literal', value: { kind: 'Str', value: 'a' }, span, type: tStr },
          span,
        },
        {
          pattern: { kind: 'Literal', value: { kind: 'Int', value: 2 }, span },
          body: { kind: 'Literal', value: { kind: 'Str', value: 'b' }, span, type: tStr },
          span,
        },
        {
          pattern: { kind: 'Wildcard', span },
          body: { kind: 'Literal', value: { kind: 'Str', value: 'c' }, span, type: tStr },
          span,
        },
      ],
      span,
      type: tStr,
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'r', symbolId: sid('m:r:0'), bindingType: tStr,
      value: caseNode,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tStr,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsCallExpression }> };
    const iife = decl.declarations[0].init;
    expect(iife.type).toBe('CallExpression');
  });
});

// ---------------------------------------------------------------------------
// AccessorNode
// ---------------------------------------------------------------------------

describe('emitAccessor', () => {
  it('emits MemberExpression', () => {
    const acc: AccessorNode = {
      kind: 'Accessor',
      receiver: { kind: 'Var', name: 'obj', symbolId: sid('m:obj:0'), span, type: tInt },
      member: 'foo',
      span,
      type: tInt,
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'v', symbolId: sid('m:v:1'), bindingType: tInt,
      value: acc,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsMemberExpression }> };
    const mem = decl.declarations[0].init;
    expect(mem.type).toBe('MemberExpression');
    expect(mem.property.name).toBe('foo');
    expect(mem.computed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConstructorNode
// ---------------------------------------------------------------------------

describe('emitConstructor', () => {
  it('emits ObjectExpression with _tag and fields', () => {
    const ctor: ConstructorNode = {
      kind: 'Constructor',
      ctorName: 'Some',
      symbolId: sid('m:Some:0'),
      args: [{ kind: 'Literal', value: { kind: 'Int', value: 42 }, span, type: tInt }],
      span,
      type: { kind: 'User', name: 'Option', symbolId: sid('m:Option:99'), args: [] },
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'v', symbolId: sid('m:v:1'), bindingType: tInt,
      value: ctor,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsObjectExpression }> };
    const obj = decl.declarations[0].init;
    expect(obj.type).toBe('ObjectExpression');
    expect(obj.properties[0].key.name).toBe('_tag');
    expect((obj.properties[0].value as JsLiteral).value).toBe('Some');
    expect(obj.properties[1].key.name).toBe('field0');
    expect((obj.properties[1].value as JsLiteral).value).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// EffectNode (erased — delegates to body)
// ---------------------------------------------------------------------------

describe('emitEffect', () => {
  it('emits body expression (effect erased)', () => {
    const body: LiteralNode = { kind: 'Literal', value: { kind: 'Int', value: 7 }, span, type: tInt };
    const effect: EffectNode = {
      kind: 'Effect',
      effectTag: 'io' as import('../../src/ast/types.js').EffectTag,
      body,
      span,
      type: tInt,
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'v', symbolId: sid('m:v:0'), bindingType: tInt,
      value: effect,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsLiteral }> };
    const lit = decl.declarations[0].init;
    expect(lit.type).toBe('Literal');
    expect(lit.value).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// AsyncBlockNode + AwaitNode
// ---------------------------------------------------------------------------

describe('emitAsyncBlock and emitAwait', () => {
  it('emits async IIFE for AsyncBlock', () => {
    const asyncBlock: AsyncBlockNode = {
      kind: 'AsyncBlock',
      body: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: tInt },
      span,
      type: tInt,
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'p', symbolId: sid('m:p:0'), bindingType: tInt,
      value: asyncBlock,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsCallExpression }> };
    const call = decl.declarations[0].init;
    expect(call.type).toBe('CallExpression');
    const arrow = call.callee as JsArrowFunctionExpression;
    expect(arrow.async).toBe(true);
  });

  it('emits AwaitExpression for Await', () => {
    const awaitNode: AwaitNode = {
      kind: 'Await',
      expr: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: tInt },
      span,
      type: tInt,
    };
    const letNode: LetNode = {
      kind: 'Let', name: 'v', symbolId: sid('m:v:0'), bindingType: tInt,
      value: awaitNode,
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
      span, type: tInt,
    };
    const prog = emitExpr([letNode]);
    const decl = prog.body[0] as { declarations: Array<{ init: JsAwaitExpression }> };
    const aw = decl.declarations[0].init;
    expect(aw.type).toBe('AwaitExpression');
  });
});

// ---------------------------------------------------------------------------
// Full emitModule smoke test
// ---------------------------------------------------------------------------

describe('emitModule (smoke test)', () => {
  it('returns Program with sourceType module', () => {
    const prog = emitModule({
      ionir: '1.0',
      module: 'test',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [],
    });
    expect(prog.type).toBe('Program');
    expect(prog.sourceType).toBe('module');
    expect(prog.body).toEqual([]);
  });

  it('emits multiple top-level declarations', () => {
    const module: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [
        {
          kind: 'Let', name: 'a', symbolId: sid('m:a:0'), bindingType: tInt,
          value: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span, type: tInt },
          body: {
            kind: 'Let', name: 'b', symbolId: sid('m:b:1'), bindingType: tInt,
            value: { kind: 'Literal', value: { kind: 'Int', value: 2 }, span, type: tInt },
            body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
            span, type: tInt,
          },
          span, type: tInt,
        },
      ],
    };
    const prog = emitModule(module);
    // Should unroll into 2 const declarations (a, b) plus the trivial final body (emitted as expr stmt)
    expect(prog.body.length).toBeGreaterThanOrEqual(2);
    expect(prog.body[0]).toMatchObject({ type: 'VariableDeclaration', kind: 'const' });
    expect(prog.body[1]).toMatchObject({ type: 'VariableDeclaration', kind: 'const' });
  });

  it('throws for OOP dialect nodes', () => {
    const module: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '0.1.0',
      dialects: ['core', 'ion-oop'],
      imports: [],
      data: [],
      decls: [
        {
          kind: 'OopThis',
          span,
          type: tInt,
        },
      ],
    };
    expect(() => emitModule(module)).toThrow(/OOP/);
  });
});
