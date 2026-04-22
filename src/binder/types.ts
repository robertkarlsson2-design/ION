import type { Span, SymbolId } from '../types.js';
import type { TypeAnnotation } from '../ast/types.js';
import type { AstIdentNode } from '../ast/nodes.js';

/** What kind of declaration created this symbol. */
export type DeclKind =
  | 'fn' | 'let' | 'data' | 'typeAlias' | 'extern' | 'module'
  | 'param'
  | 'letBound'
  | 'patternBound';

export interface SymbolInfo {
  readonly id: SymbolId;
  readonly name: string;
  readonly declKind: DeclKind;
  readonly span: Span;
  readonly typeStub: TypeAnnotation | null;
  readonly moduleId: string;
}

/** SymbolId → SymbolInfo for one compilation unit (module). */
export type SymbolTable = ReadonlyMap<SymbolId, SymbolInfo>;

export interface ModuleEdge {
  readonly fromModuleId: string;
  readonly toModuleId: string;
  readonly alias: string | null;
  readonly importedNames: readonly string[] | null;
  readonly span: Span;
}

export interface ModuleGraph {
  readonly edges: readonly ModuleEdge[];
  readonly topologicalOrder: readonly string[];
}

// ---- Errors -----------------------------------------------------------------

export interface UndefinedNameError {
  readonly kind: 'UndefinedName';
  readonly code: 'E0301';
  readonly name: string;
  readonly span: Span;
  readonly message: string;
}

export interface DuplicateBindingError {
  readonly kind: 'DuplicateBinding';
  readonly code: 'E0302';
  readonly name: string;
  readonly span: Span;
  readonly previousSpan: Span;
  readonly message: string;
}

export interface CircularImportError {
  readonly kind: 'CircularImport';
  readonly code: 'E0303';
  readonly cycle: readonly string[];
  readonly span: Span;
  readonly message: string;
}

export type BindError = UndefinedNameError | DuplicateBindingError | CircularImportError;

// ---- Result -----------------------------------------------------------------

export interface BindResult {
  readonly symbolTable: SymbolTable;
  readonly moduleGraph: ModuleGraph;
  /** Maps each AstIdentNode object reference → the SymbolId it resolves to. */
  readonly resolutions: ReadonlyMap<AstIdentNode, SymbolId>;
  readonly errors: readonly BindError[];
}
