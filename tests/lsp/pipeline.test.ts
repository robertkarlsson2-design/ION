import { describe, it, expect } from 'vitest';
import { compileDocument } from '../../src/lsp/pipeline.js';

const FILE = '/tmp/test.ion';

describe('compileDocument — valid source', () => {
  it('produces no diagnostics and non-null results for well-typed source', () => {
    const src = 'pub fn add(x: Int, y: Int) -> Int = x';
    const result = compileDocument(FILE, src);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.bindResult).not.toBeNull();
    expect(result.checkResult).not.toBeNull();
  });

  it('returns tokens for any source', () => {
    const result = compileDocument(FILE, '');
    expect(result.tokens.length).toBeGreaterThan(0);
  });
});

describe('compileDocument — syntax error', () => {
  it('emits a single P-code diagnostic and null bind/check results', () => {
    const src = 'fn (';
    const result = compileDocument(FILE, src);
    expect(result.bindResult).toBeNull();
    expect(result.checkResult).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toMatch(/^P\d+/);
    expect(result.diagnostics[0]?.severity).toBe(1); // Error
  });
});

describe('compileDocument — bind error', () => {
  it('emits a B0001 diagnostic for an undefined name', () => {
    const src = 'pub fn foo() -> Int = undeclared';
    const result = compileDocument(FILE, src);
    expect(result.bindResult).not.toBeNull();
    const bindDiags = result.diagnostics.filter(d => String(d.code).startsWith('B'));
    expect(bindDiags.length).toBeGreaterThan(0);
    expect(bindDiags[0]?.code).toBe('B0001');
  });
});

describe('compileDocument — type error', () => {
  it('emits an E0401 diagnostic for a type mismatch', () => {
    const src = 'pub fn bad(x: Int) -> Str = x';
    const result = compileDocument(FILE, src);
    expect(result.checkResult).not.toBeNull();
    const typeDiags = result.diagnostics.filter(d => String(d.code).startsWith('E'));
    expect(typeDiags.length).toBeGreaterThan(0);
    expect(typeDiags[0]?.code).toBe('E0401');
  });
});
