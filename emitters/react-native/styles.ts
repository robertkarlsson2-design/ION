import type { AppNode, IonIRNode } from '../../src/ir/nodes.js';

export function kebabToCamel(key: string): string {
  if (!key.includes('-')) return key;
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function translateStyleObject(objApp: AppNode): AppNode {
  const newArgs: IonIRNode[] = [];
  for (let i = 0; i < objApp.args.length; i += 2) {
    const keyNode = objApp.args[i]!;
    const valNode = objApp.args[i + 1]!;

    let newKeyNode: IonIRNode = keyNode;
    if (keyNode.kind === 'Literal' && keyNode.value.kind === 'Str') {
      const camel = kebabToCamel(keyNode.value.value);
      if (camel !== keyNode.value.value) {
        newKeyNode = { ...keyNode, value: { kind: 'Str', value: camel } };
      }
    }

    let newValNode: IonIRNode = valNode;
    if (valNode.kind === 'Literal' && valNode.value.kind === 'Str') {
      const m = valNode.value.value.match(/^(\d+)px$/);
      if (m) {
        newValNode = { ...valNode, value: { kind: 'Int', value: parseInt(m[1]!, 10) }, type: { kind: 'Int' } };
      }
    }

    newArgs.push(newKeyNode, newValNode);
  }
  return { ...objApp, args: newArgs };
}
