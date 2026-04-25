import type { IonIRModule, IonIRNode, AppNode, AbsNode, LetNode } from '../../src/ir/nodes.js';
import {
  HTML_TAGS,
  VOID_ELEMENTS,
  isHtmlElement,
  parseAttrString,
  getAttrRaw,
} from '../ui-shared.js';

// ---------------------------------------------------------------------------
// HTML-escape
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// emitHtmlNode
// ---------------------------------------------------------------------------

export function emitHtmlNode(node: IonIRNode, env?: ReadonlyMap<string, IonIRNode>): string {
  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Str') return escHtml(v.value);
      if (v.kind === 'Int' || v.kind === 'Float') return String(v.value);
      if (v.kind === 'Bool') return v.value ? 'true' : 'false';
      if (v.kind === 'Null') return '';
      return '';
    }

    case 'Var': {
      // If name looks like attribute pairs (contains =), treat as raw attr string.
      // These should not normally appear as children — skip safely.
      if (node.name.includes('=')) return '';
      // Try to resolve from environment (module-level decls)
      if (env) {
        const resolved = env.get(node.name);
        if (resolved !== undefined) return emitHtmlNode(resolved, env);
      }
      return `\${${node.name}}`;
    }

    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const tagName = (app.callee as { kind: 'Var'; name: string }).name;

        if (HTML_TAGS.has(tagName)) {
          // Extract attributes from first arg
          const attrRaw = app.args.length > 0 ? getAttrRaw(app.args[0]!) : '';
          const attrs = parseAttrString(attrRaw);
          const attrStr = attrs ? ` ${attrs}` : '';

          if (VOID_ELEMENTS.has(tagName)) {
            return `<${tagName}${attrStr} />`;
          }

          const children = app.args.slice(1).map(c => emitHtmlNode(c, env)).join('');
          return `<${tagName}${attrStr}>${children}</${tagName}>`;
        }

        // Non-HTML function call — emit as HTML comment
        const argStrs = app.args.map(a => {
          if (a.kind === 'Literal' && a.value.kind === 'Str') return JSON.stringify(a.value.value);
          if (a.kind === 'Var') return a.name;
          return '…';
        }).join(', ');
        return `<!-- ${tagName}(${argStrs}) -->`;
      }
      return `<!-- app -->`;
    }

    case 'Abs': {
      // Function component — emit its body
      const abs = node as AbsNode;
      return emitHtmlNode(abs.body, env);
    }

    case 'Let': {
      // Flatten let chain, emit the final return value
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') {
        cur = (cur as LetNode).body;
      }
      return emitHtmlNode(cur, env);
    }

    case 'Case': {
      // Emit the truthy/first branch body
      if (node.arms.length > 0) {
        return emitHtmlNode(node.arms[0]!.body, env);
      }
      return '';
    }

    case 'ListLit': {
      return node.elements.map(e => emitHtmlNode(e, env)).join('');
    }

    case 'OopVirtualCall':
      return `<!-- .${node.method}() -->`;

    default:
      return `<!-- unsupported: ${node.kind} -->`;
  }
}

// ---------------------------------------------------------------------------
// emitHTML
// ---------------------------------------------------------------------------

export function emitHTML(irModule: IonIRModule): string {
  // Build an environment map from all let-binding decls for variable resolution
  const env = new Map<string, IonIRNode>();
  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      env.set((d as LetNode).name, (d as LetNode).value);
    }
  }

  const parts: string[] = ['<!DOCTYPE html>', '<html lang="en">'];

  for (const d of irModule.decls) {
    if (d.kind !== 'Let') continue;
    const lt = d as LetNode;
    const value = lt.value;

    if (isHtmlElement(value)) {
      parts.push(emitHtmlNode(value, env));
    } else if (value.kind === 'Abs') {
      // Component — emit its body
      parts.push(emitHtmlNode((value as AbsNode).body, env));
    }
  }

  parts.push('</html>');
  return parts.join('\n');
}
