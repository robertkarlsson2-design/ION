import type {
  IonIRModule,
  IonIRNode,
  AdtDeclNode,
  OopClassNode,
  OopInterfaceNode,
  EffectDeclNode,
  LetNode,
  Param,
} from '../../src/ir/nodes.js';
import { ionTypeToTs } from './emit.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a `<A, B>` type parameter list, or empty string if none. */
function typeParams(params: readonly string[] | undefined): string {
  if (!params || params.length === 0) return '';
  return '<' + params.join(', ') + '>';
}

/** Format a parameter list from Param[] → `'name: Type, ...'`. */
function formatParams(params: readonly Param[]): string {
  return params.map(p => `${p.name}: ${ionTypeToTs(p.type)}`).join(', ');
}

// ---------------------------------------------------------------------------
// Per-kind emitters
// ---------------------------------------------------------------------------

/** Emit an ADT type union + factory declares. */
function emitDtsAdt(node: AdtDeclNode): string {
  const parts: string[] = [];

  const unionMembers = node.variants.map(v => {
    if (v.fields.length === 0) {
      return `{ _tag: "${v.tag}" }`;
    }
    const fieldTypes = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join('; ');
    return `{ _tag: "${v.tag}"; ${fieldTypes} }`;
  }).join(' | ');
  parts.push(`export type ${node.name} = ${unionMembers};`);

  for (const v of node.variants) {
    if (v.fields.length === 0) {
      parts.push(`export declare const ${v.tag}: ${node.name};`);
    } else {
      const ps = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join(', ');
      parts.push(`export declare const ${v.tag}: (${ps}) => ${node.name};`);
    }
  }

  return parts.join('\n');
}

/** Emit an interface declaration. */
function emitDtsInterface(node: OopInterfaceNode): string {
  const lines: string[] = [];
  const tpStr = typeParams(node.typeParams);
  lines.push(`export interface ${node.name}${tpStr} {`);

  for (const m of node.members) {
    if (m.type.kind === 'Fn') {
      const fnParams = m.type.params
        .map((p, i) => `_${i}: ${ionTypeToTs(p)}`)
        .join(', ');
      const retT = ionTypeToTs(m.type.ret);
      lines.push(`  ${m.name}(${fnParams}): ${retT};`);
    } else {
      lines.push(`  ${m.name}: ${ionTypeToTs(m.type)};`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

/** Emit a `declare class` block with field + constructor + method signatures only. */
function emitDtsClass(node: OopClassNode): string {
  const lines: string[] = [];
  const tpStr = typeParams(node.typeParams);
  const superStr = node.superClass !== undefined ? ` extends ${String(node.superClass)}` : '';
  const implStr = node.interfaces.length > 0
    ? ` implements ${node.interfaces.map(String).join(', ')}`
    : '';
  lines.push(`export declare class ${node.name}${tpStr}${superStr}${implStr} {`);

  // Fields
  for (const f of node.fields) {
    const visPrefix = f.visibility === 'private' ? 'private '
      : f.visibility === 'protected' ? 'protected '
      : '';
    const staticPrefix = f.isStatic ? 'static ' : '';
    const readonlyPrefix = f.isReadonly ? 'readonly ' : '';
    lines.push(`  ${visPrefix}${staticPrefix}${readonlyPrefix}${f.name}: ${ionTypeToTs(f.type)};`);
  }

  // Constructor signature(s)
  if (node.constructors && node.constructors.length > 0) {
    for (const ctor of node.constructors) {
      const visPrefix = ctor.visibility === 'private' ? 'private '
        : ctor.visibility === 'protected' ? 'protected '
        : '';
      lines.push(`  ${visPrefix}constructor(${formatParams(ctor.params)});`);
    }
  } else if (node.fields.length > 0) {
    // Auto-generate constructor signature from fields
    lines.push(`  constructor(${formatParams(node.fields)});`);
  }

  // Method signatures
  for (const m of node.methods) {
    const visPrefix = m.visibility === 'private' ? 'private '
      : m.visibility === 'protected' ? 'protected '
      : '';
    const staticPrefix = m.isStatic ? 'static ' : '';
    const abstractPrefix = m.isAbstract ? 'abstract ' : '';
    const accessorPrefix = m.accessorKind === 'get' ? 'get '
      : m.accessorKind === 'set' ? 'set '
      : '';
    const retT = ionTypeToTs(m.retType);
    lines.push(`  ${visPrefix}${staticPrefix}${abstractPrefix}${accessorPrefix}${m.name}(${formatParams(m.params)}): ${retT};`);
  }

  lines.push('}');
  return lines.join('\n');
}

/** Emit an effect type alias. */
function emitDtsEffect(node: EffectDeclNode): string {
  const opSigs = node.operations.map(op => {
    const params = formatParams(op.params);
    const retT = ionTypeToTs(op.retType);
    return `${op.name}(${params}): ${retT}`;
  }).join('; ');
  return `export type ${node.name}_Effect = { ${opSigs} };`;
}

/** Emit a top-level let binding as `export declare const`. */
function emitDtsLet(node: LetNode): string {
  const t = ionTypeToTs(node.bindingType);
  return `export declare const ${node.name}: ${t};`;
}

/**
 * Emit a single top-level declaration node as a `.d.ts` string.
 * Returns `undefined` for nodes that produce no declarations (ForeignRef, expressions, etc.).
 */
function emitDtsDecl(node: IonIRNode): string | undefined {
  switch (node.kind) {
    case 'OopInterface': return emitDtsInterface(node);
    case 'OopClass': return emitDtsClass(node);
    case 'EffectDecl': return emitDtsEffect(node);
    case 'Let': return emitDtsLet(node);
    case 'RawInject': return node.code;
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Top-level export
// ---------------------------------------------------------------------------

/**
 * Emit a TypeScript declaration file (`.d.ts`) for an IonIR module.
 * Produces `export declare` signatures for all top-level functions and constants,
 * `declare class` blocks for OOP classes, `interface` declarations, and `type`
 * aliases for ADTs and effects — with no implementation code.
 */
export function emitDTS(irModule: IonIRModule): string {
  const parts: string[] = ['// Generated by ION — do not edit'];

  // ADT type unions and factory declares
  for (const adt of irModule.data) {
    parts.push(emitDtsAdt(adt));
  }

  // Collect decls by kind for canonical ordering (types before values ensures
  // forward-reference correctness in TypeScript declaration files)
  const interfaces: OopInterfaceNode[] = [];
  const classes: OopClassNode[] = [];
  const effects: EffectDeclNode[] = [];
  const lets: LetNode[] = [];
  const raws: string[] = [];

  for (const decl of irModule.decls) {
    switch (decl.kind) {
      case 'OopInterface': interfaces.push(decl); break;
      case 'OopClass': classes.push(decl); break;
      case 'EffectDecl': effects.push(decl); break;
      case 'Let': lets.push(decl); break;
      case 'RawInject': raws.push(decl.code); break;
      default: break;
    }
  }

  for (const n of interfaces) parts.push(emitDtsInterface(n));
  for (const n of classes) parts.push(emitDtsClass(n));
  for (const n of effects) parts.push(emitDtsEffect(n));
  for (const n of lets) parts.push(emitDtsLet(n));
  for (const code of raws) parts.push(code);

  return parts.join('\n') + '\n';
}

// Re-export emitDtsDecl for single-node use in tests / callers
export { emitDtsDecl };
