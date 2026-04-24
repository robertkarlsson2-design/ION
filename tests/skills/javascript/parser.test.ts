import { describe, it, expect } from 'vitest';
import { parseJavaScript } from '../../../skills/javascript/parser.js';
import { isNodeOfType } from '../../../skills/javascript/node-types.js';

describe('parseJavaScript', () => {
  it('parses a valid function declaration', () => {
    const result = parseJavaScript('function foo() {}');
    expect(result.hasErrors).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.root.type).toBe('program');
    expect(result.root.namedChildren[0]?.type).toBe('function_declaration');
  });

  it('parses a valid arrow function', () => {
    const result = parseJavaScript('const f = () => 1;');
    expect(result.hasErrors).toBe(false);
    expect(result.root.namedChildren[0]?.type).toBe('lexical_declaration');
  });

  it('parses a valid class declaration', () => {
    const result = parseJavaScript('class C extends B {}');
    expect(result.hasErrors).toBe(false);
    expect(result.root.namedChildren[0]?.type).toBe('class_declaration');
  });

  it('parses ESM import and export', () => {
    const result = parseJavaScript("import foo from 'bar';\nexport default foo;");
    expect(result.hasErrors).toBe(false);
    const types = result.root.namedChildren.map(n => n.type);
    expect(types).toContain('import_statement');
    expect(types).toContain('export_statement');
  });

  it('parses empty input without errors', () => {
    const result = parseJavaScript('');
    expect(result.hasErrors).toBe(false);
    expect(result.root.type).toBe('program');
    expect(result.root.namedChildren).toHaveLength(0);
  });

  it('reports errors on invalid syntax', () => {
    const result = parseJavaScript('function (');
    expect(result.hasErrors).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.root.type).toBe('program');
  });

  it('partially recovers after a syntax error', () => {
    // Unclosed block causes an error; function before it is still parsed
    const result = parseJavaScript('function foo() {}\n{\nfunction bar() {}');
    expect(result.hasErrors).toBe(true);
    expect(result.root.type).toBe('program');
    const firstChild = result.root.namedChildren[0];
    expect(firstChild?.type).toBe('function_declaration');
  });

  it('accepts filepath option without throwing', () => {
    expect(() =>
      parseJavaScript('const x = 1;', { filepath: 'test.js' }),
    ).not.toThrow();
  });

  it('throws RangeError when source exceeds maxSourceBytes', () => {
    expect(() =>
      parseJavaScript('const x = 1;', { maxSourceBytes: 5 }),
    ).toThrow(RangeError);
  });

  it('accepts source exactly at maxSourceBytes limit', () => {
    const source = 'x;';
    expect(() =>
      parseJavaScript(source, { maxSourceBytes: source.length }),
    ).not.toThrow();
  });

  it('isNodeOfType narrows to the correct type', () => {
    const result = parseJavaScript('function foo() {}');
    const child = result.root.namedChildren[0];
    expect(child).toBeDefined();
    if (child !== undefined && isNodeOfType(child, 'function_declaration')) {
      // TypeScript compile-time check: child is JsTypedNode<'function_declaration'>
      expect(child.type).toBe('function_declaration');
    } else {
      expect.fail('Expected a function_declaration node');
    }
  });

  it('root node covers the entire input', () => {
    const source = 'const x = 42;';
    const result = parseJavaScript(source);
    expect(result.root.startIndex).toBe(0);
    expect(result.root.endIndex).toBe(source.length);
  });
});
