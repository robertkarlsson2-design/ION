import type { IonType } from '../ir/types.js';
import type { SymbolId } from '../types.js';

/**
 * Immutable lexically-scoped typing environment mapping SymbolId to IonType.
 * Extend creates a child scope; lookup walks the parent chain.
 */
export class TypeEnv {
  private readonly bindings: Map<SymbolId, IonType>;

  constructor(private readonly parent: TypeEnv | null = null) {
    this.bindings = new Map();
  }

  /** Return a new child environment with the given binding added. */
  extend(id: SymbolId, type: IonType): TypeEnv {
    const child = new TypeEnv(this);
    child.bindings.set(id, type);
    return child;
  }

  /** Look up a SymbolId, walking the parent chain. Returns undefined if not found. */
  lookup(id: SymbolId): IonType | undefined {
    return this.bindings.get(id) ?? this.parent?.lookup(id);
  }
}
