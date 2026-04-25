import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  VarNode,
  AccessorNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';

// ---------------------------------------------------------------------------
// IonType → Apex type
// ---------------------------------------------------------------------------

export function ionTypeToApex(t: IonType): string {
  switch (t.kind) {
    case 'Int': return 'Integer';
    case 'Float': return 'Decimal';
    case 'Bool': return 'Boolean';
    case 'Str': return 'String';
    case 'Unit': return 'void';
    case 'Null': return 'Object';
    case 'Never': return 'Object';
    case 'List': return `List<${ionTypeToApex(t.elem)}>`;
    case 'Map': return `Map<${ionTypeToApex(t.key)}, ${ionTypeToApex(t.value)}>`;
    case 'Option': return ionTypeToApex(t.inner); // Apex doesn't have Option, use nullable
    case 'User': return t.name; // custom Apex type / SObject
    default: return 'Object';
  }
}

// ---------------------------------------------------------------------------
// Module name → PascalCase class name
// ---------------------------------------------------------------------------

function toClassName(module: string): string {
  return module.split(/[-_]/).map(w => w.length === 0 ? '' : w[0]!.toUpperCase() + w.slice(1)).join('');
}

// ---------------------------------------------------------------------------
// Builtin operator maps
// ---------------------------------------------------------------------------

const BUILTIN_BINARY_OPS: Record<string, string> = {
  __add__: '+',
  __sub__: '-',
  __mul__: '*',
  __div__: '/',
  __mod__: 'Math.mod',
  __eq__: '==',
  __ne__: '!=',
  __lt__: '<',
  __gt__: '>',
  __le__: '<=',
  __ge__: '>=',
};

// ---------------------------------------------------------------------------
// emitApexExpr — Apex expression emitter
// ---------------------------------------------------------------------------

export function emitApexExpr(node: IonIRNode): string {
  switch (node.kind) {
    case 'Literal': {
      const v = node.value;
      if (v.kind === 'Str') return `'${v.value.replace(/'/g, "\\'")}'`;
      if (v.kind === 'Int') return String(v.value);
      if (v.kind === 'Float') return String(v.value);
      if (v.kind === 'Bool') return v.value ? 'true' : 'false';
      if (v.kind === 'Null') return 'null';
      return 'null';
    }

    case 'Var': return (node as VarNode).name;

    case 'App': {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const name = (app.callee as VarNode).name;

        // Binary operators
        const bop = BUILTIN_BINARY_OPS[name];
        if (bop !== undefined && app.args.length === 2) {
          const l = emitApexExpr(app.args[0]!);
          const r = emitApexExpr(app.args[1]!);
          return `${l} ${bop} ${r}`;
        }

        // Unary operators
        if (name === '__neg__' && app.args.length === 1) {
          return `-${emitApexExpr(app.args[0]!)}`;
        }
        if (name === '__not__' && app.args.length === 1) {
          return `!${emitApexExpr(app.args[0]!)}`;
        }
        if (name === '__and__' && app.args.length === 2) {
          return `(${emitApexExpr(app.args[0]!)} && ${emitApexExpr(app.args[1]!)})`;
        }
        if (name === '__or__' && app.args.length === 2) {
          return `(${emitApexExpr(app.args[0]!)} || ${emitApexExpr(app.args[1]!)})`;
        }

        // Regular function call
        const args = app.args.map(emitApexExpr).join(', ');
        return `${name}(${args})`;
      }
      // Non-var callee
      const callee = emitApexExpr(app.callee);
      const args = app.args.map(emitApexExpr).join(', ');
      return `${callee}(${args})`;
    }

    case 'OopVirtualCall': {
      const receiver = emitApexExpr(node.receiver);
      const args = node.args.map(emitApexExpr);

      switch (node.method) {
        case 'filter': return `/* filter: */ ${receiver}`;
        case 'map': return `/* map: */ ${receiver}`;
        case 'reduce': return `/* reduce: */ ${receiver}`;
        case 'includes': return `${receiver}.contains(${args[0] ?? ''})`;
        case 'find': return `/* find: */ ${receiver}`;
        case 'sort': return `${receiver}.sort()`;
        case 'length':
        case 'size': return `${receiver}.size()`;
        case 'concat': return `/* concat: */ ${receiver}.addAll(${args[0] ?? ''})`;
        case 'toLowerCase': return `${receiver}.toLowerCase()`;
        case 'toUpperCase': return `${receiver}.toUpperCase()`;
        case 'slice': return `${receiver}.subList(${args[0] ?? '0'}, ${args[1] ?? receiver + '.size()'})`;
        default: return `${receiver}.${node.method}(${args.join(', ')})`;
      }
    }

    case 'Accessor': {
      const acc = node as AccessorNode;
      const receiver = emitApexExpr(acc.receiver);
      const member = acc.member;
      if (member === 'length' || member === 'k') {
        return `${receiver}.size()`;
      }
      return `${receiver}.${member}`;
    }

    case 'Case': {
      const caseNode = node as CaseNode;
      if (caseNode.arms.length === 0) return 'null';

      // Simple ternary for two-arm boolean case
      if (
        caseNode.arms.length === 2 &&
        caseNode.arms[0]!.pattern.kind === 'Literal' &&
        caseNode.arms[0]!.pattern.value.kind === 'Bool' &&
        caseNode.arms[0]!.pattern.value.value === true &&
        caseNode.arms[1]!.pattern.kind === 'Wildcard'
      ) {
        const scrutinee = emitApexExpr(caseNode.scrutinee);
        const thenExpr = emitApexExpr(caseNode.arms[0]!.body);
        const elseExpr = emitApexExpr(caseNode.arms[1]!.body);
        return `${scrutinee} ? ${thenExpr} : ${elseExpr}`;
      }

      // Single wildcard arm
      if (caseNode.arms.length === 1) {
        return emitApexExpr(caseNode.arms[0]!.body);
      }

      // General case: emit first arm
      return emitApexExpr(caseNode.arms[0]!.body);
    }

    case 'Let': {
      // Expression-level let — inline the final value
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') cur = (cur as LetNode).body;
      return emitApexExpr(cur);
    }

    case 'ListLit': {
      const elements = node.elements.map(emitApexExpr).join(', ');
      return `new List<Object>{${elements}}`;
    }

    case 'Abs': {
      return `/* lambda: use method reference */`;
    }

    default: return 'null';
  }
}

// ---------------------------------------------------------------------------
// Flatten let chain into Apex local-variable statements
// ---------------------------------------------------------------------------

function emitApexLetBlock(node: IonIRNode): { stmts: string[]; ret: string } {
  const stmts: string[] = [];
  let cur = node;
  while (cur.kind === 'Let') {
    const lt = cur as LetNode;
    const valCode = emitApexExpr(lt.value);
    const typeStr = ionTypeToApex(lt.bindingType);
    stmts.push(`        ${typeStr} ${lt.name} = ${valCode};`);
    cur = lt.body;
  }
  return { stmts, ret: emitApexExpr(cur) };
}

// ---------------------------------------------------------------------------
// Annotation heuristics
// ---------------------------------------------------------------------------

const CACHEABLE_PREFIXES = [
  'filter', 'get', 'find', 'search', 'count', 'total', 'average',
  'compute', 'is', 'has', 'rank', 'sort',
];

const MUTABLE_PREFIXES = [
  'create', 'update', 'delete', 'set', 'add', 'remove', 'merge',
  'validate', 'submit', 'process',
];

function getAuraAnnotation(name: string): string {
  const lower = name.toLowerCase();
  if (CACHEABLE_PREFIXES.some(p => lower.startsWith(p))) {
    return '@AuraEnabled(cacheable=true)';
  }
  if (MUTABLE_PREFIXES.some(p => lower.startsWith(p))) {
    return '@AuraEnabled';
  }
  // Default: cacheable for query-like names
  return '@AuraEnabled(cacheable=true)';
}

// ---------------------------------------------------------------------------
// emitApex — main entry point
// ---------------------------------------------------------------------------

export function emitApex(irModule: IonIRModule): string {
  const className = toClassName(irModule.module);

  const propertyLines: string[] = [];
  const methodLines: string[] = [];

  for (const d of irModule.decls) {
    if (d.kind !== 'Let') continue;
    const lt = d as LetNode;
    const name = lt.name;
    const value = lt.value;

    if (value.kind === 'Abs') {
      const abs = value as AbsNode;
      const annotation = getAuraAnnotation(name);

      // Map parameters
      const params = abs.params.map(p => {
        const typeStr = ionTypeToApex(p.type);
        return `${typeStr} ${p.name}`;
      });

      // Return type
      const retType = 'Object';

      // Method body
      const { stmts, ret } = emitApexLetBlock(abs.body);

      const paramStr = params.join(', ');
      const methodBody: string[] = [];
      methodLines.push(`    ${annotation}`);
      methodLines.push(`    public static ${retType} ${name}(${paramStr}) {`);
      for (const s of stmts) {
        methodBody.push(s);
      }
      methodBody.push(`        return ${ret};`);
      for (const line of methodBody) {
        methodLines.push(line);
      }
      methodLines.push(`    }`);
      methodLines.push(``);
    } else {
      // Non-function: emit as private static property
      const valCode = emitApexExpr(value);
      propertyLines.push(`    private static Object ${name} = ${valCode};`);
    }
  }

  const allLines: string[] = [];
  allLines.push(`/**`);
  allLines.push(` * Generated by ION compiler from ${irModule.module}.ion`);
  allLines.push(` * Do not edit manually.`);
  allLines.push(` */`);
  allLines.push(`public with sharing class ${className}Controller {`);
  allLines.push(``);

  if (propertyLines.length > 0) {
    for (const line of propertyLines) {
      allLines.push(line);
    }
    allLines.push(``);
  }

  for (const line of methodLines) {
    allLines.push(line);
  }

  allLines.push(`}`);

  return allLines.join('\n') + '\n';
}
