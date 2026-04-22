import type { Span, SymbolId } from '../types.js';

export interface ScopeEntry {
  readonly id: SymbolId;
  readonly declSpan: Span;
}

/** Linked-list scope used during the binder walk. */
export class Scope {
  private readonly _entries: Map<string, ScopeEntry>;
  private readonly _parent: Scope | null;

  constructor(parent: Scope | null) {
    this._parent = parent;
    this._entries = new Map();
  }

  /**
   * Attempts to define `name` in this scope.
   * Returns `null` on success, or the existing entry on collision.
   */
  define(name: string, entry: ScopeEntry): ScopeEntry | null {
    const existing = this._entries.get(name);
    if (existing !== undefined) {
      return existing;
    }
    this._entries.set(name, entry);
    return null;
  }

  /** Walks the parent chain to find an entry for `name`. */
  lookup(name: string): ScopeEntry | undefined {
    return this._entries.get(name) ?? this._parent?.lookup(name);
  }

  ownNames(): IterableIterator<[string, ScopeEntry]> {
    return this._entries.entries();
  }
}
