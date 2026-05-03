/**
 * Sugar-preserving encoder roundtrip tests.
 *
 * For each surface sugar form accepted by the wire decoder
 * (`try{...}catch{...}`, `cond?then:else`, `<Tag/>`, `{k:v}`, `x??y`,
 * `expr?.field`, `throw e`, postfix `expr(args)`, do-block
 * `{stmt;stmt;...;result}`), confirm that
 *
 *     encodeModule(decodeModule(wire)) === wire
 *
 * is byte-equivalent. Each test wraps the sugar inside a top-level
 * `let f=()->...` so the F-section structure is identical across cases.
 *
 * Implementation notes — see `docs/sugar-preservation-design.md` (Approach 1).
 * Each `App` node produced by lowering a sugar form carries a `sugarForm`
 * marker that the encoder dispatches on.
 */
import { describe, it, expect } from 'vitest';
import { decodeModule } from '../../src/wire/decoder.js';
import { encodeModule } from '../../src/wire/encoder.js';

/**
 * Decode a wire string, assert success, re-encode, return the result.
 * Throws via `expect` if decoding produces an error envelope.
 */
function roundtrip(wire: string): string {
  const decoded = decodeModule(wire);
  if ('error' in decoded) {
    throw new Error(`decode failed: ${decoded.error}\n--- input ---\n${wire}`);
  }
  return encodeModule(decoded);
}

/**
 * Wrap a single expression in a minimal-header module's F section.
 * The result is the canonical wire form `I1\nM <name>\nF let f:any=()->{<expr>};0\n`
 * where the expression sits inside a do-block to defeat the body=auto-bound-name
 * rule of `let X=v` (no `;body`).
 *
 * We use `let f:any=()->...` rather than the un-typed `let f=()->...` because
 * the encoder always emits the `:any` annotation for missing types.
 */
function wrapInLet(expr: string, opts: { typed?: boolean } = {}): string {
  const ty = opts.typed === false ? '' : ':any';
  // Use trailing `;0` so the let has a body and we don't fall into the
  // implicit-self-bound-body sugar (which the encoder would re-emit as
  // `;f` and break the pre-image).
  //
  // The module header carries `d=core` because the decoder defaults a
  // missing `d=` clause to `["core"]` and the encoder emits dialects when
  // present — see decoder.test.ts D1 for the rationale.
  return `I1\nM t v=0 d=core\nF let f${ty}=${expr};0\n`;
}

// ---------------------------------------------------------------------------
// One test per sugar form
// ---------------------------------------------------------------------------

describe('sugar roundtrip — App-shaped sugar forms', () => {
  it('nullish: x??y', () => {
    const wire = wrapInLet('a??b');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('optchain: expr?.field', () => {
    const wire = wrapInLet('a?.b');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('postcall: callee(args)', () => {
    // f(1,2) — postfix call on a Var. The decoder's first parseNode reads `f`
    // as a Var, then applyInfix-postfix-`(` converts it to App(f,[1,2]).
    const wire = wrapInLet('f(1,2)');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('postcall on accessor: recv.method(args)', () => {
    // a.b(1) — must roundtrip as `.` then postfix-`(` (NOT as `a->b(1)` which
    // would be OopVirtualCall).
    const wire = wrapInLet('a.b(1)');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('object literal: {k:v}', () => {
    const wire = wrapInLet('{a:1,b:2}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('object literal — empty: {}', () => {
    const wire = wrapInLet('{}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('object literal — spread: {...:rest}', () => {
    // Spread shorthand uses the special "..." key.
    const wire = wrapInLet('{a:1,...:rest}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('do-block: {s1;s2;result}', () => {
    // 3-statement do-block. (Single-statement `{x}` is parsed as paren expr,
    // not a do-block, so we need 2+ stmts to trigger the __do__ lowering.)
    const wire = wrapInLet('{a;b;c}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('try/catch: try{x}catch{y}', () => {
    const wire = wrapInLet('try{a}catch{b}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('try/catch/finally: try{x}catch{y}finally{z}', () => {
    const wire = wrapInLet('try{a}catch{b}finally{c}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('try/finally (no catch): try{x}finally{y}', () => {
    const wire = wrapInLet('try{a}finally{b}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('throw: throw expr', () => {
    const wire = wrapInLet('throw e');
    expect(roundtrip(wire)).toBe(wire);
  });
});

describe('sugar roundtrip — Case-shaped sugar forms', () => {
  it('ternary: cond?then:else', () => {
    const wire = wrapInLet('a?b:c');
    expect(roundtrip(wire)).toBe(wire);
  });
});

describe('sugar roundtrip — JSX', () => {
  it('jsx self-closing, no props: <Tag/>', () => {
    const wire = wrapInLet('<Tag/>');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('jsx self-closing with string prop: <Tag a="s"/>', () => {
    const wire = wrapInLet('<Tag a="s"/>');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('jsx self-closing with expr prop: <Tag a={x}/>', () => {
    const wire = wrapInLet('<Tag a={x}/>');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('jsx self-closing with boolean shorthand: <Tag flag/>', () => {
    const wire = wrapInLet('<Tag flag/>');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('jsx self-closing with spread: <Tag {...rest}/>', () => {
    const wire = wrapInLet('<Tag {...rest}/>');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('jsx with single expression child: <Tag>{x}</Tag>', () => {
    const wire = wrapInLet('<Tag>{x}</Tag>');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('jsx with nested element child: <Outer><Inner/></Outer>', () => {
    const wire = wrapInLet('<Outer><Inner/></Outer>');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('jsx html lowercase tag: <div/>', () => {
    const wire = wrapInLet('<div/>');
    expect(roundtrip(wire)).toBe(wire);
  });
});

// ---------------------------------------------------------------------------
// Nested sugar — combine multiple forms in one expression
// ---------------------------------------------------------------------------

describe('sugar roundtrip — nesting', () => {
  it('try wraps a ternary: try{a?b:c}catch{d}', () => {
    // The try emit-case calls encodeNode(body) recursively, which then hits
    // the Case→ternary fast path. Confirms recursion works for mixed sugar.
    const wire = wrapInLet('try{a?b:c}catch{d}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('object value is a ternary: {x:a?b:c}', () => {
    const wire = wrapInLet('{x:a?b:c}');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('throw of nullish: throw e??f', () => {
    const wire = wrapInLet('throw e??f');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('jsx with ternary expr child: <Tag>{a?b:c}</Tag>', () => {
    const wire = wrapInLet('<Tag>{a?b:c}</Tag>');
    expect(roundtrip(wire)).toBe(wire);
  });

  it('do-block containing a try: {try{a}catch{b};c}', () => {
    const wire = wrapInLet('{try{a}catch{b};c}');
    expect(roundtrip(wire)).toBe(wire);
  });
});

// ---------------------------------------------------------------------------
// Kitchen sink — every sugar form combined in a single module body
// ---------------------------------------------------------------------------

describe('sugar roundtrip — kitchen sink', () => {
  it('combines try, jsx, ternary, object, optchain, nullish, throw, postcall', () => {
    // A do-block that exercises every supported sugar form. Ordering chosen
    // so that the result expression sits at the do-block tail (statements
    // separated by `;`).
    const expr = '{' +
      'try{a?.b}catch{throw e};' +     // try + optchain + throw
      'f(1)??g();' +                    // postcall + nullish + (postcall)
      '<Tag x={a?b:c}/>;' +              // jsx + ternary inside expr-prop
      '{k:v??w}' +                       // object literal + nullish in value
      '}';
    const wire = wrapInLet(expr);
    expect(roundtrip(wire)).toBe(wire);
  });
});
