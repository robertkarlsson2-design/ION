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

type StackFrame =
  | { type: 'enter'; name: string; path: string[] }
  | { type: 'exit'; name: string };

/**
 * Topologically sorts module nodes (leaves first).
 * Returns `{ order }` on success or `{ cycle }` with the first detected cycle path.
 */
export function topoSort(nodes: ModuleNode[]): { order: string[] } | { cycle: string[] } {
  const depMap = new Map<string, readonly string[]>(
    nodes.map(n => [n.name, n.deps]),
  );
  // 0 = white (unvisited), 1 = gray (in-progress), 2 = black (done)
  const color = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];

  for (const node of nodes) {
    if ((color.get(node.name) ?? 0) !== 0) continue;

    const stack: StackFrame[] = [{ type: 'enter', name: node.name, path: [] }];

    while (stack.length > 0) {
      const frame = stack.pop()!; // stack is non-empty per loop condition

      if (frame.type === 'exit') {
        color.set(frame.name, 2);
        order.push(frame.name);
        continue;
      }

      const { name, path } = frame;
      const c = color.get(name) ?? 0;

      if (c === 1) {
        const idx = path.indexOf(name);
        return { cycle: idx >= 0 ? path.slice(idx) : [name] };
      }
      if (c === 2) continue;

      color.set(name, 1);
      stack.push({ type: 'exit', name });

      const deps = depMap.get(name) ?? [];
      const nextPath = [...path, name];
      for (let i = deps.length - 1; i >= 0; i--) {
        stack.push({ type: 'enter', name: deps[i]!, path: nextPath });
      }
    }
  }

  return { order };
}
