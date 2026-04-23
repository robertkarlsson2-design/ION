import type { SymbolId, Span } from '../types.js';
import type { TypeAnnotation } from '../ast/types.js';

export type DeclKind =
  | 'Fn'
  | 'Let'
  | 'Data'
  | 'TypeAlias'
  | 'Extern'
  | 'Module'
  | 'Param'
  | 'TypeParam'
  | 'PatternBinding';

export interface SymbolEntry {
  readonly id: SymbolId;
  readonly name: string;
  readonly declKind: DeclKind;
  readonly span: Span;
  readonly typeAnnotation: TypeAnnotation | null;
  readonly isPublic: boolean;
}

export class SymbolTable {
  private readonly entries: Map<SymbolId, SymbolEntry> = new Map();

  /** Register a symbol entry; throws if the id is already registered. */
  register(entry: SymbolEntry): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`SymbolTable: duplicate id '${entry.id}'`);
    }
    this.entries.set(entry.id, entry);
  }

  get(id: SymbolId): SymbolEntry | undefined {
    return this.entries.get(id);
  }

  all(): IterableIterator<SymbolEntry> {
    return this.entries.values();
  }

  size(): number {
    return this.entries.size;
  }
}
