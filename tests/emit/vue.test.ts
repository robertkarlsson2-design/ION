import { describe, it, expect } from 'vitest';
import { emitVue, emitTsExprForVue } from '../../emitters/vue/emit.js';
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitVue', () => {
  it('produces a valid SFC with template, script, style sections', () => {
    const mod = makeModule([]);
    const out = emitVue(mod);
    expect(out).toContain('<template>');
    expect(out).toContain('</template>');
    expect(out).toContain('<script setup lang="ts">');
    expect(out).toContain('</script>');
    expect(out).toContain('<style scoped>');
    expect(out).toContain('</style>');
  });

  it('emits empty template placeholder when no HTML decls', () => {
    const mod = makeModule([]);
    const out = emitVue(mod);
    expect(out).toContain('<!-- empty -->');
  });

  it('places HTML element decls in template', () => {
    const mod = makeModule([letNode('app', appNode('div', 'class=app', strLit('Hello')))]);
    const out = emitVue(mod);
    const templateSection = out.slice(out.indexOf('<template>'), out.indexOf('</template>'));
    expect(templateSection).toContain('class="app"');
    expect(templateSection).toContain('Hello');
  });

  it('places non-element decls in script section', () => {
    const mod = makeModule([
      letNode('count', intLit(5)),
      letNode('msg', strLit('hello')),
    ]);
    const out = emitVue(mod);
    const scriptSection = out.slice(out.indexOf('<script setup'), out.indexOf('</script>'));
    expect(scriptSection).toContain('const count = 5;');
    expect(scriptSection).toContain('const msg = "hello";');
  });

  it('resolves variable references in template', () => {
    const titleNode = letNode('pageTitle', appNode('h1', '', strLit('My App')));
    const pageNode = letNode('page', appNode('div', '', varNode('pageTitle')));
    const mod = makeModule([titleNode, pageNode]);
    const out = emitVue(mod);
    const templateSection = out.slice(out.indexOf('<template>'), out.indexOf('</template>'));
    // The page should contain the resolved h1
    expect(templateSection).toContain('<h1>My App</h1>');
  });

  it('emits self-closing void elements in template', () => {
    const mod = makeModule([letNode('myInput', appNode('input', 'type=text name=q'))]);
    const out = emitVue(mod);
    const templateSection = out.slice(out.indexOf('<template>'), out.indexOf('</template>'));
    expect(templateSection).toContain('<input');
    expect(templateSection).toContain('/>');
    expect(templateSection).toContain('type="text"');
  });

  it('emits Abs (function component) body in template', () => {
    const body = appNode('section', 'class=content', strLit('body text'));
    const absNode: IonIRNode = {
      kind: 'Abs',
      params: [],
      body,
      captures: [],
      span: SPAN,
      type: UNIT,
    };
    const mod = makeModule([letNode('MyComp', absNode)]);
    const out = emitVue(mod);
    const templateSection = out.slice(out.indexOf('<template>'), out.indexOf('</template>'));
    expect(templateSection).toContain('class="content"');
    expect(templateSection).toContain('body text');
  });

  it('emits Abs as script const for non-element functions', () => {
    const absNode: IonIRNode = {
      kind: 'Abs',
      params: [{ name: 'x', symbolId: SYM, type: { kind: 'Int' }, span: SPAN }],
      body: intLit(42),
      captures: [],
      span: SPAN,
      type: UNIT,
    };
    const mod = makeModule([letNode('double', absNode)]);
    const out = emitVue(mod);
    const scriptSection = out.slice(out.indexOf('<script setup'), out.indexOf('</script>'));
    expect(scriptSection).toContain('const double = (x) =>');
  });

  it('handles nested elements in template', () => {
    const inner = appNode('p', 'class=text', strLit('Content'));
    const outer = appNode('article', '', inner);
    const mod = makeModule([letNode('card', outer)]);
    const out = emitVue(mod);
    const templateSection = out.slice(out.indexOf('<template>'), out.indexOf('</template>'));
    expect(templateSection).toContain('<article>');
    expect(templateSection).toContain('<p class="text">Content</p>');
    expect(templateSection).toContain('</article>');
  });
});

describe('emitTsExprForVue', () => {
  it('handles string literal', () => {
    expect(emitTsExprForVue(strLit('hello'))).toBe('"hello"');
  });

  it('handles int literal', () => {
    expect(emitTsExprForVue(intLit(7))).toBe('7');
  });

  it('handles bool literal', () => {
    expect(emitTsExprForVue(boolLit(true))).toBe('true');
  });

  it('handles var reference', () => {
    expect(emitTsExprForVue(varNode('myVar'))).toBe('myVar');
  });

  it('handles null literal', () => {
    const nullNode: IonIRNode = { kind: 'Literal', value: { kind: 'Null' }, span: SPAN, type: { kind: 'Null' } };
    expect(emitTsExprForVue(nullNode)).toBe('null');
  });
});
