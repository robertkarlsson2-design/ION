import { describe, it, expect } from 'vitest';
import { emitHTML, emitHtmlNode } from '../../emitters/html/emit.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import { makeSymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helper to build minimal IonIRNode objects
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitHtmlNode', () => {
  it('emits a simple div with no attrs', () => {
    const node = appNode('div', '', strLit('hello'));
    expect(emitHtmlNode(node)).toBe('<div>hello</div>');
  });

  it('emits a div with a class attribute', () => {
    const node = appNode('div', 'class=container', strLit('text'));
    expect(emitHtmlNode(node)).toBe('<div class="container">text</div>');
  });

  it('emits a self-closing input element', () => {
    const node = appNode('input', 'type=text name=x');
    expect(emitHtmlNode(node)).toBe('<input type="text" name="x" />');
  });

  it('emits nested elements', () => {
    const inner = appNode('span', 'class=label', strLit('Name'));
    const outer = appNode('div', 'class=field', inner);
    expect(emitHtmlNode(outer)).toBe('<div class="field"><span class="label">Name</span></div>');
  });

  it('emits a self-closing br with no attrs', () => {
    const node = appNode('br', '');
    expect(emitHtmlNode(node)).toBe('<br />');
  });

  it('HTML-escapes text content', () => {
    const node = appNode('p', '', strLit('<script>&"'));
    expect(emitHtmlNode(node)).toBe('<p>&lt;script&gt;&amp;&quot;</p>');
  });

  it('emits Literal number as string', () => {
    const node = appNode('span', '', intLit(42));
    expect(emitHtmlNode(node)).toBe('<span>42</span>');
  });

  it('resolves Var references from env', () => {
    const inner = appNode('span', '', strLit('hello'));
    const env = new Map<string, IonIRNode>([['mySpan', inner]]);
    const outer = appNode('div', '', varNode('mySpan'));
    expect(emitHtmlNode(outer, env)).toBe('<div><span>hello</span></div>');
  });
});

describe('emitHTML', () => {
  it('wraps output in DOCTYPE + html tags', () => {
    const mod = makeModule([]);
    const out = emitHTML(mod);
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain('<html lang="en">');
    expect(out).toContain('</html>');
  });

  it('emits a top-level element from a Let decl', () => {
    const mod = makeModule([letNode('page', appNode('div', 'class=app', strLit('Content')))]);
    const out = emitHTML(mod);
    expect(out).toContain('<div class="app">Content</div>');
  });

  it('resolves variable references across decls', () => {
    const title = letNode('siteTitle', appNode('h1', '', strLit('My Site')));
    const page = letNode('page', appNode('div', '', varNode('siteTitle')));
    const mod = makeModule([title, page]);
    const out = emitHTML(mod);
    // The resolved page div should contain the h1
    expect(out).toContain('<div><h1>My Site</h1></div>');
  });

  it('emits Abs body as a component', () => {
    const body = appNode('section', '', strLit('Component body'));
    const absNode: IonIRNode = {
      kind: 'Abs',
      params: [],
      body,
      captures: [],
      span: SPAN,
      type: UNIT,
    };
    const mod = makeModule([letNode('MyComp', absNode)]);
    const out = emitHTML(mod);
    expect(out).toContain('<section>Component body</section>');
  });

  it('handles multiple top-level elements', () => {
    const mod = makeModule([
      letNode('header', appNode('header', '', strLit('Top'))),
      letNode('footer', appNode('footer', '', strLit('Bottom'))),
    ]);
    const out = emitHTML(mod);
    expect(out).toContain('<header>Top</header>');
    expect(out).toContain('<footer>Bottom</footer>');
  });

  it('emits ListLit children', () => {
    const listNode: IonIRNode = {
      kind: 'ListLit',
      elements: [strLit('A'), strLit('B')],
      span: SPAN,
      type: { kind: 'List', elem: { kind: 'Str' } },
    };
    const container = appNode('div', '', listNode);
    expect(emitHtmlNode(container)).toBe('<div>AB</div>');
  });

  it('emits Case first arm body', () => {
    const arm0 = appNode('div', '', strLit('True branch'));
    const arm1 = appNode('div', '', strLit('False branch'));
    const caseNode: IonIRNode = {
      kind: 'Case',
      scrutinee: boolLit(true),
      arms: [
        { pattern: { kind: 'Literal', value: { kind: 'Bool', value: true }, span: SPAN }, body: arm0, span: SPAN },
        { pattern: { kind: 'Wildcard', span: SPAN }, body: arm1, span: SPAN },
      ],
      span: SPAN,
      type: UNIT,
    };
    expect(emitHtmlNode(caseNode)).toBe('<div>True branch</div>');
  });
});
