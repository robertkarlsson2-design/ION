import type { Span, SymbolId } from '../types.js';
import type { TypeAnnotation } from '../ast/types.js';

export type SymbolKind =
  | 'fn'
  | 'let'
  | 'data'
  | 'type-alias'
  | 'extern'
  | 'module'
  | 'param'
  | 'type-param'
  | 'pattern-var'
  | 'import';

export interface SymbolInfo {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly declSpan: Span;
  readonly typeAnnotation: TypeAnnotation | null;
  readonly pub: boolean;
}

export interface BinderError {
  readonly kind: 'UndefinedName' | 'DuplicateBinding' | 'CircularImport';
  readonly message: string;
  readonly span: Span;
}

export interface ModuleBindResult {
  /** All symbols defined in this module (including nested and non-exported). */
  readonly symbols: ReadonlyMap<SymbolId, SymbolInfo>;
  /** Maps spanKey (`${file}:${startLine}:${startCol}`) of each Ident node to its resolved SymbolId. */
  readonly resolution: ReadonlyMap<string, SymbolId>;
  /** Top-level pub symbols: name → SymbolId. */
  readonly exports: ReadonlyMap<string, SymbolId>;
  /** Dot-separated import paths from `use` declarations (e.g. `'std.http'`). */
  readonly importedPaths: readonly string[];
  readonly errors: readonly BinderError[];
}

export interface ProgramBindResult {
  /** File path → per-module bind result. */
  readonly modules: ReadonlyMap<string, ModuleBindResult>;
  /** Topological compilation order (dependencies before dependents). */
  readonly order: readonly string[];
  /** CircularImport errors from the dependency graph. */
  readonly errors: readonly BinderError[];
}
