import type { AstDeclNode } from '../ast/nodes.js';
import type { Span } from '../types.js';
import type { BindError } from './errors.js';

/** Directed graph: modulePath → set of imported module paths. */
export type ModuleGraph = Map<string, Set<string>>;

/**
 * Extract UseDecl paths from a module's declarations, returning a ModuleGraph
 * entry for `modulePath`.
 */
export function buildModuleGraph(
  modulePath: string,
  decls: readonly AstDeclNode[],
): ModuleGraph {
  const graph: ModuleGraph = new Map();
  const deps = new Set<string>();
  for (const decl of decls) {
    if (decl.kind === 'UseDecl') {
      deps.add(decl.path.join('.'));
    }
  }
  graph.set(modulePath, deps);
  return graph;
}

/**
 * DFS-based cycle detection across a merged module graph.
 * `spans` maps each `"fromModule→toModule"` edge key to the UseDecl span.
 */
export function detectCircularImports(
  graph: ModuleGraph,
  spans: Map<string, Span>,
): BindError[] {
  const errors: BindError[] = [];
  // Three-color DFS: 0=white, 1=gray, 2=black
  const color = new Map<string, 0 | 1 | 2>();

  function dfs(node: string, path: string[]): void {
    color.set(node, 1);
    const deps = graph.get(node);
    if (deps !== undefined) {
      for (const dep of deps) {
        const edgeKey = `${node}→${dep}`;
        const c = color.get(dep) ?? 0;
        if (c === 1) {
          // Back edge — cycle detected
          const span = spans.get(edgeKey) ?? {
            file: '',
            startLine: 0,
            startCol: 0,
            endLine: 0,
            endCol: 0,
          };
          errors.push({
            kind: 'CircularImport',
            cycle: [...path, node, dep],
            message: `Circular import detected: ${[...path, node, dep].join(' → ')}`,
            span,
          });
        } else if (c === 0) {
          dfs(dep, [...path, node]);
        }
      }
    }
    color.set(node, 2);
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? 0) === 0) {
      dfs(node, []);
    }
  }

  return errors;
}
