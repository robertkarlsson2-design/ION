import type { AppNode, IonIRNode } from '../../src/ir/nodes.js';

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
