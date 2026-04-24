import type { SymbolId, Span } from '../types.js';
import type { TypeAnnotation } from '../ast/types.js';

export type SymbolKind =
  | 'Fn'
  | 'Let'
  | 'Data'
  | 'TypeAlias'
  | 'Extern'
  | 'Module'
  | 'Param'
  | 'TypeParam'
  | 'PatternBinding'
  | 'UseImport';

export interface SymbolInfo {
  readonly id: SymbolId;
  readonly name: string;
  readonly declKind: SymbolKind;
  readonly span: Span;
  readonly isPublic: boolean;
  readonly typeAnnotation?: TypeAnnotation | null;
}

export interface ModuleSymbolTable {
  readonly symbols: ReadonlyMap<SymbolId, SymbolInfo>;
  readonly exports: ReadonlyMap<string, SymbolId>;
  readonly references: ReadonlyMap<string, SymbolId>;
  all(): Iterable<SymbolInfo>;
  size(): number;
}

export type SymbolTable = ModuleSymbolTable;

export class SymbolTableBuilder {
  private readonly _symbols: Map<SymbolId, SymbolInfo> = new Map();
  private readonly _exports: Map<string, SymbolId> = new Map();
  private readonly _references: Map<string, SymbolId> = new Map();

  /** Register a symbol entry; throws if the id is already registered. */
  register(info: SymbolInfo): void {
    if (this._symbols.has(info.id)) {
      throw new Error(`SymbolTable: duplicate id '${info.id}'`);
    }
    this._symbols.set(info.id, info);
  }

  addExport(name: string, id: SymbolId): void {
    this._exports.set(name, id);
  }

  addReference(spanKey: string, id: SymbolId): void {
    this._references.set(spanKey, id);
  }

  /** Look up a registered symbol by id (used for previousSpan on duplicate errors). */
  getById(id: SymbolId): SymbolInfo | undefined {
    return this._symbols.get(id);
  }

  build(): ModuleSymbolTable {
    const symbols: ReadonlyMap<SymbolId, SymbolInfo> = new Map(this._symbols);
    const exports: ReadonlyMap<string, SymbolId> = new Map(this._exports);
    const references: ReadonlyMap<string, SymbolId> = new Map(this._references);
    return {
      symbols,
      exports,
      references,
      all(): Iterable<SymbolInfo> { return symbols.values(); },
      size(): number { return symbols.size; },
    };
  }
}
