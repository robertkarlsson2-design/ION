import type { SymbolId, Span } from '../types.js';
import type { TypeAnnotation } from '../ast/types.js';

export type SymbolKind =
  | 'fn'
  | 'let'
  | 'data'
  | 'typeAlias'
  | 'extern'
  | 'module'
  | 'fnParam'
  | 'typeParam'
  | 'letExprBinding'
  | 'patternBinding'
  | 'useImport';

export interface SymbolInfo {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly span: Span;
  readonly pub: boolean;
  readonly typeAnnotation?: TypeAnnotation | null;
}

export interface ModuleSymbolTable {
  readonly symbols: ReadonlyMap<SymbolId, SymbolInfo>;
  readonly exports: ReadonlyMap<string, SymbolId>;
  readonly references: ReadonlyMap<string, SymbolId>;
}

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
    return {
      symbols: new Map(this._symbols),
      exports: new Map(this._exports),
      references: new Map(this._references),
    };
  }
}
