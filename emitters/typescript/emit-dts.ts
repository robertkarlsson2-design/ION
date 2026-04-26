import type {
  IonIRModule,
  AbsNode,
  LetNode,
  AdtDeclNode,
  OopClassNode,
  OopInterfaceNode,
  EffectDeclNode,
} from '../../src/ir/nodes.js';
import { ionTypeToTs, PRELUDE_NAMES } from './emit.js';

// ---------------------------------------------------------------------------
// OopClass — declaration-only (no method or constructor bodies)
// ---------------------------------------------------------------------------

function emitDtsClass(node: OopClassNode): string {
  const lines: string[] = [];

  const typeParamsStr = (node.typeParams ?? []).length > 0
    ? '<' + node.typeParams!.join(', ') + '>'
    : '';
  const superStr = node.superClass !== undefined ? ` extends ${String(node.superClass)}` : '';
  const implStr = node.interfaces.length > 0
    ? ` implements ${node.interfaces.map(String).join(', ')}`
    : '';
  lines.push(`export declare class ${node.name}${typeParamsStr}${superStr}${implStr} {`);

  for (const f of node.fields) {
    const ft = ionTypeToTs(f.type);
    const visPrefix = f.visibility === 'private' ? 'private '
      : f.visibility === 'protected' ? 'protected '
      : '';
    const staticPrefix = f.isStatic ? 'static ' : '';
    const readonlyPrefix = f.isReadonly ? 'readonly ' : '';
    lines.push(`  ${visPrefix}${staticPrefix}${readonlyPrefix}${f.name}: ${ft};`);
  }

  if (node.constructors && node.constructors.length > 0) {
    for (const ctor of node.constructors) {
      const visPrefix = ctor.visibility === 'private' ? 'private '
        : ctor.visibility === 'protected' ? 'protected '
        : '';
      const ctorParams = ctor.params
        .map(p => `${p.name}: ${ionTypeToTs(p.type)}`)
        .join(', ');
      lines.push(`  ${visPrefix}constructor(${ctorParams});`);
    }
  } else if (node.fields.length > 0) {
    const ctorParams = node.fields
      .map(f => `${f.name}: ${ionTypeToTs(f.type)}`)
      .join(', ');
    lines.push(`  constructor(${ctorParams});`);
  }

  for (const m of node.methods) {
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
    lines.push(`  ${visPrefix}${staticPrefix}${abstractPrefix}${accessorPrefix}${m.name}(${params})${retAnnotation};`);
  }

  lines.push('}');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// OopInterface — mirrors TS emitter but with export prefix
// ---------------------------------------------------------------------------

function emitDtsInterface(node: OopInterfaceNode): string {
  const lines: string[] = [];

  const typeParamsStr = (node.typeParams ?? []).length > 0
    ? '<' + node.typeParams!.join(', ') + '>'
    : '';
  lines.push(`export interface ${node.name}${typeParamsStr} {`);

  for (const m of node.members) {
    const mt = ionTypeToTs(m.type);
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
// AdtDecl — type union alias + variant constructor declarations
// ---------------------------------------------------------------------------

function emitDtsAdtType(node: AdtDeclNode): string {
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
      parts.push(`export declare const ${v.tag}: { readonly _tag: "${v.tag}" };`);
    } else {
      const ps = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join(', ');
      parts.push(`export declare function ${v.tag}(${ps}): ${node.name};`);
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// EffectDecl — type alias only, no comment preamble
// ---------------------------------------------------------------------------

function emitDtsEffectDecl(node: EffectDeclNode): string {
  const opSigs = node.operations.map(op => {
    const params = op.params.map(p => {
      const t = ionTypeToTs(p.type);
      return t === 'unknown' ? p.name : `${p.name}: ${t}`;
    }).join(', ');
    const retT = ionTypeToTs(op.retType);
    return `${op.name}(${params}): ${retT}`;
  }).join('; ');
  return `export type ${node.name}_Effect = { ${opSigs} };`;
}

// ---------------------------------------------------------------------------
// Let node — const, function, or extern declaration
// ---------------------------------------------------------------------------

function emitDtsLet(lt: LetNode): string {
  if (lt.value.kind === 'Abs') {
    const abs = lt.value as AbsNode;
    const params = abs.params.map(p => {
      const t = ionTypeToTs(p.type);
      return t === 'unknown' ? p.name : `${p.name}: ${t}`;
    }).join(', ');
    const retT = abs.type.kind === 'Fn' ? ionTypeToTs(abs.type.ret) : ionTypeToTs(lt.bindingType);
    const retAnnotation = retT !== 'unknown' ? `: ${retT}` : '';
    return `export declare function ${lt.name}(${params})${retAnnotation};`;
  }

  if (lt.value.kind === 'ForeignRef') {
    const typeStr = ionTypeToTs(lt.bindingType);
    return `export declare const ${lt.name}: ${typeStr};`;
  }

  const bindT = ionTypeToTs(lt.bindingType);
  const typeAnnotation = bindT !== 'unknown' ? `: ${bindT}` : '';
  return `export declare const ${lt.name}${typeAnnotation};`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Emit a TypeScript `.d.ts` declaration file from an IonIR module.
 * Produces only type-level declarations — no implementations, no prelude,
 * no `"use strict"`.
 */
export function emitTsDts(irModule: IonIRModule): string {
  const parts: string[] = [];

  // ADT declarations land in module.data from the desugar pipeline
  for (const d of irModule.data) {
    parts.push(emitDtsAdtType(d));
  }

  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      const lt = d as LetNode;
      if (PRELUDE_NAMES.has(lt.name)) continue;
      parts.push(emitDtsLet(lt));
    } else if (d.kind === 'AdtDecl') {
      // AdtDecl nodes appearing directly in decls (e.g. from IR fixtures)
      parts.push(emitDtsAdtType(d as AdtDeclNode));
    } else if (d.kind === 'OopClass') {
      parts.push(emitDtsClass(d as OopClassNode));
    } else if (d.kind === 'OopInterface') {
      parts.push(emitDtsInterface(d as OopInterfaceNode));
    } else if (d.kind === 'EffectDecl') {
      parts.push(emitDtsEffectDecl(d as EffectDeclNode));
    }
  }

  return parts.join('\n') + '\n';
}
