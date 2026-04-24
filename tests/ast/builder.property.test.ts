import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildExpr } from '../../src/ast/builder.js';
import type {
  ExprNode,
  IdentNode,
  LiteralIntNode,
  LiteralFloatNode,
  LiteralBoolNode,
  LiteralNullNode,
  StringLitNode,
  GroupExprNode,
  TriviaNode,
} from '../../src/parser/cst.js';
import { spanArb } from '../roundtrip/helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasNoTrivia(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return true;
  if (Array.isArray(node)) return node.every(hasNoTrivia);
  const obj = node as Record<string, unknown>;
  if ('leadingTrivia' in obj) return false;
  return Object.values(obj).every(hasNoTrivia);
}

// ---------------------------------------------------------------------------
// Trivia arbitraries
// ---------------------------------------------------------------------------

const triviaKindArb = fc.constantFrom(
  'Whitespace' as const,
  'Newline' as const,
  'LineComment' as const,
  'BlockComment' as const,
);

const triviaNodeArb: fc.Arbitrary<TriviaNode> = fc.record({
  kind: triviaKindArb,
  text: fc.string({ maxLength: 30 }),
  span: spanArb,
});

const triviaArrArb: fc.Arbitrary<readonly TriviaNode[]> =
  fc.array(triviaNodeArb, { maxLength: 5 });

// ---------------------------------------------------------------------------
// Leaf CST ExprNode arbitraries (with arbitrary leadingTrivia)
// ---------------------------------------------------------------------------

const identCstArb: fc.Arbitrary<IdentNode> = fc.record({
  kind: fc.constant('Ident' as const),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  span: spanArb,
  leadingTrivia: triviaArrArb,
});

const literalIntCstArb: fc.Arbitrary<LiteralIntNode> = fc.record({
  kind: fc.constant('LiteralInt' as const),
  value: fc.bigInt(),
  raw: fc.string({ minLength: 1, maxLength: 20 }),
  span: spanArb,
  leadingTrivia: triviaArrArb,
});

const literalFloatCstArb: fc.Arbitrary<LiteralFloatNode> = fc.record({
  kind: fc.constant('LiteralFloat' as const),
  value: fc.double({ noNaN: true, noDefaultInfinity: true }),
  raw: fc.string({ minLength: 1, maxLength: 20 }),
  span: spanArb,
  leadingTrivia: triviaArrArb,
});

const literalBoolCstArb: fc.Arbitrary<LiteralBoolNode> = fc.record({
  kind: fc.constant('LiteralBool' as const),
  value: fc.boolean(),
  span: spanArb,
  leadingTrivia: triviaArrArb,
});

const literalNullCstArb: fc.Arbitrary<LiteralNullNode> = fc.record({
  kind: fc.constant('LiteralNull' as const),
  span: spanArb,
  leadingTrivia: triviaArrArb,
});

const stringLitCstArb: fc.Arbitrary<StringLitNode> = fc.record({
  kind: fc.constant('StringLit' as const),
  parts: fc.array(
    fc.record({
      kind: fc.constant('TextPart' as const),
      text: fc.string({ maxLength: 20 }),
      span: spanArb,
    }),
    { maxLength: 3 },
  ),
  span: spanArb,
  leadingTrivia: triviaArrArb,
});

const leafExprCstArb: fc.Arbitrary<ExprNode> = fc.oneof(
  identCstArb,
  literalIntCstArb,
  literalFloatCstArb,
  literalBoolCstArb,
  literalNullCstArb,
  stringLitCstArb,
);

// ---------------------------------------------------------------------------
// GroupExpr arbitrary
// ---------------------------------------------------------------------------

const groupExprCstArb: fc.Arbitrary<GroupExprNode> = fc.record({
  kind: fc.constant('GroupExpr' as const),
  inner: leafExprCstArb,
  span: spanArb,
  leadingTrivia: triviaArrArb,
});

// ---------------------------------------------------------------------------
// Property 1: No trivia in any built AST node
// ---------------------------------------------------------------------------

describe('property: no trivia in any built AST node', () => {
  it('arbitrary leaf CST expr with arbitrary leadingTrivia', () => {
    fc.assert(
      fc.property(leafExprCstArb, (cst) => hasNoTrivia(buildExpr(cst))),
    );
  });

  it('GroupExpr with trivia on wrapper and inner', () => {
    fc.assert(
      fc.property(groupExprCstArb, (cst) => hasNoTrivia(buildExpr(cst))),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: GroupExpr transparent elision
// ---------------------------------------------------------------------------

describe('property: GroupExpr transparent elision', () => {
  it('buildExpr(groupCst) deep-equals buildExpr(groupCst.inner)', () => {
    fc.assert(
      fc.property(groupExprCstArb, (cst) => {
        expect(buildExpr(cst)).toEqual(buildExpr(cst.inner));
      }),
    );
  });

  it('result kind is never GroupExpr', () => {
    fc.assert(
      fc.property(groupExprCstArb, (cst) => buildExpr(cst).kind !== 'GroupExpr'),
    );
  });

  it('nested GroupExpr wrappings all collapse', () => {
    const nestedGroupArb: fc.Arbitrary<GroupExprNode> = fc.record({
      kind: fc.constant('GroupExpr' as const),
      inner: groupExprCstArb,
      span: spanArb,
      leadingTrivia: triviaArrArb,
    });
    fc.assert(
      fc.property(nestedGroupArb, (cst) => {
        const ast = buildExpr(cst);
        return ast.kind !== 'GroupExpr' && hasNoTrivia(ast);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Span preservation
// ---------------------------------------------------------------------------

describe('property: span preservation', () => {
  it('non-GroupExpr: ast.span equals cst.span', () => {
    fc.assert(
      fc.property(leafExprCstArb, (cst) => {
        expect(buildExpr(cst).span).toEqual(cst.span);
      }),
    );
  });

  it('GroupExpr elision: ast.span equals inner.span', () => {
    fc.assert(
      fc.property(groupExprCstArb, (cst) => {
        expect(buildExpr(cst).span).toEqual(cst.inner.span);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Kind preservation for non-GroupExpr
// ---------------------------------------------------------------------------

describe('property: kind preservation for non-GroupExpr', () => {
  it('arbitrary leaf expr: ast.kind equals cst.kind', () => {
    fc.assert(
      fc.property(leafExprCstArb, (cst) => buildExpr(cst).kind === cst.kind),
    );
  });
});
