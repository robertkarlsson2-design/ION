import { describe, it, expect, expectTypeOf } from 'vitest';
import { serializeModule, deserializeModule } from '../../src/ir/serde.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule } from '../../src/ir/nodes.js';
import type {
  IonIRNode,
  CoreNode,
  OopNode,
  AsyncNode,
  AdtNode,
  EffectsNode,
  VarNode,
  LiteralNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  ConstructorNode,
  AccessorNode,
  ModuleRefNode,
  ForeignRefNode,
  EffectNode,
  OopClassNode,
  OopInterfaceNode,
  OopNewNode,
  OopVirtualCallNode,
  OopThisNode,
  AsyncBlockNode,
  AwaitNode,
  AdtDeclNode,
  AdtMatchNode,
  EffectDeclNode,
  PerformNode,
  HandleNode,
  ResumeNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span, SymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Exhaustiveness helpers — TypeScript validates these at compile time.
// If any node kind is added to IonIRNode without a matching arm here, tsc fails.
// ---------------------------------------------------------------------------

function assertNever(x: never): never {
  throw new Error(`Unhandled node kind: ${JSON.stringify(x)}`);
}

/** Exhaustive switch over all IonIRNode kinds. */
function visitNode(node: IonIRNode): string {
  switch (node.kind) {
    // Core
    case 'Var': return 'Var';
    case 'Literal': return 'Literal';
    case 'App': return 'App';
    case 'Abs': return 'Abs';
    case 'Let': return 'Let';
    case 'Case': return 'Case';
    case 'Constructor': return 'Constructor';
    case 'Accessor': return 'Accessor';
    case 'ModuleRef': return 'ModuleRef';
    case 'ForeignRef': return 'ForeignRef';
    case 'Effect': return 'Effect';
    // OOP
    case 'OopClass': return 'OopClass';
    case 'OopInterface': return 'OopInterface';
    case 'OopNew': return 'OopNew';
    case 'OopVirtualCall': return 'OopVirtualCall';
    case 'OopThis': return 'OopThis';
    // Async
    case 'AsyncBlock': return 'AsyncBlock';
    case 'Await': return 'Await';
    // ADT
    case 'AdtDecl': return 'AdtDecl';
    case 'AdtMatch': return 'AdtMatch';
    // Effects
    case 'EffectDecl': return 'EffectDecl';
    case 'Perform': return 'Perform';
    case 'Handle': return 'Handle';
    case 'Resume': return 'Resume';
    default: return assertNever(node);
  }
}

/** Exhaustive switch over CoreNode only. */
function visitCoreNode(node: CoreNode): string {
  switch (node.kind) {
    case 'Var': return 'Var';
    case 'Literal': return 'Literal';
    case 'App': return 'App';
    case 'Abs': return 'Abs';
    case 'Let': return 'Let';
    case 'Case': return 'Case';
    case 'Constructor': return 'Constructor';
    case 'Accessor': return 'Accessor';
    case 'ModuleRef': return 'ModuleRef';
    case 'ForeignRef': return 'ForeignRef';
    case 'Effect': return 'Effect';
    default: return assertNever(node);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IonIR node type definitions', () => {
  it('visitNode is exhaustive over all IonIRNode kinds', () => {
    // The compile-time check above is the real test.
    // This runtime assertion confirms the switch is reachable.
    const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
    const intType: IonType = { kind: 'Int' };
    const sid = 'mod:x:0' as SymbolId;

    const varNode: VarNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    expect(visitNode(varNode)).toBe('Var');
  });

  it('visitCoreNode is exhaustive over all CoreNode kinds', () => {
    const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
    const intType: IonType = { kind: 'Int' };
    const sid = 'mod:x:0' as SymbolId;

    const varNode: VarNode = { kind: 'Var', name: 'x', symbolId: sid, span, type: intType };
    expect(visitCoreNode(varNode)).toBe('Var');
  });

  it('every IonIRNode carries kind, span, and type', () => {
    expectTypeOf<VarNode>().toHaveProperty('kind');
    expectTypeOf<VarNode>().toHaveProperty('span');
    expectTypeOf<VarNode>().toHaveProperty('type');

    expectTypeOf<LiteralNode>().toHaveProperty('kind');
    expectTypeOf<LiteralNode>().toHaveProperty('span');
    expectTypeOf<LiteralNode>().toHaveProperty('type');

    expectTypeOf<AppNode>().toHaveProperty('kind');
    expectTypeOf<AppNode>().toHaveProperty('span');
    expectTypeOf<AppNode>().toHaveProperty('type');

    expectTypeOf<AbsNode>().toHaveProperty('kind');
    expectTypeOf<AbsNode>().toHaveProperty('span');
    expectTypeOf<AbsNode>().toHaveProperty('type');

    expectTypeOf<LetNode>().toHaveProperty('kind');
    expectTypeOf<LetNode>().toHaveProperty('span');
    expectTypeOf<LetNode>().toHaveProperty('type');

    expectTypeOf<CaseNode>().toHaveProperty('kind');
    expectTypeOf<CaseNode>().toHaveProperty('span');
    expectTypeOf<CaseNode>().toHaveProperty('type');

    expectTypeOf<ConstructorNode>().toHaveProperty('kind');
    expectTypeOf<AccessorNode>().toHaveProperty('kind');
    expectTypeOf<ModuleRefNode>().toHaveProperty('kind');
    expectTypeOf<ForeignRefNode>().toHaveProperty('kind');
    expectTypeOf<EffectNode>().toHaveProperty('kind');

    expectTypeOf<OopClassNode>().toHaveProperty('kind');
    expectTypeOf<OopInterfaceNode>().toHaveProperty('kind');
    expectTypeOf<OopNewNode>().toHaveProperty('kind');
    expectTypeOf<OopVirtualCallNode>().toHaveProperty('kind');
    expectTypeOf<OopThisNode>().toHaveProperty('kind');

    expectTypeOf<AsyncBlockNode>().toHaveProperty('kind');
    expectTypeOf<AwaitNode>().toHaveProperty('kind');

    expectTypeOf<AdtDeclNode>().toHaveProperty('kind');
    expectTypeOf<AdtMatchNode>().toHaveProperty('kind');

    expectTypeOf<EffectDeclNode>().toHaveProperty('kind');
    expectTypeOf<PerformNode>().toHaveProperty('kind');
    expectTypeOf<HandleNode>().toHaveProperty('kind');
    expectTypeOf<ResumeNode>().toHaveProperty('kind');
  });

  it('IonIRNode sub-unions compose correctly', () => {
    expectTypeOf<CoreNode>().toMatchTypeOf<IonIRNode>();
    expectTypeOf<OopNode>().toMatchTypeOf<IonIRNode>();
    expectTypeOf<AsyncNode>().toMatchTypeOf<IonIRNode>();
    expectTypeOf<AdtNode>().toMatchTypeOf<IonIRNode>();
    expectTypeOf<EffectsNode>().toMatchTypeOf<IonIRNode>();
  });
});

describe('IonIR serde — TupleType round-trip', () => {
  it('round-trips a VarNode carrying TupleType', () => {
    const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
    const sid: SymbolId = makeSymbolId('mod:x:0');
    const tupleType: IonType = { kind: 'Tuple', elements: [{ kind: 'Int' }, { kind: 'Str' }] };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test.tuple',
      version: '1.0.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: tupleType }],
    };
    const out = deserializeModule(serializeModule(mod));
    expect(out).toEqual(mod);
    expect((out.decls[0] as { type: IonType }).type).toEqual(tupleType);
  });

  it('round-trips an empty TupleType', () => {
    const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
    const sid: SymbolId = makeSymbolId('mod:y:0');
    const emptyTuple: IonType = { kind: 'Tuple', elements: [] };
    const mod: IonIRModule = {
      ionir: '1.0',
      module: 'test.empty-tuple',
      version: '1.0.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [{ kind: 'Var', name: 'y', symbolId: sid, span, type: emptyTuple }],
    };
    const out = deserializeModule(serializeModule(mod));
    expect(out).toEqual(mod);
  });
});
