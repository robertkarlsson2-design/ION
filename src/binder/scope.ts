import type { SymbolId, Span } from '../types.js';
import type { BinderError } from './types.js';

/** Lexical scope node in the scope chain. Internal to the binder. */
export class Scope {
  private readonly bindings = new Map<string, SymbolId>();

  constructor(private readonly parent: Scope | null) {}

  /** Walks the parent chain until the name is found; returns null if not found. */
  lookup(name: string): SymbolId | null {
    const id = this.bindings.get(name);
    if (id !== undefined) return id;
    return this.parent?.lookup(name) ?? null;
  }

  /**
   * Defines a name in this scope.
   * Returns a DuplicateBinding error if the name already exists in THIS scope
   * (shadowing an outer scope is allowed).
   */
  define(name: string, id: SymbolId, span: Span): BinderError | null {
    if (this.bindings.has(name)) {
      return {
        kind: 'DuplicateBinding',
        message: `'${name}' is already defined in this scope`,
        span,
      };
    }
    this.bindings.set(name, id);
    return null;
  }

  /** Creates a child scope with this scope as parent. */
  child(): Scope {
    return new Scope(this);
  }
}
