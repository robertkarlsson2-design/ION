import type { IonIRModule, IonIRNode, LetNode } from '../ir/nodes.js';

/** Walk an IR node and collect all Var names referenced. */
function collectVarNames(node: IonIRNode, out: Set<string>): void {
  switch (node.kind) {
    case 'Var': out.add(node.name); break;
    case 'App': collectVarNames(node.callee, out); node.args.forEach(a => collectVarNames(a, out)); break;
    case 'Abs': collectVarNames(node.body, out); break;
    case 'Let': collectVarNames(node.value, out); collectVarNames(node.body, out); break;
    case 'Case':
      collectVarNames(node.scrutinee, out);
      node.arms.forEach(a => { if (a.guard !== undefined) collectVarNames(a.guard, out); collectVarNames(a.body, out); });
      break;
    case 'Accessor': collectVarNames(node.receiver, out); break;
    case 'ListLit': node.elements.forEach(e => collectVarNames(e, out)); break;
    case 'MapLit': node.entries.forEach(e => { collectVarNames(e.key, out); collectVarNames(e.value, out); }); break;
    case 'Constructor': node.args.forEach(a => collectVarNames(a, out)); break;
    case 'AdtMatch': collectVarNames(node.scrutinee, out); node.arms.forEach(a => collectVarNames(a.body, out)); break;
    case 'OopNew': node.args.forEach(a => collectVarNames(a, out)); break;
    case 'OopVirtualCall': collectVarNames(node.receiver, out); node.args.forEach(a => collectVarNames(a, out)); break;
    case 'AsyncBlock': collectVarNames(node.body, out); break;
    case 'Await': collectVarNames(node.expr, out); break;
    case 'Perform': node.args.forEach(a => collectVarNames(a, out)); break;
    case 'Handle':
      collectVarNames(node.body, out);
      node.handlers.forEach(h => collectVarNames(h.body, out));
      if (node.returnClause !== undefined) collectVarNames(node.returnClause, out);
      break;
    case 'Resume': collectVarNames(node.value, out); break;
    case 'Effect': collectVarNames(node.body, out); break;
    default: break;
  }
}

/**
 * Remove unused prelude ForeignRef Let declarations from the IR module.
 * A ForeignRef Let is kept only if its name is referenced anywhere in the module.
 */
export function shakePreludeDecls(module: IonIRModule): IonIRModule {
  const used = new Set<string>();
  for (const d of module.decls) collectVarNames(d, used);

  const filteredDecls = module.decls.filter(d => {
    if (d.kind !== 'Let') return true;
    const lt = d as LetNode;
    if (lt.value.kind !== 'ForeignRef') return true;
    return used.has(lt.name);
  });

  return { ...module, decls: filteredDecls };
}
