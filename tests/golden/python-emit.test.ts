import { describe, it, expect } from 'vitest';
import { emitPython } from '../../emitters/python/emit.js';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import { desugarModule } from '../../src/desugar/index.js';

/** End-to-end pipeline: Ion source string → emitted Python string. */
function compile(src: string, moduleName = 'test'): string {
  const tokens = lex(src, `${moduleName}.ion`);
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bind = bindModule(ast, moduleName);
  const check = checkModule(ast, bind, moduleName);
  const ir = desugarModule(ast, bind, check, moduleName, '0.0.0');
  return emitPython(ir);
}

describe('emitPython — data declarations', () => {
  it('emits a single-ctor data type as a @dataclass', () => {
    const out = compile('data User = User { id: Int; email: Str }');
    expect(out).toContain('@dataclass');
    expect(out).toContain('class User:');
    expect(out).toContain('id: int');
    expect(out).toContain('email: str');
    expect(out).not.toContain('"_tag"');
    expect(out).not.toContain('Union');
  });

  it('emits a multi-ctor data type as @dataclass classes + Union alias', () => {
    const out = compile('data Shape = Circle { r: Float } | Rect { w: Float; h: Float }');
    expect(out).toContain('class Circle:');
    expect(out).toContain('class Rect:');
    expect(out).toContain('r: float');
    expect(out).toContain('w: float');
    expect(out).toContain('h: float');
    expect(out).toContain('Shape = Union[Circle, Rect]');
    expect(out).toContain('from typing import Union');
  });

  it('emits data declaration before function declarations', () => {
    const out = compile('data User = User { id: Int }\npub fn show(u: User) -> Str = "user"');
    expect(out).toContain('class User:');
    expect(out).toContain('def show(');
    expect(out.indexOf('class User')).toBeLessThan(out.indexOf('def show'));
  });
});

describe('emitPython — functions', () => {
  it('emits a simple function correctly', () => {
    const out = compile('pub fn add(a: Int, b: Int) -> Int = a + b');
    expect(out).toContain('def add(');
    expect(out).toContain('return a + b');
  });
});
