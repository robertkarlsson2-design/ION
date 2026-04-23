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

export type DeclKind =
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

export interface BoundSymbol {
  readonly id: SymbolId;
  readonly name: string;
  readonly declKind: DeclKind;
  readonly isPublic: boolean;
}

function symbolKindToDeclKind(kind: SymbolKind): DeclKind {
  switch (kind) {
    case 'fn': return 'Fn';
    case 'let': return 'Let';
    case 'letExprBinding': return 'Let';
    case 'data': return 'Data';
    case 'typeAlias': return 'TypeAlias';
    case 'extern': return 'Extern';
    case 'module': return 'Module';
    case 'fnParam': return 'Param';
    case 'typeParam': return 'TypeParam';
    case 'patternBinding': return 'PatternBinding';
    case 'useImport': return 'UseImport';
  }
}

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
  all(): IterableIterator<BoundSymbol>;
  size(): number;
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
    const symbols = new Map(this._symbols);
    return {
      symbols,
      exports: new Map(this._exports),
      references: new Map(this._references),
      all(): IterableIterator<BoundSymbol> {
        return Array.from(symbols.values(), info => ({
          id: info.id,
          name: info.name,
          declKind: symbolKindToDeclKind(info.kind),
          isPublic: info.pub,
        })).values();
      },
      size(): number {
        return symbols.size;
      },
    };
  }
}
