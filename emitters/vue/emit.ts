import type {
  IonIRModule,
  IonIRNode,
  LetNode,
  AbsNode,
  VarNode,
  AppNode,
  AccessorNode,
  CasePattern,
  OopClassNode,
  OopAnnotation,
  OopConstructor,
  OopInterfaceNode,
  AdtDeclNode,
  AdtMatchNode,
  EffectDeclNode,
  RawInjectNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import { isHtmlElement } from '../ui-shared.js';
import { emitHtmlNode } from '../html/emit.js';

let _vueCtorFields: Map<string, readonly string[]> = new Map();

function buildVueCtorBindings(pat: CasePattern, scrutinee: string): Array<{ name: string; member: string }> {
  if (pat.kind !== 'Constructor') return [];
  const fieldNames = _vueCtorFields.get(pat.ctorName) ?? [];
  const result: Array<{ name: string; member: string }> = [];
  for (let fi = 0; fi < pat.fields.length; fi++) {
    const f = pat.fields[fi]!;
    if (f.kind !== 'Var') continue;
    result.push({ name: f.name, member: fieldNames[fi] ?? `_${fi}` });
  }
  return result;
}

function emitVuePatCond(pat: CasePattern, scrutinee: string): string {
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
// IonType → TypeScript type annotation (used in <script setup lang="ts">)
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
// emitTsExprForVue — simple TS expression emitter for <script setup> values
// ---------------------------------------------------------------------------

export function emitTsExprForVue(node: IonIRNode): string {
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
        const _n = (app.callee as VarNode).name;
        if ((_n === '__platform__' || _n === '__platform_select__') && app.args.length >= 2)
          return `/* __platform__ requires --target react-native */ ${emitTsExprForVue(app.args[1]!)}`;
      }
      const callee = emitTsExprForVue(app.callee);
      const args = app.args.map(emitTsExprForVue).join(', ');
      return `${callee}(${args})`;
    }
    case 'Abs': {
      const abs = node as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      return `(${params}) => ${emitTsExprForVue(abs.body)}`;
    }
    case 'Accessor':
      return `${emitTsExprForVue((node as AccessorNode).receiver)}.${(node as AccessorNode).member}`;
    case 'ListLit':
      return `[${node.elements.map(emitTsExprForVue).join(', ')}]`;
    case 'MapLit': {
      const entries = node.entries.map(e => `[${emitTsExprForVue(e.key)}, ${emitTsExprForVue(e.value)}]`).join(', ');
      return `new Map([${entries}])`;
    }
    case 'Let': {
      let cur: IonIRNode = node;
      while (cur.kind === 'Let') cur = (cur as LetNode).body;
      return emitTsExprForVue(cur);
    }
    case 'Case': {
      const c = node;
      if (c.arms.length === 0) return 'undefined';
      if (c.arms.length === 1 && c.arms[0]!.pattern.kind === 'Wildcard') {
        return emitTsExprForVue(c.arms[0]!.body);
      }
      if (
        c.arms.length === 2 &&
        c.arms[0]!.pattern.kind === 'Literal' &&
        c.arms[0]!.pattern.value.kind === 'Bool' &&
        c.arms[0]!.pattern.value.value === true &&
        c.arms[1]!.pattern.kind === 'Wildcard'
      ) {
        return `(${emitTsExprForVue(c.scrutinee)} ? ${emitTsExprForVue(c.arms[0]!.body)} : ${emitTsExprForVue(c.arms[1]!.body)})`;
      }
      const scrutinee = emitTsExprForVue(c.scrutinee);
      const parts: string[] = [];
      for (let i = 0; i < c.arms.length; i++) {
        const arm = c.arms[i]!;
        const isLast = i === c.arms.length - 1;
        const pat = arm.pattern;
        if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
          parts.push(emitTsExprForVue(arm.body));
        } else {
          const cond = emitVuePatCond(pat, scrutinee);
          const bindings = buildVueCtorBindings(pat, scrutinee);
          if (bindings.length > 0) {
            const decls = bindings.map(b => `const ${b.name} = ${scrutinee}.${b.member};`).join(' ');
            parts.push(`${cond} ? (() => { ${decls} return ${emitTsExprForVue(arm.body)}; })()`);
          } else {
            parts.push(`${cond} ? ${emitTsExprForVue(arm.body)}`);
          }
        }
      }
      if (parts.length === 1) return parts[0]!;
      const last = parts.pop()!;
      return parts.join(' : ') + ' : ' + last;
    }
    case 'Constructor': {
      const args = node.args.map(emitTsExprForVue).join(', ');
      return `{ _tag: '${node.ctorName}' as const${args ? `, _args: [${args}] as const` : ''} }`;
    }
    case 'ModuleRef': return node.modulePath.join('.');
    case 'ForeignRef': return node.target;
    case 'Effect': return emitTsExprForVue(node.body);
    case 'OopNew': {
      const args = node.args.map(emitTsExprForVue).join(', ');
      return `new _ctor_${node.ctorSymbolId}(${args})`;
    }
    case 'OopVirtualCall': {
      const receiver = emitTsExprForVue(node.receiver);
      const args = node.args.map(emitTsExprForVue).join(', ');
      return `${receiver}.${node.method}(${args})`;
    }
    case 'OopThis': return 'this';
    case 'AsyncBlock': return `(async () => ${emitTsExprForVue(node.body)})()`;
    case 'Await': return `await ${emitTsExprForVue(node.expr)}`;
    case 'AdtMatch': {
      const adtMatch = node as AdtMatchNode;
      const subject = emitTsExprForVue(adtMatch.scrutinee);
      const arms = adtMatch.arms.map(arm => {
        const bindings = arm.bindings.map((b, i) => `const ${b.name} = _v._args[${i}];`).join(' ');
        return `if (_v._tag === '${arm.tag}') { ${bindings} return (${emitTsExprForVue(arm.body)}); }`;
      }).join(' else ');
      return `((_v: any) => { ${arms} return undefined; })(${subject})`;
    }
    case 'Perform': return `/* perform ${node.operation} */(${node.args.map(emitTsExprForVue).join(', ')})`;
    case 'Handle': return emitTsExprForVue(node.body);
    case 'Resume': return emitTsExprForVue(node.value);
    // Declaration nodes in expression position — reference by name
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
// emitScriptDeclForVue — emit non-Let top-level node as <script setup> code
// ---------------------------------------------------------------------------

function emitScriptDeclForVue(node: IonIRNode): string {
  switch (node.kind) {
    case 'OopClass': {
      const cls = node as OopClassNode;
      const lines: string[] = [];

      // annotations → emit as vue-class-component @Component decorator if present
      const annotations: readonly OopAnnotation[] = cls.annotations ?? [];
      const componentAnnotation = annotations.find(a => a.name === 'Component');
      if (componentAnnotation) {
        const args = componentAnnotation.args.length > 0
          ? `({ ${componentAnnotation.args.join(', ')} })`
          : '({})';
        lines.push(`@Component${args}`);
      } else if (annotations.length > 0) {
        for (const ann of annotations) {
          const args = ann.args.length > 0 ? `(${ann.args.join(', ')})` : '';
          lines.push(`@${ann.name}${args}`);
        }
      }

      // In Vue Composition API context, emit as a class or composable
      lines.push(`// Class: ${cls.name}`);
      // typeParams → skipped (Vue SFCs don't parameterize component class)
      if (cls.fields.length > 0) {
        lines.push(`interface ${cls.name}Options {`);
        for (const f of cls.fields) {
          lines.push(`  ${f.name}: ${ionTypeToTs(f.type)};`);
        }
        lines.push(`}`);
      }
      lines.push(`class ${cls.name} {`);

      // Explicit constructors → emit body as created() lifecycle hook instead of constructor
      const constructors: readonly OopConstructor[] = cls.constructors ?? [];
      if (constructors.length > 0) {
        const ctor = constructors[0]!;
        const bodyStr = ctor.body ? emitTsExprForVue(ctor.body) : '';
        lines.push(`  created() {`);
        if (bodyStr) lines.push(`    ${bodyStr};`);
        lines.push(`  }`);
      } else if (cls.fields.length > 0) {
        const fieldParams = cls.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join(', ');
        lines.push(`  constructor(${fieldParams}) {`);
        for (const f of cls.fields) {
          lines.push(`    this.${f.name} = ${f.name};`);
        }
        lines.push(`  }`);
      }

      for (const m of cls.methods) {
        const params = m.params.map(p => `${p.name}: ${ionTypeToTs(p.type)}`).join(', ');
        const retType = ionTypeToTs(m.retType);
        const bodyStr = m.body ? emitTsExprForVue(m.body) : 'undefined';
        const staticKw = m.isStatic ? 'static ' : '';
        // accessorKind === 'get' → Vue computed property getter
        if (m.accessorKind === 'get') {
          lines.push(`  // computed`);
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
      // typeParams → skipped (Vue SFCs don't typically parameterize interfaces)
      // annotations → emit as comments
      for (const ann of iface.annotations ?? []) {
        lines.push(`// @${ann.name}${ann.args.length > 0 ? `(${ann.args.join(', ')})` : ''}`);
      }
      lines.push(`interface ${iface.name} {`);
      for (const m of iface.members) {
        lines.push(`  ${m.name}: ${ionTypeToTs(m.type)};`);
      }
      lines.push(`}`);
      return lines.join('\n');
    }

    case 'AdtDecl': {
      const adt = node as AdtDeclNode;
      const lines: string[] = [];
      for (const v of adt.variants) {
        const fields = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join('; ');
        lines.push(`interface ${v.tag} { readonly _tag: '${v.tag}'; ${fields} }`);
      }
      const union = adt.variants.map(v => v.tag).join(' | ');
      lines.push(`type ${adt.name} = ${union || 'never'};`);
      for (const v of adt.variants) {
        const params = v.fields.map(f => `${f.name}: ${ionTypeToTs(f.type)}`).join(', ');
        const body = v.fields.map(f => f.name).join(', ');
        lines.push(`function make${v.tag}(${params}): ${v.tag} { return { _tag: '${v.tag}'${v.fields.length > 0 ? `, ${body}` : ''} }; }`);
      }
      return lines.join('\n');
    }

    case 'EffectDecl': {
      const eff = node as EffectDeclNode;
      const lines: string[] = [];
      // In Vue: emit as a composable stub
      lines.push(`// Effect: ${eff.name}`);
      lines.push(`function use${eff.name}() {`);
      for (const op of eff.operations) {
        const params = op.params.map(p => `${p.name}: ${ionTypeToTs(p.type)}`).join(', ');
        const retType = ionTypeToTs(op.retType);
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
// emitVue
// ---------------------------------------------------------------------------

export function emitVue(irModule: IonIRModule): string {
  _vueCtorFields = new Map();
  for (const d of irModule.data) {
    for (const v of d.variants) {
      _vueCtorFields.set(v.tag, v.fields.map(f => f.name));
    }
  }

  // Build environment map for variable resolution
  const env = new Map<string, IonIRNode>();
  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      env.set((d as LetNode).name, (d as LetNode).value);
    }
  }

  // Split decls into template elements and script bindings
  const templateDecls: LetNode[] = [];
  const scriptDecls: LetNode[] = [];
  const extraScriptDecls: IonIRNode[] = [];

  for (const d of irModule.decls) {
    if (d.kind === 'Let') {
      const lt = d as LetNode;
      const value = lt.value;

      if (isHtmlElement(value)) {
        templateDecls.push(lt);
      } else if (value.kind === 'Abs' && isHtmlElement((value as AbsNode).body)) {
        // Function component wrapping an element — goes in template
        templateDecls.push(lt);
      } else {
        scriptDecls.push(lt);
      }
    } else {
      // Non-Let top-level nodes: OopClass, OopInterface, AdtDecl, EffectDecl, etc.
      extraScriptDecls.push(d);
    }
  }

  // Build template section
  // Use the last declared element (likely the root page component)
  let templateContent: string;
  if (templateDecls.length === 0) {
    templateContent = '<div><!-- empty --></div>';
  } else {
    const lastDecl = templateDecls[templateDecls.length - 1]!;
    const value = lastDecl.value;
    if (value.kind === 'Abs') {
      templateContent = emitHtmlNode((value as AbsNode).body, env);
    } else {
      templateContent = emitHtmlNode(value, env);
    }
  }

  // Indent template content
  const indented = templateContent
    .split('\n')
    .map(line => (line.trim() ? `  ${line}` : line))
    .join('\n');

  // Build script section
  const scriptLines: string[] = [];

  // Module-level ADT data declarations
  for (const adt of irModule.data) {
    scriptLines.push(emitScriptDeclForVue(adt));
    scriptLines.push('');
  }

  // Extra non-Let declarations (OopClass, OopInterface, AdtDecl, EffectDecl, etc.)
  for (const decl of extraScriptDecls) {
    scriptLines.push(emitScriptDeclForVue(decl));
    scriptLines.push('');
  }

  // Let bindings
  for (const lt of scriptDecls) {
    const value = lt.value;
    if (value.kind === 'Abs') {
      const abs = value as AbsNode;
      const params = abs.params.map(p => p.name).join(', ');
      scriptLines.push(`const ${lt.name} = (${params}) => ${emitTsExprForVue(abs.body)};`);
    } else {
      scriptLines.push(`const ${lt.name} = ${emitTsExprForVue(value)};`);
    }
  }

  const scriptContent = scriptLines.join('\n');

  return [
    `<template>`,
    indented,
    `</template>`,
    ``,
    `<script setup lang="ts">`,
    scriptContent,
    `</script>`,
    ``,
    `<style scoped>`,
    `/* styles go here */`,
    `</style>`,
    ``,
  ].join('\n');
}
