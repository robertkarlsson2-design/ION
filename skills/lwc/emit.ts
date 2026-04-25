import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  VarNode,
} from '../../src/ir/nodes.js';
import {
  HTML_TAGS,
  VOID_ELEMENTS,
  isHtmlElement,
  getAttrRaw,
} from '../ui-shared.js';

// ---------------------------------------------------------------------------
// LwcOutput — all four files for a single LWC component
// ---------------------------------------------------------------------------

export interface LwcOutput {
  html: string;  // the <template>...</template> file
  js: string;    // the JS class file
  css: string;   // optional scoped styles (can be empty)
  meta: string;  // the .js-meta.xml file
}

// ---------------------------------------------------------------------------
// Module name → PascalCase class name
// ---------------------------------------------------------------------------

function toClassName(module: string): string {
  return module.split(/[-_]/).map(w => w.length === 0 ? '' : w[0]!.toUpperCase() + w.slice(1)).join('');
}

// ---------------------------------------------------------------------------
// LWC attribute emitter — dynamic identifiers use {value} syntax
// ---------------------------------------------------------------------------

/** Returns true if a value looks like a JS identifier (dynamic expression). */
function isLwcIdentifier(v: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(v);
}

/** Parse key=value pairs from raw attr string into LWC attr format. */
function emitLwcAttrString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\s+/)
    .map(pair => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair; // bare attribute
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1).replace(/\+/g, ' ');
      // Dynamic identifier → {value}, otherwise → "value"
      if (isLwcIdentifier(v)) {
        return `${k}={${v}}`;
      }
      return `${k}="${v}"`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// LWC expression emitter (for non-template expressions)
// ---------------------------------------------------------------------------

function emitLwcExpr(node: IonIRNode): string {
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
      const callee = emitLwcExpr(app.callee);
      const args = app.args.map(emitLwcExpr).join(', ');
      return `${callee}(${args})`;
    }
    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      return `(${params}) => ${emitLwcExpr(abs.body)}`;
    }
    case 'Accessor': return `${emitLwcExpr(node.receiver)}.${node.member}`;
    case 'ListLit': return `[${node.elements.map(emitLwcExpr).join(', ')}]`;
    case 'Let': {
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') cur = (cur as LetNode).body;
      return emitLwcExpr(cur);
    }
    default: return 'undefined';
  }
}

// ---------------------------------------------------------------------------
// emitLwcNode — template HTML node emitter
// ---------------------------------------------------------------------------

export function emitLwcNode(
  node: IonIRNode,
  indent = 0,
  env?: ReadonlyMap<string, IonIRNode>,
): string {
  const pad = '  '.repeat(indent);

  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Str') return v.value ? `${pad}${v.value}` : '';
      if (v.kind === 'Int' || v.kind === 'Float') return `${pad}${v.value}`;
      if (v.kind === 'Bool') return `${pad}${v.value}`;
      if (v.kind === 'Null') return '';
      return '';
    }

    case 'Var': {
      const varName = (node as VarNode).name;
      if (varName.includes('=')) return '';
      // Try to resolve from environment
      if (env) {
        const resolved = env.get(varName);
        if (resolved !== undefined) return emitLwcNode(resolved, indent, env);
      }
      return `${pad}{${varName}}`;
    }

    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const tagName = (app.callee as VarNode).name;

        if (HTML_TAGS.has(tagName)) {
          const attrRaw = app.args.length > 0 ? getAttrRaw(app.args[0]!) : '';
          const attrs = emitLwcAttrString(attrRaw);
          const attrStr = attrs ? ` ${attrs}` : '';

          if (VOID_ELEMENTS.has(tagName)) {
            return `${pad}<${tagName}${attrStr} />`;
          }

          const children = app.args
            .slice(1)
            .map(c => emitLwcNode(c, indent + 1, env))
            .filter(s => s.trim())
            .join('\n');

          if (!children) {
            return `${pad}<${tagName}${attrStr}></${tagName}>`;
          }
          return `${pad}<${tagName}${attrStr}>\n${children}\n${pad}</${tagName}>`;
        }

        // Non-HTML callee — emit as LWC expression binding
        const argStrs = app.args.map(a => emitLwcExpr(a)).join(', ');
        return `${pad}{${tagName}(${argStrs})}`;
      }
      return `${pad}{/* app */}`;
    }

    case 'Abs': {
      // Function component — emit its body
      const abs = node as AbsNode;
      return emitLwcNode(abs.body, indent, env);
    }

    case 'Let': {
      // Flatten let chain, emit the final return value
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') {
        cur = (cur as LetNode).body;
      }
      return emitLwcNode(cur, indent, env);
    }

    case 'Case': {
      const caseNode = node as CaseNode;
      if (caseNode.arms.length === 0) return '';

      // Two-arm boolean conditional: emit as lwc:if / lwc:else
      if (
        caseNode.arms.length === 2 &&
        caseNode.arms[0]!.pattern.kind === 'Literal' &&
        caseNode.arms[0]!.pattern.value.kind === 'Bool' &&
        caseNode.arms[0]!.pattern.value.value === true &&
        caseNode.arms[1]!.pattern.kind === 'Wildcard'
      ) {
        const scrutinee = emitLwcExpr(caseNode.scrutinee);
        const thenHtml = emitLwcNode(caseNode.arms[0]!.body, indent + 1, env);
        const elseHtml = emitLwcNode(caseNode.arms[1]!.body, indent + 1, env);
        const parts = [
          `${pad}<template lwc:if={${scrutinee}}>`,
          thenHtml,
          `${pad}</template>`,
        ];
        if (elseHtml.trim()) {
          parts.push(
            `${pad}<template lwc:else>`,
            elseHtml,
            `${pad}</template>`,
          );
        }
        return parts.filter(Boolean).join('\n');
      }

      // Single-arm case or general case: emit first arm body
      return emitLwcNode(caseNode.arms[0]!.body, indent, env);
    }

    case 'ListLit': {
      const items = node.elements
        .map(e => emitLwcNode(e, indent + 1, env))
        .filter(s => s.trim())
        .join('\n');
      return items;
    }

    case 'OopVirtualCall':
      return `${pad}{/* .${node.method}() */}`;

    default:
      return `${pad}{/* unsupported: ${node.kind} */}`;
  }
}

// ---------------------------------------------------------------------------
// LWC HTML template builder
// ---------------------------------------------------------------------------

function buildLwcTemplate(irModule: IonIRModule): string {
  const env = new Map<string, IonIRNode>();
  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      env.set((d as LetNode).name, (d as LetNode).value);
    }
  }

  const parts: string[] = [];

  for (const d of irModule.decls) {
    if (d.kind !== 'Let') continue;
    const lt = d as LetNode;
    const value = lt.value;

    if (isHtmlElement(value)) {
      parts.push(emitLwcNode(value, 1, env));
    } else if (value.kind === 'Abs' && isHtmlElement((value as AbsNode).body)) {
      parts.push(emitLwcNode((value as AbsNode).body, 1, env));
    }
  }

  const content = parts.join('\n');
  return `<template>\n${content}\n</template>\n`;
}

// ---------------------------------------------------------------------------
// LWC JS class builder
// ---------------------------------------------------------------------------

function buildLwcJs(irModule: IonIRModule): string {
  const className = toClassName(irModule.module);
  const lines: string[] = [];
  const trackProps: string[] = [];
  const apiProps: string[] = [];
  const methods: string[] = [];

  for (const d of irModule.decls) {
    if (d.kind !== 'Let') continue;
    const lt = d as LetNode;
    const name = lt.name;
    const value = lt.value;

    if (value.kind === 'Abs') {
      const abs = value as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      const bodyExpr = emitLwcExpr(abs.body);

      if (name.startsWith('get')) {
        // Getter
        const propName = name.slice(3, 4).toLowerCase() + name.slice(4);
        methods.push(`    get ${propName}() {\n        return ${bodyExpr};\n    }`);
      } else if (name.startsWith('handle')) {
        // Event handler
        const handlerParams = params ? `event, ${params}` : 'event';
        methods.push(`    ${name}(${handlerParams}) {\n        event.preventDefault();\n        return ${bodyExpr};\n    }`);
      } else if (isHtmlElement(value) || isHtmlElement(abs.body)) {
        // Skip HTML component functions — they go in the template
      } else {
        // Regular method
        methods.push(`    ${name}(${params}) {\n        return ${bodyExpr};\n    }`);
      }
    } else if (isHtmlElement(value)) {
      // Skip HTML elements — they go in the template
    } else {
      // Property
      if (name.endsWith('Id')) {
        apiProps.push(`    @api ${name};`);
      } else {
        const valExpr = emitLwcExpr(value);
        trackProps.push(`    @track ${name} = ${valExpr};`);
      }
    }
  }

  lines.push(`import { LightningElement, api, track } from 'lwc';`);
  lines.push(``);
  lines.push(`export default class ${className} extends LightningElement {`);

  if (apiProps.length > 0) {
    lines.push(...apiProps);
  }
  if (trackProps.length > 0) {
    lines.push(...trackProps);
  }
  if (methods.length > 0) {
    if (apiProps.length > 0 || trackProps.length > 0) {
      lines.push(``);
    }
    lines.push(...methods);
  }

  lines.push(`}`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// LWC static CSS
// ---------------------------------------------------------------------------

const LWC_CSS = `.container {
  padding: 1rem;
}
.btn {
  cursor: pointer;
}
`;

// ---------------------------------------------------------------------------
// LWC meta XML
// ---------------------------------------------------------------------------

const LWC_META = `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>59.0</apiVersion>
  <isExposed>true</isExposed>
  <targets>
    <target>lightning__AppPage</target>
    <target>lightning__RecordPage</target>
    <target>lightning__HomePage</target>
  </targets>
</LightningComponentBundle>
`;

// ---------------------------------------------------------------------------
// emitLWC — main entry point
// ---------------------------------------------------------------------------

export function emitLWC(irModule: IonIRModule): LwcOutput {
  return {
    html: buildLwcTemplate(irModule),
    js: buildLwcJs(irModule),
    css: LWC_CSS,
    meta: LWC_META,
  };
}
