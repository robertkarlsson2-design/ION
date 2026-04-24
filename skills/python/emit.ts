import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  ForeignRefNode,
  AdtDeclNode,
  AdtMatchNode,
  VarNode,
} from '../../src/ir/nodes.js';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';

// ---------------------------------------------------------------------------
// Builtin operator maps
// ---------------------------------------------------------------------------

const BUILTIN_BINARY_OPS: Record<string, string> = {
  __add__: '+', __sub__: '-', __mul__: '*', __div__: '/', __mod__: '%',
  __eq__: '==', __ne__: '!=', __lt__: '<', __gt__: '>', __le__: '<=', __ge__: '>=',
  __and__: 'and', __or__: 'or',
};
const BUILTIN_UNARY_OPS: Record<string, string> = { __neg__: '-', __not__: 'not ' };

// ---------------------------------------------------------------------------
// Python prelude templates — same $1/$2 positional convention as JS
// ---------------------------------------------------------------------------

const PYTHON_PRELUDE: Record<string, string> = {
  map: 'list(map($2, $1))',
  filter: 'list(filter($2, $1))',
  fold: '__import__("functools").reduce($3, $1, $2)',
  length: 'len($1)',
  range: 'list(range($1, $2))',
  concat: '$1 + $2',
  contains: '$2 in $1',
  isEmpty: 'len($1) == 0',
  reverse: 'list(reversed($1))',
  slice: '$1[$2:$3]',
  joinWith: '$2.join($1)',
  flatMap: '[__x for __xs in map($2, $1) for __x in __xs]',
  any: 'any(map($2, $1))',
  all: 'all(map($2, $1))',
  abs: 'abs($1)',
  floor: 'int($1)',
  ceil: '__import__("math").ceil($1)',
  round: 'round($1)',
  sqrt: '__import__("math").sqrt($1)',
  min: 'min($1, $2)',
  max: 'max($1, $2)',
  pow: '$1 ** $2',
  toString: 'str($1)',
  split: '$1.split($2)',
  trim: '$1.strip()',
  toUpper: '$1.upper()',
  toLower: '$1.lower()',
  startsWith: '$1.startswith($2)',
  endsWith: '$1.endswith($2)',
  print: 'print($1)',
  printInt: 'print($1)',
  printFloat: 'print($1)',
  sum: 'sum($1)',
  product: '__import__("math").prod($1)',
  head: '$1[0]',
  last: '$1[-1]',
  tail: '$1[1:]',
  flatten: '[__x for __xs in $1 for __x in __xs]',
  sort: 'sorted($1)',
  sortStrs: 'sorted($1)',
  sortBy: 'sorted($1, key=$2)',
  unique: 'list(dict.fromkeys($1))',
  zip: 'list(zip($1, $2))',
  indexOf: '$1.index($2)',
  find: 'next(filter($2, $1), None)',
  findIndex: 'next((i for i, x in enumerate($1) if $2(x)), -1)',
  strContains: '$2 in $1',
  repeat: '$1 * $2',
  replace: '$1.replace($2, $3)',
  strIndexOf: '$1.find($2)',
  toFloat: 'float($1)',
  toInt: 'int($1)',
  strLen: 'len($1)',
};

const PRELUDE_NAMES = new Set(Object.keys(PYTHON_PRELUDE));

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

function needsParens(node: IonIRNode): boolean {
  if (node.kind !== 'App') return false;
  const app = node as AppNode;
  return app.callee.kind === 'Var' && (
    BUILTIN_BINARY_OPS[(app.callee as VarNode).name] !== undefined ||
    BUILTIN_UNARY_OPS[(app.callee as VarNode).name] !== undefined
  );
}

function emitPyExpr(node: IonIRNode): string {
  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Bool') return v.value ? 'True' : 'False';
      if (v.kind === 'Null') return 'None';
      if (v.kind === 'Str') return JSON.stringify(v.value);
      return String(v.value);
    }

    case 'Var': return node.name;

    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const bop = BUILTIN_BINARY_OPS[(app.callee as VarNode).name];
        if (bop !== undefined && app.args.length === 2) {
          const l = needsParens(app.args[0]) ? `(${emitPyExpr(app.args[0])})` : emitPyExpr(app.args[0]);
          const r = needsParens(app.args[1]) ? `(${emitPyExpr(app.args[1])})` : emitPyExpr(app.args[1]);
          return `${l} ${bop} ${r}`;
        }
        const uop = BUILTIN_UNARY_OPS[(app.callee as VarNode).name];
        if (uop !== undefined && app.args.length === 1) {
          return `${uop}${emitPyExpr(app.args[0])}`;
        }
        // Prelude function call — expand using Python template
        const calleeName = (app.callee as VarNode).name;
        const pyTemplate = PYTHON_PRELUDE[calleeName];
        if (pyTemplate !== undefined) {
          const argStrs = app.args.map(a => wrapEmitted(emitPyExpr(a)));
          return expandTemplate(pyTemplate, argStrs);
        }
      }
      return `${emitPyExpr(app.callee)}(${app.args.map(emitPyExpr).join(', ')})`;
    }

    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      // Check if body has let bindings — use a nested lambda trick for simple cases
      const { stmts, ret } = flattenLets(abs.body);
      if (stmts.length > 0) {
        // Can't use lambda with statements; wrap as nested call chain
        return emitPyLetChain(stmts, ret, params);
      }
      return `lambda ${params}: ${ret}`;
    }

    case 'Let': {
      const { stmts, ret } = flattenLets(node);
      if (stmts.length === 0) return ret;
      // Expression-level let — use nested lambda chain
      return emitPyLetChain(stmts, ret, '');
    }

    case 'Case': return emitPyCase(node as CaseNode);

    case 'ForeignRef': {
      const fr = node as ForeignRefNode;
      const arity = fr.sig.params.length;
      if (arity === 0) return expandTemplate(PYTHON_PRELUDE[fr.symbol] ?? fr.sig.template, []);
      const pnames = fr.sig.params.map((_, i) => fr.sig.paramNames[i] ?? `_p${i + 1}`);
      const argStrs = pnames.map(p => wrapEmitted(p));
      const template = PYTHON_PRELUDE[fr.symbol] ?? fr.sig.template;
      const body = expandTemplate(template, argStrs);
      return `lambda ${pnames.join(', ')}: ${body}`;
    }

    case 'Accessor': return `${emitPyExpr(node.receiver)}.${node.member}`;
    case 'ListLit': return `[${node.elements.map(emitPyExpr).join(', ')}]`;
    case 'MapLit': return `{${node.entries.map(e => `${emitPyExpr(e.key)}: ${emitPyExpr(e.value)}`).join(', ')}}`;
    case 'Constructor': return `${node.ctorName}(${node.args.map(emitPyExpr).join(', ')})`;
    case 'AdtMatch': return emitPyAdtMatch(node as AdtMatchNode);
    case 'ModuleRef': return node.modulePath.join('.');
    case 'OopNew': return `${node.type.kind === 'User' ? node.type.name : '_ctor'}(${node.args.map(emitPyExpr).join(', ')})`;
    case 'OopVirtualCall': return `${emitPyExpr(node.receiver)}.${node.method}(${node.args.map(emitPyExpr).join(', ')})`;
    case 'OopThis': return 'self';
    case 'AsyncBlock': return `(lambda: ${emitPyExpr(node.body)})`;
    case 'Await': return emitPyExpr(node.expr);
    case 'Perform': return `_perform("${node.operation}", [${node.args.map(emitPyExpr).join(', ')}])`;
    case 'Handle': return emitPyExpr(node.body);
    case 'Resume': return emitPyExpr(node.value);
    case 'Effect': return emitPyExpr(node.body);
    case 'OopClass':
    case 'OopInterface':
    case 'AdtDecl':
    case 'EffectDecl':
      return 'None';
  }
}

/** Flatten consecutive Let nodes into (stmts, finalExpr). */
function flattenLets(node: IonIRNode): { stmts: Array<{ name: string; val: string }>; ret: string } {
  const stmts: Array<{ name: string; val: string }> = [];
  let cur = node;
  while (cur.kind === 'Let') {
    const lt = cur as LetNode;
    stmts.push({ name: lt.name, val: emitPyExpr(lt.value) });
    cur = lt.body;
  }
  return { stmts, ret: emitPyExpr(cur) };
}

/** Emit expression-level let bindings as nested lambda applications: (lambda name: body)(value) */
function emitPyLetChain(
  stmts: Array<{ name: string; val: string }>,
  ret: string,
  outerParams: string,
): string {
  // Build from inside out
  let expr = ret;
  for (let i = stmts.length - 1; i >= 0; i--) {
    const { name, val } = stmts[i];
    expr = `(lambda ${name}: ${expr})(${val})`;
  }
  if (outerParams !== '') {
    return `lambda ${outerParams}: ${expr}`;
  }
  return expr;
}

function emitPyCase(node: CaseNode): string {
  if (node.arms.length === 0) return 'None';
  if (node.arms.length === 1 && node.arms[0].pattern.kind === 'Wildcard') {
    return emitPyExpr(node.arms[0].body);
  }
  // if-else shortcut
  if (
    node.arms.length === 2 &&
    node.arms[0].pattern.kind === 'Literal' &&
    node.arms[0].pattern.value.kind === 'Bool' &&
    node.arms[0].pattern.value.value === true &&
    node.arms[0].guard === undefined &&
    node.arms[1].pattern.kind === 'Wildcard'
  ) {
    const cond = emitPyExpr(node.scrutinee);
    const then = emitPyExpr(node.arms[0].body);
    const else_ = emitPyExpr(node.arms[1].body);
    return `${then} if ${cond} else ${else_}`;
  }
  const scrutinee = emitPyExpr(node.scrutinee);
  const parts: string[] = [];
  for (let i = 0; i < node.arms.length; i++) {
    const arm = node.arms[i];
    const isLast = i === node.arms.length - 1;
    const pat = arm.pattern;
    if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
      parts.push(emitPyExpr(arm.body));
    } else {
      const cond = emitPyPatCond(pat, scrutinee);
      parts.push(`(${emitPyExpr(arm.body)}) if (${cond}) else`);
    }
  }
  return parts.join(' ');
}

function emitPyPatCond(pat: import('../../src/ir/nodes.js').CasePattern, scrutinee: string): string {
  if (pat.kind === 'Wildcard' || pat.kind === 'Var') return 'True';
  if (pat.kind === 'Constructor') return `${scrutinee}["_tag"] == "${pat.ctorName}"`;
  const v = pat.value;
  if (v.kind === 'Bool') return `${scrutinee} == ${v.value ? 'True' : 'False'}`;
  if (v.kind === 'Null') return `${scrutinee} is None`;
  if (v.kind === 'Str') return `${scrutinee} == ${JSON.stringify(v.value)}`;
  return `${scrutinee} == ${v.value}`;
}

function emitPyAdtMatch(node: AdtMatchNode): string {
  const s = emitPyExpr(node.scrutinee);
  const parts = node.arms.map(arm => {
    const bindings = arm.bindings.map(b => `${b.name} = _s["${b.name}"]`).join('; ');
    const body = emitPyExpr(arm.body);
    const guard = `_s["_tag"] == "${arm.tag}"`;
    return `(lambda _s: (exec('${bindings}') or ${body}) if ${guard} else None)(_s)`;
  });
  return `(lambda _s: ${parts.join(' or ')})(${s})`;
}

// ---------------------------------------------------------------------------
// Statement-level emit for function bodies
// ---------------------------------------------------------------------------

function emitPyFnBody(node: IonIRNode, indent: string): string {
  const { stmts, ret } = flattenLets(node);
  const lines: string[] = [];
  for (const s of stmts) {
    lines.push(`${indent}${s.name} = ${s.val}`);
  }
  lines.push(`${indent}return ${ret}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Top-level module emit
// ---------------------------------------------------------------------------

export function emitPython(irModule: IonIRModule): string {
  const module = shakePreludeDecls(irModule);
  const parts: string[] = [];

  for (const d of module.decls) {
    if (d.kind !== 'Let') continue;
    const lt = d as LetNode;
    if (PRELUDE_NAMES.has(lt.name)) continue;

    if (lt.value.kind === 'Abs') {
      const abs = lt.value as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      const body = emitPyFnBody(abs.body, '    ');
      parts.push(`def ${lt.name}(${params}):\n${body}`);
    } else {
      parts.push(`${lt.name} = ${emitPyExpr(lt.value)}`);
    }
  }

  // ADT constructors as dict factories
  for (const d of module.data) {
    const adt = d as AdtDeclNode;
    parts.push(`# ADT: ${adt.name}`);
    for (const v of adt.variants) {
      if (v.fields.length === 0) {
        parts.push(`${v.tag} = {"_tag": "${v.tag}"}`);
      } else {
        const ps = v.fields.map(f => f.name).join(', ');
        const fs = v.fields.map(f => `"${f.name}": ${f.name}`).join(', ');
        parts.push(`def ${v.tag}(${ps}):\n    return {"_tag": "${v.tag}", ${fs}}`);
      }
    }
  }

  return parts.join('\n\n') + '\n';
}
