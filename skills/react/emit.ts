import type { IonIRModule, IonIRNode, AppNode, AbsNode, LetNode, CaseNode, VarNode } from '../../src/ir/nodes.js';
import {
  HTML_TAGS,
  VOID_ELEMENTS,
  isHtmlElement,
  getAttrRaw,
} from '../ui-shared.js';

// ---------------------------------------------------------------------------
// HTML attribute name → React prop name mapping
// ---------------------------------------------------------------------------

const ATTR_MAP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  onclick: 'onClick',
  onchange: 'onChange',
  onsubmit: 'onSubmit',
  oninput: 'onInput',
  onfocus: 'onFocus',
  onblur: 'onBlur',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  crossorigin: 'crossOrigin',
};

// ---------------------------------------------------------------------------
// JSX attribute string parsing
// ---------------------------------------------------------------------------

/** Returns true if a value looks like a plain JS identifier (function/variable reference). */
function isJsIdentifier(v: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v);
}

/** Parse key=value pairs from raw attr string into JSX props. */
function emitJsxAttrString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\s+/)
    .map(pair => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair; // bare attribute
      const rawKey = pair.slice(0, eq);
      const v = pair.slice(eq + 1);
      const k = ATTR_MAP[rawKey] ?? rawKey;
      // Use curly braces for function references, strings otherwise
      if (isJsIdentifier(v) && ATTR_MAP[rawKey] !== undefined && rawKey.startsWith('on')) {
        return `${k}={${v}}`;
      }
      return `${k}="${v}"`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// emitJsxNode
// ---------------------------------------------------------------------------

export function emitJsxNode(node: IonIRNode, indent = 0, env?: ReadonlyMap<string, IonIRNode>): string {
  const pad = '  '.repeat(indent);

  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Str') return v.value ? `{${JSON.stringify(v.value)}}` : '';
      if (v.kind === 'Int' || v.kind === 'Float') return `{${v.value}}`;
      if (v.kind === 'Bool') return `{${v.value}}`;
      if (v.kind === 'Null') return '';
      return '';
    }

    case 'Var': {
      const varName = (node as VarNode).name;
      if (varName.includes('=')) return '';
      // Try to resolve from environment
      if (env) {
        const resolved = env.get(varName);
        if (resolved !== undefined) return emitJsxNode(resolved, indent, env);
      }
      return `{${varName}}`;
    }

    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const tagName = (app.callee as VarNode).name;

        if (HTML_TAGS.has(tagName)) {
          const attrRaw = app.args.length > 0 ? getAttrRaw(app.args[0]!) : '';
          const attrs = emitJsxAttrString(attrRaw);
          const attrStr = attrs ? ` ${attrs}` : '';

          if (VOID_ELEMENTS.has(tagName)) {
            return `${pad}<${tagName}${attrStr} />`;
          }

          const children = app.args.slice(1).map(c => emitJsxNode(c, indent + 1, env)).filter(s => s.trim()).join('\n');
          if (!children) {
            return `${pad}<${tagName}${attrStr}></${tagName}>`;
          }
          return `${pad}<${tagName}${attrStr}>\n${children}\n${pad}</${tagName}>`;
        }

        // Non-HTML function call in JSX context
        const argStrs = app.args.map(a => emitTsExprForReact(a)).join(', ');
        return `{${tagName}(${argStrs})}`;
      }
      return `{/* app */}`;
    }

    case 'Abs': {
      // Inline function component body
      const abs = node as AbsNode;
      return emitJsxNode(abs.body, indent, env);
    }

    case 'Let': {
      // Flatten let chain, emit return value
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') {
        cur = (cur as LetNode).body;
      }
      return emitJsxNode(cur, indent, env);
    }

    case 'Case': {
      const caseNode = node as CaseNode;
      if (caseNode.arms.length === 0) return '';
      if (caseNode.arms.length === 1) {
        return emitJsxNode(caseNode.arms[0]!.body, indent, env);
      }
      // Two-arm boolean ternary
      if (
        caseNode.arms.length === 2 &&
        caseNode.arms[0]!.pattern.kind === 'Literal' &&
        caseNode.arms[0]!.pattern.value.kind === 'Bool' &&
        caseNode.arms[0]!.pattern.value.value === true &&
        caseNode.arms[1]!.pattern.kind === 'Wildcard'
      ) {
        const cond = emitTsExprForReact(caseNode.scrutinee);
        const tTrue = emitJsxNode(caseNode.arms[0]!.body, indent, env);
        const tFalse = emitJsxNode(caseNode.arms[1]!.body, indent, env);
        return `{${cond} ? (\n${tTrue}\n) : (\n${tFalse}\n)}`;
      }
      // Fallback: first arm
      return emitJsxNode(caseNode.arms[0]!.body, indent, env);
    }

    case 'ListLit': {
      const items = node.elements.map(e => emitJsxNode(e, indent + 1, env)).filter(s => s.trim()).join('\n');
      return `${pad}<>\n${items}\n${pad}</>`;
    }

    case 'OopVirtualCall':
      return `{/* .${node.method}() */}`;

    default:
      return `{/* unsupported: ${node.kind} */}`;
  }
}

// ---------------------------------------------------------------------------
// emitTsExprForReact — simple TS expression emitter for non-JSX values
// ---------------------------------------------------------------------------

export function emitTsExprForReact(node: IonIRNode): string {
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
      const callee = emitTsExprForReact(app.callee);
      const args = app.args.map(emitTsExprForReact).join(', ');
      return `${callee}(${args})`;
    }
    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      return `(${params}) => ${emitTsExprForReact(abs.body)}`;
    }
    case 'Accessor': return `${emitTsExprForReact(node.receiver)}.${node.member}`;
    case 'ListLit': return `[${node.elements.map(emitTsExprForReact).join(', ')}]`;
    default: return 'undefined';
  }
}

// ---------------------------------------------------------------------------
// emitReact
// ---------------------------------------------------------------------------

export function emitReact(irModule: IonIRModule): string {
  // Build environment map for variable resolution
  const env = new Map<string, IonIRNode>();
  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      env.set((d as LetNode).name, (d as LetNode).value);
    }
  }

  const parts = [
    `"use strict";`,
    `import React from 'react';`,
    ``,
  ];

  for (const d of irModule.decls) {
    if (d.kind !== 'Let') continue;
    const lt = d as LetNode;
    const name = lt.name;
    const value = lt.value;

    if (value.kind === 'Abs') {
      const abs = value as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      const body = emitJsxNode(abs.body, 1, env);
      const isJsx = body.trim().startsWith('<');

      if (isJsx) {
        parts.push(`const ${name}: React.FC = (${params}) => (`);
        parts.push(`  ${body.trim()}`);
        parts.push(`);`);
      } else {
        parts.push(`const ${name} = (${params}) => ${emitTsExprForReact(abs.body)};`);
      }
    } else if (isHtmlElement(value)) {
      // Top-level element — wrap as component
      const jsx = emitJsxNode(value, 1, env);
      parts.push(`const ${name}: React.FC = () => (`);
      parts.push(`  ${jsx.trim()}`);
      parts.push(`);`);
    } else {
      // Regular const
      parts.push(`const ${name} = ${emitTsExprForReact(value)};`);
    }
  }

  return parts.join('\n') + '\n';
}
