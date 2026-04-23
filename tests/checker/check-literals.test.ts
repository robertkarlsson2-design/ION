import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule, spanKey } from '../../src/checker/index.js';
import type { AstModule, AstFnDeclNode } from '../../src/ast/nodes.js';

function parse(src: string): AstModule {
  return buildModule(parseModule(lex(src, 'test.ion')));
}

function check(src: string) {
  const ast = parse(src);
  const bindResult = bindModule(ast, 'test.ion');
  return { ast, result: checkModule(ast, bindResult, 'test.ion') };
}

describe('checkModule — literal types', () => {
  it('LiteralInt infers as Int', () => {
    const { ast, result } = check('fn f() = 42');
    expect(result.errors).toHaveLength(0);
    const body = (ast.decls[0] as AstFnDeclNode).body;
    expect(result.typeMap.get(spanKey(body.span))).toEqual({ kind: 'Int' });
  });

  it('LiteralFloat infers as Float', () => {
    const { ast, result } = check('fn f() = 3.14');
    expect(result.errors).toHaveLength(0);
    const body = (ast.decls[0] as AstFnDeclNode).body;
    expect(result.typeMap.get(spanKey(body.span))).toEqual({ kind: 'Float' });
  });

  it('LiteralBool true infers as Bool', () => {
    const { ast, result } = check('fn f() = true');
    expect(result.errors).toHaveLength(0);
    const body = (ast.decls[0] as AstFnDeclNode).body;
    expect(result.typeMap.get(spanKey(body.span))).toEqual({ kind: 'Bool' });
  });

  it('LiteralBool false infers as Bool', () => {
    const { ast, result } = check('fn f() = false');
    expect(result.errors).toHaveLength(0);
    const body = (ast.decls[0] as AstFnDeclNode).body;
    expect(result.typeMap.get(spanKey(body.span))).toEqual({ kind: 'Bool' });
  });

  it('LiteralNull infers as Null', () => {
    const { ast, result } = check('fn f() = null');
    expect(result.errors).toHaveLength(0);
    const body = (ast.decls[0] as AstFnDeclNode).body;
    expect(result.typeMap.get(spanKey(body.span))).toEqual({ kind: 'Null' });
  });

  it('StringLit with no interpolation infers as Str', () => {
    const { ast, result } = check('fn f() = "hello"');
    expect(result.errors).toHaveLength(0);
    const body = (ast.decls[0] as AstFnDeclNode).body;
    expect(result.typeMap.get(spanKey(body.span))).toEqual({ kind: 'Str' });
  });
});
