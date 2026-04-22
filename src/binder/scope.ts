import { makeSymbolId } from '../types.js';
import type { SymbolId } from '../types.js';
import type { SymbolInfo } from './types.js';

/**
 * Lexical scope chain for a single module bind pass.
 * Index 0 is module-level; the last element is the innermost scope.
 */
export class ScopeChain {
  private readonly stack: Array<Map<string, SymbolId>>;
  private readonly table: Map<SymbolId, SymbolInfo>;
  private counter: number;

  constructor() {
    this.stack = [new Map()];
    this.table = new Map();
    this.counter = 0;
  }

  pushScope(): void {
    this.stack.push(new Map());
  }

  popScope(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
    }
  }

  /**
   * Define a name in the current (innermost) scope.
   * Returns `{ id }` on success or `{ duplicate }` if the name already exists
   * in the same scope.
   */
  define(info: Omit<SymbolInfo, 'id'>): { id: SymbolId } | { duplicate: SymbolInfo } {
    const current = this.stack[this.stack.length - 1]!;
    const existingId = current.get(info.name);
    if (existingId !== undefined) {
      return { duplicate: this.table.get(existingId)! };
    }
    const id = makeSymbolId(`${info.moduleId}:${info.name}:${this.counter++}`);
    current.set(info.name, id);
    this.table.set(id, { ...info, id });
    return { id };
  }

  /** Walk from innermost to outermost scope looking for name. */
  resolve(name: string): SymbolId | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const id = this.stack[i]!.get(name);
      if (id !== undefined) return id;
    }
    return undefined;
  }

  /** Snapshot the full symbol table (called when binder is done). */
  snapshot(): ReadonlyMap<SymbolId, SymbolInfo> {
    return this.table;
  }
}
