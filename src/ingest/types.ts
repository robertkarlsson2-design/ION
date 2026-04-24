import type { IonIRNode, IonIRModule } from '../ir/nodes.js';

export type { IonIRNode, IonIRModule };

/** Minimal tree-sitter-compatible CST node. Matches the actual tree-sitter SyntaxNode API. */
export interface CSTNode {
  readonly type: string;
  readonly text: string;
  readonly isNamed: boolean;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly endPosition: { readonly row: number; readonly column: number };
  readonly children: readonly CSTNode[];
}

/** Which translation layer produced this IonIR node. */
export type LayerName = 'pattern' | 'llm';

/** Records which layer translated one CST construct and what it produced. */
export interface ConstructTrace {
  readonly layer: LayerName;
  readonly cstNode: CSTNode;
  readonly ionNode: IonIRNode;
}

/** Per-layer summary counts from one pipeline run. */
export interface LayerStats {
  readonly pattern: number;
  readonly llm: number;
  readonly unhandled: number;
}

/** A construct that no layer could translate. */
export interface IngestError {
  readonly message: string;
  readonly cstNode: CSTNode;
}

/** Full result of running the pipeline on one source file. */
export interface IngestResult {
  readonly module: IonIRModule;
  readonly traces: readonly ConstructTrace[];
  readonly stats: LayerStats;
  readonly errors: readonly IngestError[];
}

/** Synchronously tries to translate a CST node → IonIR node. Returns null if no match. */
export interface PatternMatcher {
  match(node: CSTNode): IonIRNode | null;
}

/**
 * Asynchronously translates an unmatched CST subtree via LLM.
 * context = surrounding source text (±50 lines). Returns null if translation failed.
 */
export interface LLMFallbackHandler {
  translate(node: CSTNode, context: string): Promise<IonIRNode | null>;
}

/** What any language plugin must supply for ingestion. */
export interface IngestPlugin {
  readonly language: string;
  parse(source: string): CSTNode;
}

/** Full configuration passed to runPipeline(). */
export interface PipelineConfig {
  readonly plugin: IngestPlugin;
  readonly patterns: readonly PatternMatcher[];
  readonly llmFallback?: LLMFallbackHandler;
  /** Fully-qualified module name, e.g. 'org.acme.users'. */
  readonly moduleName: string;
  /** Semver version string; defaults to '0.0.0'. */
  readonly version?: string;
}
