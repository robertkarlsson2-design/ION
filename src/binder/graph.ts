import type { AstModule } from '../ast/nodes.js';

export interface ModuleNode {
  readonly name: string;
  readonly deps: readonly string[];
}

/** Builds a dependency graph from a set of named modules by inspecting UseDecl paths. */
export function buildGraph(modules: Map<string, AstModule>): ModuleNode[] {
  const result: ModuleNode[] = [];
  for (const [name, ast] of modules) {
    const deps: string[] = [];
    for (const decl of ast.decls) {
      if (decl.kind === 'UseDecl') {
        const dep = decl.path.join('::');
        if (modules.has(dep)) {
          deps.push(dep);
        }
      }
    }
    result.push({ name, deps });
  }
  return result;
}

/**
 * Topologically sorts module nodes (leaves first).
 * Returns `{ order }` on success or `{ cycle }` with the first detected cycle path.
 */
export function topoSort(nodes: ModuleNode[]): { order: string[] } | { cycle: string[] } {
  const depMap = new Map<string, readonly string[]>(
    nodes.map(n => [n.name, n.deps]),
  );
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const order: string[] = [];

  function visit(name: string, path: string[]): string[] | null {
    if (inStack.has(name)) {
      const idx = path.indexOf(name);
      return path.slice(idx);
    }
    if (visited.has(name)) return null;

    visited.add(name);
    inStack.add(name);

    const currentPath = [...path, name];
    for (const dep of depMap.get(name) ?? []) {
      const cycle = visit(dep, currentPath);
      if (cycle !== null) return cycle;
    }

    inStack.delete(name);
    order.push(name);
    return null;
  }

  for (const node of nodes) {
    if (!visited.has(node.name)) {
      const cycle = visit(node.name, []);
      if (cycle !== null) return { cycle };
    }
  }

  return { order };
}
