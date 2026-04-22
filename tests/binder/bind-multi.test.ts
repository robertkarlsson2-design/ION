import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModules } from '../../src/binder/index.js';
import type { AstModule } from '../../src/ast/nodes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(src: string, file = 'test.ion'): AstModule {
  return buildModule(parseModule(lex(src, file)));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bindModules — cross-module resolution', () => {
  it('resolves named import from another module to the exporter SymbolId', () => {
    const modules = new Map<string, AstModule>([
      ['B', parse('pub fn foo() = 42', 'B.ion')],
      ['A', parse('use B.{foo}\nfn bar() = foo()', 'A.ion')],
    ]);

    const result = bindModules(modules);
    expect(result.errors).toHaveLength(0);
    expect(result.modules).toHaveLength(2);

    const modB = result.modules.find(m => m.modulePath === 'B');
    const modA = result.modules.find(m => m.modulePath === 'A');

    const fooId = modB?.symbolTable.exports.get('foo');
    expect(fooId).toBeDefined();

    // The reference to foo inside A's bar should resolve to B's foo SymbolId
    const aRefs = Array.from(modA!.symbolTable.references.values());
    expect(aRefs).toContain(fooId);
  });

  it('emits UndefinedName when a named import is not exported by the target', () => {
    const modules = new Map<string, AstModule>([
      ['B', parse('fn internal() = 42', 'B.ion')],
      ['A', parse('use B.{Bar}\nfn test() = 42', 'A.ion')],
    ]);

    const result = bindModules(modules);
    const undefinedErrors = result.errors.filter(e => e.kind === 'UndefinedName');
    expect(undefinedErrors).toHaveLength(1);
    expect(undefinedErrors[0]).toMatchObject({ kind: 'UndefinedName', name: 'Bar' });
  });
});

describe('bindModules — circular import detection', () => {
  it('returns CircularImport error when A uses B and B uses A', () => {
    const modules = new Map<string, AstModule>([
      ['A', parse('use B.{bar}\nfn foo() -> Int = 42', 'A.ion')],
      ['B', parse('use A.{foo}\nfn bar() -> Int = 42', 'B.ion')],
    ]);

    const result = bindModules(modules);
    expect(result.modules).toHaveLength(0);

    const circularError = result.errors.find(e => e.kind === 'CircularImport');
    expect(circularError).toBeDefined();
    expect(circularError?.kind).toBe('CircularImport');

    if (circularError?.kind === 'CircularImport') {
      expect(circularError.cycle).toContain('A');
      expect(circularError.cycle).toContain('B');
    }
  });
});

describe('bindModules — topological ordering', () => {
  it('returns modules in leaves-first order for a three-module chain A -> B -> C', () => {
    const modules = new Map<string, AstModule>([
      ['A', parse('use B.{bfn}\nfn afn() = bfn()', 'A.ion')],
      ['B', parse('use C.{cfn}\npub fn bfn() = cfn()', 'B.ion')],
      ['C', parse('pub fn cfn() = 42', 'C.ion')],
    ]);

    const result = bindModules(modules);
    expect(result.errors).toHaveLength(0);
    expect(result.modules).toHaveLength(3);

    const paths = result.modules.map(m => m.modulePath);
    // C has no deps (leaf), B depends on C, A depends on B
    expect(paths.indexOf('C')).toBeLessThan(paths.indexOf('B'));
    expect(paths.indexOf('B')).toBeLessThan(paths.indexOf('A'));
  });
});
