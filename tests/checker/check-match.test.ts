import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import type { AstModule } from '../../src/ast/nodes.js';

function parse(src: string): AstModule {
  return buildModule(parseModule(lex(src, 'test.ion')));
}

function check(src: string) {
  const ast = parse(src);
  const bindResult = bindModule(ast, 'test.ion');
  return checkModule(ast, bindResult, 'test.ion');
}

describe('checkModule — match exhaustiveness', () => {
  it('match on Bool with true and false arms — no error', () => {
    const result = check(
      'fn f(b: Bool) = match b | true -> 1 | false -> 0',
    );
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403).toHaveLength(0);
  });

  it('match on Bool missing false arm (no wildcard) → E0403', () => {
    const result = check('fn f(b: Bool) = match b | true -> 1');
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403.length).toBeGreaterThanOrEqual(1);
    expect(e403[0]?.code).toBe('E0403');
    expect(e403[0]?.missing).toContain('false');
  });

  it('match on Bool with wildcard — no exhaustiveness error', () => {
    const result = check('fn f(b: Bool) = match b | true -> 1 | _ -> 0');
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403).toHaveLength(0);
  });

  it('match on Option<Int> covering Some and None — no error', () => {
    const result = check(
      'fn f(x: Option<Int>) = match x | Some(n) -> n | None -> 0',
    );
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403).toHaveLength(0);
  });

  it('match on Option<Int> missing None arm → E0403', () => {
    const result = check('fn f(x: Option<Int>) = match x | Some(n) -> n');
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403.length).toBeGreaterThanOrEqual(1);
    expect(e403[0]?.missing).toContain('None');
  });

  it('match on Result<Str, Str> covering Ok and Err — no error', () => {
    const result = check(
      'fn f(x: Result<Str, Str>) = match x | Ok(v) -> v | Err(e) -> e',
    );
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403).toHaveLength(0);
  });

  it('match on Result missing Err arm → E0403', () => {
    const result = check(
      'fn f(x: Result<Str, Str>) = match x | Ok(v) -> v',
    );
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403.length).toBeGreaterThanOrEqual(1);
    expect(e403[0]?.missing).toContain('Err');
  });

  it('match on data Color covering all three variants — no error', () => {
    const result = check(`
      data Color = Red | Green | Blue
      fn f(c: Color) = match c | Red -> 1 | Green -> 2 | Blue -> 3
    `);
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403).toHaveLength(0);
  });

  it('match on Color with wildcard arm — no exhaustiveness error', () => {
    const result = check(`
      data Color = Red | Green | Blue
      fn f(c: Color) = match c | Red -> 1 | _ -> 0
    `);
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403).toHaveLength(0);
  });

  it('match on Color missing Blue arm → E0403', () => {
    const result = check(`
      data Color = Red | Green | Blue
      fn f(c: Color) = match c | Red -> 1 | Green -> 2
    `);
    const e403 = result.errors.filter(e => e.kind === 'NonExhaustiveMatch');
    expect(e403.length).toBeGreaterThanOrEqual(1);
    expect(e403[0]?.missing).toContain('Blue');
  });
});
