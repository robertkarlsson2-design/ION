import type { IonIRModule, IonIRNode, LetNode, AbsNode, VarNode, AppNode, AccessorNode } from '../../src/ir/nodes.js';
import { isHtmlElement } from '../ui-shared.js';
import { emitHtmlNode } from '../html/emit.js';

// ---------------------------------------------------------------------------
// emitTsExprForVue — simple TS expression emitter for <script setup> values
// ---------------------------------------------------------------------------

export function emitTsExprForVue(node: IonIRNode): string {
  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Str') return JSON.stringify(v.value);
      if (v.kind === 'Bool') return v.value ? 'true' : 'false';
      if (v.kind === 'Null') return 'null';
      return String(v.value);
    }
    case 'Var': return (node as VarNode).name;
    case 'App': {
      const app = node as AppNode;
      const callee = emitTsExprForVue(app.callee);
      const args = app.args.map(emitTsExprForVue).join(', ');
      return `${callee}(${args})`;
    }
    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      return `(${params}) => ${emitTsExprForVue(abs.body)}`;
    }
    case 'Accessor':
      return `${emitTsExprForVue((node as AccessorNode).receiver)}.${(node as AccessorNode).member}`;
    case 'ListLit':
      return `[${node.elements.map(emitTsExprForVue).join(', ')}]`;
    case 'Let': {
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') cur = (cur as LetNode).body;
      return emitTsExprForVue(cur);
    }
    default:
      return 'undefined';
  }
}

// ---------------------------------------------------------------------------
// emitVue
// ---------------------------------------------------------------------------

export function emitVue(irModule: IonIRModule): string {
  // Build environment map for variable resolution
  const env = new Map<string, IonIRNode>();
  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      env.set((d as LetNode).name, (d as LetNode).value);
    }
  }

  // Split decls into template elements and script bindings
  const templateDecls: LetNode[] = [];
  const scriptDecls: LetNode[] = [];

  for (const d of irModule.decls) {
    if (d.kind !== 'Let') continue;
    const lt = d as LetNode;
    const value = lt.value;

    if (isHtmlElement(value)) {
      templateDecls.push(lt);
    } else if (value.kind === 'Abs' && isHtmlElement((value as AbsNode).body)) {
      // Function component wrapping an element — goes in template
      templateDecls.push(lt);
    } else {
      scriptDecls.push(lt);
    }
  }

  // Build template section
  // Use the last declared element (likely the root page component)
  let templateContent: string;
  if (templateDecls.length === 0) {
    templateContent = '<div><!-- empty --></div>';
  } else {
    const lastDecl = templateDecls[templateDecls.length - 1]!;
    const value = lastDecl.value;
    if (value.kind === 'Abs') {
      templateContent = emitHtmlNode((value as AbsNode).body, env);
    } else {
      templateContent = emitHtmlNode(value, env);
    }
  }

  // Indent template content
  const indented = templateContent
    .split('\n')
    .map(line => (line.trim() ? `  ${line}` : line))
    .join('\n');

  // Build script section
  const scriptLines: string[] = [];
  for (const lt of scriptDecls) {
    const value = lt.value;
    if (value.kind === 'Abs') {
      const abs = value as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      scriptLines.push(`const ${lt.name} = (${params}) => ${emitTsExprForVue(abs.body)};`);
    } else {
      scriptLines.push(`const ${lt.name} = ${emitTsExprForVue(value)};`);
    }
  }

  const scriptContent = scriptLines.join('\n');

  return [
    `<template>`,
    indented,
    `</template>`,
    ``,
    `<script setup lang="ts">`,
    scriptContent,
    `</script>`,
    ``,
    `<style scoped>`,
    `/* styles go here */`,
    `</style>`,
    ``,
  ].join('\n');
}
