import type {
  IonIRModule,
  IonIRNode,
  Param,
  CasePattern,
  CaseArm,
  LiteralValue,
  OopMethod,
  OopMember,
  AdtVariant,
  AdtArm,
  EffectOp,
  EffectHandler,
  AdtDeclNode,
} from '../ir/nodes.js';
import type { IonType } from '../ir/types.js';

export interface PrettyOptions {
  readonly indentSize?: number;
}

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function ind(depth: number, size: number): string {
  return ' '.repeat(depth * size);
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function printLiteral(v: LiteralValue): string {
  switch (v.kind) {
    case 'Int': return String(v.value);
    case 'Float': return Number.isInteger(v.value) ? `${v.value}.0` : String(v.value);
    case 'Str': return `"${escapeString(v.value)}"`;

    case 'Bool': return v.value ? 'true' : 'false';
    case 'Null': return 'null';
    default: return assertNever(v);
  }
}

function printPattern(p: CasePattern): string {
  switch (p.kind) {
    case 'Wildcard': return '_';
    case 'Var': return p.name;
    case 'Constructor': {
      if (p.fields.length === 0) return p.ctorName;
      return `${p.ctorName}(${p.fields.map(printPattern).join(', ')})`;
    }
    case 'Literal': return printLiteral(p.value);
    case 'Tuple':
      return `(${p.elements.map(printPattern).join(', ')})`;
    default: return assertNever(p);
  }
}

function printParams(params: readonly Param[]): string {
  return `(${params.map(p => `${p.name}: ${prettyPrintType(p.type)}`).join(', ')})`;
}

function printCaseArm(arm: CaseArm, depth: number, size: number): string {
  const guardPart = arm.guard !== undefined
    ? ` if ${prettyPrintNode(arm.guard, depth, { indentSize: size })}`
    : '';
  const bodyStr = prettyPrintNode(arm.body, depth, { indentSize: size });
  return `${ind(depth, size)}${printPattern(arm.pattern)}${guardPart} => ${bodyStr}`;
}

function printAdtArm(arm: AdtArm, depth: number, size: number): string {
  const bindingsPart = arm.bindings.length > 0
    ? `(${arm.bindings.map(p => p.name).join(', ')})`
    : '';
  const bodyStr = prettyPrintNode(arm.body, depth, { indentSize: size });
  return `${ind(depth, size)}${arm.tag}${bindingsPart} => ${bodyStr}`;
}

function printEffectHandler(h: EffectHandler, depth: number, size: number): string {
  const bodyStr = prettyPrintNode(h.body, depth, { indentSize: size });
  return `${ind(depth, size)}${h.operation}${printParams(h.params)} => ${bodyStr}`;
}

function printEffectOp(op: EffectOp, depth: number, size: number): string {
  return `${ind(depth, size)}${op.name}${printParams(op.params)}: ${prettyPrintType(op.retType)}`;
}

function printOopMethod(m: OopMethod, depth: number, size: number): string {
  const prefix = ind(depth, size);
  const sig = `fn ${m.name}${printParams(m.params)}: ${prettyPrintType(m.retType)}`;
  if (m.isAbstract || m.body === undefined) {
    return `${prefix}${sig}`;
  }
  const bodyStr = prettyPrintNode(m.body, depth + 1, { indentSize: size });
  return `${prefix}${sig} {\n${ind(depth + 1, size)}${bodyStr}\n${prefix}}`;
}

function printOopMember(m: OopMember, depth: number, size: number): string {
  return `${ind(depth, size)}${m.name}: ${prettyPrintType(m.type)}`;
}

function printAdtVariantBody(v: AdtVariant): string {
  if (v.fields.length === 0) return v.tag;
  return `${v.tag}(${v.fields.map(f => `${f.name}: ${prettyPrintType(f.type)}`).join(', ')})`;
}

function printAdtDecl(node: AdtDeclNode, depth: number, size: number): string {
  const prefix = ind(depth, size);
  if (node.variants.length === 0) {
    return `data ${node.name} {}`;
  }
  const variantsStr = node.variants.map((v, i) => {
    const body = printAdtVariantBody(v);
    return i === 0
      ? `${ind(depth + 1, size)}${body}`
      : `${ind(depth + 1, size)}| ${body}`;
  }).join('\n');
  return `data ${node.name} {\n${variantsStr}\n${prefix}}`;
}

function printTopLevelDecl(node: IonIRNode, size: number, out: string[]): void {
  if (node.kind === 'Let') {
    out.push(`let ${node.name}: ${prettyPrintType(node.bindingType)} = ${prettyPrintNode(node.value, 0, { indentSize: size })}`);
    printTopLevelDecl(node.body, size, out);
  } else {
    out.push(prettyPrintNode(node, 0, { indentSize: size }));
  }
}

/** Render an IonType to its surface type annotation. */
export function prettyPrintType(type: IonType): string {
  switch (type.kind) {
    case 'Int': return 'Int';
    case 'Float': return 'Float';
    case 'Str': return 'Str';
    case 'Bool': return 'Bool';
    case 'Null': return 'Null';
    case 'Unit': return 'Unit';
    case 'Never': return 'Never';
    case 'TypeVar': return `'${type.id}`;
    case 'List': return `[${prettyPrintType(type.elem)}]`;
    case 'Option': return `${prettyPrintType(type.inner)}?`;
    case 'Map': return `{${prettyPrintType(type.key)}: ${prettyPrintType(type.value)}}`;
    case 'Result': return `Result<${prettyPrintType(type.ok)}, ${prettyPrintType(type.err)}>`;
    case 'Fn': {
      const paramsStr = type.params.map(prettyPrintType).join(', ');
      const retStr = prettyPrintType(type.ret);
      const effects = [...type.effects].sort();
      if (effects.length === 0) {
        return `(${paramsStr}) -> ${retStr}`;
      }
      return `(${paramsStr}) -[${effects.join(', ')}]-> ${retStr}`;
    }
    case 'User': {
      if (type.args.length === 0) return type.name;
      return `${type.name}<${type.args.map(prettyPrintType).join(', ')}>`;
    }
    case 'Tuple':
      return `(${type.elements.map(prettyPrintType).join(', ')})`;
    default: return assertNever(type);
  }
}

/** Render any single IonIRNode at a given indent depth. */
export function prettyPrintNode(node: IonIRNode, depth = 0, opts?: PrettyOptions): string {
  const size = opts?.indentSize ?? 2;

  switch (node.kind) {
    // Core
    case 'Var': return node.name;
    case 'Literal': return printLiteral(node.value);
    case 'App': {
      const calleeStr = prettyPrintNode(node.callee, depth, opts);
      const argsStr = node.args.map(a => prettyPrintNode(a, depth, opts)).join(', ');
      return `${calleeStr}(${argsStr})`;
    }
    case 'Abs': {
      const retType = node.type.kind === 'Fn' ? node.type.ret : node.type;
      const bodyStr = prettyPrintNode(node.body, depth, opts);
      return `fn${printParams(node.params)}: ${prettyPrintType(retType)} => ${bodyStr}`;
    }
    case 'Let': {
      const prefix = ind(depth, size);
      const valueStr = prettyPrintNode(node.value, depth, opts);
      const bodyStr = prettyPrintNode(node.body, depth, opts);
      return `let ${node.name}: ${prettyPrintType(node.bindingType)} = ${valueStr}\n${prefix}${bodyStr}`;
    }
    case 'Case': {
      const prefix = ind(depth, size);
      const scrutStr = prettyPrintNode(node.scrutinee, depth, opts);
      const armsStr = node.arms.map(a => printCaseArm(a, depth + 1, size)).join('\n');
      return `case ${scrutStr} {\n${armsStr}\n${prefix}}`;
    }
    case 'Constructor': {
      if (node.args.length === 0) return node.ctorName;
      const argsStr = node.args.map(a => prettyPrintNode(a, depth, opts)).join(', ');
      return `${node.ctorName}(${argsStr})`;
    }
    case 'Accessor': return `${prettyPrintNode(node.receiver, depth, opts)}.${node.member}`;
    case 'ModuleRef': return node.modulePath.join('.');
    case 'ForeignRef': return `@foreign("${escapeString(node.module)}::${escapeString(node.symbol)}")`;
    case 'Effect': {
      const prefix = ind(depth, size);
      const inner = ind(depth + 1, size);
      const bodyStr = prettyPrintNode(node.body, depth + 1, opts);
      return `@effect(${node.effectTag}) {\n${inner}${bodyStr}\n${prefix}}`;
    }
    // OOP
    case 'OopThis': return 'this';
    case 'OopNew': {
      const argsStr = node.args.map(a => prettyPrintNode(a, depth, opts)).join(', ');
      return `new ${node.ctorSymbolId}(${argsStr})`;
    }
    case 'OopVirtualCall': {
      const recvStr = prettyPrintNode(node.receiver, depth, opts);
      const argsStr = node.args.map(a => prettyPrintNode(a, depth, opts)).join(', ');
      return `${recvStr}.${node.method}(${argsStr})`;
    }
    case 'OopClass': {
      const prefix = ind(depth, size);
      const inner = ind(depth + 1, size);
      const superPart = node.superClass !== undefined ? ` extends ${node.superClass}` : '';
      const ifacePart = node.interfaces.length > 0 ? `: ${node.interfaces.join(', ')}` : '';
      const fieldsStr = node.fields.map(f => `${inner}${f.name}: ${prettyPrintType(f.type)}`).join('\n');
      const methodsStr = node.methods.map(m => printOopMethod(m, depth + 1, size)).join('\n');
      const bodyParts = [fieldsStr, methodsStr].filter(s => s.length > 0).join('\n');
      if (bodyParts.length === 0) {
        return `class ${node.name}${superPart}${ifacePart} {}`;
      }
      return `class ${node.name}${superPart}${ifacePart} {\n${bodyParts}\n${prefix}}`;
    }
    case 'OopInterface': {
      const prefix = ind(depth, size);
      if (node.members.length === 0) {
        return `interface ${node.name} {}`;
      }
      const membersStr = node.members.map(m => printOopMember(m, depth + 1, size)).join('\n');
      return `interface ${node.name} {\n${membersStr}\n${prefix}}`;
    }
    // Async
    case 'AsyncBlock': {
      const prefix = ind(depth, size);
      const inner = ind(depth + 1, size);
      const bodyStr = prettyPrintNode(node.body, depth + 1, opts);
      return `async {\n${inner}${bodyStr}\n${prefix}}`;
    }
    case 'Await': return `await ${prettyPrintNode(node.expr, depth, opts)}`;
    // ADT
    case 'AdtDecl': return printAdtDecl(node, depth, size);
    case 'AdtMatch': {
      const prefix = ind(depth, size);
      const scrutStr = prettyPrintNode(node.scrutinee, depth, opts);
      const armsStr = node.arms.map(a => printAdtArm(a, depth + 1, size)).join('\n');
      return `match ${scrutStr} {\n${armsStr}\n${prefix}}`;
    }
    // Effects
    case 'EffectDecl': {
      const prefix = ind(depth, size);
      if (node.operations.length === 0) {
        return `effect ${node.name} {}`;
      }
      const opsStr = node.operations.map(op => printEffectOp(op, depth + 1, size)).join('\n');
      return `effect ${node.name} {\n${opsStr}\n${prefix}}`;
    }
    case 'Perform': {
      const argsStr = node.args.map(a => prettyPrintNode(a, depth, opts)).join(', ');
      return `perform ${node.effectSymbolId}.${node.operation}(${argsStr})`;
    }
    case 'Handle': {
      const prefix = ind(depth, size);
      const inner = ind(depth + 1, size);
      const bodyStr = prettyPrintNode(node.body, depth + 1, opts);
      const handlersStr = node.handlers.map(h => printEffectHandler(h, depth + 1, size)).join('\n');
      const withBlock = node.handlers.length > 0
        ? `with {\n${handlersStr}\n${prefix}}`
        : `with {}`;
      if (node.returnClause !== undefined) {
        const retStr = prettyPrintNode(node.returnClause, depth + 1, opts);
        return `handle {\n${inner}${bodyStr}\n${prefix}} ${withBlock} return => ${retStr}`;
      }
      return `handle {\n${inner}${bodyStr}\n${prefix}} ${withBlock}`;
    }
    case 'Resume': return `resume(${prettyPrintNode(node.value, depth, opts)})`;
    case 'ListLit': {
      const elems = node.elements.map(el => prettyPrintNode(el, depth, opts)).join(', ');
      return `[${elems}]`;
    }
    case 'TupleLit': {
      const elems = node.elements.map(el => prettyPrintNode(el, depth, opts)).join(', ');
      return `(${elems})`;
    }
    case 'MapLit': {
      const entries = node.entries.map(e =>
        `${prettyPrintNode(e.key, depth, opts)}: ${prettyPrintNode(e.value, depth, opts)}`
      ).join(', ');
      return `{${entries}}`;
    }
    case 'RawInject': return `raw(${JSON.stringify(node.code)})`;
    default: return assertNever(node);
  }
}

/** Render a full IonIRModule to .ion surface syntax. */
export function prettyPrintModule(mod: IonIRModule, opts?: PrettyOptions): string {
  const size = opts?.indentSize ?? 2;
  const sections: string[][] = [];

  const header: string[] = [`module ${mod.module}  "${mod.version}"`];
  if (mod.dialects.length > 0) {
    header.push(`// dialects: ${mod.dialects.join(', ')}`);
  }
  sections.push(header);

  if (mod.imports.length > 0) {
    sections.push(mod.imports.map(imp => `import ${imp.modulePath.join('.')}`));
  }

  if (mod.data.length > 0) {
    sections.push(mod.data.map(decl => prettyPrintNode(decl, 0, { indentSize: size })));
  }

  const declLines: string[] = [];
  for (const decl of mod.decls) {
    printTopLevelDecl(decl, size, declLines);
  }
  if (declLines.length > 0) {
    sections.push(declLines);
  }

  return sections.map(s => s.join('\n')).join('\n\n');
}
