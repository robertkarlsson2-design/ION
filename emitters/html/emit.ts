import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  CasePattern,
  OopClassNode,
  OopMethod,
  OopAnnotation,
  OopConstructor,
  AdtDeclNode,
  AdtMatchNode,
  OopInterfaceNode,
  EffectDeclNode,
  RawInjectNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import {
  HTML_TAGS,
  VOID_ELEMENTS,
  isHtmlElement,
  parseAttrString,
  getAttrRaw,
} from '../ui-shared.js';

let _htmlCtorFields: Map<string, readonly string[]> = new Map();

function buildHtmlCtorBindings(pat: CasePattern, scrutinee: string): Array<{ name: string; member: string }> {
  if (pat.kind !== 'Constructor') return [];
  const fieldNames = _htmlCtorFields.get(pat.ctorName) ?? [];
  const result: Array<{ name: string; member: string }> = [];
  for (let fi = 0; fi < pat.fields.length; fi++) {
    const f = pat.fields[fi]!;
    if (f.kind !== 'Var') continue;
    result.push({ name: f.name, member: fieldNames[fi] ?? `_${fi}` });
  }
  return result;
}

function emitHtmlPatCond(pat: CasePattern, scrutinee: string): string {
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
// IonType → JS type annotation (for JSDoc)
// ---------------------------------------------------------------------------

function ionTypeToJs(t: IonType): string {
  switch (t.kind) {
    case 'Int': return 'number';
    case 'Float': return 'number';
    case 'Str': return 'string';
    case 'Bool': return 'boolean';
    case 'Null': return 'null';
    case 'Unit': return 'void';
    case 'List': return `${ionTypeToJs(t.elem)}[]`;
    case 'Map': return `Map`;
    case 'Option': return `${ionTypeToJs(t.inner)}|null`;
    case 'Result': return 'object';
    case 'Fn': return 'Function';
    case 'User': return t.name;
    case 'TypeVar': return 'any';
    case 'Never': return 'never';
    case 'Tuple': return `[${t.elements.map(ionTypeToJs).join(', ')}]`;
    default: return 'any';
  }
}

// ---------------------------------------------------------------------------
// emitJsExpr — inline JS expression (used inside <script> blocks)
// ---------------------------------------------------------------------------

function emitJsExpr(node: IonIRNode): string {
  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Str') return JSON.stringify(v.value);
      if (v.kind === 'Int' || v.kind === 'Float') return String(v.value);
      if (v.kind === 'Bool') return v.value ? 'true' : 'false';
      if (v.kind === 'Null') return 'null';
      return 'null';
    }
    case 'Var': return node.name;
    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const _n = (app.callee as { kind: 'Var'; name: string }).name;
        if ((_n === '__platform__' || _n === '__platform_select__') && app.args.length >= 2)
          return `/* __platform__ requires --target react-native */ ${emitJsExpr(app.args[1]!)}`;
      }
      const callee = emitJsExpr(app.callee);
      const args = app.args.map(emitJsExpr).join(', ');
      return `${callee}(${args})`;
    }
    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      return `(${params}) => ${emitJsExpr(abs.body)}`;
    }
    case 'Let': {
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') cur = (cur as LetNode).body;
      return emitJsExpr(cur);
    }
    case 'Case': {
      const c = node as CaseNode;
      if (c.arms.length === 0) return 'undefined';
      if (c.arms.length === 1 && c.arms[0]!.pattern.kind === 'Wildcard') {
        return emitJsExpr(c.arms[0]!.body);
      }
      if (
        c.arms.length === 2 &&
        c.arms[0]!.pattern.kind === 'Literal' &&
        c.arms[0]!.pattern.value.kind === 'Bool' &&
        c.arms[0]!.pattern.value.value === true &&
        c.arms[1]!.pattern.kind === 'Wildcard'
      ) {
        return `(${emitJsExpr(c.scrutinee)} ? ${emitJsExpr(c.arms[0]!.body)} : ${emitJsExpr(c.arms[1]!.body)})`;
      }
      const scrutinee = emitJsExpr(c.scrutinee);
      const parts: string[] = [];
      for (let i = 0; i < c.arms.length; i++) {
        const arm = c.arms[i]!;
        const isLast = i === c.arms.length - 1;
        const pat = arm.pattern;
        if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
          parts.push(emitJsExpr(arm.body));
        } else {
          const cond = emitHtmlPatCond(pat, scrutinee);
          const bindings = buildHtmlCtorBindings(pat, scrutinee);
          if (bindings.length > 0) {
            const decls = bindings.map(b => `const ${b.name} = ${scrutinee}.${b.member};`).join(' ');
            parts.push(`${cond} ? (() => { ${decls} return ${emitJsExpr(arm.body)}; })()`);
          } else {
            parts.push(`${cond} ? ${emitJsExpr(arm.body)}`);
          }
        }
      }
      if (parts.length === 1) return parts[0]!;
      const last = parts.pop()!;
      return parts.join(' : ') + ' : ' + last;
    }
    case 'Constructor': {
      const args = node.args.map(emitJsExpr).join(', ');
      return `{ _tag: '${node.ctorName}'${args ? `, _args: [${args}]` : ''} }`;
    }
    case 'Accessor': return `${emitJsExpr(node.receiver)}.${node.member}`;
    case 'ListLit': return `[${node.elements.map(emitJsExpr).join(', ')}]`;
    case 'MapLit': {
      const entries = node.entries.map(e => `[${emitJsExpr(e.key)}, ${emitJsExpr(e.value)}]`).join(', ');
      return `new Map([${entries}])`;
    }
    case 'ModuleRef': return node.modulePath.join('.');
    case 'ForeignRef': return node.target;
    case 'Effect': return emitJsExpr(node.body);
    case 'OopNew': return `new _ctor_${node.ctorSymbolId}(${node.args.map(emitJsExpr).join(', ')})`;
    case 'OopVirtualCall': return `${emitJsExpr(node.receiver)}.${node.method}(${node.args.map(emitJsExpr).join(', ')})`;
    case 'OopThis': return 'this';
    case 'AsyncBlock': return `(async () => ${emitJsExpr(node.body)})()`;
    case 'Await': return `await ${emitJsExpr(node.expr)}`;
    case 'AdtMatch': {
      const subject = emitJsExpr(node.scrutinee);
      const arms = node.arms.map(arm => {
        const bindings = arm.bindings.map((b, i) => `const ${b.name} = _v._args[${i}];`).join(' ');
        return `if (_v._tag === '${arm.tag}') { ${bindings} return (${emitJsExpr(arm.body)}); }`;
      }).join(' else ');
      return `((_v) => { ${arms} return undefined; })(${subject})`;
    }
    case 'Perform': return `/* perform ${node.operation} */(${node.args.map(emitJsExpr).join(', ')})`;
    case 'Handle': return emitJsExpr(node.body);
    case 'Resume': return emitJsExpr(node.value);
    // OopClass / OopInterface / AdtDecl / EffectDecl are declarations, not expressions —
    // fall through to a JS comment so they never produce the string "undefined".
    case 'OopClass': return `/* class ${node.name} */`;
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
// emitScriptDecl — emit a top-level IR node as a <script> JS declaration
// ---------------------------------------------------------------------------

function emitScriptDecl(node: IonIRNode): string {
  switch (node.kind) {
    case 'Let': {
      const lt = node as LetNode;
      if (lt.value.kind === 'Abs') {
        const abs = lt.value as AbsNode;
        const params = abs.params.map(p => p.name).join(', ');
        return `function ${lt.name}(${params}) {\n  return ${emitJsExpr(abs.body)};\n}`;
      }
      return `const ${lt.name} = ${emitJsExpr(lt.value)};`;
    }

    case 'OopClass': {
      const cls = node as OopClassNode;
      const lines: string[] = [];

      // annotations → check for customElement annotation to use as a comment
      const annotations: readonly OopAnnotation[] = cls.annotations ?? [];
      const customElementAnnotation = annotations.find(a => a.name === 'customElement');
      if (customElementAnnotation) {
        const tagName = customElementAnnotation.args[0] ?? cls.name.toLowerCase();
        lines.push(`// Custom element: <${tagName}>`);
      }

      lines.push(`class ${cls.name} {`);

      // Explicit constructors (new field) — emit as connectedCallback if present, or plain constructor
      const constructors: readonly OopConstructor[] = cls.constructors ?? [];
      if (constructors.length > 0) {
        const ctor = constructors[0]!;
        const params = ctor.params.map(p => p.name).join(', ');
        const bodyStr = ctor.body ? emitJsExpr(ctor.body) : '';
        lines.push(`  connectedCallback(${params}) {`);
        if (bodyStr) lines.push(`    ${bodyStr};`);
        lines.push(`  }`);
      } else if (cls.fields.length > 0) {
        // Constructor from fields (legacy path)
        const fieldParams = cls.fields.map(f => f.name).join(', ');
        const fieldAssigns = cls.fields.map(f => `    this.${f.name} = ${f.name};`).join('\n');
        lines.push(`  constructor(${fieldParams}) {`);
        lines.push(fieldAssigns);
        lines.push(`  }`);
      }

      // Methods — handle accessorKind (get/set) and annotations; ignore visibility
      for (const m of cls.methods) {
        const params = m.params.map(p => p.name).join(', ');
        const bodyStr = m.body ? emitJsExpr(m.body) : 'undefined';
        const staticKw = m.isStatic ? 'static ' : '';
        if (m.accessorKind === 'get') {
          lines.push(`  ${staticKw}get ${m.name}() {`);
          lines.push(`    return ${bodyStr};`);
          lines.push(`  }`);
        } else if (m.accessorKind === 'set') {
          const setParam = m.params[0]?.name ?? 'value';
          lines.push(`  ${staticKw}set ${m.name}(${setParam}) {`);
          lines.push(`    ${bodyStr};`);
          lines.push(`  }`);
        } else {
          lines.push(`  ${staticKw}${m.name}(${params}) {`);
          lines.push(`    return ${bodyStr};`);
          lines.push(`  }`);
        }
      }

      lines.push(`}`);
      return lines.join('\n');
    }

    case 'OopInterface': {
      const iface = node as OopInterfaceNode;
      const lines: string[] = [];
      // typeParams → ignored in HTML (no generics); annotations → ignored
      lines.push(`/**`);
      lines.push(` * @interface ${iface.name}`);
      for (const m of iface.members) {
        lines.push(` * @property {${ionTypeToJs(m.type)}} ${m.name}`);
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
        lines.push(`function ${v.tag}(${fieldNames}) { return { _tag: '${v.tag}'${v.fields.length > 0 ? `, _args: [${fieldNames}]` : ''} }; }`);
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

    case 'Abs': {
      // Top-level anonymous function — emit as an immediately-invoked function expression
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      return `(function(${params}) {\n  return ${emitJsExpr(abs.body)};\n})();`;
    }

    case 'AsyncBlock':
      return `// async block\n(async () => {\n  return ${emitJsExpr(node.body)};\n})();`;

    case 'Await':
      return `// await\nawait ${emitJsExpr(node.expr)};`;

    case 'Var':
      return `// ref: ${node.name}`;

    case 'App': {
      const app = node as AppNode;
      const callee = emitJsExpr(app.callee);
      const args = app.args.map(emitJsExpr).join(', ');
      return `${callee}(${args});`;
    }

    case 'Literal':
      return `// literal: ${emitJsExpr(node)}`;

    case 'Case': {
      const c = node as CaseNode;
      return `// case expression\n(${emitJsExpr(c)});`;
    }

    case 'Constructor':
      return `// constructor: ${node.ctorName}`;

    case 'Accessor':
      return `// accessor: ${emitJsExpr(node)}`;

    case 'ListLit':
      return `const _list = ${emitJsExpr(node)};`;

    case 'MapLit':
      return `const _map = ${emitJsExpr(node)};`;

    case 'ModuleRef':
      return `// module: ${node.modulePath.join('.')}`;

    case 'ForeignRef':
      return `// foreign: ${node.target}`;

    case 'Effect':
      return emitScriptDecl(node.body);

    case 'OopNew': {
      const args = node.args.map(emitJsExpr).join(', ');
      return `new _ctor_${node.ctorSymbolId}(${args});`;
    }

    case 'OopVirtualCall':
      return `${emitJsExpr(node.receiver)}.${node.method}(${node.args.map(emitJsExpr).join(', ')});`;

    case 'OopThis':
      return `// this`;

    case 'AdtMatch': {
      const adt = node as AdtMatchNode;
      return `// adt match\n(${emitJsExpr(adt)});`;
    }

    case 'Perform':
      return `// perform: ${node.operation}(${node.args.map(emitJsExpr).join(', ')})`;

    case 'Handle':
      return emitScriptDecl(node.body);

    case 'Resume':
      return `// resume: ${emitJsExpr(node.value)}`;

    case 'RawInject':
      return (node as RawInjectNode).code;

    default: {
      const _exhaustive: never = node;
      return `// [${(_exhaustive as IonIRNode).kind}]`;
    }
  }
}

// ---------------------------------------------------------------------------
// emitHtmlNode — HTML template emitter
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

    case 'Constructor': {
      // Constructors don't render to HTML directly — emit as inline JS object comment
      return `<!-- ${node.ctorName} -->`;
    }

    case 'MapLit': {
      // Maps have no direct HTML representation
      return `<!-- map -->`;
    }

    case 'ModuleRef':
      return `<!-- module:${node.modulePath.join('.')} -->`;

    case 'ForeignRef':
      return `<!-- foreign:${node.target} -->`;

    case 'Effect':
      return emitHtmlNode(node.body, env);

    case 'OopClass': {
      // OopClass in an HTML context: emit as a <script> block
      const decl = emitScriptDecl(node);
      return `<script>\n${decl}\n</script>`;
    }

    case 'OopInterface': {
      const decl = emitScriptDecl(node);
      return `<script>\n${decl}\n</script>`;
    }

    case 'Accessor':
      return emitHtmlNode(node.receiver, env);

    case 'OopNew':
      return `<!-- new ${node.ctorSymbolId} -->`;

    case 'OopVirtualCall':
      return `<!-- .${node.method}() -->`;

    case 'OopThis':
      return `<!-- this -->`;

    case 'AsyncBlock':
      return emitHtmlNode(node.body, env);

    case 'Await':
      return emitHtmlNode(node.expr, env);

    case 'AdtDecl': {
      const decl = emitScriptDecl(node);
      return `<script>\n${decl}\n</script>`;
    }

    case 'AdtMatch': {
      // Emit the first arm's body as the rendered branch
      if (node.arms.length > 0) {
        return emitHtmlNode(node.arms[0]!.body, env);
      }
      return '';
    }

    case 'EffectDecl': {
      const decl = emitScriptDecl(node);
      return `<script>\n${decl}\n</script>`;
    }

    case 'Perform':
      return `<!-- perform:${node.operation} -->`;

    case 'Handle':
      return emitHtmlNode(node.body, env);

    case 'Resume':
      return emitHtmlNode(node.value, env);

    case 'RawInject':
      return (node as RawInjectNode).code;

    default: {
      // Exhaustiveness: node is `never` here if all cases are covered
      const _exhaustive: never = node;
      return `<!-- unsupported: ${(_exhaustive as IonIRNode).kind} -->`;
    }
  }
}

// ---------------------------------------------------------------------------
// emitHTML
// ---------------------------------------------------------------------------

export function emitHTML(irModule: IonIRModule): string {
  _htmlCtorFields = new Map();
  for (const d of irModule.data) {
    for (const v of d.variants) {
      _htmlCtorFields.set(v.tag, v.fields.map(f => f.name));
    }
  }

  // Build an environment map from all let-binding decls for variable resolution
  const env = new Map<string, IonIRNode>();
  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      env.set((d as LetNode).name, (d as LetNode).value);
    }
  }

  const parts: string[] = ['<!DOCTYPE html>', '<html lang="en">'];

  // Collect script declarations (non-HTML nodes) to embed in a single <script> block
  const scriptDecls: string[] = [];

  for (const d of irModule.decls) {
    switch (d.kind) {
      case 'Let': {
        const lt = d as LetNode;
        const value = lt.value;
        if (isHtmlElement(value)) {
          parts.push(emitHtmlNode(value, env));
        } else if (value.kind === 'Abs') {
          // Component — emit its body
          parts.push(emitHtmlNode((value as AbsNode).body, env));
        } else {
          // Non-HTML binding — emit as script decl
          scriptDecls.push(emitScriptDecl(lt));
        }
        break;
      }

      case 'OopClass':
      case 'OopInterface':
      case 'AdtDecl':
      case 'EffectDecl':
        scriptDecls.push(emitScriptDecl(d));
        break;

      default:
        break;
    }
  }

  // Also process module-level ADT data
  for (const adt of irModule.data) {
    scriptDecls.push(emitScriptDecl(adt));
  }

  if (scriptDecls.length > 0) {
    parts.push('<script>');
    parts.push(scriptDecls.join('\n\n'));
    parts.push('</script>');
  }

  parts.push('</html>');
  return parts.join('\n');
}
