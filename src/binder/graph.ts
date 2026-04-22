import type { ModuleBindResult } from './types.js';

/**
 * Builds a dependency adjacency list: graph[A] = set of module paths that A imports.
 * Only edges to known modules (keys present in `modules`) are recorded.
 */
export function buildGraph(
  modules: ReadonlyMap<string, ModuleBindResult>,
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const [path] of modules) {
    graph.set(path, new Set());
  }
  for (const [path, result] of modules) {
    for (const imported of result.importedPaths) {
      if (graph.has(imported)) {
        // path is always in graph since it was seeded in the loop above
        graph.get(path)!.add(imported);
      }
    }
  }
  return graph;
}

/**
 * Kahn's BFS topological sort.
 * Returns `order` (dependencies before dependents) and `cycles` (nodes that could
 * not be ordered because they participate in a cycle).
 */
export function topoSort(
  graph: Map<string, Set<string>>,
): { order: string[]; cycles: string[][] } {
  // inDegree[A] = number of dependencies A still has (i.e. |graph[A]| initially)
  const inDegree = new Map<string, number>();
  // reverseDeps[B] = set of nodes that depend on B (need B to be processed first)
  const reverseDeps = new Map<string, Set<string>>();

  for (const node of graph.keys()) {
    inDegree.set(node, 0);
    reverseDeps.set(node, new Set());
  }

  for (const [node, deps] of graph) {
    inDegree.set(node, deps.size);
    for (const dep of deps) {
      reverseDeps.get(dep)?.add(node);
    }
  }

  const queue: string[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    // Non-null: guarded by queue.length > 0
    const node = queue.shift()!;
    order.push(node);
    for (const dependent of reverseDeps.get(node) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push(dependent);
    }
  }

  if (order.length === graph.size) {
    return { order, cycles: [] };
  }

  // Any node not in `order` is part of a cycle
  const processedSet = new Set(order);
  const cycleNodes = [...graph.keys()].filter(n => !processedSet.has(n));
  return { order, cycles: [cycleNodes] };
}
