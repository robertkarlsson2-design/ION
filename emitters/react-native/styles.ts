import type { AppNode, IonIRNode, IonIRModule, VarNode } from '../../src/ir/nodes.js';

export function kebabToCamel(key: string): string {
  if (!key.includes('-')) return key;
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function translateStyleObject(objApp: AppNode): AppNode {
  const newArgs: IonIRNode[] = [];
  for (let i = 0; i < objApp.args.length; i += 2) {
    const k = objApp.args[i]!;
    const v = objApp.args[i + 1]!;
    let newK = k;
    if (k.kind === 'Literal' && k.value.kind === 'Str') {
      const camelKey = kebabToCamel(k.value.value);
      if (camelKey !== k.value.value)
        newK = { ...k, value: { ...k.value, value: camelKey } };
    }
    let newV = v;
    if (v.kind === 'Literal' && v.value.kind === 'Str' && /^\d+px$/.test(v.value.value)) {
      const num = parseInt(v.value.value, 10);
      newV = { ...v, value: { kind: 'Int' as const, value: num }, type: { kind: 'Int' as const } };
    }
    newArgs.push(newK, newV);
  }
  return { ...objApp, args: newArgs };
}

export interface HoistResult {
  replacements: Map<string, string>;
  hoisted: Array<{ name: string; body: string }>;
}

export function isHoistableStyleObj(node: IonIRNode): node is AppNode {
  if (node.kind !== 'App') return false;
  const app = node as AppNode;
  if (app.callee.kind !== 'Var' || (app.callee as VarNode).name !== '__obj__') return false;
  if (app.args.length % 2 !== 0) return false;
  for (let i = 1; i < app.args.length; i += 2) {
    const v = app.args[i]!;
    if (v.kind !== 'Literal' && v.kind !== 'ForeignRef') return false;
  }
  return true;
}

function canonicalValue(v: IonIRNode): string {
  if (v.kind === 'Literal') {
    const lv = v.value;
    if (lv.kind === 'Str') return JSON.stringify(lv.value);
    if (lv.kind === 'Int' || lv.kind === 'Float') return String(lv.value);
    if (lv.kind === 'Bool') return String(lv.value);
    return 'null';
  }
  if (v.kind === 'ForeignRef') return `ffi:${v.module}:${v.symbol}`;
  return '';
}

export function canonicalStyleKey(objApp: AppNode): string {
  const transformed = translateStyleObject(objApp);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < transformed.args.length; i += 2) {
    const k = transformed.args[i]!;
    const v = transformed.args[i + 1]!;
    const ks = k.kind === 'Literal' && k.value.kind === 'Str' ? k.value.value : '';
    pairs.push([ks, canonicalValue(v)]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map(([k, v]) => `${k}:${v}`).join(',');
}

function renderStyleValue(v: IonIRNode): string {
  if (v.kind === 'Literal') {
    const lv = v.value;
    if (lv.kind === 'Str') return JSON.stringify(lv.value);
    if (lv.kind === 'Int' || lv.kind === 'Float') return String(lv.value);
    if (lv.kind === 'Bool') return String(lv.value);
    return 'null';
  }
  if (v.kind === 'ForeignRef') return v.symbol;
  return '';
}

function renderStyleBody(objApp: AppNode): string {
  const transformed = translateStyleObject(objApp);
  const parts: string[] = [];
  for (let i = 0; i < transformed.args.length; i += 2) {
    const origK = objApp.args[i]!;
    const tKey = transformed.args[i]!;
    const tVal = transformed.args[i + 1]!;
    const origKs = origK.kind === 'Literal' && origK.value.kind === 'Str' ? origK.value.value : null;
    const transKs = tKey.kind === 'Literal' && tKey.value.kind === 'Str' ? tKey.value.value : '';
    const comment = origKs !== null && origKs !== transKs ? ' /* kebab→camel for RN */' : '';
    parts.push(`${transKs}: ${renderStyleValue(tVal)}${comment}`);
  }
  return `{ ${parts.join(', ')} }`;
}

export function collectAndHoistStyles(irModule: IonIRModule, threshold: number): HoistResult {
  const counts = new Map<string, { count: number; node: AppNode }>();
  const order: string[] = [];

  function walkNode(node: IonIRNode): void {
    if (node.kind === 'App') {
      const app = node as AppNode;
      if (app.callee.kind === 'Var') {
        const calleeName = (app.callee as VarNode).name;
        if (calleeName === '__platform__' || calleeName === '__platform_select__') return;
      }
      if (app.propDict) {
        for (const { key, value } of app.propDict) {
          if (key === 'style' && isHoistableStyleObj(value)) {
            const styleNode = value as AppNode;
            const ckey = canonicalStyleKey(styleNode);
            if (!counts.has(ckey)) {
              counts.set(ckey, { count: 0, node: styleNode });
              order.push(ckey);
            }
            counts.get(ckey)!.count++;
          }
        }
      }
      for (const arg of app.args) {
        walkNode(arg);
      }
    } else if (node.kind === 'Abs') {
      walkNode(node.body);
    } else if (node.kind === 'Let') {
      walkNode(node.value);
      walkNode(node.body);
    } else if (node.kind === 'Case') {
      walkNode(node.scrutinee);
      for (const arm of node.arms) {
        if (arm.guard) walkNode(arm.guard);
        walkNode(arm.body);
      }
    } else if (node.kind === 'Effect') {
      walkNode(node.body);
    }
  }

  for (const decl of irModule.decls) {
    walkNode(decl);
  }

  const replacements = new Map<string, string>();
  const hoisted: Array<{ name: string; body: string }> = [];
  let styleIdx = 1;

  for (const ckey of order) {
    const entry = counts.get(ckey)!;
    if (entry.count >= threshold) {
      const name = `s${styleIdx++}`;
      replacements.set(ckey, name);
      hoisted.push({ name, body: renderStyleBody(entry.node) });
    }
  }

  return { replacements, hoisted };
}
