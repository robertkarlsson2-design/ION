import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  AsyncBlockNode,
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
  ForeignRefNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import {
  HTML_TAGS,
  VOID_ELEMENTS,
  isHtmlElement,
  getAttrRaw,
} from '../ui-shared.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';

let _reactCtorFields: Map<string, readonly string[]> = new Map();

function buildReactCtorBindings(pat: CasePattern, scrutinee: string): Array<{ name: string; member: string }> {
  if (pat.kind !== 'Constructor') return [];
  const fieldNames = _reactCtorFields.get(pat.ctorName) ?? [];
  const result: Array<{ name: string; member: string }> = [];
  for (let fi = 0; fi < pat.fields.length; fi++) {
    const f = pat.fields[fi]!;
    if (f.kind !== 'Var') continue;
    result.push({ name: f.name, member: fieldNames[fi] ?? `_${fi}` });
  }
  return result;
}

function emitReactPatCond(pat: CasePattern, scrutinee: string): string {
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
// IonType → TypeScript type annotation
// ---------------------------------------------------------------------------

function ionTypeToTs(t: IonType): string {
  switch (t.kind) {
    case 'Int': return 'number';
    case 'Float': return 'number';
    case 'Str': return 'string';
    case 'Bool': return 'boolean';
    case 'Null': return 'null';
    case 'Unit': return 'void';
    case 'List': return `${ionTypeToTs(t.elem)}[]`;
    case 'Map': return `Map<${ionTypeToTs(t.key)}, ${ionTypeToTs(t.value)}>`;
    case 'Option': return `${ionTypeToTs(t.inner)} | null`;
    case 'Result': return `{ ok: ${ionTypeToTs(t.ok)} } | { err: ${ionTypeToTs(t.err)} }`;
    case 'Fn': return `(${t.params.map(ionTypeToTs).join(', ')}) => ${ionTypeToTs(t.ret)}`;
    case 'User': return t.name;
    case 'TypeVar': return 'unknown';
    case 'Never': return 'never';
    case 'Tuple': return `[${t.elements.map(ionTypeToTs).join(', ')}]`;
    default: return 'unknown';
  }
}

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

/**
 * Attribute names whose values React always treats as JS expressions when
 * they look like an identifier. Lets `value=email` emit as `value={email}`
 * without the author having to write `value={email}` explicitly.
 */
const EXPR_ATTR_NAMES = new Set([
  'value', 'checked', 'disabled', 'selected', 'readOnly', 'autoFocus',
  'key', 'ref', 'style', 'htmlFor',
]);

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
      // Explicit expression form: value={email} or onClick={(e) => ...}
      // (Preserves whatever's between the braces verbatim.)
      if (v.startsWith('{') && v.endsWith('}')) {
        return `${k}=${v}`;
      }
      // Event handler bound to an identifier (onclick=handleClick → onClick={handleClick})
      if (isJsIdentifier(v) && ATTR_MAP[rawKey] !== undefined && rawKey.startsWith('on')) {
        return `${k}={${v}}`;
      }
      // Common expression-valued attrs whose value looks like an identifier
      // (value=email → value={email}). Skip if the value would more
      // naturally be a string literal (anything with non-ident chars).
      if (isJsIdentifier(v) && EXPR_ATTR_NAMES.has(k)) {
        return `${k}={${v}}`;
      }
      return `${k}="${v}"`;
    })
    .join(' ');
}

/** Emit propDict entries as space-prefixed JSX attribute fragments. */
function emitPropDictAttrs(propDict: readonly { readonly key: string; readonly value: IonIRNode }[]): string {
  if (propDict.length === 0) return '';
  return ' ' + propDict.map(({ key, value }) => `${key}={${emitTsExprForReact(value)}}`).join(' ');
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
          const propDictStr = app.propDict ? emitPropDictAttrs(app.propDict) : '';
          const allAttrs = `${attrStr}${propDictStr}`;

          if (VOID_ELEMENTS.has(tagName)) {
            return `${pad}<${tagName}${allAttrs} />`;
          }

          const children = app.args.slice(1).map(c => emitJsxNode(c, indent + 1, env)).filter(s => s.trim()).join('\n');
          if (!children) {
            return `${pad}<${tagName}${allAttrs}></${tagName}>`;
          }
          return `${pad}<${tagName}${allAttrs}>\n${children}\n${pad}</${tagName}>`;
        }

        // Non-HTML function call in JSX context — capitalised name = component
        // (e.g. <Card item={x} />), lowercase = plain function call expression.
        const isComponent = /^[A-Z]/.test(tagName);
        if (isComponent) {
          const first = app.args[0];
          const hasAttrString = first !== undefined && first.kind === 'Literal' && first.value.kind === 'Str';
          const propDictStr = app.propDict && app.propDict.length > 0 ? emitPropDictAttrs(app.propDict) : '';
          if (hasAttrString || propDictStr) {
            const attrs = hasAttrString ? emitJsxAttrString(first.value.value) : '';
            const attrStr = attrs ? ` ${attrs}` : '';
            const allAttrs = `${attrStr}${propDictStr}`;
            const childrenArgs = hasAttrString ? app.args.slice(1) : app.args;
            const children = childrenArgs.map(c => emitJsxNode(c, indent + 1, env)).filter(s => s.trim()).join('\n');
            if (!children) return `${pad}<${tagName}${allAttrs} />`;
            return `${pad}<${tagName}${allAttrs}>\n${children}\n${pad}</${tagName}>`;
          }
          // No string-literal attr block or propDict — fall through to expression emission.
        }
        const argStrs = app.args.map(a => emitTsExprForReact(a)).join(', ');
        return `{${tagName}(${argStrs})}`;
      }
      // Callee is something else (Accessor like items.map, lambda, etc.).
      // Treat the whole call as a TS expression and wrap in JSX braces.
      return `{${emitTsExprForReact(app)}}`;
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
        const trueBody = caseNode.arms[0]!.body;
        const falseBody = caseNode.arms[1]!.body;
        // If the false arm is null / null literal, prefer the && short-circuit
        // form so the output is valid JSX (`{cond && <jsx/>}`) instead of a
        // ternary with an empty branch.
        const falseIsNull =
          (falseBody.kind === 'Literal' && falseBody.value.kind === 'Null') ||
          (falseBody.kind === 'Literal' && falseBody.value.kind === 'Bool' && falseBody.value.value === false);
        const tTrue = emitJsxNode(trueBody, indent, env);
        if (falseIsNull) {
          return `{${cond} && (\n${tTrue}\n)}`;
        }
        const tFalse = emitJsxNode(falseBody, indent, env);
        // Defensive: if either branch ended up empty (e.g. unsupported node),
        // fall back to `null` so the output still parses as TSX.
        const safeTrue = tTrue.trim() ? tTrue : `${'  '.repeat(indent + 1)}null`;
        const safeFalse = tFalse.trim() ? tFalse : `${'  '.repeat(indent + 1)}null`;
        return `{${cond} ? (\n${safeTrue}\n) : (\n${safeFalse}\n)}`;
      }
      // Fallback: first arm
      return emitJsxNode(caseNode.arms[0]!.body, indent, env);
    }

    case 'ListLit': {
      const items = node.elements.map(e => emitJsxNode(e, indent + 1, env)).filter(s => s.trim()).join('\n');
      return `${pad}<>\n${items}\n${pad}</>`;
    }

    case 'Constructor': {
      // ADT constructor in JSX context — render as expression
      const args = node.args.map(emitTsExprForReact).join(', ');
      return `{/* ${node.ctorName}(${args}) */}`;
    }

    case 'MapLit': {
      // Maps don't render as JSX
      return `{/* map */}`;
    }

    case 'ModuleRef':
      return `{/* module:${node.modulePath.join('.')} */}`;

    case 'ForeignRef':
      return `{/* foreign:${node.target} */}`;

    case 'Effect':
      return emitJsxNode(node.body, indent, env);

    case 'OopNew': {
      const args = node.args.map(emitTsExprForReact).join(', ');
      return `{/* new ctor_${node.ctorSymbolId}(${args}) */}`;
    }

    case 'OopVirtualCall':
      return `{/* .${node.method}() */}`;

    case 'OopThis':
      return `{/* this */}`;

    case 'AsyncBlock':
      return emitJsxNode(node.body, indent, env);

    case 'Await':
      return emitJsxNode(node.expr, indent, env);

    case 'AdtMatch': {
      const adtMatch = node as AdtMatchNode;
      // Render first arm as the default JSX branch
      if (adtMatch.arms.length > 0) {
        return emitJsxNode(adtMatch.arms[0]!.body, indent, env);
      }
      return '';
    }

    case 'Perform':
      return `{/* perform:${node.operation} */}`;

    case 'Handle':
      return emitJsxNode(node.body, indent, env);

    case 'Resume':
      return emitJsxNode(node.value, indent, env);

    // Declarations in JSX context — emit nothing (they live in the script section)
    case 'OopClass':
    case 'OopInterface':
    case 'AdtDecl':
    case 'EffectDecl':
      return '';

    case 'Accessor':
      return `{${emitTsExprForReact(node)}}`;

    case 'RawInject':
      return (node as RawInjectNode).code;

    default: {
      const _exhaustive: never = node;
      return `{/* unsupported: ${(_exhaustive as IonIRNode).kind} */}`;
    }
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
      // Operator builtin special-cases (mirror TS emitter): __obj__, __index__,
      // __nullish__, __optchain__, __throw__, __env__, __set__, __regex__,
      // __try__, __tryfin__, __finally__, __do__, __seq__, __spread__, __add__,
      // __sub__, __mul__, __div__, __mod__, __eq__, __ne__, __lt__, __gt__,
      // __le__, __ge__, __and__, __or__, __not__, __neg__.
      if (app.callee.kind === 'Var') {
        const name = (app.callee as VarNode).name;
        const binOps: Record<string, string> = {
          __add__: '+', __sub__: '-', __mul__: '*', __div__: '/', __mod__: '%',
          __eq__: '===', __ne__: '!==', __lt__: '<', __gt__: '>', __le__: '<=', __ge__: '>=',
          __and__: '&&', __or__: '||',
        };
        if (binOps[name] !== undefined && app.args.length === 2) {
          return `(${emitTsExprForReact(app.args[0]!)} ${binOps[name]} ${emitTsExprForReact(app.args[1]!)})`;
        }
        if (name === '__neg__' && app.args.length === 1) return `-${emitTsExprForReact(app.args[0]!)}`;
        if (name === '__not__' && app.args.length === 1) return `!${emitTsExprForReact(app.args[0]!)}`;
        if (name === '__obj__' && app.args.length % 2 === 0) {
          const parts: string[] = [];
          for (let i = 0; i < app.args.length; i += 2) {
            const k = app.args[i]!;
            const v = app.args[i + 1]!;
            const ks = k.kind === 'Literal' && (k as { value: { kind: string; value?: string } }).value.kind === 'Str'
              ? (k as { value: { value: string } }).value.value : emitTsExprForReact(k);
            if (ks === '...') { parts.push(`...${emitTsExprForReact(v)}`); continue; }
            const ko = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(ks) ? ks : JSON.stringify(ks);
            parts.push(`${ko}: ${emitTsExprForReact(v)}`);
          }
          return `{ ${parts.join(', ')} }`;
        }
        if (name === '__index__' && app.args.length === 2) return `${emitTsExprForReact(app.args[0]!)}[${emitTsExprForReact(app.args[1]!)}]`;
        if (name === '__nullish__' && app.args.length === 2) return `(${emitTsExprForReact(app.args[0]!)} ?? ${emitTsExprForReact(app.args[1]!)})`;
        if (name === '__optchain__' && app.args.length === 2) {
          const m = app.args[1]!;
          if (m.kind === 'Literal' && (m as { value: { kind: string; value?: string } }).value.kind === 'Str') {
            return `${emitTsExprForReact(app.args[0]!)}?.${(m as { value: { value: string } }).value.value}`;
          }
        }
        if (name === '__throw__' && app.args.length === 1) return `(() => { throw new Error(${emitTsExprForReact(app.args[0]!)}); })()`;
        if (name === '__env__' && app.args.length === 1) return `process.env[${emitTsExprForReact(app.args[0]!)}]`;
        if (name === '__set__' && app.args.length === 3) {
          const f = app.args[1]!;
          if (f.kind === 'Literal' && (f as { value: { kind: string; value?: string } }).value.kind === 'Str') {
            return `((${emitTsExprForReact(app.args[0]!)}).${(f as { value: { value: string } }).value.value} = ${emitTsExprForReact(app.args[2]!)})`;
          }
          return `((${emitTsExprForReact(app.args[0]!)})[${emitTsExprForReact(f)}] = ${emitTsExprForReact(app.args[2]!)})`;
        }
        if (name === '__regex__' && (app.args.length === 1 || app.args.length === 2)) {
          return app.args.length === 1
            ? `new RegExp(${emitTsExprForReact(app.args[0]!)})`
            : `new RegExp(${emitTsExprForReact(app.args[0]!)}, ${emitTsExprForReact(app.args[1]!)})`;
        }
        if (name === '__try__' && app.args.length === 2) {
          return `(async () => { try { return ${emitTsExprForReact(app.args[0]!)}; } catch (e) { return ${emitTsExprForReact(app.args[1]!)}; } })()`;
        }
        if (name === '__tryfin__' && app.args.length === 3) {
          return `(async () => { try { return ${emitTsExprForReact(app.args[0]!)}; } catch (e) { return ${emitTsExprForReact(app.args[1]!)}; } finally { ${emitTsExprForReact(app.args[2]!)}; } })()`;
        }
        if (name === '__finally__' && app.args.length === 2) {
          return `(async () => { try { return ${emitTsExprForReact(app.args[0]!)}; } finally { ${emitTsExprForReact(app.args[1]!)}; } })()`;
        }
        if (name === '__do__' && app.args.length >= 1) {
          const last = app.args[app.args.length - 1]!;
          const stmts = app.args.slice(0, -1).map(a => `${emitTsExprForReact(a)};`);
          if (stmts.length === 0) return emitTsExprForReact(last);
          return `(() => { ${stmts.join(' ')} return ${emitTsExprForReact(last)}; })()`;
        }
        if (name === '__seq__' && app.args.length >= 1) return `(${app.args.map(emitTsExprForReact).join(', ')})`;
        if (name === '__spread__' && app.args.length === 1) return `...${emitTsExprForReact(app.args[0]!)}`;
      }
      // ForeignRef as callee: emit as direct identifier (mirrors TS emitter).
      if (app.callee.kind === 'ForeignRef') {
        const fr = app.callee as ForeignRefNode;
        if (fr.sig.template === '' && fr.sig.params.length === 0) {
          const JS_GLOBALS = new Set(['console','Math','JSON','Object','Array','String','Number','Boolean','Date','RegExp','Promise','Symbol','Error','window','document','globalThis','process']);
          const calleeStr = (fr.target === 'js' && JS_GLOBALS.has(fr.module)) ? `${fr.module}.${fr.symbol}` : fr.symbol;
          return `${calleeStr}(${app.args.map(emitTsExprForReact).join(', ')})`;
        }
      }
      // HTML-element call appearing in expression position (e.g. inside a
      // lambda passed to .map): re-route through emitJsxNode so the result
      // is real JSX. emitJsxNode wraps non-tag children in {} braces, so
      // strip those when we're already in an expression context.
      if (isHtmlElement(app)) {
        const jsx = emitJsxNode(app);
        return jsx.trim();
      }
      // Fix D: component App in expression position (capitalised callee Var)
      // — route through emitJsxNode so propDict attrs are rendered as JSX.
      if (app.callee.kind === 'Var' && /^[A-Z]/.test((app.callee as VarNode).name)) {
        return emitJsxNode(app).trim();
      }
      const callee = emitTsExprForReact(app.callee);
      const args = app.args.map(emitTsExprForReact).join(', ');
      return `${callee}(${args})`;
    }
    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      if (abs.body.kind === 'AsyncBlock') {
        return `async (${params}) => ${emitTsExprForReact((abs.body as AsyncBlockNode).body)}`;
      }
      const innerBody = abs.body;
      if (isHtmlElement(innerBody)) {
        return `(${params}) => (${emitJsxNode(innerBody).trim()})`;
      }
      // Fix E: component body — route through JSX so propDict attrs are rendered.
      if (innerBody.kind === 'App' && innerBody.callee.kind === 'Var' && /^[A-Z]/.test((innerBody.callee as VarNode).name)) {
        return `(${params}) => (${emitJsxNode(innerBody).trim()})`;
      }
      return `(${params}) => ${emitTsExprForReact(abs.body)}`;
    }
    case 'Accessor': return `${emitTsExprForReact(node.receiver)}.${node.member}`;
    case 'ListLit': return `[${node.elements.map(emitTsExprForReact).join(', ')}]`;
    case 'MapLit': {
      const entries = node.entries.map(e => `[${emitTsExprForReact(e.key)}, ${emitTsExprForReact(e.value)}]`).join(', ');
      return `new Map([${entries}])`;
    }
    case 'Let': {
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') cur = (cur as LetNode).body;
      return emitTsExprForReact(cur);
    }
    case 'Case': {
      const c = node as CaseNode;
      if (c.arms.length === 0) return 'undefined';
      if (c.arms.length === 1 && c.arms[0]!.pattern.kind === 'Wildcard') {
        return emitTsExprForReact(c.arms[0]!.body);
      }
      if (
        c.arms.length === 2 &&
        c.arms[0]!.pattern.kind === 'Literal' &&
        c.arms[0]!.pattern.value.kind === 'Bool' &&
        c.arms[0]!.pattern.value.value === true &&
        c.arms[1]!.pattern.kind === 'Wildcard'
      ) {
        return `(${emitTsExprForReact(c.scrutinee)} ? ${emitTsExprForReact(c.arms[0]!.body)} : ${emitTsExprForReact(c.arms[1]!.body)})`;
      }
      const scrutinee = emitTsExprForReact(c.scrutinee);
      const parts: string[] = [];
      for (let i = 0; i < c.arms.length; i++) {
        const arm = c.arms[i]!;
        const isLast = i === c.arms.length - 1;
        const pat = arm.pattern;
        if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
          parts.push(emitTsExprForReact(arm.body));
        } else {
          const cond = emitReactPatCond(pat, scrutinee);
          const bindings = buildReactCtorBindings(pat, scrutinee);
          if (bindings.length > 0) {
            const decls = bindings.map(b => `const ${b.name} = ${scrutinee}.${b.member};`).join(' ');
            parts.push(`${cond} ? (() => { ${decls} return ${emitTsExprForReact(arm.body)}; })()`);
          } else {
            parts.push(`${cond} ? ${emitTsExprForReact(arm.body)}`);
          }
        }
      }
      if (parts.length === 1) return parts[0]!;
      const last = parts.pop()!;
      return parts.join(' : ') + ' : ' + last;
    }
    case 'Constructor': {
      const args = node.args.map(emitTsExprForReact).join(', ');
      return `{ _tag: '${node.ctorName}' as const${args ? `, _args: [${args}] as const` : ''} }`;
    }
    case 'ModuleRef': return node.modulePath.join('.');
    case 'ForeignRef': return node.target;
    case 'Effect': return emitTsExprForReact(node.body);
    case 'OopNew': {
      const args = node.args.map(emitTsExprForReact).join(', ');
      return `new _ctor_${node.ctorSymbolId}(${args})`;
    }
    case 'OopVirtualCall': {
      const receiver = emitTsExprForReact(node.receiver);
      const args = node.args.map(emitTsExprForReact).join(', ');
      return `${receiver}.${node.method}(${args})`;
    }
    case 'OopThis': return 'this';
    case 'AsyncBlock': return `(async () => ${emitTsExprForReact(node.body)})()`;
    case 'Await': return `await ${emitTsExprForReact(node.expr)}`;
    case 'AdtMatch': {
      const adtMatch = node as AdtMatchNode;
      const subject = emitTsExprForReact(adtMatch.scrutinee);
      const arms = adtMatch.arms.map(arm => {
        const bindings = arm.bindings.map((b, i) => `const ${b.name} = _v._args[${i}];`).join(' ');
        return `if (_v._tag === '${arm.tag}') { ${bindings} return (${emitTsExprForReact(arm.body)}); }`;
      }).join(' else ');
      return `((_v: any) => { ${arms} return undefined; })(${subject})`;
    }
    case 'Perform': return `/* perform ${node.operation} */(${node.args.map(emitTsExprForReact).join(', ')})`;
    case 'Handle': return emitTsExprForReact(node.body);
    case 'Resume': return emitTsExprForReact(node.value);
    // Declaration nodes in expression position — return their name as a reference
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
// emitTopLevelDecl — emit a non-Let top-level node as TSX module-scope code
// ---------------------------------------------------------------------------

function emitTopLevelDecl(node: IonIRNode): string {
  switch (node.kind) {
    case 'OopClass': {
      const cls = node as OopClassNode;
      const lines: string[] = [];

      // annotations → emit as decorators (e.g. @observer)
      const annotations: readonly OopAnnotation[] = cls.annotations ?? [];
      for (const ann of annotations) {
        const args = ann.args.length > 0 ? `(${ann.args.join(', ')})` : '';
        lines.push(`@${ann.name}${args}`);
      }

      // typeParams → use first two as Props and State generics if present
      const typeParams: readonly string[] = cls.typeParams ?? [];
      let classGeneric = '';
      if (typeParams.length >= 2) {
        classGeneric = `<${typeParams[0]}, ${typeParams[1]}>`;
      } else if (typeParams.length === 1) {
        classGeneric = `<${typeParams[0]}>`;
      }

      // Build props interface if there are fields (and no explicit typeParams)
      if (cls.fields.length > 0 && typeParams.length === 0) {
        lines.push(`interface ${cls.name}Props {`);
        for (const f of cls.fields) {
          lines.push(`  ${f.name}: ${ionTypeToTs(f.type)};`);
        }
        lines.push(`}`);
        lines.push(``);
        lines.push(`class ${cls.name} extends React.Component<${cls.name}Props> {`);
      } else if (classGeneric) {
        lines.push(`class ${cls.name} extends React.Component${classGeneric} {`);
      } else {
        lines.push(`class ${cls.name} extends React.Component {`);
      }

      // Explicit constructors (new field)
      const constructors: readonly OopConstructor[] = cls.constructors ?? [];
      for (const ctor of constructors) {
        const ctorParams = ctor.params.map(p => `${p.name}: ${ionTypeToTs(p.type)}`).join(', ');
        const bodyStr = ctor.body ? emitTsExprForReact(ctor.body) : '';
        lines.push(`  constructor(props: any) {`);
        lines.push(`    super(props);`);
        if (bodyStr) lines.push(`    ${bodyStr};`);
        lines.push(`  }`);
      }

      // render method (look for a method named 'render', otherwise emit empty)
      const renderMethod = cls.methods.find(m => m.name === 'render');
      if (renderMethod?.body) {
        lines.push(`  render() {`);
        lines.push(`    return ${emitTsExprForReact(renderMethod.body)};`);
        lines.push(`  }`);
      } else {
        lines.push(`  render() {`);
        lines.push(`    return null;`);
        lines.push(`  }`);
      }

      // Other methods — handle accessorKind, annotations, static; skip visibility
      for (const m of cls.methods) {
        if (m.name === 'render') continue;
        const methodAnnotations = m.annotations ?? [];
        for (const ann of methodAnnotations) {
          const args = ann.args.length > 0 ? `(${ann.args.join(', ')})` : '';
          lines.push(`  @${ann.name}${args}`);
        }
        const params = m.params.map(p => `${p.name}: ${ionTypeToTs(p.type)}`).join(', ');
        const retType = ionTypeToTs(m.retType);
        const bodyStr = m.body ? emitTsExprForReact(m.body) : 'undefined';
        const staticKw = m.isStatic ? 'static ' : '';
        if (m.accessorKind === 'get') {
          lines.push(`  ${staticKw}get ${m.name}(): ${retType} {`);
          lines.push(`    return ${bodyStr};`);
          lines.push(`  }`);
        } else if (m.accessorKind === 'set') {
          const setParam = m.params[0] ? `${m.params[0].name}: ${ionTypeToTs(m.params[0].type)}` : 'value: any';
          lines.push(`  ${staticKw}set ${m.name}(${setParam}) {`);
          lines.push(`    ${bodyStr};`);
          lines.push(`  }`);
        } else {
          lines.push(`  ${staticKw}${m.name}(${params}): ${retType} {`);
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
      // typeParams → include in interface declaration if present
      const typeParams: readonly string[] = iface.typeParams ?? [];
      const generic = typeParams.length > 0 ? `<${typeParams.join(', ')}>` : '';
      // annotations → emit as JSDoc comments
      for (const ann of iface.annotations ?? []) {
        lines.push(`// @${ann.name}${ann.args.length > 0 ? `(${ann.args.join(', ')})` : ''}`);
      }
      lines.push(`interface ${iface.name}${generic} {`);
      for (const m of iface.members) {
        lines.push(`  ${m.name}: ${ionTypeToTs(m.type)};`);
      }
      lines.push(`}`);
      return lines.join('\n');
    }

    case 'AdtDecl': {
      const adt = node as AdtDeclNode;
      const lines: string[] = [];
      // Emit TypeScript discriminated union type
      for (const v of adt.variants) {
        const fields = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join('; ');
        lines.push(`interface ${v.tag} { readonly _tag: '${v.tag}'; ${fields} }`);
      }
      const union = adt.variants.map(v => v.tag).join(' | ');
      lines.push(`type ${adt.name} = ${union || 'never'};`);
      // Constructor functions
      for (const v of adt.variants) {
        const params = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join(', ');
        const body = v.fields.map(f => `${f.name}`).join(', ');
        lines.push(`function make${v.tag}(${params}): ${v.tag} { return { _tag: '${v.tag}'${v.fields.length > 0 ? `, ${body}` : ''} }; }`);
      }
      return lines.join('\n');
    }

    case 'EffectDecl': {
      const eff = node as EffectDeclNode;
      const lines: string[] = [];
      // Emit as a custom hook stub
      lines.push(`// Effect: ${eff.name}`);
      lines.push(`function use${eff.name}() {`);
      for (const op of eff.operations) {
        const params = op.params.map(p => `${p.name}: ${ionTypeToTs(p.type)}`).join(', ');
        const retType = ionTypeToTs(op.retType);
        lines.push(`  // operation: ${op.name}`);
        lines.push(`  function ${op.name}(${params}): ${retType} {`);
        lines.push(`    throw new Error('Not implemented: ${eff.name}.${op.name}');`);
        lines.push(`  }`);
      }
      const opNames = eff.operations.map(op => op.name).join(', ');
      lines.push(`  return { ${opNames} };`);
      lines.push(`}`);
      return lines.join('\n');
    }

    default:
      return `// [${node.kind}]`;
  }
}

// ---------------------------------------------------------------------------
// Component body helpers
// ---------------------------------------------------------------------------

function collectBodyStatements(
  body: IonIRNode
): { statements: string[]; tail: IonIRNode } {
  const statements: string[] = [];
  let cur: IonIRNode = body;
  while (cur.kind === 'Let') {
    const lt = cur as LetNode;
    const v = lt.value;
    if (v.kind === 'RawInject') {
      const code = v.code.trim();
      statements.push(code.endsWith(';') || code.endsWith('}') ? code : `${code};`);
    } else {
      statements.push(`const ${lt.name} = ${emitTsExprForReact(v)};`);
    }
    cur = lt.body;
  }
  return { statements, tail: cur };

}

// ---------------------------------------------------------------------------
// emitReact
// ---------------------------------------------------------------------------

export function emitReact(irModule: IonIRModule): string {
  // Drop unused prelude declarations (mirrors what the JS/TS emitters do).
  // Without this every output gets ~80 lines of `const map = unknown;` style
  // noise from the auto-prepended prelude.
  irModule = shakePreludeDecls(irModule);

  _reactCtorFields = new Map();
  for (const d of irModule.data) {
    for (const v of d.variants) {
      _reactCtorFields.set(v.tag, v.fields.map(f => f.name));
    }
  }

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

  // Emit module-level ADT data declarations first
  for (const adt of irModule.data) {
    parts.push(emitTopLevelDecl(adt));
    parts.push(``);
  }

  for (const d of irModule.decls) {
    switch (d.kind) {
      case 'Let': {
        const lt = d as LetNode;
        const name = lt.name;
        const value = lt.value;

        // User-declared HTML tag externs (foreign refs whose name is an HTML
        // tag) are only used inline as JSX elements — emitting `const div =
        // unknown;` for them is noise. Skip the binding entirely.
        if (value.kind === 'ForeignRef' && HTML_TAGS.has(name)) {
          break;
        }

        if (value.kind === 'Abs') {
          const abs = value as AbsNode;
          const params = abs.params.map(p => p.name).join(', ');

          if (abs.body.kind === 'Let') {
            const { statements, tail } = collectBodyStatements(abs.body);
            const tailJsx = emitJsxNode(tail, 2, env);
            const tailIsJsx = tailJsx.trim().startsWith('<') || tailJsx.trim().startsWith('{');
            const returnExpr = tailIsJsx ? tailJsx.trim() : emitTsExprForReact(tail);
            parts.push(`const ${name}: React.FC = (${params}) => {`);
            for (const s of statements) parts.push(`  ${s}`);
            if (tailIsJsx && tailJsx.includes('\n')) {
              parts.push(`  return (`);
              parts.push(`    ${returnExpr.split('\n').join('\n    ')}`);
              parts.push(`  );`);
            } else {
              parts.push(`  return ${returnExpr};`);
            }
            parts.push(`};`);
            break;
          }

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
        break;
      }

      case 'OopClass':
      case 'OopInterface':
      case 'AdtDecl':
      case 'EffectDecl':
        parts.push(emitTopLevelDecl(d));
        parts.push(``);
        break;

      default:
        // Other top-level nodes (Perform, Handle, etc.) — emit as expression statement
        parts.push(`// ${d.kind}: ${emitTsExprForReact(d)}`);
        break;
    }
  }

  return parts.join('\n') + '\n';
}
