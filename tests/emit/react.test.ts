import { describe, it, expect } from 'vitest';
import { emitReact, emitJsxNode, emitTsExprForReact } from '../../emitters/react/emit.js';
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

function letNode(name: string, value: IonIRNode): IonIRNode {
  return {
    kind: 'Let',
    name,
    symbolId: SYM,
    bindingType: UNIT,
    value,
    body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span: SPAN, type: { kind: 'Int' } },
    span: SPAN,
    type: UNIT,
  };
}

function makeModule(decls: IonIRNode[]): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test',
    version: '0.0.1',
    dialects: [],
    imports: [],
    data: [],
    decls,
  };
}

function rawNode(code: string): IonIRNode {
  return { kind: 'RawInject', code, span: SPAN, type: UNIT };
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

function asyncBlockNode(body: IonIRNode): IonIRNode {
  return { kind: 'AsyncBlock', body, span: SPAN, type: UNIT };
}

function chainLet(name: string, value: IonIRNode, body: IonIRNode): IonIRNode {
  return {
    kind: 'Let',
    name,
    symbolId: SYM,
    bindingType: UNIT,
    value,
    body,
    span: SPAN,
    type: UNIT,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitJsxNode', () => {
  it('emits a simple div with no attrs', () => {
    const node = appNode('div', '', strLit('hello'));
    const out = emitJsxNode(node);
    expect(out).toContain('<div>');
    expect(out).toContain('{"hello"}');
    expect(out).toContain('</div>');
  });

  it('emits div with class mapped to className', () => {
    const node = appNode('div', 'class=container', strLit('text'));
    const out = emitJsxNode(node);
    expect(out).toContain('className="container"');
    expect(out).not.toContain('class="container"');
  });

  it('emits a self-closing input with type attribute', () => {
    const node = appNode('input', 'type=text name=x');
    const out = emitJsxNode(node);
    expect(out).toContain('<input');
    expect(out).toContain('type="text"');
    expect(out).toContain('name="x"');
    expect(out).toContain('/>');
  });

  it('emits nested elements', () => {
    const inner = appNode('span', 'class=label', strLit('Name'));
    const outer = appNode('div', 'class=field', inner);
    const out = emitJsxNode(outer);
    expect(out).toContain('className="field"');
    expect(out).toContain('className="label"');
    expect(out).toContain('{"Name"}');
  });

  it('emits onclick handler with curly braces', () => {
    const node = appNode('button', 'onclick=handleClick', strLit('Click'));
    const out = emitJsxNode(node);
    expect(out).toContain('onClick={handleClick}');
  });

  it('resolves Var from env', () => {
    const inner = appNode('span', '', strLit('resolved'));
    const env = new Map<string, IonIRNode>([['mySpan', inner]]);
    const outer = appNode('div', '', varNode('mySpan'));
    const out = emitJsxNode(outer, 0, env);
    expect(out).toContain('<span>');
    expect(out).toContain('{"resolved"}');
  });

  it('emits Case as conditional expression', () => {
    const trueArm = appNode('div', '', strLit('Yes'));
    const falseArm = appNode('div', '', strLit('No'));
    const caseNode: IonIRNode = {
      kind: 'Case',
      scrutinee: varNode('isActive'),
      arms: [
        { pattern: { kind: 'Literal', value: { kind: 'Bool', value: true }, span: SPAN }, body: trueArm, span: SPAN },
        { pattern: { kind: 'Wildcard', span: SPAN }, body: falseArm, span: SPAN },
      ],
      span: SPAN,
      type: UNIT,
    };
    const out = emitJsxNode(caseNode);
    expect(out).toContain('isActive');
    expect(out).toContain('?');
  });

  it('emits ListLit as fragment', () => {
    const node: IonIRNode = {
      kind: 'ListLit',
      elements: [appNode('li', '', strLit('a')), appNode('li', '', strLit('b'))],
      span: SPAN,
      type: { kind: 'List', elem: UNIT },
    };
    const out = emitJsxNode(node);
    expect(out).toContain('<>');
    expect(out).toContain('</>');
    expect(out).toContain('<li>');
  });
});

describe('emitReact', () => {
  it('starts with use strict and React import', () => {
    const mod = makeModule([]);
    const out = emitReact(mod);
    expect(out).toContain('"use strict";');
    expect(out).toContain("import React from 'react';");
  });

  it('wraps top-level element as React.FC component', () => {
    const mod = makeModule([letNode('MyPage', appNode('div', 'class=page', strLit('Page Content')))]);
    const out = emitReact(mod);
    expect(out).toContain('const MyPage: React.FC');
    expect(out).toContain('className="page"');
  });

  it('emits Abs as a function component when body is JSX', () => {
    const body = appNode('section', '', strLit('Hello'));
    const absNode: IonIRNode = {
      kind: 'Abs',
      params: [],
      body,
      captures: [],
      span: SPAN,
      type: UNIT,
    };
    const mod = makeModule([letNode('MyComp', absNode)]);
    const out = emitReact(mod);
    expect(out).toContain('const MyComp: React.FC');
    expect(out).toContain('<section>');
  });

  it('emits non-JSX const for scalar values', () => {
    const mod = makeModule([letNode('count', intLit(42))]);
    const out = emitReact(mod);
    expect(out).toContain('const count = 42;');
  });

  it('resolves variable references across decls', () => {
    const header = letNode('pageHeader', appNode('header', '', strLit('Title')));
    const page = letNode('page', appNode('div', '', varNode('pageHeader')));
    const mod = makeModule([header, page]);
    const out = emitReact(mod);
    // The page component should have the resolved header content inline
    expect(out).toContain('<header>');
    expect(out).toContain('{"Title"}');
  });

  it('maps multiple HTML attributes in JSX', () => {
    const node = appNode('input', 'type=email maxlength=100 class=field');
    const mod = makeModule([letNode('EmailInput', node)]);
    const out = emitReact(mod);
    expect(out).toContain('type="email"');
    expect(out).toContain('maxLength="100"');
    expect(out).toContain('className="field"');
  });

  it('emits block-body component when Abs body is a Let chain with raw useState', () => {
    const chain = chainLet('_', rawNode('const [count, setCount] = useState(0)'), appNode('div', '', varNode('count')));
    const abs = absNode([], chain);
    const decl = letNode('Counter', abs);
    const out = emitReact(makeModule([decl]));
    expect(out).toContain('const Counter: React.FC = () => {');
    expect(out).toContain('const [count, setCount] = useState(0)');
    expect(out).toContain('return (');
    expect(out).toContain('<div>');
    expect(out).not.toContain('const _ =');
  });

  it('emits event handler from Abs in Let chain', () => {
    const chain = chainLet('_', rawNode('const [count, setCount] = useState(0)'),
      chainLet('handleClick', absNode([], rawNode('setCount(count + 1)')),
        appNode('button', 'onclick=handleClick', strLit('Click'))));
    const abs = absNode([], chain);
    const decl = letNode('Btn', abs);
    const out = emitReact(makeModule([decl]));
    expect(out).toContain('const Btn: React.FC = () => {');
    expect(out).toContain('const handleClick = () => setCount(count + 1);');
    expect(out).toContain('onClick={handleClick}');
    expect(out).toContain('return (');
  });

  it('emits block-body component with conditional render', () => {
    const caseNode: IonIRNode = {
      kind: 'Case',
      scrutinee: varNode('error'),
      arms: [
        { pattern: { kind: 'Literal', value: { kind: 'Bool', value: true }, span: SPAN }, body: appNode('p', 'class=err', varNode('error')), span: SPAN },
        { pattern: { kind: 'Wildcard', span: SPAN }, body: { kind: 'Literal', value: { kind: 'Null' }, span: SPAN, type: UNIT }, span: SPAN },
      ],
      span: SPAN,
      type: UNIT,
    };
    const chain = chainLet('_', rawNode('const [error, setError] = useState(null)'), caseNode);
    const abs = absNode([], chain);
    const decl = letNode('Form', abs);
    const out = emitReact(makeModule([decl]));
    expect(out).toContain('const Form: React.FC = () => {');
    expect(out).toContain('const [error, setError] = useState(null)');
    expect(out).toContain('return (');
    expect(out).toContain('error');
    expect(out).toContain('&&');
  });
});

describe('emitTsExprForReact', () => {
  it('handles string literal', () => {
    expect(emitTsExprForReact(strLit('hello'))).toBe('"hello"');
  });

  it('handles int literal', () => {
    expect(emitTsExprForReact(intLit(99))).toBe('99');
  });

  it('handles bool literal', () => {
    expect(emitTsExprForReact(boolLit(true))).toBe('true');
    expect(emitTsExprForReact(boolLit(false))).toBe('false');
  });

  it('handles var reference', () => {
    expect(emitTsExprForReact(varNode('myVar'))).toBe('myVar');
  });

  it('emits async arrow function for Abs with AsyncBlock body', () => {
    const node = absNode(['e'], asyncBlockNode(rawNode('{ e.preventDefault(); }')));
    expect(emitTsExprForReact(node)).toBe('async (e) => { e.preventDefault(); }');
  });

  it('__throw__ emits throw EXPR directly', () => {
    const node: IonIRNode = {
      kind: 'App',
      callee: varNode('__throw__'),
      args: [varNode('err')],
      span: SPAN,
      type: UNIT,
    };
    expect(emitTsExprForReact(node)).toBe('(() => { throw err; })()');
  });
});
