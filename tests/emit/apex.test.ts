import { describe, it, expect } from 'vitest';
import { emitApex, emitApexExpr, ionTypeToApex } from '../../emitters/apex/emit.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import { makeSymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const SYM = makeSymbolId('');
const UNIT: IonIRNode['type'] = { kind: 'Unit' };

function strLit(value: string): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Str', value }, span: SPAN, type: { kind: 'Str' } };
}

function intLit(value: number): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Int', value }, span: SPAN, type: { kind: 'Int' } };
}

function floatLit(value: number): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Float', value }, span: SPAN, type: { kind: 'Float' } };
}

function boolLit(value: boolean): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Bool', value }, span: SPAN, type: { kind: 'Bool' } };
}

function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}

function appNode(calleeName: string, ...args: IonIRNode[]): IonIRNode {
  return {
    kind: 'App',
    callee: varNode(calleeName),
    args,
    span: SPAN,
    type: UNIT,
  };
}

function oopVirtualCallNode(receiver: IonIRNode, method: string, ...args: IonIRNode[]): IonIRNode {
  return {
    kind: 'OopVirtualCall',
    receiver,
    method,
    args,
    span: SPAN,
    type: UNIT,
  };
}

function accessorNode(receiver: IonIRNode, member: string): IonIRNode {
  return {
    kind: 'Accessor',
    receiver,
    member,
    span: SPAN,
    type: UNIT,
  };
}

function absNode(paramNames: string[], body: IonIRNode): IonIRNode {
  return {
    kind: 'Abs',
    params: paramNames.map(name => ({ name, symbolId: SYM, type: UNIT, span: SPAN })),
    body,
    captures: [],
    span: SPAN,
    type: UNIT,
  };
}

function letNode(name: string, value: IonIRNode): IonIRNode {
  return {
    kind: 'Let',
    name,
    symbolId: SYM,
    bindingType: UNIT,
    value,
    body: intLit(0),
    span: SPAN,
    type: UNIT,
  };
}

function makeModule(decls: IonIRNode[], moduleName = 'test'): IonIRModule {
  return {
    ionir: '1.0',
    module: moduleName,
    version: '0.0.1',
    dialects: [],
    imports: [],
    data: [],
    decls,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ionTypeToApex', () => {
  it('maps Int to Integer', () => {
    expect(ionTypeToApex({ kind: 'Int' })).toBe('Integer');
  });

  it('maps Float to Decimal', () => {
    expect(ionTypeToApex({ kind: 'Float' })).toBe('Decimal');
  });

  it('maps Str to String', () => {
    expect(ionTypeToApex({ kind: 'Str' })).toBe('String');
  });

  it('maps Bool to Boolean', () => {
    expect(ionTypeToApex({ kind: 'Bool' })).toBe('Boolean');
  });

  it('maps Unit to void', () => {
    expect(ionTypeToApex({ kind: 'Unit' })).toBe('void');
  });

  it('maps List<Str> to List<String>', () => {
    expect(ionTypeToApex({ kind: 'List', elem: { kind: 'Str' } })).toBe('List<String>');
  });

  it('maps Never to Object', () => {
    expect(ionTypeToApex({ kind: 'Never' })).toBe('Object');
  });
});

describe('emitApexExpr', () => {
  it('emits string literal with single quotes', () => {
    expect(emitApexExpr(strLit('hello'))).toBe("'hello'");
  });

  it('emits integer literal', () => {
    expect(emitApexExpr(intLit(42))).toBe('42');
  });

  it('emits float literal', () => {
    expect(emitApexExpr(floatLit(3.14))).toBe('3.14');
  });

  it('emits bool literal', () => {
    expect(emitApexExpr(boolLit(true))).toBe('true');
    expect(emitApexExpr(boolLit(false))).toBe('false');
  });

  it('emits __eq__ as == (not ===)', () => {
    const node = appNode('__eq__', varNode('a'), varNode('b'));
    expect(emitApexExpr(node)).toBe('a == b');
  });

  it('emits __ne__ as !=', () => {
    const node = appNode('__ne__', varNode('a'), varNode('b'));
    expect(emitApexExpr(node)).toBe('a != b');
  });

  it('emits __and__ as &&', () => {
    const node = appNode('__and__', varNode('a'), varNode('b'));
    expect(emitApexExpr(node)).toBe('(a && b)');
  });

  it('emits __or__ as ||', () => {
    const node = appNode('__or__', varNode('a'), varNode('b'));
    expect(emitApexExpr(node)).toBe('(a || b)');
  });

  it('emits __not__ as !', () => {
    const node = appNode('__not__', varNode('x'));
    expect(emitApexExpr(node)).toBe('!x');
  });

  it('emits __add__ as +', () => {
    const node = appNode('__add__', intLit(1), intLit(2));
    expect(emitApexExpr(node)).toBe('1 + 2');
  });

  it('OopVirtualCall includes → .contains()', () => {
    const node = oopVirtualCallNode(varNode('list'), 'includes', varNode('item'));
    expect(emitApexExpr(node)).toBe('list.contains(item)');
  });

  it('OopVirtualCall sort → .sort()', () => {
    const node = oopVirtualCallNode(varNode('myList'), 'sort');
    expect(emitApexExpr(node)).toBe('myList.sort()');
  });

  it('OopVirtualCall toLowerCase → .toLowerCase()', () => {
    const node = oopVirtualCallNode(varNode('str'), 'toLowerCase');
    expect(emitApexExpr(node)).toBe('str.toLowerCase()');
  });

  it('OopVirtualCall toUpperCase → .toUpperCase()', () => {
    const node = oopVirtualCallNode(varNode('str'), 'toUpperCase');
    expect(emitApexExpr(node)).toBe('str.toUpperCase()');
  });

  it('Accessor length → .size()', () => {
    const node = accessorNode(varNode('items'), 'length');
    expect(emitApexExpr(node)).toBe('items.size()');
  });

  it('Accessor k → .size()', () => {
    const node = accessorNode(varNode('claims'), 'k');
    expect(emitApexExpr(node)).toBe('claims.size()');
  });

  it('emits ListLit as new List<Object>{...}', () => {
    const node: IonIRNode = {
      kind: 'ListLit',
      elements: [intLit(1), intLit(2), intLit(3)],
      span: SPAN,
      type: { kind: 'List', elem: { kind: 'Int' } },
    };
    expect(emitApexExpr(node)).toBe('new List<Object>{1, 2, 3}');
  });

  it('emits Case as ternary expression', () => {
    const scrutinee = varNode('isActive');
    const thenBody = strLit('Active');
    const elseBody = strLit('Inactive');
    const node: IonIRNode = {
      kind: 'Case',
      scrutinee,
      arms: [
        {
          pattern: { kind: 'Literal', value: { kind: 'Bool', value: true }, span: SPAN },
          body: thenBody,
          span: SPAN,
        },
        {
          pattern: { kind: 'Wildcard', span: SPAN },
          body: elseBody,
          span: SPAN,
        },
      ],
      span: SPAN,
      type: { kind: 'Str' },
    };
    expect(emitApexExpr(node)).toBe("isActive ? 'Active' : 'Inactive'");
  });
});

describe('emitApex', () => {
  it('wraps class in public with sharing class', () => {
    const mod = makeModule([], 'claims-controller');
    const out = emitApex(mod);
    expect(out).toContain('public with sharing class ClaimsControllerController');
  });

  it('uses module name as class name prefix (PascalCase)', () => {
    const mod = makeModule([], 'task-manager');
    const out = emitApex(mod);
    expect(out).toContain('class TaskManagerController');
  });

  it('adds @AuraEnabled(cacheable=true) on get/filter functions', () => {
    const fn = absNode(['claims'], varNode('claims'));
    const mod = makeModule([letNode('getClaims', fn)]);
    const out = emitApex(mod);
    expect(out).toContain('@AuraEnabled(cacheable=true)');
    expect(out).toContain('getClaims(');
  });

  it('adds @AuraEnabled(cacheable=true) on filter* functions', () => {
    const fn = absNode(['claims', 'status'], varNode('claims'));
    const mod = makeModule([letNode('filterByStatus', fn)]);
    const out = emitApex(mod);
    expect(out).toContain('@AuraEnabled(cacheable=true)');
    expect(out).toContain('filterByStatus(');
  });

  it('adds @AuraEnabled (non-cacheable) on create/update functions', () => {
    const fn = absNode(['data'], varNode('data'));
    const mod = makeModule([letNode('createClaim', fn)]);
    const out = emitApex(mod);
    // Should NOT have cacheable=true
    expect(out).toContain('@AuraEnabled');
    // The line with @AuraEnabled should NOT have cacheable
    const lines = out.split('\n');
    const auraLine = lines.find(l => l.includes('@AuraEnabled'));
    expect(auraLine).toBeDefined();
    expect(auraLine).not.toContain('cacheable=true');
  });

  it('adds @AuraEnabled (non-cacheable) on update* functions', () => {
    const fn = absNode(['id', 'data'], varNode('data'));
    const mod = makeModule([letNode('updateClaimStatus', fn)]);
    const out = emitApex(mod);
    const lines = out.split('\n');
    const auraLine = lines.find(l => l.includes('@AuraEnabled'));
    expect(auraLine).toBeDefined();
    expect(auraLine).not.toContain('cacheable=true');
  });

  it('emits non-Abs values as private static properties', () => {
    const mod = makeModule([letNode('defaultStatus', strLit('Pending'))]);
    const out = emitApex(mod);
    expect(out).toContain("private static Object defaultStatus = 'Pending';");
  });

  it('contains public static method signature', () => {
    const fn = absNode(['claims'], varNode('claims'));
    const mod = makeModule([letNode('getClaims', fn)]);
    const out = emitApex(mod);
    expect(out).toContain('public static Object getClaims(');
  });

  it('contains generated comment header', () => {
    const mod = makeModule([], 'my-module');
    const out = emitApex(mod);
    expect(out).toContain('Generated by ION compiler from my-module.ion');
    expect(out).toContain('Do not edit manually.');
  });

  it('emits return statement in method body', () => {
    const fn = absNode(['x'], intLit(42));
    const mod = makeModule([letNode('getValue', fn)]);
    const out = emitApex(mod);
    expect(out).toContain('return 42;');
  });
});
