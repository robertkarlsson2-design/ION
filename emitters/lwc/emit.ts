import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  CasePattern,
  VarNode,
  OopClassNode,
  OopAnnotation,
  OopConstructor,
  OopInterfaceNode,
  AdtDeclNode,
  AdtMatchNode,
  EffectDeclNode,
  RawInjectNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import {
  HTML_TAGS,
  VOID_ELEMENTS,
  isHtmlElement,
  getAttrRaw,
} from '../ui-shared/index.js';

let _lwcCtorFields: Map<string, readonly string[]> = new Map();

function buildLwcCtorBindings(pat: CasePattern, scrutinee: string): Array<{ name: string; member: string }> {
  if (pat.kind !== 'Constructor') return [];
  const fieldNames = _lwcCtorFields.get(pat.ctorName) ?? [];
  const result: Array<{ name: string; member: string }> = [];
  for (let fi = 0; fi < pat.fields.length; fi++) {
    const f = pat.fields[fi]!;
    if (f.kind !== 'Var') continue;
    result.push({ name: f.name, member: fieldNames[fi] ?? `_${fi}` });
  }
  return result;
}

function emitLwcPatCond(pat: CasePattern, scrutinee: string): string {
  if (pat.kind === 'Wildcard' || pat.kind === 'Var') return 'true';
  if (pat.kind === 'Constructor') return `${scrutinee}._tag === "${pat.ctorName}"`;
  if (pat.kind === 'Tuple') return `${scrutinee}.length === ${pat.fields.length}`;
  const v = pat.value;
  if (v.kind === 'Bool') return `${scrutinee} === ${v.value}`;
  if (v.kind === 'Null') return `${scrutinee} === null`;
  if (v.kind === 'Str') return `${scrutinee} === ${JSON.stringify(v.value)}`;
  return `${scrutinee} === ${v.value}`;
}

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
  return module.split(/[-_.]/).map(w => w.length === 0 ? '' : w[0]!.toUpperCase() + w.slice(1)).join('');
}

// ---------------------------------------------------------------------------
// IonType → JSDoc type string (for @type annotations in JS)
// ---------------------------------------------------------------------------

function ionTypeToJsDoc(t: IonType): string {
  switch (t.kind) {
    case 'Int': return 'number';
    case 'Float': return 'number';
    case 'Str': return 'string';
    case 'Bool': return 'boolean';
    case 'Null': return 'null';
    case 'Unit': return 'void';
    case 'List': return `${ionTypeToJsDoc(t.elem)}[]`;
    case 'Map': return `Map`;
    case 'Option': return `${ionTypeToJsDoc(t.inner)}|null`;
    case 'Result': return 'object';
    case 'Fn': return 'Function';
    case 'User': return t.name;
    case 'TypeVar': return '*';
    case 'Never': return 'never';
    case 'Tuple': return `[${t.elements.map(ionTypeToJsDoc).join(', ')}]`;
    default: return '*';
  }
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
      if (app.callee.kind === 'Var') {
        const _n = (app.callee as VarNode).name;
        if ((_n === '__platform__' || _n === '__platform_select__') && app.args.length >= 2)
          return `/* __platform__ requires --target react-native */ ${emitLwcExpr(app.args[1]!)}`;
      }
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
    case 'MapLit': {
      const entries = node.entries.map(e => `[${emitLwcExpr(e.key)}, ${emitLwcExpr(e.value)}]`).join(', ');
      return `new Map([${entries}])`;
    }
    case 'Let': {
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') cur = (cur as LetNode).body;
      return emitLwcExpr(cur);
    }
    case 'Case': {
      const c = node as CaseNode;
      if (c.arms.length === 0) return 'undefined';
      if (c.arms.length === 1 && c.arms[0]!.pattern.kind === 'Wildcard') {
        return emitLwcExpr(c.arms[0]!.body);
      }
      if (
        c.arms.length === 2 &&
        c.arms[0]!.pattern.kind === 'Literal' &&
        c.arms[0]!.pattern.value.kind === 'Bool' &&
        c.arms[0]!.pattern.value.value === true &&
        c.arms[1]!.pattern.kind === 'Wildcard'
      ) {
        return `(${emitLwcExpr(c.scrutinee)} ? ${emitLwcExpr(c.arms[0]!.body)} : ${emitLwcExpr(c.arms[1]!.body)})`;
      }
      const scrutinee = emitLwcExpr(c.scrutinee);
      const parts: string[] = [];
      for (let i = 0; i < c.arms.length; i++) {
        const arm = c.arms[i]!;
        const isLast = i === c.arms.length - 1;
        const pat = arm.pattern;
        if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
          parts.push(emitLwcExpr(arm.body));
        } else {
          const cond = emitLwcPatCond(pat, scrutinee);
          const bindings = buildLwcCtorBindings(pat, scrutinee);
          if (bindings.length > 0) {
            const decls = bindings.map(b => `const ${b.name} = ${scrutinee}.${b.member};`).join(' ');
            parts.push(`${cond} ? (() => { ${decls} return ${emitLwcExpr(arm.body)}; })()`);
          } else {
            parts.push(`${cond} ? ${emitLwcExpr(arm.body)}`);
          }
        }
      }
      if (parts.length === 1) return parts[0]!;
      const last = parts.pop()!;
      return parts.join(' : ') + ' : ' + last;
    }
    case 'Constructor': {
      const args = node.args.map(emitLwcExpr).join(', ');
      return `{ _tag: '${node.ctorName}'${args ? `, _args: [${args}]` : ''} }`;
    }
    case 'ModuleRef': return node.modulePath.join('.');
    case 'ForeignRef': return node.target;
    case 'Effect': return emitLwcExpr(node.body);
    case 'OopNew': {
      const args = node.args.map(emitLwcExpr).join(', ');
      return `new _ctor_${node.ctorSymbolId}(${args})`;
    }
    case 'OopVirtualCall': {
      const receiver = emitLwcExpr(node.receiver);
      const args = node.args.map(emitLwcExpr).join(', ');
      return `${receiver}.${node.method}(${args})`;
    }
    case 'OopThis': return 'this';
    case 'AsyncBlock': return `(async () => ${emitLwcExpr(node.body)})()`;
    case 'Await': return `await ${emitLwcExpr(node.expr)}`;
    case 'AdtMatch': {
      const adtMatch = node as AdtMatchNode;
      const subject = emitLwcExpr(adtMatch.scrutinee);
      const arms = adtMatch.arms.map(arm => {
        const bindings = arm.bindings.map((b, i) => `const ${b.name} = _v._args[${i}];`).join(' ');
        return `if (_v._tag === '${arm.tag}') { ${bindings} return (${emitLwcExpr(arm.body)}); }`;
      }).join(' else ');
      return `((_v) => { ${arms} return undefined; })(${subject})`;
    }
    case 'Perform': return `/* perform ${node.operation} */(${node.args.map(emitLwcExpr).join(', ')})`;
    case 'Handle': return emitLwcExpr(node.body);
    case 'Resume': return emitLwcExpr(node.value);
    // Declaration nodes in expression position
    case 'OopClass': return node.name;
    case 'OopInterface': return `/* interface ${node.name} */`;
    case 'AdtDecl': return `/* adt ${node.name} */`;
    case 'EffectDecl': return `/* effect ${node.name} */`;
    case 'RawInject': return (node as RawInjectNode).code;
    default: {
      const _exhaustive: never = node;
      return `/* unknown: ${(_exhaustive as IonIRNode).kind} */`;
    }
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

    case 'Constructor':
      return `${pad}{/* ${node.ctorName} */}`;

    case 'MapLit':
      return `${pad}{/* map */}`;

    case 'ModuleRef':
      return `${pad}{/* module:${node.modulePath.join('.')} */}`;

    case 'ForeignRef':
      return `${pad}{/* foreign:${node.target} */}`;

    case 'Effect':
      return emitLwcNode(node.body, indent, env);

    case 'OopNew':
      return `${pad}{/* new ctor_${node.ctorSymbolId} */}`;

    case 'OopVirtualCall':
      return `${pad}{/* .${node.method}() */}`;

    case 'OopThis':
      return `${pad}{/* this */}`;

    case 'AsyncBlock':
      return emitLwcNode(node.body, indent, env);

    case 'Await':
      return emitLwcNode(node.expr, indent, env);

    case 'AdtMatch': {
      const adtMatch = node as AdtMatchNode;
      if (adtMatch.arms.length > 0) {
        return emitLwcNode(adtMatch.arms[0]!.body, indent, env);
      }
      return '';
    }

    case 'Perform':
      return `${pad}{/* perform:${node.operation} */}`;

    case 'Handle':
      return emitLwcNode(node.body, indent, env);

    case 'Resume':
      return emitLwcNode(node.value, indent, env);

    // Declaration nodes have no template representation
    case 'OopClass':
    case 'OopInterface':
    case 'AdtDecl':
    case 'EffectDecl':
      return '';

    case 'Accessor':
      return `${pad}{${emitLwcExpr(node)}}`;

    case 'RawInject':
      return (node as RawInjectNode).code;

    default: {
      const _exhaustive: never = node;
      return `${pad}{/* unsupported: ${(_exhaustive as IonIRNode).kind} */}`;
    }
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
// emitJsDecl — emit a non-Let top-level IR node as LWC JS class member/helper
// ---------------------------------------------------------------------------

function emitJsDecl(node: IonIRNode): string {
  switch (node.kind) {
    case 'OopClass': {
      const cls = node as OopClassNode;
      const lines: string[] = [];
      // In LWC, OopClass extends LightningElement
      lines.push(`/**`);
      lines.push(` * @class ${cls.name}`);
      lines.push(` */`);
      // typeParams → skipped (LWC is plain JS, no generics)
      // annotations on the class itself → emit as class-level decorators (comment form in JS)
      for (const ann of cls.annotations ?? []) {
        lines.push(`// @${ann.name}${ann.args.length > 0 ? `(${ann.args.join(', ')})` : ''}`);
      }
      if (cls.fields.length > 0) {
        for (const f of cls.fields) {
          lines.push(`/** @type {${ionTypeToJsDoc(f.type)}} */`);
          // visibility === 'public' → emit @api decorator (LWC convention)
          if (f.visibility === 'public') {
            lines.push(`@api ${f.name};`);
          } else if (f.isStatic) {
            lines.push(`static ${f.name};`);
          } else {
            lines.push(`@api ${f.name};`);
          }
        }
      }
      // Explicit constructors
      const constructors: readonly OopConstructor[] = cls.constructors ?? [];
      for (const ctor of constructors) {
        const params = ctor.params.map(p => p.name).join(', ');
        const bodyStr = ctor.body ? emitLwcExpr(ctor.body) : '';
        lines.push(`constructor(${params}) {`);
        lines.push(`    super();`);
        if (bodyStr) lines.push(`    ${bodyStr};`);
        lines.push(`}`);
      }
      for (const m of cls.methods) {
        // annotations on methods → emit as LWC decorators
        for (const ann of m.annotations ?? []) {
          const args = ann.args.length > 0 ? `(${ann.args.join(', ')})` : '';
          lines.push(`@${ann.name}${args}`);
        }
        const params = m.params.map(p => p.name).join(', ');
        const bodyStr = m.body ? emitLwcExpr(m.body) : 'undefined';
        const staticKw = m.isStatic ? 'static ' : '';
        if (m.accessorKind === 'get') {
          lines.push(`${staticKw}get ${m.name}() {`);
          lines.push(`    return ${bodyStr};`);
          lines.push(`}`);
        } else if (m.accessorKind === 'set') {
          const setParam = m.params[0]?.name ?? 'value';
          lines.push(`${staticKw}set ${m.name}(${setParam}) {`);
          lines.push(`    ${bodyStr};`);
          lines.push(`}`);
        } else {
          lines.push(`${staticKw}${m.name}(${params}) {`);
          lines.push(`    return ${bodyStr};`);
          lines.push(`}`);
        }
      }
      return lines.join('\n');
    }

    case 'OopInterface': {
      const iface = node as OopInterfaceNode;
      const lines: string[] = [];
      lines.push(`/**`);
      lines.push(` * @interface ${iface.name}`);
      for (const m of iface.members) {
        lines.push(` * @property {${ionTypeToJsDoc(m.type)}} ${m.name}`);
      }
      lines.push(` */`);
      return lines.join('\n');
    }

    case 'AdtDecl': {
      const adt = node as AdtDeclNode;
      const lines: string[] = [];
      lines.push(`// ADT: ${adt.name}`);
      for (const v of adt.variants) {
        const fieldNames = v.fields.map(f => f.name).join(', ');
        lines.push(`function make${v.tag}(${fieldNames}) { return { _tag: '${v.tag}'${v.fields.length > 0 ? `, _args: [${fieldNames}]` : ''} }; }`);
      }
      return lines.join('\n');
    }

    case 'EffectDecl': {
      const eff = node as EffectDeclNode;
      const lines: string[] = [];
      lines.push(`// Effect: ${eff.name}`);
      for (const op of eff.operations) {
        lines.push(`// operation: ${op.name}(${op.params.map(p => p.name).join(', ')})`);
      }
      return lines.join('\n');
    }

    default:
      return `// [${node.kind}]`;
  }
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
  const helperDecls: string[] = [];

  // Collect module-level ADT data declarations as helpers
  for (const adt of irModule.data) {
    helperDecls.push(emitJsDecl(adt));
  }

  for (const d of irModule.decls) {
    if (d.kind === 'OopClass') {
      // A nested OopClass within LWC: emit @AuraEnabled-style methods extracted into the main class
      const cls = d as OopClassNode;

      // Explicit constructors → emit as constructor() { super(); body }
      for (const ctor of cls.constructors ?? []) {
        const ctorParams = ctor.params.map(p => p.name).join(', ');
        const bodyStr = ctor.body ? emitLwcExpr(ctor.body) : '';
        const ctorLines = [
          `    constructor(${ctorParams}) {`,
          `        super();`,
        ];
        if (bodyStr) ctorLines.push(`        ${bodyStr};`);
        ctorLines.push(`    }`);
        methods.push(ctorLines.join('\n'));
      }

      for (const m of cls.methods) {
        // annotations → emit as LWC decorators inline
        const annLines = (m.annotations ?? []).map((ann: OopAnnotation) => {
          const args = ann.args.length > 0 ? `(${ann.args.join(', ')})` : '';
          return `    @${ann.name}${args}`;
        });
        const params = m.params.map(p => p.name).join(', ');
        const bodyStr = m.body ? emitLwcExpr(m.body) : 'undefined';
        const staticKw = m.isStatic ? 'static ' : '';
        let methodStr: string;
        if (m.accessorKind === 'get') {
          methodStr = `    ${staticKw}get ${m.name}() {\n        return ${bodyStr};\n    }`;
        } else if (m.accessorKind === 'set') {
          const setParam = m.params[0]?.name ?? 'value';
          methodStr = `    ${staticKw}set ${m.name}(${setParam}) {\n        ${bodyStr};\n    }`;
        } else {
          methodStr = `    ${staticKw}${m.name}(${params}) {\n        return ${bodyStr};\n    }`;
        }
        methods.push([...annLines, methodStr].join('\n'));
      }
      // Fields → @api for public or general, @track if explicitly tracked via annotation
      for (const f of cls.fields) {
        if (f.visibility === 'public') {
          apiProps.push(`    @api ${f.name};`);
        } else if (f.isStatic) {
          apiProps.push(`    static ${f.name};`);
        } else {
          apiProps.push(`    @api ${f.name};`);
        }
      }
      continue;
    }

    if (d.kind === 'OopInterface' || d.kind === 'AdtDecl' || d.kind === 'EffectDecl') {
      helperDecls.push(emitJsDecl(d));
      continue;
    }

    if (d.kind !== 'Let') {
      // Other node kinds at top level (Perform, Handle, etc.) — emit as comments
      helperDecls.push(`// ${d.kind}`);
      continue;
    }

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

  // Emit helper declarations (ADT constructors, interfaces, effects) before the class
  if (helperDecls.length > 0) {
    for (const h of helperDecls) {
      lines.push(h);
    }
    lines.push(``);
  }

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
  _lwcCtorFields = new Map();
  for (const d of irModule.data) {
    for (const v of d.variants) {
      _lwcCtorFields.set(v.tag, v.fields.map(f => f.name));
    }
  }

  return {
    html: buildLwcTemplate(irModule),
    js: buildLwcJs(irModule),
    css: LWC_CSS,
    meta: LWC_META,
  };
}
