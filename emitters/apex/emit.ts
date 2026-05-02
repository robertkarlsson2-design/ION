import type {
  IonIRModule,
  IonIRNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  VarNode,
  AccessorNode,
  OopClassNode,
  OopInterfaceNode,
  OopMethod,
  OopAnnotation,
  OopConstructor,
  AdtDeclNode,
  AdtMatchNode,
  EffectDeclNode,
  RawInjectNode,
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
  return module.split(/[-_.]/).map(w => w.length === 0 ? '' : w[0]!.toUpperCase() + w.slice(1)).join('');
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
      if (v.kind === 'Str') return `'${v.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
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

        // map/filter/reduce — no higher-order functions in Apex; emit a loop comment
        if ((name === 'map' || name === 'filter' || name === 'reduce') && app.args.length >= 1) {
          return `/* ${name}: */ ${emitApexExpr(app.args[0]!)}`;
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

      // General case: _tag-based ternary dispatch
      /* Apex: field bindings are inlined as (Object)s.get('_argN') — multi-use vars need manual extraction */
      const scrutinee = emitApexExpr(caseNode.scrutinee);
      const parts: string[] = [];
      for (let i = 0; i < caseNode.arms.length; i++) {
        const arm = caseNode.arms[i]!;
        const isLast = i === caseNode.arms.length - 1;
        const pat = arm.pattern;
        if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
          parts.push(emitApexExpr(arm.body));
        } else if (pat.kind === 'Constructor') {
          const cond = `(String) ${scrutinee}.get('_tag') == '${pat.ctorName}'`;
          parts.push(`${cond} ? ${emitApexExpr(arm.body)}`);
        } else if (pat.kind === 'Literal') {
          const lv = pat.value;
          let cond: string;
          if (lv.kind === 'Bool') cond = `${scrutinee} == ${lv.value}`;
          else if (lv.kind === 'Null') cond = `${scrutinee} == null`;
          else if (lv.kind === 'Str') cond = `${scrutinee} == '${lv.value}'`;
          else cond = `${scrutinee} == ${lv.value}`;
          parts.push(`${cond} ? ${emitApexExpr(arm.body)}`);
        } else {
          parts.push(emitApexExpr(arm.body));
        }
      }
      if (parts.length === 1) return parts[0]!;
      const last = parts.pop()!;
      return parts.join(' : ') + ' : ' + last;
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

    case 'MapLit': {
      // Apex Map literal: new Map<Object, Object>{ key => value, ... }
      const entries = node.entries.map(e => `${emitApexExpr(e.key)} => ${emitApexExpr(e.value)}`).join(', ');
      return `new Map<Object, Object>{${entries}}`;
    }

    case 'Constructor': {
      // ADT constructor: represent as a Map with _tag key
      const args = node.args.map(emitApexExpr);
      if (args.length === 0) {
        return `new Map<String, Object>{ '_tag' => '${node.ctorName}' }`;
      }
      const argEntries = args.map((a, i) => `'_arg${i}' => ${a}`).join(', ');
      return `new Map<String, Object>{ '_tag' => '${node.ctorName}', ${argEntries} }`;
    }

    case 'ModuleRef': return node.modulePath.join('.');

    case 'ForeignRef': return node.target;

    case 'Effect': return emitApexExpr(node.body);

    case 'OopNew': {
      const args = node.args.map(emitApexExpr).join(', ');
      return `new _ctor_${node.ctorSymbolId}(${args})`;
    }

    case 'OopThis': return 'this';

    case 'Abs': {
      // Apex has no lambdas — emit a comment placeholder
      return `/* lambda: use method reference */`;
    }

    case 'AsyncBlock': {
      // Apex has no real async; emit body directly (or use @future for side effects)
      return emitApexExpr(node.body);
    }

    case 'Await': {
      // Apex has no await — emit the inner expression directly
      return emitApexExpr(node.expr);
    }

    case 'AdtMatch': {
      const adtMatch = node as AdtMatchNode;
      if (adtMatch.arms.length === 0) return 'null';
      // Apex has no pattern matching — emit first arm's body
      return emitApexExpr(adtMatch.arms[0]!.body);
    }

    case 'Perform': {
      // Apex algebraic effects don't exist — emit args as a call comment
      const args = node.args.map(emitApexExpr).join(', ');
      return `/* perform ${node.operation}(${args}) */null`;
    }

    case 'Handle': return emitApexExpr(node.body);

    case 'Resume': return emitApexExpr(node.value);

    // Declaration nodes in expression position
    case 'OopClass': return node.name;
    case 'OopInterface': return `/* interface ${node.name} */null`;
    case 'AdtDecl': return `/* adt ${node.name} */null`;
    case 'EffectDecl': return `/* effect ${node.name} */null`;

    case 'RawInject': return (node as RawInjectNode).code;

    default: {
      const _exhaustive: never = node;
      return `/* unknown: ${(_exhaustive as IonIRNode).kind} */null`;
    }
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
// emitApexMethodBody — emit a potentially async body, including @future wrapper
// ---------------------------------------------------------------------------

function emitApexMethodBody(
  name: string,
  node: IonIRNode,
  indent = '        ',
): { isAsync: boolean; stmts: string[]; ret: string } {
  let isAsync = false;
  let inner = node;

  if (inner.kind === 'AsyncBlock') {
    isAsync = true;
    inner = inner.body;
  }

  const { stmts, ret } = emitApexLetBlock(inner);
  return { isAsync, stmts, ret };
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
// Apex annotation helper
// ---------------------------------------------------------------------------

function emitApexAnnotationLines(annotations: readonly OopAnnotation[], indent: string): string[] {
  return (annotations ?? []).map(ann => {
    const args = ann.args.length > 0 ? `(${ann.args.join(', ')})` : '';
    return `${indent}@${ann.name}${args}`;
  });
}

// ---------------------------------------------------------------------------
// Apex constructor emitter
// ---------------------------------------------------------------------------

function emitApexConstructor(ctor: OopConstructor, className: string, indent: string): string[] {
  const lines: string[] = [];
  const vis = ctor.visibility ?? 'public';
  const params = ctor.params.map(p => `${ionTypeToApex(p.type)} ${p.name}`).join(', ');
  lines.push(`${indent}${vis} ${className}(${params}) {`);
  if (ctor.body) {
    const bodyStr = emitApexExpr(ctor.body);
    lines.push(`${indent}    ${bodyStr};`);
  }
  lines.push(`${indent}}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Apex method emitter (shared by class methods)
// ---------------------------------------------------------------------------

function emitApexMethod(m: OopMethod, indent: string): string[] {
  const lines: string[] = [];

  // Annotations above the method
  if (m.annotations && m.annotations.length > 0) {
    lines.push(...emitApexAnnotationLines(m.annotations, indent));
  }

  const vis = m.visibility ?? 'public';
  const staticKw = m.isStatic ? 'static ' : '';
  const abstractKw = m.isAbstract ? 'abstract ' : '';
  const retType = ionTypeToApex(m.retType);
  const params = m.params.map(p => `${ionTypeToApex(p.type)} ${p.name}`).join(', ');

  if (m.accessorKind === 'get') {
    // Apex-style getter: public Type getXxx() { ... }
    const getterName = `get${m.name.slice(0, 1).toUpperCase()}${m.name.slice(1)}`;
    const bodyStr = m.body ? emitApexExpr(m.body) : 'null';
    lines.push(`${indent}${vis} ${staticKw}${retType} ${getterName}() {`);
    lines.push(`${indent}    return ${bodyStr};`);
    lines.push(`${indent}}`);
  } else if (m.accessorKind === 'set') {
    // Apex-style setter: public void setXxx(Type v) { ... }
    const setterName = `set${m.name.slice(0, 1).toUpperCase()}${m.name.slice(1)}`;
    const bodyStr = m.body ? emitApexExpr(m.body) : '';
    lines.push(`${indent}${vis} ${staticKw}void ${setterName}(${retType} value) {`);
    if (bodyStr) lines.push(`${indent}    ${bodyStr};`);
    lines.push(`${indent}}`);
  } else if (m.isAbstract) {
    // Abstract method — no body
    lines.push(`${indent}${vis} ${staticKw}${abstractKw}${retType} ${m.name}(${params});`);
  } else {
    const bodyStr = m.body ? emitApexExpr(m.body) : 'null';
    lines.push(`${indent}${vis} ${staticKw}${retType} ${m.name}(${params}) {`);
    lines.push(`${indent}    return ${bodyStr};`);
    lines.push(`${indent}}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// emitApexClass — emit an OopClass node as an Apex inner class
// ---------------------------------------------------------------------------

function emitApexClass(cls: OopClassNode, indent = '    '): string {
  const lines: string[] = [];
  const memberIndent = `${indent}    `;

  // Class-level annotations
  for (const ann of emitApexAnnotationLines(cls.annotations ?? [], indent)) {
    lines.push(ann);
  }

  // Class declaration with optional type params
  const typeParamStr = (cls.typeParams ?? []).length > 0 ? `<${cls.typeParams!.join(', ')}>` : '';
  lines.push(`${indent}public class ${cls.name}${typeParamStr} {`);

  // Fields — emit with visibility/static/readonly
  for (const f of cls.fields) {
    const vis = f.visibility ?? 'public';
    const staticKw = f.isStatic ? 'static ' : '';
    const finalKw = f.isReadonly ? 'final ' : '';
    lines.push(`${memberIndent}${vis} ${staticKw}${finalKw}${ionTypeToApex(f.type)} ${f.name};`);
  }

  // Explicit constructors (from new OopConstructor[] field)
  if ((cls.constructors ?? []).length > 0) {
    lines.push(``);
    for (const ctor of cls.constructors!) {
      lines.push(...emitApexConstructor(ctor, cls.name, memberIndent));
    }
  } else if (cls.fields.length > 0) {
    // Auto-generate a constructor from fields (backwards-compat)
    lines.push(``);
    const ctorParams = cls.fields.map(f => `${ionTypeToApex(f.type)} ${f.name}`).join(', ');
    lines.push(`${memberIndent}public ${cls.name}(${ctorParams}) {`);
    for (const f of cls.fields) {
      lines.push(`${memberIndent}    this.${f.name} = ${f.name};`);
    }
    lines.push(`${memberIndent}}`);
  }

  // Methods
  for (const m of cls.methods) {
    lines.push(``);
    lines.push(...emitApexMethod(m, memberIndent));
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// emitApexInterface — emit an OopInterface node as an Apex interface
// ---------------------------------------------------------------------------

function emitApexInterface(iface: OopInterfaceNode, indent = '    '): string {
  const lines: string[] = [];

  // Interface-level annotations
  for (const ann of emitApexAnnotationLines(iface.annotations ?? [], indent)) {
    lines.push(ann);
  }

  // Interface declaration with optional type params
  const typeParamStr = (iface.typeParams ?? []).length > 0 ? `<${iface.typeParams!.join(', ')}>` : '';
  lines.push(`${indent}public interface ${iface.name}${typeParamStr} {`);

  for (const m of iface.members) {
    const memberName = `get${m.name.slice(0, 1).toUpperCase() + m.name.slice(1)}`;
    lines.push(`${indent}    ${ionTypeToApex(m.type)} ${memberName}();`);
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// emitApexAdt — emit an AdtDecl node as Apex enum or inner class hierarchy
// ---------------------------------------------------------------------------

function emitApexAdt(adt: AdtDeclNode, indent = '    '): string {
  const lines: string[] = [];

  // If all variants have no fields → emit as Apex enum
  const allSimple = adt.variants.every(v => v.fields.length === 0);
  if (allSimple) {
    lines.push(`${indent}public enum ${adt.name} {`);
    lines.push(`${indent}    ${adt.variants.map(v => v.tag).join(', ')}`);
    lines.push(`${indent}}`);
    return lines.join('\n');
  }

  // Otherwise emit as inner class hierarchy with a base class + subclasses
  lines.push(`${indent}public abstract class ${adt.name} {`);
  lines.push(`${indent}    public abstract String getTag();`);

  for (const v of adt.variants) {
    lines.push(``);
    lines.push(`${indent}    public class ${v.tag} extends ${adt.name} {`);
    for (const f of v.fields) {
      lines.push(`${indent}        public ${ionTypeToApex(f.type)} ${f.name};`);
    }
    if (v.fields.length > 0) {
      const ctorParams = v.fields.map(f => `${ionTypeToApex(f.type)} ${f.name}`).join(', ');
      lines.push(`${indent}        public ${v.tag}(${ctorParams}) {`);
      for (const f of v.fields) {
        lines.push(`${indent}            this.${f.name} = ${f.name};`);
      }
      lines.push(`${indent}        }`);
    }
    lines.push(`${indent}        public override String getTag() { return '${v.tag}'; }`);
    lines.push(`${indent}    }`);
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// emitApex — main entry point
// ---------------------------------------------------------------------------

export function emitApex(irModule: IonIRModule): string {
  const className = toClassName(irModule.module);

  const propertyLines: string[] = [];
  const methodLines: string[] = [];
  const innerTypeLines: string[] = [];

  // Process module-level ADT data declarations
  for (const adt of irModule.data) {
    innerTypeLines.push(emitApexAdt(adt));
    innerTypeLines.push(``);
  }

  for (const d of irModule.decls) {
    switch (d.kind) {
      case 'Let': {
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

          // Check if the body is async
          const { isAsync, stmts, ret } = emitApexMethodBody(name, abs.body);

          const paramStr = params.join(', ');
          const methodBody: string[] = [];

          if (isAsync) {
            // @future methods in Apex can only accept primitive types and cannot return values
            // Emit a synchronous version with a comment explaining the async intent
            methodLines.push(`    // Note: originally async — Apex @future methods must be void with primitive params`);
            methodLines.push(`    ${annotation}`);
            methodLines.push(`    public static ${retType} ${name}(${paramStr}) {`);
          } else {
            methodLines.push(`    ${annotation}`);
            methodLines.push(`    public static ${retType} ${name}(${paramStr}) {`);
          }
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
        break;
      }

      case 'OopClass': {
        innerTypeLines.push(emitApexClass(d as OopClassNode));
        innerTypeLines.push(``);
        break;
      }

      case 'OopInterface': {
        innerTypeLines.push(emitApexInterface(d as OopInterfaceNode));
        innerTypeLines.push(``);
        break;
      }

      case 'AdtDecl': {
        innerTypeLines.push(emitApexAdt(d as AdtDeclNode));
        innerTypeLines.push(``);
        break;
      }

      case 'EffectDecl': {
        const eff = d as EffectDeclNode;
        innerTypeLines.push(`    // Effect: ${eff.name}`);
        for (const op of eff.operations) {
          innerTypeLines.push(`    // operation: ${op.name}(${op.params.map(p => p.name).join(', ')})`);
        }
        innerTypeLines.push(``);
        break;
      }

      case 'AsyncBlock': {
        // Top-level async block: wrap in a @future void method
        const bodyExpr = emitApexExpr(d.body);
        methodLines.push(`    // @future equivalent — no return value in Apex`);
        methodLines.push(`    @future`);
        methodLines.push(`    public static void runAsync() {`);
        methodLines.push(`        ${bodyExpr};`);
        methodLines.push(`    }`);
        methodLines.push(``);
        break;
      }

      default:
        // Other nodes (Perform, Handle, Resume, Var, etc.) — skip silently with comment
        methodLines.push(`    // [${d.kind}]`);
        break;
    }
  }

  const allLines: string[] = [];
  allLines.push(`/**`);
  allLines.push(` * Generated by ION compiler from ${irModule.module}.ion`);
  allLines.push(` * Do not edit manually.`);
  allLines.push(` */`);
  allLines.push(`public with sharing class ${className}Controller {`);
  allLines.push(``);

  if (innerTypeLines.length > 0) {
    for (const line of innerTypeLines) {
      allLines.push(line);
    }
  }

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
