import { describe, it, expect } from 'vitest';
import { lex } from '../../src/lexer/index.js';
import { parseExpression, ParseError } from '../../src/parser/expressions.js';
import type {
  ExprNode,
  BinopExprNode,
  LiteralIntNode,
  LiteralFloatNode,
  LiteralBoolNode,
  LiteralNullNode,
  IdentNode,
  CallExprNode,
  LambdaExprNode,
  IfElseExprNode,
  MatchExprNode,
  StringLitNode,
  LetExprNode,
  AccessorExprNode,
  PropagateExprNode,
  GroupExprNode,
  PipelineExprNode,
  UnaryExprNode,
} from '../../src/parser/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(src: string): ExprNode {
  return parseExpression(lex(src, 'test.ion'));
}

function asKind<K extends ExprNode['kind']>(
  node: ExprNode,
  kind: K,
): Extract<ExprNode, { kind: K }> {
  expect(node.kind).toBe(kind);
  return node as Extract<ExprNode, { kind: K }>;
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

describe('literals', () => {
  it('parses integer literal', () => {
    const node = asKind(parse('42'), 'LiteralInt') as LiteralIntNode;
    expect(node.value).toBe(42n);
    expect(node.raw).toBe('42');
  });

  it('parses float literal', () => {
    const node = asKind(parse('3.14'), 'LiteralFloat') as LiteralFloatNode;
    expect(node.value).toBeCloseTo(3.14);
    expect(node.raw).toBe('3.14');
  });

  it('parses true boolean', () => {
    const node = asKind(parse('true'), 'LiteralBool') as LiteralBoolNode;
    expect(node.value).toBe(true);
  });

  it('parses false boolean', () => {
    const node = asKind(parse('false'), 'LiteralBool') as LiteralBoolNode;
    expect(node.value).toBe(false);
  });

  it('parses null', () => {
    asKind(parse('null'), 'LiteralNull') as LiteralNullNode;
  });
});

// ---------------------------------------------------------------------------
// Identifiers & accessors
// ---------------------------------------------------------------------------

describe('identifiers', () => {
  it('parses bare identifier', () => {
    const node = asKind(parse('foo'), 'Ident') as IdentNode;
    expect(node.name).toBe('foo');
  });

  it('parses multi-level accessor a.b.c', () => {
    const node = asKind(parse('a.b.c'), 'AccessorExpr') as AccessorExprNode;
    expect(node.field).toBe('c');
    const ab = asKind(node.receiver, 'AccessorExpr') as AccessorExprNode;
    expect(ab.field).toBe('b');
    asKind(ab.receiver, 'Ident');
  });
});

// ---------------------------------------------------------------------------
// Arithmetic & precedence
// ---------------------------------------------------------------------------

describe('arithmetic', () => {
  it('1 + 2 * 3 → * binds tighter', () => {
    const node = asKind(parse('1 + 2 * 3'), 'BinopExpr') as BinopExprNode;
    expect(node.op).toBe('Add');
    asKind(node.left, 'LiteralInt');
    const right = asKind(node.right, 'BinopExpr') as BinopExprNode;
    expect(right.op).toBe('Mul');
  });

  it('subtraction is left-associative: 5 - 2 - 1', () => {
    const node = asKind(parse('5 - 2 - 1'), 'BinopExpr') as BinopExprNode;
    expect(node.op).toBe('Sub');
    const left = asKind(node.left, 'BinopExpr') as BinopExprNode;
    expect(left.op).toBe('Sub');
  });
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

describe('comparison', () => {
  it('a == b', () => {
    const node = asKind(parse('a == b'), 'BinopExpr') as BinopExprNode;
    expect(node.op).toBe('EqEq');
  });

  it('x < y', () => {
    const node = asKind(parse('x < y'), 'BinopExpr') as BinopExprNode;
    expect(node.op).toBe('Lt');
  });
});

// ---------------------------------------------------------------------------
// Logical
// ---------------------------------------------------------------------------

describe('logical', () => {
  it('a && b || c → || binds looser', () => {
    // `a && b || c` should parse as `(a && b) || c`
    const node = asKind(parse('a && b || c'), 'BinopExpr') as BinopExprNode;
    expect(node.op).toBe('Or');
    const left = asKind(node.left, 'BinopExpr') as BinopExprNode;
    expect(left.op).toBe('And');
  });
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

describe('pipeline', () => {
  it('xs |> map(f) is left-associative', () => {
    const node = asKind(parse('xs |> map(f)'), 'PipelineExpr') as PipelineExprNode;
    asKind(node.left, 'Ident');
    asKind(node.right, 'CallExpr');
  });

  it('xs |> filter(f) |> map(g) nests left', () => {
    const node = asKind(parse('xs |> filter(f) |> map(g)'), 'PipelineExpr') as PipelineExprNode;
    asKind(node.left, 'PipelineExpr');
    asKind(node.right, 'CallExpr');
  });
});

// ---------------------------------------------------------------------------
// Unary
// ---------------------------------------------------------------------------

describe('unary', () => {
  it('-x is negation', () => {
    const node = asKind(parse('-x'), 'UnaryExpr') as UnaryExprNode;
    expect(node.op).toBe('Neg');
    asKind(node.operand, 'Ident');
  });

  it('!b is logical not', () => {
    const node = asKind(parse('!b'), 'UnaryExpr') as UnaryExprNode;
    expect(node.op).toBe('Not');
  });
});

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

describe('calls', () => {
  it('f(1, 2) — positional args', () => {
    const node = asKind(parse('f(1, 2)'), 'CallExpr') as CallExprNode;
    expect(node.args).toHaveLength(2);
    expect(node.args[0]?.label).toBeNull();
    expect(node.args[1]?.label).toBeNull();
  });

  it('f(x: 1, y: 2) — named args', () => {
    const node = asKind(parse('f(x: 1, y: 2)'), 'CallExpr') as CallExprNode;
    expect(node.args[0]?.label).toBe('x');
    expect(node.args[1]?.label).toBe('y');
  });

  it('f() — zero args', () => {
    const node = asKind(parse('f()'), 'CallExpr') as CallExprNode;
    expect(node.args).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lambdas
// ---------------------------------------------------------------------------

describe('lambdas', () => {
  it('x -> x + 1 — single bare param', () => {
    const node = asKind(parse('x -> x + 1'), 'LambdaExpr') as LambdaExprNode;
    expect(node.params).toHaveLength(1);
    expect(node.params[0]?.name).toBe('x');
    expect(node.params[0]?.type_).toBeNull();
    asKind(node.body, 'BinopExpr');
  });

  it('(x, y) -> x + y — multi-param', () => {
    const node = asKind(parse('(x, y) -> x + y'), 'LambdaExpr') as LambdaExprNode;
    expect(node.params).toHaveLength(2);
    expect(node.params[0]?.name).toBe('x');
    expect(node.params[1]?.name).toBe('y');
  });

  it('(x: Int) -> x — typed param', () => {
    const node = asKind(parse('(x: Int) -> x'), 'LambdaExpr') as LambdaExprNode;
    expect(node.params[0]?.type_).not.toBeNull();
    expect(node.params[0]?.type_?.kind).toBe('Named');
  });
});

// ---------------------------------------------------------------------------
// If/else
// ---------------------------------------------------------------------------

describe('if/else', () => {
  it('if c then e1 else e2', () => {
    const node = asKind(parse('if c then 1 else 2'), 'IfElseExpr') as IfElseExprNode;
    asKind(node.cond, 'Ident');
    asKind(node.then, 'LiteralInt');
    asKind(node.else_, 'LiteralInt');
  });
});

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

describe('match', () => {
  it('match opt | Some(x) -> x | None -> 0', () => {
    const src = 'match opt | Some(x) -> x | None -> 0';
    const node = asKind(parse(src), 'MatchExpr') as MatchExprNode;
    asKind(node.scrutinee, 'Ident');
    expect(node.arms).toHaveLength(2);
    expect(node.arms[0]?.pattern.kind).toBe('ConstructorPat');
    expect(node.arms[1]?.pattern.kind).toBe('ConstructorPat');
  });

  it('wildcard arm _', () => {
    const src = 'match x | _ -> 0';
    const node = asKind(parse(src), 'MatchExpr') as MatchExprNode;
    expect(node.arms[0]?.pattern.kind).toBe('WildcardPat');
  });
});

// ---------------------------------------------------------------------------
// String interpolation
// ---------------------------------------------------------------------------

describe('string interpolation', () => {
  it('"hello" — plain string has one TextPart', () => {
    const node = asKind(parse('"hello"'), 'StringLit') as StringLitNode;
    expect(node.parts).toHaveLength(1);
    expect(node.parts[0]?.kind).toBe('TextPart');
  });

  it('"Hello, {name}!" — has TextPart, InterpPart, TextPart', () => {
    const node = asKind(parse('"Hello, {name}!"'), 'StringLit') as StringLitNode;
    expect(node.parts).toHaveLength(3);
    expect(node.parts[0]?.kind).toBe('TextPart');
    expect(node.parts[1]?.kind).toBe('InterpPart');
    expect(node.parts[2]?.kind).toBe('TextPart');
  });

  it('InterpPart contains an Ident node', () => {
    const node = asKind(parse('"{x}"'), 'StringLit') as StringLitNode;
    const interp = node.parts[0];
    expect(interp?.kind).toBe('InterpPart');
    if (interp?.kind === 'InterpPart') {
      asKind(interp.expr, 'Ident');
    }
  });
});

// ---------------------------------------------------------------------------
// Let binding
// ---------------------------------------------------------------------------

describe('let binding', () => {
  it('let x = 1; x + 1', () => {
    const node = asKind(parse('let x = 1; x + 1'), 'LetExpr') as LetExprNode;
    expect(node.name).toBe('x');
    expect(node.type_).toBeNull();
    asKind(node.value, 'LiteralInt');
    asKind(node.body, 'BinopExpr');
  });

  it('let x: Int = 1; x — typed binding', () => {
    const node = asKind(parse('let x: Int = 1; x'), 'LetExpr') as LetExprNode;
    expect(node.type_?.kind).toBe('Named');
  });
});

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

describe('propagation', () => {
  it('query()? — PropagateExpr wrapping CallExpr', () => {
    const node = asKind(parse('query()?'), 'PropagateExpr') as PropagateExprNode;
    asKind(node.inner, 'CallExpr');
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe('grouping', () => {
  it('(1 + 2) * 3 — group preserved, correct eval order', () => {
    const node = asKind(parse('(1 + 2) * 3'), 'BinopExpr') as BinopExprNode;
    expect(node.op).toBe('Mul');
    const left = asKind(node.left, 'GroupExpr') as GroupExprNode;
    asKind(left.inner, 'BinopExpr');
  });
});

// ---------------------------------------------------------------------------
// Span correctness
// ---------------------------------------------------------------------------

describe('span correctness', () => {
  it('every node span is non-empty for "1 + 2"', () => {
    const node = asKind(parse('1 + 2'), 'BinopExpr') as BinopExprNode;
    expect(node.span.startCol).toBeLessThan(node.span.endCol);
    expect(node.left.span.endCol).toBeLessThanOrEqual(node.span.endCol);
    expect(node.right.span.startCol).toBeGreaterThanOrEqual(node.left.span.endCol);
  });

  it('span file matches lex file', () => {
    const tokens = lex('42', 'myfile.ion');
    const node = parseExpression(tokens);
    expect(node.span.file).toBe('myfile.ion');
  });
});

// ---------------------------------------------------------------------------
// Trivia preservation
// ---------------------------------------------------------------------------

describe('trivia preservation', () => {
  it('leading whitespace is attached to ident node', () => {
    const tokens = lex('  foo', 'test.ion');
    const node = asKind(parseExpression(tokens), 'Ident') as IdentNode;
    expect(node.leadingTrivia.length).toBeGreaterThan(0);
    expect(node.leadingTrivia[0]?.kind).toBe('Whitespace');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('1 + → ParseError with span', () => {
    expect(() => parse('1 +')).toThrow(ParseError);
  });

  it('ParseError carries a span', () => {
    try {
      parse('1 +');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      const pe = e as ParseError;
      expect(pe.span).toBeDefined();
    }
  });

  it('unclosed paren → ParseError', () => {
    expect(() => parse('(1 + 2')).toThrow(ParseError);
  });
});
