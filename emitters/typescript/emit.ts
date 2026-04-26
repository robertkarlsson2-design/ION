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
  OopClassNode,
  OopInterfaceNode,
  EffectDeclNode,
  HandleNode,
  PerformNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';

// ---------------------------------------------------------------------------
// IonType → TypeScript type string
// ---------------------------------------------------------------------------

export function ionTypeToTs(t: IonType): string {
  switch (t.kind) {
    case 'Int': return 'number';
    case 'Float': return 'number';
    case 'Bool': return 'boolean';
    case 'Str': return 'string';
    case 'Unit': return 'void';
    case 'Null': return 'null';
    case 'List': return `${ionTypeToTs(t.elem)}[]`;
    case 'Map': return `Map<${ionTypeToTs(t.key)}, ${ionTypeToTs(t.value)}>`;
    case 'Option': return `${ionTypeToTs(t.inner)} | null`;
    case 'Result': return `{ ok: ${ionTypeToTs(t.ok)} } | { err: ${ionTypeToTs(t.err)} }`;
    case 'Fn': {
      const params = t.params.map((p, i) => `_${i}: ${ionTypeToTs(p)}`).join(', ');
      return `(${params}) => ${ionTypeToTs(t.ret)}`;
    }
    case 'User': {
      if (t.args.length === 0) return t.name;
      // Map well-known generic names to idiomatic TypeScript forms
      if (t.name === 'Array' && t.args.length === 1) return `${ionTypeToTs(t.args[0])}[]`;
      if (t.name === 'Map' && t.args.length === 2) return `Map<${ionTypeToTs(t.args[0])}, ${ionTypeToTs(t.args[1])}>`;
      if (t.name === 'Set' && t.args.length === 1) return `Set<${ionTypeToTs(t.args[0])}>`;
      if (t.name === 'Promise' && t.args.length === 1) return `Promise<${ionTypeToTs(t.args[0])}>`;
      return `${t.name}<${t.args.map(ionTypeToTs).join(', ')}>`;
    }
    case 'TypeVar': return 'unknown';
    case 'Never': return 'never';
    case 'Tuple': return `[${t.elements.map(ionTypeToTs).join(', ')}]`;
  }
}

// ---------------------------------------------------------------------------
// Builtin operator maps
// ---------------------------------------------------------------------------

const BUILTIN_BINARY_OPS: Record<string, string> = {
  __add__: '+', __sub__: '-', __mul__: '*', __div__: '/', __mod__: '%',
  __eq__: '===', __ne__: '!==', __lt__: '<', __gt__: '>', __le__: '<=', __ge__: '>=',
  __and__: '&&', __or__: '||',
};
const BUILTIN_UNARY_OPS: Record<string, string> = { __neg__: '-', __not__: '!' };

export const PRELUDE_NAMES = new Set([
  'map', 'filter', 'fold', 'length', 'range', 'concat', 'contains', 'isEmpty',
  'reverse', 'slice', 'joinWith', 'flatMap', 'any', 'all', 'abs', 'floor', 'ceil',
  'round', 'sqrt', 'min', 'max', 'pow', 'toString', 'split', 'trim', 'toUpper',
  'toLower', 'startsWith', 'endsWith', 'print', 'printInt', 'printFloat', 'sum',
  'product', 'head', 'last', 'tail', 'flatten', 'sort', 'sortStrs', 'sortBy',
  'unique', 'zip', 'indexOf', 'find', 'findIndex', 'strContains', 'repeat',
  'replace', 'strIndexOf', 'toFloat', 'toInt', 'strLen',
]);

// ---------------------------------------------------------------------------
// TypeScript prelude (replaces the ForeignRef wrappers with typed declarations)
// ---------------------------------------------------------------------------

const TS_PRELUDE_DECLS: Record<string, string> = {
  map: 'const map = <A, B>(list: A[], f: (a: A) => B): B[] => list.map(f);',
  filter: 'const filter = <A>(list: A[], pred: (a: A) => boolean): A[] => list.filter(pred);',
  fold: 'const fold = <A, B>(list: A[], init: B, f: (acc: B, x: A) => B): B => list.reduce(f, init);',
  length: 'const length = <A>(list: A[]): number => list.length;',
  range: 'const range = (start: number, end: number): number[] => Array.from(Array(end - start), (_, i) => start + i);',
  concat: 'const concat = <A>(a: A[], b: A[]): A[] => [...a, ...b];',
  contains: 'const contains = <A>(list: A[], item: A): boolean => list.includes(item);',
  isEmpty: 'const isEmpty = <A>(list: A[]): boolean => list.length === 0;',
  reverse: 'const reverse = <A>(list: A[]): A[] => [...list].reverse();',
  slice: 'const slice = <A>(list: A[], from: number, to: number): A[] => list.slice(from, to);',
  joinWith: 'const joinWith = (list: string[], sep: string): string => list.join(sep);',
  flatMap: 'const flatMap = <A, B>(list: A[], f: (a: A) => B[]): B[] => list.flatMap(f);',
  any: 'const any = <A>(list: A[], pred: (a: A) => boolean): boolean => list.some(pred);',
  all: 'const all = <A>(list: A[], pred: (a: A) => boolean): boolean => list.every(pred);',
  abs: 'const abs = (n: number): number => Math.abs(n);',
  floor: 'const floor = (n: number): number => Math.floor(n);',
  ceil: 'const ceil = (n: number): number => Math.ceil(n);',
  round: 'const round = (n: number): number => Math.round(n);',
  sqrt: 'const sqrt = (n: number): number => Math.sqrt(n);',
  min: 'const min = (a: number, b: number): number => Math.min(a, b);',
  max: 'const max = (a: number, b: number): number => Math.max(a, b);',
  pow: 'const pow = (base: number, exp: number): number => Math.pow(base, exp);',
  toString: 'const toString = (n: number): string => String(n);',
  split: 'const split = (s: string, sep: string): string[] => s.split(sep);',
  trim: 'const trim = (s: string): string => s.trim();',
  toUpper: 'const toUpper = (s: string): string => s.toUpperCase();',
  toLower: 'const toLower = (s: string): string => s.toLowerCase();',
  startsWith: 'const startsWith = (s: string, prefix: string): boolean => s.startsWith(prefix);',
  endsWith: 'const endsWith = (s: string, suffix: string): boolean => s.endsWith(suffix);',
  print: 'const print = (msg: string): void => { console.log(msg); };',
  printInt: 'const printInt = (n: number): void => { console.log(n); };',
  printFloat: 'const printFloat = (n: number): void => { console.log(n); };',
  sum: 'const sum = (list: number[]): number => list.reduce((a, b) => a + b, 0);',
  product: 'const product = (list: number[]): number => list.reduce((a, b) => a * b, 1);',
  head: 'const head = <A>(list: A[]): A => list[0];',
  last: 'const last = <A>(list: A[]): A => list[list.length - 1];',
  tail: 'const tail = <A>(list: A[]): A[] => list.slice(1);',
  flatten: 'const flatten = <A>(list: A[][]): A[] => list.flat();',
  sort: 'const sort = (list: number[]): number[] => [...list].sort((a, b) => a - b);',
  sortStrs: 'const sortStrs = (list: string[]): string[] => [...list].sort();',
  sortBy: 'const sortBy = <A>(list: A[], cmp: (a: A, b: A) => number): A[] => [...list].sort(cmp);',
  unique: 'const unique = <A>(list: A[]): A[] => [...new Set(list)];',
  zip: 'const zip = <A, B>(a: A[], b: B[]): [A, B][] => a.slice(0, Math.min(a.length, b.length)).map((x, i) => [x, b[i]]);',
  indexOf: 'const indexOf = <A>(list: A[], item: A): number => list.indexOf(item);',
  find: 'const find = <A>(list: A[], pred: (a: A) => boolean): A | undefined => list.find(pred);',
  findIndex: 'const findIndex = <A>(list: A[], pred: (a: A) => boolean): number => list.findIndex(pred);',
  strContains: 'const strContains = (s: string, sub: string): boolean => s.includes(sub);',
  repeat: 'const repeat = (s: string, n: number): string => s.repeat(n);',
  replace: 'const replace = (s: string, from: string, to: string): string => s.replace(from, to);',
  strIndexOf: 'const strIndexOf = (s: string, sub: string): number => s.indexOf(sub);',
  toFloat: 'const toFloat = (s: string): number => parseFloat(s);',
  toInt: 'const toInt = (s: string): number => parseInt(s, 10);',
  strLen: 'const strLen = (s: string): number => s.length;',
};

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

function needsParens(node: IonIRNode): boolean {
  return node.kind === 'App' && node.callee.kind === 'Var' &&
    (BUILTIN_BINARY_OPS[(node.callee as VarNode).name] !== undefined ||
     BUILTIN_UNARY_OPS[(node.callee as VarNode).name] !== undefined);
}

// ---------------------------------------------------------------------------
// OopClass emitter — produces a full TypeScript class declaration string
// ---------------------------------------------------------------------------

function emitTsAnnotations(annotations: readonly import('../../src/ir/nodes.js').OopAnnotation[] | undefined): string[] {
  if (!annotations || annotations.length === 0) return [];
  return annotations.map(a =>
    '@' + a.name + (a.args.length > 0 ? '(' + a.args.join(', ') + ')' : '')
  );
}

function emitTsClass(node: OopClassNode): string {
  const lines: string[] = [];

  // Class-level annotations
  for (const ann of emitTsAnnotations(node.annotations)) {
    lines.push(ann);
  }

  // Class header with optional type params, extends, implements
  const typeParamsStr = (node.typeParams ?? []).length > 0
    ? '<' + node.typeParams!.join(', ') + '>'
    : '';
  const superStr = node.superClass !== undefined ? ` extends ${String(node.superClass)}` : '';
  const implStr = node.interfaces.length > 0
    ? ` implements ${node.interfaces.map(String).join(', ')}`
    : '';
  lines.push(`class ${node.name}${typeParamsStr}${superStr}${implStr} {`);

  // Field declarations with visibility / static / readonly modifiers
  for (const f of node.fields) {
    const ft = ionTypeToTs(f.type);
    const visPrefix = f.visibility === 'private' ? 'private '
      : f.visibility === 'protected' ? 'protected '
      : '';
    const staticPrefix = f.isStatic ? 'static ' : '';
    const readonlyPrefix = f.isReadonly ? 'readonly ' : '';
    lines.push(`  ${visPrefix}${staticPrefix}${readonlyPrefix}${f.name}: ${ft};`);
  }

  // Explicit constructors (from node.constructors)
  if (node.constructors && node.constructors.length > 0) {
    for (const ctor of node.constructors) {
      const visPrefix = ctor.visibility === 'private' ? 'private '
        : ctor.visibility === 'protected' ? 'protected '
        : '';
      const ctorParams = ctor.params
        .map(p => `${p.name}: ${ionTypeToTs(p.type)}`)
        .join(', ');
      if (ctor.body !== undefined) {
        const body = emitTsLetBlock(ctor.body);
        if (body.stmts.length > 0) {
          const stmts = body.stmts.map(s => `    ${s}`).join('\n');
          lines.push(`  ${visPrefix}constructor(${ctorParams}) {`);
          lines.push(stmts);
          lines.push(`    return ${body.ret};`);
          lines.push('  }');
        } else {
          lines.push(`  ${visPrefix}constructor(${ctorParams}) {`);
          lines.push(`    return ${body.ret};`);
          lines.push('  }');
        }
      } else {
        lines.push(`  ${visPrefix}constructor(${ctorParams}) {}`);
      }
    }
  } else if (node.fields.length > 0) {
    // Auto-generate constructor from fields if no explicit constructors are provided
    const ctorParams = node.fields
      .map(f => `${f.name}: ${ionTypeToTs(f.type)}`)
      .join(', ');
    const assignments = node.fields.map(f => `    this.${f.name} = ${f.name};`).join('\n');
    lines.push(`  constructor(${ctorParams}) {`);
    lines.push(assignments);
    lines.push('  }');
  }

  // Methods
  for (const m of node.methods) {
    // Method-level annotations
    for (const ann of emitTsAnnotations(m.annotations)) {
      lines.push(`  ${ann}`);
    }

    const params = m.params.map(p => {
      const t = ionTypeToTs(p.type);
      return t === 'unknown' ? p.name : `${p.name}: ${t}`;
    }).join(', ');
    const retT = ionTypeToTs(m.retType);
    const retAnnotation = retT !== 'unknown' ? `: ${retT}` : '';
    const visPrefix = m.visibility === 'private' ? 'private '
      : m.visibility === 'protected' ? 'protected '
      : '';
    const staticPrefix = m.isStatic ? 'static ' : '';
    const abstractPrefix = m.isAbstract ? 'abstract ' : '';
    const accessorPrefix = m.accessorKind === 'get' ? 'get '
      : m.accessorKind === 'set' ? 'set '
      : '';
    const methodHead = `  ${visPrefix}${staticPrefix}${abstractPrefix}${accessorPrefix}${m.name}(${params})${retAnnotation}`;

    if (m.isAbstract || m.body === undefined) {
      // Abstract method — declaration only
      lines.push(`${methodHead};`);
    } else {
      const body = emitTsLetBlock(m.body);
      if (body.stmts.length > 0) {
        const stmts = body.stmts.map(s => `    ${s}`).join('\n');
        lines.push(`${methodHead} {`);
        lines.push(stmts);
        lines.push(`    return ${body.ret};`);
        lines.push('  }');
      } else {
        lines.push(`${methodHead} {`);
        lines.push(`    return ${body.ret};`);
        lines.push('  }');
      }
    }
  }

  lines.push('}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// OopInterface emitter — produces a TypeScript interface declaration string
// ---------------------------------------------------------------------------

function emitTsInterface(node: OopInterfaceNode): string {
  const lines: string[] = [];

  // Interface-level annotations
  for (const ann of emitTsAnnotations(node.annotations)) {
    lines.push(ann);
  }

  // Interface header with optional type params
  const typeParamsStr = (node.typeParams ?? []).length > 0
    ? '<' + node.typeParams!.join(', ') + '>'
    : '';
  lines.push(`interface ${node.name}${typeParamsStr} {`);

  for (const m of node.members) {
    const mt = ionTypeToTs(m.type);
    // Distinguish method signatures (Fn type) from property members
    if (m.type.kind === 'Fn') {
      const fnParams = m.type.params
        .map((p, i) => `_${i}: ${ionTypeToTs(p)}`)
        .join(', ');
      const retT = ionTypeToTs(m.type.ret);
      lines.push(`  ${m.name}(${fnParams}): ${retT};`);
    } else {
      lines.push(`  ${m.name}: ${mt};`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// EffectDecl emitter — emits a type alias + structural type (TS has no effects)
// ---------------------------------------------------------------------------

function emitTsEffectDecl(node: EffectDeclNode): string {
  const lines: string[] = [];
  lines.push(`// Effect: ${node.name}`);
  const opSigs = node.operations.map(op => {
    const params = op.params.map(p => {
      const t = ionTypeToTs(p.type);
      return t === 'unknown' ? p.name : `${p.name}: ${t}`;
    }).join(', ');
    const retT = ionTypeToTs(op.retType);
    return `${op.name}(${params}): ${retT}`;
  }).join('; ');
  lines.push(`type ${node.name}_Effect = { ${opSigs} };`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Handle emitter — wraps body in IIFE try/catch using EffectPerform class
// ---------------------------------------------------------------------------

function emitTsHandle(node: HandleNode): string {
  const bodyExpr = emitTsExpr(node.body);
  const returnExpr = node.returnClause !== undefined
    ? emitTsExpr(node.returnClause)
    : '_result';

  const handlerClauses = node.handlers.map(h => {
    const paramBindings = h.params.map((p, i) =>
      `const ${p.name} = _e.args[${i}] as ${ionTypeToTs(p.type)};`
    ).join(' ');
    const handlerBody = emitTsExpr(h.body);
    return `    if (_e instanceof EffectPerform && _e.op === ${JSON.stringify(h.operation)}) { ${paramBindings} return ${handlerBody}; }`;
  }).join('\n');

  const hasReturnClause = node.returnClause !== undefined;
  if (hasReturnClause) {
    return [
      `(() => {`,
      `  class EffectPerform { constructor(public op: string, public args: unknown[]) {} }`,
      `  try { const _result = ${bodyExpr}; return ${returnExpr}; }`,
      `  catch (_e) {`,
      handlerClauses,
      `    throw _e;`,
      `  }`,
      `})()`,
    ].join('\n');
  }
  return [
    `(() => {`,
    `  class EffectPerform { constructor(public op: string, public args: unknown[]) {} }`,
    `  try { return ${bodyExpr}; }`,
    `  catch (_e) {`,
    handlerClauses,
    `    throw _e;`,
    `  }`,
    `})()`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// ADT discriminated union type emitter
// ---------------------------------------------------------------------------

function emitTsAdtType(node: AdtDeclNode): string {
  const parts: string[] = [];
  parts.push(`// ADT: ${node.name}`);

  // Discriminated union type alias
  const unionMembers = node.variants.map(v => {
    if (v.fields.length === 0) {
      return `{ _tag: "${v.tag}" }`;
    }
    const fieldTypes = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join('; ');
    return `{ _tag: "${v.tag}"; ${fieldTypes} }`;
  }).join(' | ');
  parts.push(`type ${node.name} = ${unionMembers};`);

  // Constructor functions
  for (const v of node.variants) {
    if (v.fields.length === 0) {
      parts.push(`const ${v.tag} = { _tag: "${v.tag}" } as const;`);
    } else {
      const ps = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join(', ');
      const fs = v.fields.map(f => f.name).join(', ');
      parts.push(`const ${v.tag} = (${ps}): ${node.name} => ({ _tag: "${v.tag}" as const, ${fs} });`);
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main expression emitter
// ---------------------------------------------------------------------------

function emitTsExpr(node: IonIRNode): string {
  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Bool') return v.value ? 'true' : 'false';
      if (v.kind === 'Null') return 'null';
      if (v.kind === 'Str') return JSON.stringify(v.value);
      return String(v.value);
    }
    case 'Var': return node.name;

    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const bop = BUILTIN_BINARY_OPS[(app.callee as VarNode).name];
        if (bop !== undefined && app.args.length === 2) {
          const l = needsParens(app.args[0]) ? `(${emitTsExpr(app.args[0])})` : emitTsExpr(app.args[0]);
          const r = needsParens(app.args[1]) ? `(${emitTsExpr(app.args[1])})` : emitTsExpr(app.args[1]);
          return `${l} ${bop} ${r}`;
        }
        const uop = BUILTIN_UNARY_OPS[(app.callee as VarNode).name];
        if (uop !== undefined && app.args.length === 1) {
          return `${uop}${emitTsExpr(app.args[0])}`;
        }
      }
      return `${emitTsExpr(app.callee)}(${app.args.map(emitTsExpr).join(', ')})`;
    }

    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => {
        const t = ionTypeToTs(p.type);
        return t === 'unknown' ? p.name : `${p.name}: ${t}`;
      }).join(', ');
      const retT = abs.type.kind === 'Fn' ? ionTypeToTs(abs.type.ret) : null;
      const retAnnotation = retT !== null && retT !== 'unknown' ? `: ${retT}` : '';
      const body = emitTsLetBlock(abs.body);
      if (body.stmts.length > 0) {
        const stmts = body.stmts.join('\n  ');
        return `(${params})${retAnnotation} => {\n  ${stmts}\n  return ${body.ret};\n}`;
      }
      return `(${params})${retAnnotation} => ${body.ret}`;
    }

    case 'Let': {
      // Expression-level let: use IIFE
      const letNode = node as LetNode;
      const { stmts, ret } = emitTsLetBlock(letNode);
      if (stmts.length > 0) {
        return `(() => {\n  ${stmts.join('\n  ')}\n  return ${ret};\n})()`;
      }
      return ret;
    }

    case 'Case': return emitTsCase(node as CaseNode);

    case 'ForeignRef': {
      const fr = node as ForeignRefNode;
      const arity = fr.sig.params.length;
      if (arity === 0) return expandTemplate(fr.sig.template, []);
      const pnames = fr.sig.params.map((pt, i) => {
        const n = fr.sig.paramNames[i] ?? `_p${i + 1}`;
        const t = ionTypeToTs(pt);
        return t === 'unknown' ? n : `${n}: ${t}`;
      });
      const args = pnames.map((_, i) => wrapEmitted(fr.sig.paramNames[i] ?? `_p${i + 1}`));
      const retT = ionTypeToTs(fr.sig.ret);
      const retAnnotation = retT !== 'unknown' ? `: ${retT}` : '';
      return `(${pnames.join(', ')})${retAnnotation} => ${expandTemplate(fr.sig.template, args)}`;
    }

    case 'Accessor': return `${emitTsExpr(node.receiver)}.${node.member}`;

    case 'ListLit': return `[${node.elements.map(emitTsExpr).join(', ')}]`;

    case 'MapLit':
      return `new Map([${node.entries.map(e => `[${emitTsExpr(e.key)}, ${emitTsExpr(e.value)}]`).join(', ')}])`;

    case 'Constructor': return `${node.ctorName}(${node.args.map(emitTsExpr).join(', ')})`;

    case 'AdtMatch': return emitTsAdtMatch(node as AdtMatchNode);

    case 'ModuleRef': return node.modulePath.join('.');

    case 'OopNew': {
      const typeName = node.type.kind === 'User' ? node.type.name : 'unknown';
      return `new ${typeName}(${node.args.map(emitTsExpr).join(', ')})`;
    }

    case 'OopVirtualCall':
      return `${emitTsExpr(node.receiver)}.${node.method}(${node.args.map(emitTsExpr).join(', ')})`;

    case 'OopThis': return 'this';

    case 'AsyncBlock':
      // Wrap in an immediately-invoked async arrow so it eagerly starts
      return `(async () => ${emitTsExpr(node.body)})()`;

    case 'Await': return `await ${emitTsExpr(node.expr)}`;

    case 'Perform': {
      const perform = node as PerformNode;
      return `(() => { throw new EffectPerform(${JSON.stringify(perform.operation)}, [${perform.args.map(emitTsExpr).join(', ')}]); })()`;
    }

    case 'Handle': return emitTsHandle(node as HandleNode);

    case 'Resume':
      // Resume passes the value back to the continuation; in the CPS translation
      // we represent this as just returning the value from the handler branch.
      return emitTsExpr(node.value);

    case 'Effect': return emitTsExpr(node.body);

    // Declaration nodes — should not appear as expressions, but handle gracefully
    case 'OopClass':
      return `(() => { ${emitTsClass(node as OopClassNode)} return ${(node as OopClassNode).name}; })()`;

    case 'OopInterface':
      // Interfaces are purely structural in TS; return undefined at expression level
      return 'undefined';

    case 'AdtDecl':
      return 'undefined';

    case 'EffectDecl':
      return 'undefined';

    case 'RawInject':
      return node.code;
  }
}

/** Flatten consecutive let bindings into statement + final return. */
function emitTsLetBlock(node: IonIRNode): { stmts: string[]; ret: string } {
  const stmts: string[] = [];
  let cur = node;
  while (cur.kind === 'Let') {
    const lt = cur as LetNode;
    const valCode = emitTsExpr(lt.value);
    const bindT = ionTypeToTs(lt.bindingType);
    const annotation = bindT !== 'unknown' ? `: ${bindT}` : '';
    stmts.push(`const ${lt.name}${annotation} = ${valCode};`);
    cur = lt.body;
  }
  return { stmts, ret: emitTsExpr(cur) };
}

function emitTsCase(node: CaseNode): string {
  if (node.arms.length === 0) return 'undefined';
  if (node.arms.length === 1 && node.arms[0].pattern.kind === 'Wildcard') {
    return emitTsExpr(node.arms[0].body);
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
    return `${emitTsExpr(node.scrutinee)} ? ${emitTsExpr(node.arms[0].body)} : ${emitTsExpr(node.arms[1].body)}`;
  }
  const scrutinee = emitTsExpr(node.scrutinee);
  const parts: string[] = [];
  for (let i = 0; i < node.arms.length; i++) {
    const arm = node.arms[i];
    const isLast = i === node.arms.length - 1;
    const pat = arm.pattern;
    if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
      parts.push(emitTsExpr(arm.body));
    } else {
      const cond = emitTsPatCond(pat, scrutinee);
      parts.push(`${cond} ? ${emitTsExpr(arm.body)}`);
    }
  }
  if (parts.length === 1) return parts[0];
  const last = parts.pop()!;
  return parts.join(' : ') + ' : ' + last;
}

function emitTsPatCond(pat: import('../../src/ir/nodes.js').CasePattern, scrutinee: string): string {
  if (pat.kind === 'Wildcard' || pat.kind === 'Var') return 'true';
  if (pat.kind === 'Constructor') return `${scrutinee}._tag === "${pat.ctorName}"`;
  if (pat.kind === 'Tuple') return `${scrutinee}.length === ${pat.fields.length}`;
  const v = pat.value;
  if (v.kind === 'Bool') return `${scrutinee} === ${v.value}`;
  if (v.kind === 'Null') return `${scrutinee} === null`;
  if (v.kind === 'Str') return `${scrutinee} === ${JSON.stringify(v.value)}`;
  return `${scrutinee} === ${v.value}`;
}

function emitTsAdtMatch(node: AdtMatchNode): string {
  const s = emitTsExpr(node.scrutinee);
  const cases = node.arms.map(arm => {
    const bindings = arm.bindings.map(b => `const ${b.name} = _s.${b.name};`).join(' ');
    return `  case "${arm.tag}": { ${bindings} return ${emitTsExpr(arm.body)}; }`;
  }).join('\n');
  return `(() => { const _s = ${s}; switch (_s._tag) {\n${cases}\n  default: return undefined; } })()`;
}

// ---------------------------------------------------------------------------
// Top-level emit
// ---------------------------------------------------------------------------

export function emitTS(irModule: IonIRModule): string {
  const module = shakePreludeDecls(irModule);
  const usedPrelude = new Set<string>();

  // First pass: collect referenced prelude names
  function collectPrelude(node: IonIRNode): void {
    if (node.kind === 'Var' && PRELUDE_NAMES.has(node.name)) usedPrelude.add(node.name);
    // Walk children
    switch (node.kind) {
      case 'App': collectPrelude(node.callee); node.args.forEach(collectPrelude); break;
      case 'Abs': collectPrelude(node.body); break;
      case 'Let': collectPrelude(node.value); collectPrelude(node.body); break;
      case 'Case': collectPrelude(node.scrutinee); node.arms.forEach(a => collectPrelude(a.body)); break;
      case 'Accessor': collectPrelude(node.receiver); break;
      case 'ListLit': node.elements.forEach(collectPrelude); break;
      case 'MapLit': node.entries.forEach(e => { collectPrelude(e.key); collectPrelude(e.value); }); break;
      case 'OopClass': node.methods.forEach(m => { if (m.body !== undefined) collectPrelude(m.body); }); break;
      case 'Handle': collectPrelude(node.body); node.handlers.forEach(h => collectPrelude(h.body)); break;
      case 'AdtMatch': collectPrelude(node.scrutinee); node.arms.forEach(a => collectPrelude(a.body)); break;
      default: break;
    }
  }

  for (const d of module.decls) collectPrelude(d);

  const parts: string[] = ['"use strict";'];

  // Emit used prelude declarations
  for (const name of PRELUDE_NAMES) {
    if (usedPrelude.has(name) && TS_PRELUDE_DECLS[name] !== undefined) {
      parts.push(TS_PRELUDE_DECLS[name]);
    }
  }

  // Emit user declarations (skip prelude stubs)
  for (const d of module.decls) {
    if (d.kind === 'Let') {
      const lt = d as LetNode;
      if (PRELUDE_NAMES.has(lt.name)) continue;
      // Skip outer type annotation when the value is already an annotated Abs
      const annotation = lt.value.kind !== 'Abs' ? (() => {
        const bindT = ionTypeToTs(lt.bindingType);
        return bindT !== 'unknown' && bindT !== 'void' ? `: ${bindT}` : '';
      })() : '';
      parts.push(`const ${lt.name}${annotation} = ${emitTsExpr(lt.value)};`);

    } else if (d.kind === 'AdtDecl') {
      parts.push(emitTsAdtType(d as AdtDeclNode));

    } else if (d.kind === 'OopClass') {
      // Emit full class declaration at the top level (not wrapped in const = ...)
      parts.push(emitTsClass(d as OopClassNode));

    } else if (d.kind === 'OopInterface') {
      // Emit interface declaration at the top level
      parts.push(emitTsInterface(d as OopInterfaceNode));

    } else if (d.kind === 'EffectDecl') {
      // Emit effect as a type alias comment + structural type
      parts.push(emitTsEffectDecl(d as EffectDeclNode));
    }
  }

  return parts.join('\n') + '\n';
}
