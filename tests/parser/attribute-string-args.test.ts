import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseDeclaration } from '../../src/parser/declarations.js';
import type { ExternDeclNode, FnDeclNode } from '../../src/parser/declarations.js';
import type { DeclNode } from '../../src/parser/cst.js';

function parseDecl(src: string): DeclNode {
  return parseDeclaration(lex(src, 'test.ion'));
}

function asExtern(src: string): ExternDeclNode {
  const node = parseDecl(src);
  expect(node.kind).toBe('ExternDecl');
  return node as ExternDeclNode;
}

function asFn(src: string): FnDeclNode {
  const node = parseDecl(src);
  expect(node.kind).toBe('FnDecl');
  return node as FnDeclNode;
}

describe('parseAttributes — string literal args', () => {
  it('parses @foreign with three string args', () => {
    const node = asExtern(
      '@foreign("node:fs", "readFile", "fs.readFile($1, $2)")\nextern fn readFile(path: Str) !io -> Str',
    );
    const attr = node.attributes[0];
    expect(attr?.name).toBe('foreign');
    expect(attr?.args).toEqual(['node:fs', 'readFile', 'fs.readFile($1, $2)']);
  });

  it('parses @foreign with module containing colon separator', () => {
    const node = asExtern(
      '@foreign("node:path", "join", "path.join($1, $2)")\nextern fn pathJoin(a: Str, b: Str) -> Str',
    );
    const attr = node.attributes[0];
    expect(attr?.args).toEqual(['node:path', 'join', 'path.join($1, $2)']);
  });

  it('parses @foreign with double-colon in module string', () => {
    const node = asExtern(
      '@foreign("a::b", "c::d", "$1")\nextern fn foo(x: Str) -> Str',
    );
    const attr = node.attributes[0];
    expect(attr?.args).toEqual(['a::b', 'c::d', '$1']);
  });

  it('parses @foreign with empty string arg', () => {
    const node = asExtern(
      '@foreign("", "push", "$1.push($2)")\nextern fn push(arr: Str, item: Str) -> Int',
    );
    const attr = node.attributes[0];
    expect(attr?.args).toEqual(['', 'push', '$1.push($2)']);
  });

  it('parses @foreign with console template containing parens', () => {
    const node = asExtern(
      '@foreign("console", "log", "console.log($1)")\npub extern fn consoleLog(msg: Str) !io -> Unit',
    );
    const attr = node.attributes[0];
    expect(attr?.args).toEqual(['console', 'log', 'console.log($1)']);
  });

  it('parses @foreign with multi-arg template (JSON.stringify)', () => {
    const node = asExtern(
      '@foreign("JSON", "stringify", "JSON.stringify($1, null, $2)")\nextern fn jsonPretty(val: Str, indent: Int) -> Str',
    );
    const attr = node.attributes[0];
    expect(attr?.args).toEqual(['JSON', 'stringify', 'JSON.stringify($1, null, $2)']);
  });

  it('regression: non-string (bare ident) args still work', () => {
    const node = asFn('@external(js) fn native() = 0');
    const attr = node.attributes[0];
    expect(attr?.args).toEqual(['js']);
  });

  it('regression: no args still works', () => {
    const node = asFn('@external fn native() = 0');
    const attr = node.attributes[0];
    expect(attr?.args).toEqual([]);
  });

  it('parses multiple attributes on one declaration', () => {
    const node = asExtern(
      '@foreign("Math", "sqrt", "Math.sqrt($1)")\n@pure\nextern fn mathSqrt(x: Float) -> Float',
    );
    expect(node.attributes).toHaveLength(2);
    expect(node.attributes[0]?.name).toBe('foreign');
    expect(node.attributes[0]?.args).toEqual(['Math', 'sqrt', 'Math.sqrt($1)']);
    expect(node.attributes[1]?.name).toBe('pure');
    expect(node.attributes[1]?.args).toEqual([]);
  });

  it('parses @foreign with property-access template (no parens)', () => {
    const node = asExtern(
      '@foreign("", "length", "$1.length")\nextern fn arrayLength(arr: Str) -> Int',
    );
    const attr = node.attributes[0];
    expect(attr?.args).toEqual(['', 'length', '$1.length']);
  });
});
