import { describe, it, expect } from 'vitest';
import { SymbolTable } from '../../src/binder/symbol-table.js';
import type { SymbolEntry } from '../../src/binder/symbol-table.js';
import { makeSymbolId } from '../../src/types.js';

function makeEntry(raw: string, name: string): SymbolEntry {
  return {
    id: makeSymbolId(raw),
    name,
    declKind: 'Let',
    span: { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 },
    typeAnnotation: null,
    isPublic: false,
  };
}

describe('SymbolTable', () => {
  it('register() and get() — happy path stores and retrieves entry', () => {
    const table = new SymbolTable();
    const entry = makeEntry('test$x$0', 'x');
    table.register(entry);
    expect(table.get(makeSymbolId('test$x$0'))).toBe(entry);
  });

  it('register() throws on duplicate id', () => {
    const table = new SymbolTable();
    const entry = makeEntry('test$x$0', 'x');
    table.register(entry);
    expect(() => table.register(entry)).toThrow('duplicate id');
  });

  it('get() returns undefined for unknown id', () => {
    const table = new SymbolTable();
    expect(table.get(makeSymbolId('nonexistent$0'))).toBeUndefined();
  });

  it('all() yields all registered entries', () => {
    const table = new SymbolTable();
    const a = makeEntry('test$a$0', 'a');
    const b = makeEntry('test$b$1', 'b');
    table.register(a);
    table.register(b);
    expect([...table.all()]).toEqual(expect.arrayContaining([a, b]));
    expect([...table.all()]).toHaveLength(2);
  });

  it('size() reflects count after registrations', () => {
    const table = new SymbolTable();
    expect(table.size()).toBe(0);
    table.register(makeEntry('test$x$0', 'x'));
    expect(table.size()).toBe(1);
    table.register(makeEntry('test$y$1', 'y'));
    expect(table.size()).toBe(2);
  });
});
