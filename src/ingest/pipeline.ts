import type {
  CSTNode,
  ConstructTrace,
  IngestError,
  IngestResult,
  LayerStats,
  PipelineConfig,
} from './types.js';
import type {
  IonIRNode,
  IonIRModule,
  IonIRDialect,
  AdtDeclNode,
  ModuleRefNode,
} from '../ir/nodes.js';

const MAX_WALK_DEPTH = 500;

/**
 * Run the three-layer ingestion pipeline on `source`.
 * Layer order: pattern matchers → LLM fallback. Tracks which layer handled each construct.
 */
export async function runPipeline(
  source: string,
  config: PipelineConfig,
): Promise<IngestResult> {
  const traces: ConstructTrace[] = [];
  const errors: IngestError[] = [];

  let root: ReturnType<typeof config.plugin.parse>;
  try {
    root = config.plugin.parse(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const dummyNode: CSTNode = {
      type: 'error',
      text: '',
      isNamed: false,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
      children: [],
    };
    errors.push({ message: `Plugin parse threw: ${message}`, cstNode: dummyNode });
    const module = assembleModule([], config);
    const stats = computeStats([], errors);
    return { module, traces, stats, errors };
  }

  for (const child of root.children.filter(c => c.isNamed)) {
    await walkNode(child, source, config, traces, errors, 0);
  }

  const module = assembleModule(traces, config);
  const stats = computeStats(traces, errors);

  return { module, traces, stats, errors };
}

/**
 * Recursive CST walker. Returns true if the node's subtree was fully handled.
 * Uses fresh child arrays so a successful LLM translation of the parent discards
 * any partial child errors that were collected during recursion.
 */
async function walkNode(
  node: CSTNode,
  source: string,
  config: PipelineConfig,
  traces: ConstructTrace[],
  errors: IngestError[],
  depth: number,
): Promise<boolean> {
  if (depth > MAX_WALK_DEPTH) {
    errors.push({ message: `CST depth limit exceeded at node type '${node.type}'`, cstNode: node });
    return false;
  }

  // Step 1: try pattern matchers (consume whole subtree on first match)
  for (const pattern of config.patterns) {
    let ionNode: IonIRNode | null;
    try {
      ionNode = pattern.match(node);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ message: `Pattern matcher threw: ${message}`, cstNode: node });
      continue;
    }
    if (ionNode !== null) {
      traces.push({ layer: 'pattern', cstNode: node, ionNode });
      return true;
    }
  }

  // Step 2: recurse into named children with fresh local arrays
  const childTraces: ConstructTrace[] = [];
  const childErrors: IngestError[] = [];
  const namedChildren = node.children.filter(c => c.isNamed);
  const unhandled: CSTNode[] = [];

  for (const child of namedChildren) {
    const handled = await walkNode(child, source, config, childTraces, childErrors, depth + 1);
    if (!handled) {
      unhandled.push(child);
    }
  }

  // Step 3: LLM fallback when children remain unhandled
  if (unhandled.length > 0 && config.llmFallback !== undefined) {
    let ionNode: IonIRNode | null;
    try {
      ionNode = await config.llmFallback.translate(
        node,
        extractContext(source, node),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ message: `LLM fallback threw: ${message}`, cstNode: node });
      ionNode = null;
    }
    if (ionNode !== null) {
      // LLM translates the whole subtree — discard child results
      traces.push({ layer: 'llm', cstNode: node, ionNode });
      return true;
    }
  }

  // Step 4: merge child results into caller's arrays, then decide fate of this node
  for (const t of childTraces) traces.push(t);
  for (const e of childErrors) errors.push(e);

  if (unhandled.length > 0 || namedChildren.length === 0) {
    errors.push({ message: `No handler for CST node type '${node.type}'`, cstNode: node });
    return false;
  }

  // All named children were handled recursively
  return true;
}

/** Slice ±50 lines around the node's start position. */
function extractContext(source: string, node: CSTNode): string {
  const lines = source.split('\n');
  const from = Math.max(0, node.startPosition.row - 50);
  const to = Math.min(lines.length, node.startPosition.row + 50);
  return lines.slice(from, to).join('\n');
}

/** Partition IonIR nodes from traces into imports / data / decls and build IonIRModule. */
function assembleModule(traces: readonly ConstructTrace[], config: PipelineConfig): IonIRModule {
  const imports: ModuleRefNode[] = [];
  const data: AdtDeclNode[] = [];
  const decls: IonIRNode[] = [];
  const allNodes: IonIRNode[] = [];

  for (const trace of traces) {
    const node = trace.ionNode;
    allNodes.push(node);
    if (node.kind === 'ModuleRef') {
      imports.push(node);
    } else if (node.kind === 'AdtDecl') {
      data.push(node);
    } else {
      decls.push(node);
    }
  }

  return {
    ionir: '1.0',
    module: config.moduleName,
    version: config.version ?? '0.0.0',
    dialects: detectDialects(allNodes),
    imports,
    data,
    decls,
  };
}

/** Count traces by layer and errors. */
function computeStats(
  traces: readonly ConstructTrace[],
  errors: readonly IngestError[],
): LayerStats {
  let pattern = 0;
  let llm = 0;
  for (const trace of traces) {
    if (trace.layer === 'pattern') {
      pattern++;
    } else {
      llm++;
    }
  }
  return { pattern, llm, unhandled: errors.length };
}

/**
 * Scan node kinds to determine which dialects are active.
 * 'core' is always included.
 */
function detectDialects(nodes: readonly IonIRNode[]): readonly IonIRDialect[] {
  const dialects = new Set<IonIRDialect>(['core']);
  for (const node of nodes) {
    const k = node.kind;
    if (k.startsWith('Oop')) {
      dialects.add('ion-oop');
    }
    if (k.startsWith('Async') || k === 'Await') {
      dialects.add('ion-async');
    }
    if (k.startsWith('Adt')) {
      dialects.add('ion-adt');
    }
    if (k.startsWith('Effect') || k === 'Perform' || k === 'Handle' || k === 'Resume') {
      dialects.add('ion-effects');
    }
  }
  return [...dialects];
}
