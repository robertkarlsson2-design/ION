import { describe, it, expect } from 'vitest';
import { parseJavaScript } from '../../../skills/javascript/parser.js';
import type {
  JsFunctionDecl,
  JsVariableDecl,
  JsVariableDeclarator,
  JsArrowFunction,
  JsImportStmt,
} from '../../../skills/javascript/node-types.js';

// ---------------------------------------------------------------------------
// Function declaration
// ---------------------------------------------------------------------------

describe('function declaration', () => {
  it('parses function add(a, b) correctly', () => {
    const result = parseJavaScript('function add(a, b) { return a + b; }', 'test.js');
    expect(result.root.raw.type).toBe('program');
    const stmts = result.root.statements();
    expect(stmts).toHaveLength(1);
    const fnDecl = stmts[0] as JsFunctionDecl;
    expect(fnDecl.raw.type).toBe('function_declaration');
    expect(fnDecl.name()?.text()).toBe('add');
    expect(fnDecl.params()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Error-tolerant parsing
// ---------------------------------------------------------------------------

describe('error-tolerant parsing', () => {
  it('returns hasErrors=true for malformed input but root is still accessible', () => {
    const result = parseJavaScript('function (', 'test.js');
    expect(result.hasErrors).toBe(true);
    expect(result.root).toBeDefined();
    expect(result.root.raw.type).toBe('program');
  });
});

// ---------------------------------------------------------------------------
// toSpan
// ---------------------------------------------------------------------------

describe('toSpan', () => {
  it('converts position 0,0 to startLine=1, startCol=0', () => {
    const result = parseJavaScript('foo', 'test.js');
    // The root node (program) starts at row 0, col 0 in tree-sitter
    const span = result.toSpan(result.root.raw);
    expect(span.startLine).toBe(1);
    expect(span.startCol).toBe(0);
    expect(span.file).toBe('test.js');
  });

  it('returns startLine > 1 for tokens on line 2+', () => {
    const src = 'const a = 1;\nconst b = 2;';
    const result = parseJavaScript(src, 'test.js');
    const stmts = result.root.statements();
    expect(stmts.length).toBeGreaterThanOrEqual(2);
    const second = stmts[1];
    if (!second) throw new Error('expected second statement');
    const span = result.toSpan(second.raw);
    expect(span.startLine).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Arrow function
// ---------------------------------------------------------------------------

describe('arrow function', () => {
  it('parses const f = x => x * 2', () => {
    const result = parseJavaScript('const f = x => x * 2', 'test.js');
    const stmts = result.root.statements();
    expect(stmts).toHaveLength(1);
    const varDecl = stmts[0] as JsVariableDecl;
    // tree-sitter-javascript uses lexical_declaration for const/let, variable_declaration for var
    expect(varDecl.raw.type).toBe('lexical_declaration');
    expect(varDecl.kind()).toBe('const');
    const decls = varDecl.declarators();
    expect(decls).toHaveLength(1);
    const declarator = decls[0] as JsVariableDeclarator;
    const val = declarator.value();
    expect(val).not.toBeNull();
    const arrow = val as JsArrowFunction;
    expect(arrow.raw.type).toBe('arrow_function');
    expect(arrow.params()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Import statement
// ---------------------------------------------------------------------------

describe('import statement', () => {
  it("parses import { foo } from 'bar'", () => {
    const result = parseJavaScript("import { foo } from 'bar'", 'test.js');
    const stmts = result.root.statements();
    expect(stmts).toHaveLength(1);
    const importStmt = stmts[0] as JsImportStmt;
    expect(importStmt.raw.type).toBe('import_statement');
    // source().text() returns the raw source text of the string literal, including quotes
    expect(importStmt.source().text()).toBe("'bar'");
  });
});

// ---------------------------------------------------------------------------
// Empty source
// ---------------------------------------------------------------------------

describe('empty source', () => {
  it('parses empty string without errors', () => {
    const result = parseJavaScript('', 'test.js');
    expect(result.hasErrors).toBe(false);
    expect(result.root).toBeDefined();
    expect(result.root.raw.type).toBe('program');
    expect(result.root.statements()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-line source
// ---------------------------------------------------------------------------

describe('multi-line source', () => {
  it('toSpan returns correct line numbers across multiple lines', () => {
    const src = 'const x = 1;\nconst y = 2;\nconst z = 3;';
    const result = parseJavaScript(src, '/abs/path.js');
    const stmts = result.root.statements();
    expect(stmts).toHaveLength(3);

    const line1 = result.toSpan(stmts[0]!.raw);
    const line2 = result.toSpan(stmts[1]!.raw);
    const line3 = result.toSpan(stmts[2]!.raw);

    expect(line1.startLine).toBe(1);
    expect(line2.startLine).toBe(2);
    expect(line3.startLine).toBe(3);
    expect(line1.file).toBe('/abs/path.js');
  });
});
