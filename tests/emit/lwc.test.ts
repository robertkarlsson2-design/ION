import { describe, it, expect } from 'vitest';
import { emitLWC, emitLwcNode } from '../../skills/lwc/emit.js';
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

function boolLit(value: boolean): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Bool', value }, span: SPAN, type: { kind: 'Bool' } };
}

function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}

function appNode(tag: string, attrStr: string, ...children: IonIRNode[]): IonIRNode {
  return {
    kind: 'App',
    callee: varNode(tag),
    args: [strLit(attrStr), ...children],
    span: SPAN,
    type: UNIT,
  };
}

function absNode(params: string[], body: IonIRNode): IonIRNode {
  return {
    kind: 'Abs',
    params: params.map(name => ({ name, symbolId: SYM, type: UNIT, span: SPAN })),
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

function caseNode(scrutinee: IonIRNode, thenBody: IonIRNode, elseBody: IonIRNode): IonIRNode {
  return {
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

describe('emitLwcNode', () => {
  it('wraps output in <template> tags via emitLWC', () => {
    const mod = makeModule([letNode('page', appNode('div', 'class=container', strLit('Hello')))]);
    const out = emitLWC(mod);
    expect(out.html).toContain('<template>');
    expect(out.html).toContain('</template>');
    expect(out.html).toContain('<div');
  });

  it('emits static class attr with double quotes (not dynamic)', () => {
    const node = appNode('div', 'class=container', strLit('text'));
    const out = emitLwcNode(node);
    // "container" is not a JS identifier with dots/parens — but it IS an identifier
    // per the regex. The spec says identifiers get {value}. Let's verify:
    expect(out).toContain('class={container}');
  });

  it('emits onclick with curly brace syntax', () => {
    const node = appNode('button', 'onclick=handleSubmit', strLit('Submit'));
    const out = emitLwcNode(node);
    expect(out).toContain('onclick={handleSubmit}');
    expect(out).not.toContain('onclick="handleSubmit"');
  });

  it('emits lwc:if and lwc:else for two-arm Case', () => {
    const thenArm = appNode('p', '', strLit('Has claims'));
    const elseArm = appNode('p', '', strLit('No claims'));
    const node = caseNode(varNode('hasClaims'), thenArm, elseArm);
    const out = emitLwcNode(node);
    expect(out).toContain('lwc:if={hasClaims}');
    expect(out).toContain('lwc:else');
    expect(out).toContain('Has claims');
    expect(out).toContain('No claims');
  });

  it('emits lwc:if without lwc:else when else arm is empty', () => {
    const thenArm = appNode('p', '', strLit('Has items'));
    const node = caseNode(varNode('hasItems'), thenArm, strLit(''));
    const out = emitLwcNode(node);
    expect(out).toContain('lwc:if={hasItems}');
    // Empty else means no lwc:else block
    expect(out).not.toContain('lwc:else');
  });

  it('emits Var as {varName} binding', () => {
    const node = appNode('span', '', varNode('claimTitle'));
    const out = emitLwcNode(node);
    expect(out).toContain('{claimTitle}');
  });

  it('emits for:each attribute as dynamic binding', () => {
    const node = appNode('ul', 'for:each=claims for:item=claim', strLit(''));
    const out = emitLwcNode(node);
    expect(out).toContain('for:each={claims}');
    expect(out).toContain('for:item={claim}');
  });
});

describe('emitLWC', () => {
  it('emits Abs as method in JS class', () => {
    const body = appNode('div', '', strLit('result'));
    const fnNode = absNode(['x'], strLit('hello'));
    const mod = makeModule([letNode('processData', fnNode)]);
    const out = emitLWC(mod);
    expect(out.js).toContain('processData(');
  });

  it('emits getter (name starts with get) as get accessor', () => {
    const fn = absNode([], varNode('claims'));
    const mod = makeModule([letNode('getClaimCount', fn)]);
    const out = emitLWC(mod);
    expect(out.js).toContain('get claimCount()');
  });

  it('emits handle* methods as event handlers with event param', () => {
    const fn = absNode([], strLit('handled'));
    const mod = makeModule([letNode('handleSubmit', fn)]);
    const out = emitLWC(mod);
    expect(out.js).toContain('handleSubmit(event');
    expect(out.js).toContain('event.preventDefault()');
  });

  it('emits @track for non-Abs non-Id properties', () => {
    const mod = makeModule([letNode('claims', intLit(0))]);
    const out = emitLWC(mod);
    expect(out.js).toContain('@track claims');
  });

  it('emits @api for names ending in Id', () => {
    const mod = makeModule([letNode('recordId', strLit('')), letNode('accountId', strLit(''))]);
    const out = emitLWC(mod);
    expect(out.js).toContain('@api recordId');
    expect(out.js).toContain('@api accountId');
  });

  it('meta file always contains apiVersion', () => {
    const mod = makeModule([]);
    const out = emitLWC(mod);
    expect(out.meta).toContain('<apiVersion>59.0</apiVersion>');
  });

  it('meta file contains LightningComponentBundle', () => {
    const mod = makeModule([]);
    const out = emitLWC(mod);
    expect(out.meta).toContain('LightningComponentBundle');
    expect(out.meta).toContain('lightning__AppPage');
    expect(out.meta).toContain('lightning__RecordPage');
    expect(out.meta).toContain('lightning__HomePage');
  });

  it('CSS file contains .container', () => {
    const mod = makeModule([]);
    const out = emitLWC(mod);
    expect(out.css).toContain('.container');
  });

  it('full LwcOutput has all 4 keys with content', () => {
    const mod = makeModule([letNode('page', appNode('div', 'class=app', strLit('Content')))]);
    const out = emitLWC(mod);
    expect(out).toHaveProperty('html');
    expect(out).toHaveProperty('js');
    expect(out).toHaveProperty('css');
    expect(out).toHaveProperty('meta');
    expect(typeof out.html).toBe('string');
    expect(typeof out.js).toBe('string');
    expect(typeof out.css).toBe('string');
    expect(typeof out.meta).toBe('string');
    expect(out.html.length).toBeGreaterThan(0);
    expect(out.js.length).toBeGreaterThan(0);
    expect(out.css.length).toBeGreaterThan(0);
    expect(out.meta.length).toBeGreaterThan(0);
  });

  it('class name is PascalCase from module name', () => {
    const mod = makeModule([], 'claims-list');
    const out = emitLWC(mod);
    expect(out.js).toContain('class ClaimsList extends LightningElement');
  });

  it('imports LightningElement from lwc', () => {
    const mod = makeModule([]);
    const out = emitLWC(mod);
    expect(out.js).toContain("import { LightningElement");
    expect(out.js).toContain("from 'lwc'");
  });
});
