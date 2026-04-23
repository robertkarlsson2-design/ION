import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { buildExpr, buildDecl, buildModule, buildPattern } from '../../src/ast/builder.js';
import type {
  ExprNode,
  IdentNode,
  DeclNode,
  ModuleNode,
  TriviaNode,
  PatternNode,
  GroupExprNode,
  BinopExprNode,
  LiteralIntNode,
  StringLitNode,
  BinopKind,
  UnaryKind,
} from '../../src/parser/cst.js';
import type { Span, TypeAnnotation } from '../../src/parser/cst.js';

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

function hasGroupExprKind(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasGroupExprKind);
  const obj = node as Record<string, unknown>;
  if (obj['kind'] === 'GroupExpr') return true;
  return Object.values(obj).some(hasGroupExprKind);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const spanArb: fc.Arbitrary<Span> = fc.record({
  file: fc.constantFrom('a.ion', 'b.ion'),
  startLine: fc.integer({ min: 1, max: 50 }),
  startCol: fc.integer({ min: 0, max: 80 }),
  endLine: fc.integer({ min: 1, max: 50 }),
  endCol: fc.integer({ min: 0, max: 80 }),
});

const triviaNodeArb: fc.Arbitrary<TriviaNode> = fc.oneof(
  fc.record({ kind: fc.constant('Whitespace' as const), text: fc.string({ maxLength: 20 }), span: spanArb }),
  fc.record({ kind: fc.constant('Newline' as const), text: fc.string({ maxLength: 20 }), span: spanArb }),
  fc.record({ kind: fc.constant('LineComment' as const), text: fc.string({ maxLength: 20 }), span: spanArb }),
  fc.record({ kind: fc.constant('BlockComment' as const), text: fc.string({ maxLength: 20 }), span: spanArb }),
);

const triviaArrayArb = fc.array(triviaNodeArb, { minLength: 1, maxLength: 4 });

const identNodeArb: fc.Arbitrary<IdentNode> = fc.record({
  kind: fc.constant('Ident' as const),
  name: fc.string({ minLength: 1, maxLength: 10 }),
  span: spanArb,
  leadingTrivia: triviaArrayArb,
});

const identNodeNoTriviaArb: fc.Arbitrary<IdentNode> = fc.record({
  kind: fc.constant('Ident' as const),
  name: fc.string({ minLength: 1, maxLength: 10 }),
  span: spanArb,
  leadingTrivia: fc.constant([] as TriviaNode[]),
});

const literalIntArb: fc.Arbitrary<LiteralIntNode> = fc.record({
  kind: fc.constant('LiteralInt' as const),
  value: fc.bigInt({ min: 0n, max: 2147483647n }),
  raw: fc.string({ maxLength: 10 }),
  span: spanArb,
});

const literalFloatArb = fc.record({
  kind: fc.constant('LiteralFloat' as const),
  value: fc.float(),
  raw: fc.string({ maxLength: 10 }),
  span: spanArb,
});

const literalBoolArb = fc.record({
  kind: fc.constant('LiteralBool' as const),
  value: fc.boolean(),
  span: spanArb,
});

const literalNullArb = fc.record({
  kind: fc.constant('LiteralNull' as const),
  span: spanArb,
});

const stringLitNodeArb: fc.Arbitrary<StringLitNode> = fc.record({
  kind: fc.constant('StringLit' as const),
  parts: fc.array(
    fc.record({ kind: fc.constant('TextPart' as const), text: fc.string({ maxLength: 20 }), span: spanArb }),
    { maxLength: 3 },
  ),
  span: spanArb,
});

const leafExprArb: fc.Arbitrary<ExprNode> = fc.oneof(
  identNodeArb,
  identNodeNoTriviaArb,
  literalIntArb,
  literalFloatArb,
  literalBoolArb,
  literalNullArb,
  stringLitNodeArb,
);

const { exprNodeArb } = fc.letrec<{ exprNodeArb: ExprNode }>(tie => ({
  exprNodeArb: fc.oneof(
    { depthFactor: 0.5 },
    identNodeArb,
    identNodeNoTriviaArb,
    literalIntArb,
    literalFloatArb,
    literalBoolArb,
    literalNullArb,
    stringLitNodeArb,
    fc.record({
      kind: fc.constant('BinopExpr' as const),
      op: fc.constantFrom<BinopKind>(
        'Add', 'Sub', 'Mul', 'Div', 'Mod',
        'EqEq', 'NotEq', 'Lt', 'Gt', 'LtEq', 'GtEq',
        'And', 'Or',
      ),
      left: tie('exprNodeArb'),
      right: tie('exprNodeArb'),
      span: spanArb,
    }) as fc.Arbitrary<BinopExprNode>,
    fc.record({
      kind: fc.constant('UnaryExpr' as const),
      op: fc.constantFrom<UnaryKind>('Neg', 'Not'),
      operand: tie('exprNodeArb'),
      span: spanArb,
    }),
    fc.record({
      kind: fc.constant('GroupExpr' as const),
      inner: tie('exprNodeArb'),
      span: spanArb,
    }),
    fc.record({
      kind: fc.constant('PropagateExpr' as const),
      inner: tie('exprNodeArb'),
      span: spanArb,
    }),
  ),
}));

const groupExprLeafArb: fc.Arbitrary<GroupExprNode> = fc.record({
  kind: fc.constant('GroupExpr' as const),
  inner: leafExprArb,
  span: spanArb,
});

const groupExprNestedArb: fc.Arbitrary<GroupExprNode> = fc.record({
  kind: fc.constant('GroupExpr' as const),
  inner: fc.record({
    kind: fc.constant('GroupExpr' as const),
    inner: leafExprArb,
    span: spanArb,
  }),
  span: spanArb,
});

const namedTypeAnnotationArb: fc.Arbitrary<TypeAnnotation> = fc.record({
  kind: fc.constant('Named' as const),
  name: fc.string({ minLength: 1, maxLength: 10 }),
  span: spanArb,
});

const { declNodeArb } = fc.letrec<{ declNodeArb: DeclNode }>(tie => ({
  declNodeArb: fc.oneof(
    { depthFactor: 0.5 },
    fc.record({
      kind: fc.constant('LetDecl' as const),
      pub: fc.boolean(),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      type_: fc.constant(null),
      value: exprNodeArb,
      span: spanArb,
      leadingTrivia: triviaArrayArb,
    }),
    fc.record({
      kind: fc.constant('TypeAliasDecl' as const),
      pub: fc.boolean(),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      typeParams: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 3 }),
      type_: namedTypeAnnotationArb,
      span: spanArb,
      leadingTrivia: triviaArrayArb,
    }),
    fc.record({
      kind: fc.constant('UseDecl' as const),
      path: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 4 }),
      items: fc.oneof(
        fc.constant(null),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 4 }),
      ),
      span: spanArb,
      leadingTrivia: triviaArrayArb,
    }),
    fc.record({
      kind: fc.constant('ModuleDecl' as const),
      pub: fc.boolean(),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      decls: fc.array(tie('declNodeArb'), { maxLength: 3 }),
      span: spanArb,
      leadingTrivia: triviaArrayArb,
    }),
  ),
}));

const moduleNodeArb: fc.Arbitrary<ModuleNode> = fc.record({
  kind: fc.constant('Module' as const),
  decls: fc.array(declNodeArb, { maxLength: 4 }),
  span: spanArb,
});

const { patternNodeArb } = fc.letrec<{ patternNodeArb: PatternNode }>(tie => ({
  patternNodeArb: fc.oneof(
    { depthFactor: 0.5 },
    fc.record({ kind: fc.constant('WildcardPat' as const), span: spanArb }),
    fc.record({ kind: fc.constant('IdentPat' as const), name: fc.string({ minLength: 1, maxLength: 10 }), span: spanArb }),
    fc.record({
      kind: fc.constant('TuplePat' as const),
      elements: fc.array(tie('patternNodeArb'), { maxLength: 3 }),
      span: spanArb,
    }),
  ),
}));

// ---------------------------------------------------------------------------
// Suite 1: Trivia stripping — expressions
// ---------------------------------------------------------------------------

describe('property: trivia stripping — expressions', () => {
  it('P1: IdentNode with trivia has no trivia after buildExpr', () => {
    fc.assert(
      fc.property(identNodeArb, ident => {
        return !hasNoTrivia(ident) && hasNoTrivia(buildExpr(ident));
      }),
      { numRuns: 100 },
    );
  });

  it('P2: any ExprNode has no trivia after buildExpr', () => {
    fc.assert(
      fc.property(exprNodeArb, expr => {
        return hasNoTrivia(buildExpr(expr));
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Trivia stripping — declarations
// ---------------------------------------------------------------------------

describe('property: trivia stripping — declarations', () => {
  it('P3: any DeclNode has no trivia after buildDecl', () => {
    fc.assert(
      fc.property(declNodeArb, decl => {
        return hasNoTrivia(buildDecl(decl));
      }),
      { numRuns: 100 },
    );
  });

  it('P4: ModuleDeclNode recursively strips trivia from nested decls', () => {
    const moduleDeclArb = fc.record({
      kind: fc.constant('ModuleDecl' as const),
      pub: fc.boolean(),
      name: fc.string({ minLength: 1, maxLength: 10 }),
      decls: fc.array(declNodeArb, { minLength: 1, maxLength: 3 }),
      span: spanArb,
      leadingTrivia: triviaArrayArb,
    });
    fc.assert(
      fc.property(moduleDeclArb, decl => {
        return hasNoTrivia(buildDecl(decl));
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Trivia stripping — modules
// ---------------------------------------------------------------------------

describe('property: trivia stripping — modules', () => {
  it('P5: any ModuleNode has no trivia after buildModule', () => {
    fc.assert(
      fc.property(moduleNodeArb, mod => {
        return hasNoTrivia(buildModule(mod));
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Span preservation — non-GroupExpr expressions
// ---------------------------------------------------------------------------

describe('property: span preservation — non-GroupExpr expressions', () => {
  it('P6: IdentNode span is preserved by buildExpr', () => {
    fc.assert(
      fc.property(identNodeArb, ident => {
        const ast = buildExpr(ident);
        return (
          ast.span.file === ident.span.file &&
          ast.span.startLine === ident.span.startLine &&
          ast.span.startCol === ident.span.startCol &&
          ast.span.endLine === ident.span.endLine &&
          ast.span.endCol === ident.span.endCol
        );
      }),
      { numRuns: 100 },
    );
  });

  it('P7: LiteralIntNode span is preserved by buildExpr', () => {
    fc.assert(
      fc.property(literalIntArb, lit => {
        const ast = buildExpr(lit);
        return (
          ast.span.file === lit.span.file &&
          ast.span.startLine === lit.span.startLine &&
          ast.span.startCol === lit.span.startCol &&
          ast.span.endLine === lit.span.endLine &&
          ast.span.endCol === lit.span.endCol
        );
      }),
      { numRuns: 100 },
    );
  });

  it('P8: BinopExprNode span is preserved by buildExpr', () => {
    const binopArb: fc.Arbitrary<BinopExprNode> = fc.record({
      kind: fc.constant('BinopExpr' as const),
      op: fc.constantFrom<BinopKind>('Add', 'Sub', 'Mul'),
      left: literalIntArb,
      right: literalIntArb,
      span: spanArb,
    });
    fc.assert(
      fc.property(binopArb, binop => {
        const ast = buildExpr(binop);
        return (
          ast.span.file === binop.span.file &&
          ast.span.startLine === binop.span.startLine &&
          ast.span.startCol === binop.span.startCol &&
          ast.span.endLine === binop.span.endLine &&
          ast.span.endCol === binop.span.endCol
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 5: GroupExpr elision — span and kind
// ---------------------------------------------------------------------------

describe('property: GroupExpr elision — span and kind', () => {
  it('P9: GroupExpr with leaf inner: result span equals inner span', () => {
    fc.assert(
      fc.property(groupExprLeafArb, group => {
        const ast = buildExpr(group);
        const inner = group.inner;
        return (
          ast.span.file === inner.span.file &&
          ast.span.startLine === inner.span.startLine &&
          ast.span.startCol === inner.span.startCol &&
          ast.span.endLine === inner.span.endLine &&
          ast.span.endCol === inner.span.endCol
        );
      }),
      { numRuns: 200 },
    );
  });

  it('P10: GroupExpr result kind is never GroupExpr', () => {
    fc.assert(
      fc.property(groupExprLeafArb, group => {
        return buildExpr(group).kind !== 'GroupExpr';
      }),
      { numRuns: 200 },
    );
  });

  it('P11: nested GroupExpr (GroupExpr wrapping GroupExpr) result kind is never GroupExpr', () => {
    fc.assert(
      fc.property(groupExprNestedArb, group => {
        return buildExpr(group).kind !== 'GroupExpr';
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 6: GroupExpr never appears in any AST expression
// ---------------------------------------------------------------------------

describe('property: GroupExpr never appears in built AST', () => {
  it('P12: no GroupExpr kind survives anywhere in buildExpr result', () => {
    fc.assert(
      fc.property(exprNodeArb, expr => {
        return !hasGroupExprKind(buildExpr(expr));
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Span preservation — declarations and modules
// ---------------------------------------------------------------------------

describe('property: span preservation — declarations and modules', () => {
  it('P13: DeclNode span is preserved by buildDecl', () => {
    fc.assert(
      fc.property(declNodeArb, decl => {
        const ast = buildDecl(decl);
        return (
          ast.span.file === decl.span.file &&
          ast.span.startLine === decl.span.startLine &&
          ast.span.startCol === decl.span.startCol &&
          ast.span.endLine === decl.span.endLine &&
          ast.span.endCol === decl.span.endCol
        );
      }),
      { numRuns: 200 },
    );
  });

  it('P14: ModuleNode span is preserved by buildModule', () => {
    fc.assert(
      fc.property(moduleNodeArb, mod => {
        const ast = buildModule(mod);
        return (
          ast.span.file === mod.span.file &&
          ast.span.startLine === mod.span.startLine &&
          ast.span.startCol === mod.span.startCol &&
          ast.span.endLine === mod.span.endLine &&
          ast.span.endCol === mod.span.endCol
        );
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 8: Pattern span preservation
// ---------------------------------------------------------------------------

describe('property: pattern span preservation', () => {
  it('P_pattern: PatternNode span is preserved by buildPattern', () => {
    fc.assert(
      fc.property(patternNodeArb, pat => {
        const ast = buildPattern(pat);
        return (
          ast.span.file === pat.span.file &&
          ast.span.startLine === pat.span.startLine &&
          ast.span.startCol === pat.span.startCol &&
          ast.span.endLine === pat.span.endLine &&
          ast.span.endCol === pat.span.endCol
        );
      }),
      { numRuns: 100 },
    );
  });
});
