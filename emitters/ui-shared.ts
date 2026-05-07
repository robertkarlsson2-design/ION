import type {
  IonIRNode,
  AppNode,
  AbsNode,
  AsyncBlockNode,
  LetNode,
  CaseNode,
  CasePattern,
  VarNode,
  AdtMatchNode,
  ForeignRefNode,
  RawInjectNode,
} from '../src/ir/nodes.js';

// ---------------------------------------------------------------------------
// Known HTML tag names
// ---------------------------------------------------------------------------

export const HTML_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'footer', 'main', 'nav', 'section', 'article', 'aside',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'label',
  'a', 'img', 'br', 'hr', 'meta', 'link', 'script', 'style',
  'title', 'head', 'body', 'html',
  'figure', 'figcaption', 'blockquote', 'pre', 'code',
  'em', 'strong', 'small', 'mark', 'sup', 'sub',
  'details', 'summary', 'dialog',
]);

// HTML void (self-closing) elements
export const VOID_ELEMENTS = new Set([
  'input', 'br', 'hr', 'img', 'meta', 'link',
  'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr',
]);

// ---------------------------------------------------------------------------
// isHtmlElement
// ---------------------------------------------------------------------------

/** Returns true if the node is an HTML element App call. */
export function isHtmlElement(node: IonIRNode): boolean {
  return (
    node.kind === 'App' &&
    node.callee.kind === 'Var' &&
    HTML_TAGS.has((node.callee as { kind: 'Var'; name: string }).name)
  );
}

// ---------------------------------------------------------------------------
// Attribute string parsing
// ---------------------------------------------------------------------------

/**
 * Parse a space-separated "key=value key=value" attribute string into
 * `key="value"` pairs suitable for HTML.
 *
 * Within a value, use `+` to encode a literal space (e.g. `class=foo+bar`
 * → `class="foo bar"`). This lets the pool encoding stay space-delimited
 * while still allowing multi-word attribute values such as compound CSS
 * class lists or multi-word data attributes.
 */
export function parseAttrString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\s+/)
    .map(pair => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair; // bare attribute like "disabled"
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1).replace(/\+/g, ' ');
      return `${k}="${v}"`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Extract attribute string from first arg of an element call
// ---------------------------------------------------------------------------

/** Get the raw attribute string value from the first arg of an HTML App call. */
export function getAttrRaw(node: IonIRNode): string {
  if (node.kind === 'Literal' && node.value.kind === 'Str') {
    return node.value.value;
  }
  if (node.kind === 'Var') {
    // Pool-resolved var whose name IS the attribute string (e.g. "class=container")
    return node.name;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Shared TS expression emitter (JSX-emitter-agnostic)
// ---------------------------------------------------------------------------

export interface EmitTsExprOpts {
  /** If provided, HTML-element and component App nodes are routed through this. */
  jsxEmitter?: (n: IonIRNode) => string;
  /** ADT constructor field names, keyed by constructor name. */
  ctorFields?: Map<string, readonly string[]>;
  /** When set, platform builtin handlers add 'Platform' (and others) to this set for dynamic import-line construction. */
  rnImports?: Set<string>;
}

function isSimpleExpr(node: IonIRNode): boolean {
  return node.kind === 'Literal' || node.kind === 'Var';
}

function defaultImportLocalName(moduleName: string): string {
  const segments = moduleName.split(/[^A-Za-z0-9_$]+/).filter(s => s.length > 0);
  if (segments.length === 0) return '_default';
  const head = segments[0]!;
  const tail = segments.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
  const ident = head + tail;
  return /^[0-9]/.test(ident) ? `_${ident}` : ident;
}

export function containsAwait(node: IonIRNode | undefined | null): boolean {
  if (!node || typeof node !== 'object') return false;
  switch (node.kind) {
    case 'Await': return true;
    case 'Abs':
    case 'AsyncBlock':
      return false;
    case 'Let':
      return containsAwait(node.value) || containsAwait(node.body);
    case 'App':
      return containsAwait(node.callee) || node.args.some(containsAwait);
    case 'Case':
      return containsAwait(node.scrutinee) ||
        node.arms.some(a => containsAwait(a.guard) || containsAwait(a.body));
    case 'AdtMatch':
      return containsAwait(node.scrutinee) ||
        node.arms.some(a => containsAwait(a.body));
    case 'Accessor': return containsAwait(node.receiver);
    case 'ListLit': return node.elements.some(containsAwait);
    case 'MapLit':
      return node.entries.some(e => containsAwait(e.key) || containsAwait(e.value));
    case 'Constructor': return node.args.some(containsAwait);
    case 'OopNew': return node.args.some(containsAwait);
    case 'OopVirtualCall':
      return containsAwait(node.receiver) || node.args.some(containsAwait);
    case 'Perform': return node.args.some(containsAwait);
    case 'Handle':
      return containsAwait(node.body) ||
        (node.returnClause !== undefined && containsAwait(node.returnClause)) ||
        node.handlers.some(h => containsAwait(h.body));
    case 'Resume': return containsAwait(node.value);
    case 'Effect': return containsAwait(node.body);
    default: return false;
  }
}

function buildCtorBindings(
  pat: CasePattern,
  scrutinee: string,
  ctorFields: Map<string, readonly string[]> | undefined,
): Array<{ name: string; member: string }> {
  if (pat.kind !== 'Constructor') return [];
  const fieldNames = ctorFields?.get(pat.ctorName) ?? [];
  const result: Array<{ name: string; member: string }> = [];
  for (let fi = 0; fi < pat.fields.length; fi++) {
    const f = pat.fields[fi]!;
    if (f.kind !== 'Var') continue;
    result.push({ name: f.name, member: fieldNames[fi] ?? `_${fi}` });
  }
  return result;
}

function emitPatCond(pat: CasePattern, scrutinee: string): string {
  if (pat.kind === 'Wildcard' || pat.kind === 'Var') return 'true';
  if (pat.kind === 'Constructor') return `${scrutinee}._tag === "${pat.ctorName}"`;
  if (pat.kind === 'Tuple') return `${scrutinee}.length === ${pat.fields.length}`;
  const v = pat.value;
  if (v.kind === 'Bool') return `${scrutinee} === ${v.value}`;
  if (v.kind === 'Null') return `${scrutinee} === null`;
  if (v.kind === 'Str') return `${scrutinee} === ${JSON.stringify(v.value)}`;
  return `${scrutinee} === ${v.value}`;
}

export function emitTsExpr(node: IonIRNode, opts: EmitTsExprOpts): string {
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
        const name = (app.callee as VarNode).name;
        const binOps: Record<string, string> = {
          __add__: '+', __sub__: '-', __mul__: '*', __div__: '/', __mod__: '%',
          __eq__: '===', __ne__: '!==', __lt__: '<', __gt__: '>', __le__: '<=', __ge__: '>=',
          __and__: '&&', __or__: '||',
        };
        if (binOps[name] !== undefined && app.args.length === 2) {
          return `(${emitTsExpr(app.args[0]!, opts)} ${binOps[name]} ${emitTsExpr(app.args[1]!, opts)})`;
        }
        if (name === '__neg__' && app.args.length === 1) return `-${emitTsExpr(app.args[0]!, opts)}`;
        if (name === '__not__' && app.args.length === 1) return `!${emitTsExpr(app.args[0]!, opts)}`;
        if (name === '__obj__' && app.args.length % 2 === 0) {
          const parts: string[] = [];
          for (let i = 0; i < app.args.length; i += 2) {
            const k = app.args[i]!;
            const v = app.args[i + 1]!;
            const ks = k.kind === 'Literal' && (k as { value: { kind: string; value?: string } }).value.kind === 'Str'
              ? (k as { value: { value: string } }).value.value : emitTsExpr(k, opts);
            if (ks === '...') { parts.push(`...${emitTsExpr(v, opts)}`); continue; }
            const ko = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(ks) ? ks : JSON.stringify(ks);
            parts.push(`${ko}: ${emitTsExpr(v, opts)}`);
          }
          return `{ ${parts.join(', ')} }`;
        }
        if (name === '__index__' && app.args.length === 2) return `${emitTsExpr(app.args[0]!, opts)}[${emitTsExpr(app.args[1]!, opts)}]`;
        if (name === '__nullish__' && app.args.length === 2) return `(${emitTsExpr(app.args[0]!, opts)} ?? ${emitTsExpr(app.args[1]!, opts)})`;
        if (name === '__optchain__' && app.args.length === 2) {
          const m = app.args[1]!;
          if (m.kind === 'Literal' && (m as { value: { kind: string; value?: string } }).value.kind === 'Str') {
            return `${emitTsExpr(app.args[0]!, opts)}?.${(m as { value: { value: string } }).value.value}`;
          }
        }
        if (name === '__throw__' && app.args.length === 1) return `(() => { throw new Error(${emitTsExpr(app.args[0]!, opts)}); })()`;
        if (name === '__env__' && app.args.length === 1) return `process.env[${emitTsExpr(app.args[0]!, opts)}]`;
        if (name === '__set__' && app.args.length === 3) {
          const f = app.args[1]!;
          if (f.kind === 'Literal' && (f as { value: { kind: string; value?: string } }).value.kind === 'Str') {
            return `((${emitTsExpr(app.args[0]!, opts)}).${(f as { value: { value: string } }).value.value} = ${emitTsExpr(app.args[2]!, opts)})`;
          }
          return `((${emitTsExpr(app.args[0]!, opts)})[${emitTsExpr(f, opts)}] = ${emitTsExpr(app.args[2]!, opts)})`;
        }
        if (name === '__regex__' && (app.args.length === 1 || app.args.length === 2)) {
          return app.args.length === 1
            ? `new RegExp(${emitTsExpr(app.args[0]!, opts)})`
            : `new RegExp(${emitTsExpr(app.args[0]!, opts)}, ${emitTsExpr(app.args[1]!, opts)})`;
        }
        if (name === '__try__' && app.args.length === 2) {
          return `(async () => { try { return ${emitTsExpr(app.args[0]!, opts)}; } catch (e: any) { return ${emitTsExpr(app.args[1]!, opts)}; } })()`;
        }
        if (name === '__tryfin__' && app.args.length === 3) {
          return `(async () => { try { return ${emitTsExpr(app.args[0]!, opts)}; } catch (e: any) { return ${emitTsExpr(app.args[1]!, opts)}; } finally { ${emitTsExpr(app.args[2]!, opts)}; } })()`;
        }
        if (name === '__finally__' && app.args.length === 2) {
          return `(async () => { try { return ${emitTsExpr(app.args[0]!, opts)}; } finally { ${emitTsExpr(app.args[1]!, opts)}; } })()`;
        }
        if (name === '__do__' && app.args.length >= 1) {
          const last = app.args[app.args.length - 1]!;
          const allButLast = app.args.slice(0, -1);
          if (allButLast.length === 0) return emitTsExpr(last, opts);
          const stmts: string[] = [];
          for (const a of allButLast) {
            if (a.kind === 'Let') {
              let cur: IonIRNode = a;
              while (cur.kind === 'Let') {
                const lt = cur as LetNode;
                stmts.push(`const ${lt.name} = ${emitTsExpr(lt.value, opts)};`);
                cur = lt.body;
              }
              stmts.push(`${emitTsExpr(cur, opts)};`);
            } else {
              stmts.push(`${emitTsExpr(a, opts)};`);
            }
          }
          let retCode: string;
          if (last.kind === 'Let') {
            let cur: IonIRNode = last;
            while (cur.kind === 'Let') {
              const lt = cur as LetNode;
              stmts.push(`const ${lt.name} = ${emitTsExpr(lt.value, opts)};`);
              cur = lt.body;
            }
            retCode = emitTsExpr(cur, opts);
          } else {
            retCode = emitTsExpr(last, opts);
          }
          const isAsync = app.args.some(containsAwait);
          const arrow = isAsync ? 'async () =>' : '() =>';
          return `(${arrow} { ${stmts.join(' ')} return ${retCode}; })()`;
        }
        if (name === '__seq__' && app.args.length >= 1) return `(${app.args.map(a => emitTsExpr(a, opts)).join(', ')})`;
        if (name === '__spread__' && app.args.length === 1) return `...${emitTsExpr(app.args[0]!, opts)}`;
        if ((name === '__platform__' || name === '__platform_select__') && app.args.length >= 4 && app.args.length % 2 === 0) {
          const VALID_ARMS = new Set(['ios', 'android', 'default']);
          for (let i = 0; i < app.args.length; i += 2) {
            const armNameNode = app.args[i]!;
            const isStrLit = armNameNode.kind === 'Literal' &&
              (armNameNode as { value: { kind: string } }).value.kind === 'Str';
            const armName = isStrLit
              ? (armNameNode as { value: { value: string } }).value.value
              : null;
            if (!isStrLit || armName === null || !VALID_ARMS.has(armName)) {
              throw new Error(
                `${name}: arm name at position ${i} must be a string literal ('ios', 'android', or 'default') — at ${armNameNode.span.file}:${armNameNode.span.startLine}`,
              );
            }
          }
          opts.rnImports?.add('Platform');
          const pairs: Array<{ key: string; val: IonIRNode }> = [];
          for (let i = 0; i < app.args.length; i += 2) {
            pairs.push({
              key: (app.args[i] as { value: { value: string } }).value.value,
              val: app.args[i + 1]!,
            });
          }
          if (name === '__platform_select__') {
            const entries = pairs.map(p => `${p.key}: ${emitTsExpr(p.val, opts)}`).join(', ');
            return `Platform.select({ ${entries} })`;
          }
          // __platform__: ternary form when no default arm and all values are simple
          const hasDefault = pairs.some(p => p.key === 'default');
          const allSimple = pairs.every(p => isSimpleExpr(p.val));
          if (!hasDefault && allSimple) {
            const iosPair = pairs.find(p => p.key === 'ios')!;
            const androidPair = pairs.find(p => p.key === 'android')!;
            return `(Platform.OS === "ios" ? ${emitTsExpr(iosPair.val, opts)} : ${emitTsExpr(androidPair.val, opts)})`;
          }
          // IIFE form
          const entries = pairs.map(p => `${p.key}: () => ${emitTsExpr(p.val, opts)}`).join(', ');
          return `Platform.select({ ${entries} })()`;
        }
      }
      if (app.callee.kind === 'ForeignRef') {
        const fr = app.callee as ForeignRefNode;
        if (fr.sig.template === '' && fr.sig.params.length === 0) {
          const JS_GLOBALS = new Set(['console','Math','JSON','Object','Array','String','Number','Boolean','Date','RegExp','Promise','Symbol','Error','window','document','globalThis','process']);
          const calleeStr = (fr.target === 'js' && JS_GLOBALS.has(fr.module))
            ? `${fr.module}.${fr.symbol}`
            : (fr.target === 'js' && fr.symbol === 'default')
              ? defaultImportLocalName(fr.module)
              : fr.symbol;
          return `${calleeStr}(${app.args.map(a => emitTsExpr(a, opts)).join(', ')})`;
        }
      }
      if (isHtmlElement(app)) {
        if (opts.jsxEmitter) return opts.jsxEmitter(app).trim();
        // No JSX emitter — fall through to regular call form
      }
      if (app.callee.kind === 'Var' && /^[A-Z]/.test((app.callee as VarNode).name)) {
        if (opts.jsxEmitter) return opts.jsxEmitter(app).trim();
        // No JSX emitter — fall through to regular call form
      }
      const callee = emitTsExpr(app.callee, opts);
      const args = app.args.map(a => emitTsExpr(a, opts)).join(', ');
      return `${callee}(${args})`;
    }
    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      if (abs.body.kind === 'AsyncBlock') {
        return `async (${params}) => ${emitTsExpr((abs.body as AsyncBlockNode).body, opts)}`;
      }
      const innerBody = abs.body;
      if (opts.jsxEmitter) {
        if (isHtmlElement(innerBody)) {
          return `(${params}) => (${opts.jsxEmitter(innerBody).trim()})`;
        }
        if (innerBody.kind === 'App' && innerBody.callee.kind === 'Var' && /^[A-Z]/.test((innerBody.callee as VarNode).name)) {
          return `(${params}) => (${opts.jsxEmitter(innerBody).trim()})`;
        }
      }
      return `(${params}) => ${emitTsExpr(abs.body, opts)}`;
    }
    case 'Accessor': return `${emitTsExpr(node.receiver, opts)}.${node.member}`;
    case 'ListLit': return `[${node.elements.map(e => emitTsExpr(e, opts)).join(', ')}]`;
    case 'MapLit': {
      const entries = node.entries.map(e => `[${emitTsExpr(e.key, opts)}, ${emitTsExpr(e.value, opts)}]`).join(', ');
      return `new Map([${entries}])`;
    }
    case 'Let': {
      const stmts: string[] = [];
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') {
        const lt = cur as LetNode;
        stmts.push(`const ${lt.name} = ${emitTsExpr(lt.value, opts)};`);
        cur = lt.body;
      }
      const isAsync = containsAwait(node);
      const arrow = isAsync ? 'async () =>' : '() =>';
      return `(${arrow} { ${stmts.join(' ')} return ${emitTsExpr(cur, opts)}; })()`;
    }
    case 'Case': {
      const c = node as CaseNode;
      if (c.arms.length === 0) return 'undefined';
      if (c.arms.length === 1 && c.arms[0]!.pattern.kind === 'Wildcard') {
        return emitTsExpr(c.arms[0]!.body, opts);
      }
      if (
        c.arms.length === 2 &&
        c.arms[0]!.pattern.kind === 'Literal' &&
        c.arms[0]!.pattern.value.kind === 'Bool' &&
        c.arms[0]!.pattern.value.value === true &&
        c.arms[1]!.pattern.kind === 'Wildcard'
      ) {
        return `(${emitTsExpr(c.scrutinee, opts)} ? ${emitTsExpr(c.arms[0]!.body, opts)} : ${emitTsExpr(c.arms[1]!.body, opts)})`;
      }
      const scrutinee = emitTsExpr(c.scrutinee, opts);
      const parts: string[] = [];
      for (let i = 0; i < c.arms.length; i++) {
        const arm = c.arms[i]!;
        const isLast = i === c.arms.length - 1;
        const pat = arm.pattern;
        if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
          parts.push(emitTsExpr(arm.body, opts));
        } else {
          const cond = emitPatCond(pat, scrutinee);
          const bindings = buildCtorBindings(pat, scrutinee, opts.ctorFields);
          if (bindings.length > 0) {
            const decls = bindings.map(b => `const ${b.name} = ${scrutinee}.${b.member};`).join(' ');
            const armAsync = containsAwait(arm.body);
            const arrow = armAsync ? 'async () =>' : '() =>';
            parts.push(`${cond} ? (${arrow} { ${decls} return ${emitTsExpr(arm.body, opts)}; })()`);
          } else {
            parts.push(`${cond} ? ${emitTsExpr(arm.body, opts)}`);
          }
        }
      }
      if (parts.length === 1) return parts[0]!;
      const last = parts.pop()!;
      return parts.join(' : ') + ' : ' + last;
    }
    case 'Constructor': {
      const args = node.args.map(a => emitTsExpr(a, opts)).join(', ');
      return `{ _tag: '${node.ctorName}' as const${args ? `, _args: [${args}] as const` : ''} }`;
    }
    case 'ModuleRef': return node.modulePath.join('.');
    case 'ForeignRef': return node.target;
    case 'Effect': return emitTsExpr(node.body, opts);
    case 'OopNew': {
      const args = node.args.map(a => emitTsExpr(a, opts)).join(', ');
      return `new _ctor_${node.ctorSymbolId}(${args})`;
    }
    case 'OopVirtualCall': {
      const receiver = emitTsExpr(node.receiver, opts);
      const args = node.args.map(a => emitTsExpr(a, opts)).join(', ');
      return `${receiver}.${node.method}(${args})`;
    }
    case 'OopThis': return 'this';
    case 'AsyncBlock': {
      const body = (node as AsyncBlockNode).body;
      if (body.kind === 'Let') {
        const stmts: string[] = [];
        let cur: IonIRNode = body;
        while (cur.kind === 'Let') {
          const lt = cur as LetNode;
          stmts.push(`const ${lt.name} = ${emitTsExpr(lt.value, opts)};`);
          cur = lt.body;
        }
        return `(async () => { ${stmts.join(' ')} return ${emitTsExpr(cur, opts)}; })()`;
      }
      return `(async () => ${emitTsExpr(body, opts)})()`;
    }
    case 'Await': return `await ${emitTsExpr(node.expr, opts)}`;
    case 'AdtMatch': {
      const adtMatch = node as AdtMatchNode;
      const subject = emitTsExpr(adtMatch.scrutinee, opts);
      const arms = adtMatch.arms.map(arm => {
        const bindings = arm.bindings.map((b, i) => `const ${b.name} = _v._args[${i}];`).join(' ');
        return `if (_v._tag === '${arm.tag}') { ${bindings} return (${emitTsExpr(arm.body, opts)}); }`;
      }).join(' else ');
      return `((_v: any) => { ${arms} return undefined; })(${subject})`;
    }
    case 'Perform': return `/* perform ${node.operation} */(${node.args.map(a => emitTsExpr(a, opts)).join(', ')})`;
    case 'Handle': return emitTsExpr(node.body, opts);
    case 'Resume': return emitTsExpr(node.value, opts);
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
