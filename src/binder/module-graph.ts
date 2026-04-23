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

type StackFrame =
  | { type: 'enter'; node: string; path: string[] }
  | { type: 'exit'; node: string };

const nullSpan: Span = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };

/**
 * Iterative three-color DFS cycle detection across a merged module graph.
 * `spans` maps each `"fromModule→toModule"` edge key to the UseDecl span.
 */
export function detectCircularImports(
  graph: ModuleGraph,
  spans: Map<string, Span>,
): BindError[] {
  const errors: BindError[] = [];
  // 0=white, 1=gray, 2=black
  const color = new Map<string, 0 | 1 | 2>();

  for (const startNode of graph.keys()) {
    if ((color.get(startNode) ?? 0) !== 0) continue;

    const stack: StackFrame[] = [{ type: 'enter', node: startNode, path: [] }];

    while (stack.length > 0) {
      const frame = stack.pop()!;

      if (frame.type === 'exit') {
        color.set(frame.node, 2);
        continue;
      }

      const { node, path } = frame;
      if ((color.get(node) ?? 0) !== 0) continue;

      color.set(node, 1);
      stack.push({ type: 'exit', node });

      const deps = graph.get(node);
      if (deps !== undefined) {
        for (const dep of deps) {
          const depColor = color.get(dep) ?? 0;
          if (depColor === 1) {
            const cycle = [...path, node, dep];
            const span = spans.get(`${node}→${dep}`) ?? nullSpan;
            errors.push({
              kind: 'CircularImport',
              cycle,
              message: `Circular import detected: ${cycle.join(' → ')}`,
              span,
            });
          } else if (depColor === 0) {
            stack.push({ type: 'enter', node: dep, path: [...path, node] });
          }
        }
      }
    }
  }

  return errors;
}
