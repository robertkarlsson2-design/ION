import type {
  AstModule,
  AstDeclNode,
  AstExprNode,
  AstPatternNode,
  AstMatchArm,
  AstDataVariant,
  AstFnDeclNode,
  AstExternDeclNode,
  AstStringLitNode,
  AstStringPart,
  AstTextPart,
  AstFnParam,
  AstLambdaParam,
  LiteralIntNode,
  LiteralFloatNode,
  LiteralBoolNode,
  LiteralNullNode,
  BinopKind,
  UnaryKind,
} from '../ast/nodes.js';
import type { BindResult, ResolutionMap } from '../binder/index.js';
import type { ModuleSymbolTable } from '../binder/symbol-table.js';
import type { CheckResult, TypeMap } from '../checker/index.js';
import { spanKey } from '../checker/index.js';
import {
  buildVarIndex,
  buildLetIndex,
  buildFnDeclIndex,
  buildNameIndex,
} from '../checker/infer.js';
import { resolveAnnotation } from '../checker/annotation.js';
import type {
  IonIRModule,
  IonIRNode,
  IonIRDialect,
  AdtDeclNode,
  AdtVariant,
  CasePattern,
  CaseArm,
  VarNode,
  LiteralNode,
  AbsNode,
  LetNode,
  ConstructorNode,
  Param,
  LiteralValue,
  ForeignRefNode,
  ForeignSignature,
  ModuleRefNode,
} from '../ir/nodes.js';
import type { IonType, FnType } from '../ir/types.js';
import type { Span, SymbolId } from '../types.js';
import { makeSymbolId } from '../types.js';

// ---------------------------------------------------------------------------
// Internal context
// ---------------------------------------------------------------------------

interface DesugarCtx {
  readonly typeMap: TypeMap;
  readonly resolutionMap: ResolutionMap;
  readonly symbolTable: ModuleSymbolTable;
  /** spanKey(param/pattern span) → SymbolId */
  readonly varIndex: ReadonlyMap<string, SymbolId>;
  /** spanKey(let-binding span) → SymbolId */
  readonly letIndex: ReadonlyMap<string, SymbolId>;
  /** Declaration name → SymbolId for Fn and Extern */
  readonly fnDeclIndex: ReadonlyMap<string, SymbolId>;
  /** Type name → SymbolId for Data and TypeAlias */
  readonly nameIndex: ReadonlyMap<string, SymbolId>;
  readonly counter: { n: number };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Lower a fully bound and checked `AstModule` to `IonIRModule`.
 *
 * @param ast - The syntax tree, post-parse and post-builder
 * @param bindResult - Symbol tables and resolution map from the binder
 * @param checkResult - TypeMap from the checker
 * @param modulePath - Fully-qualified module name (e.g. 'org.acme.users')
 * @param version - Semver version string for the module
 */
export function desugarModule(
  ast: AstModule,
  bindResult: BindResult,
  checkResult: CheckResult,
  modulePath: string,
  version: string,
): IonIRModule {
  const ctx: DesugarCtx = {
    typeMap: checkResult.typeMap,
    resolutionMap: bindResult.resolutionMap,
    symbolTable: bindResult.symbolTable,
    varIndex: buildVarIndex(bindResult.symbolTable),
    letIndex: buildLetIndex(bindResult.symbolTable),
    fnDeclIndex: buildFnDeclIndex(bindResult.symbolTable),
    nameIndex: buildNameIndex(bindResult.symbolTable),
    counter: { n: 0 },
  };

  const data: AdtDeclNode[] = [];
  const decls: IonIRNode[] = [];
  const imports: ModuleRefNode[] = [];

  for (const decl of ast.decls) {
    desugarDecl(decl, data, decls, ctx);
  }

  const dialects: IonIRDialect[] = ['core'];
  if (data.length > 0) {
    dialects.push('ion-adt');
  }
  if (decls.some(d => d.kind === 'Effect' || d.kind === 'EffectDecl')) {
    dialects.push('ion-effects');
  }

  return {
    ionir: '1.0',
    module: modulePath,
    version,
    dialects,
    imports,
    data,
    decls,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lookupType(span: Span, ctx: DesugarCtx): IonType {
  return ctx.typeMap.get(spanKey(span)) ?? { kind: 'TypeVar', id: '?unknown' };
}

function freshSymbolId(ctx: DesugarCtx): SymbolId {
  return makeSymbolId(`__desugar__${ctx.counter.n++}`);
}

function sentinelUnit(span: Span): LiteralNode {
  return { kind: 'Literal', value: { kind: 'Null' }, span, type: { kind: 'Unit' } };
}

function binopName(op: BinopKind): string {
  switch (op) {
    case 'Add': return '__add__';
    case 'Sub': return '__sub__';
    case 'Mul': return '__mul__';
    case 'Div': return '__div__';
    case 'Mod': return '__mod__';
    case 'EqEq': return '__eq__';
    case 'NotEq': return '__ne__';
    case 'Lt': return '__lt__';
    case 'Gt': return '__gt__';
    case 'LtEq': return '__le__';
    case 'GtEq': return '__ge__';
    case 'And': return '__and__';
    case 'Or': return '__or__';
  }
}

function unaryName(op: UnaryKind): string {
  switch (op) {
    case 'Neg': return '__neg__';
    case 'Not': return '__not__';
  }
}

function resolveParamType(param: AstFnParam | AstLambdaParam, ctx: DesugarCtx): IonType {
  if (param.type_ !== null) {
    return resolveAnnotation(param.type_, ctx.nameIndex, new Map(), []);
  }
  return { kind: 'TypeVar', id: `?${param.name}` };
}

// ---------------------------------------------------------------------------
// Declaration lowering
// ---------------------------------------------------------------------------

function desugarDecl(
  decl: AstDeclNode,
  data: AdtDeclNode[],
  decls: IonIRNode[],
  ctx: DesugarCtx,
): void {
  switch (decl.kind) {
    case 'FnDecl':
      decls.push(desugarFnDecl(decl, ctx));
      break;
    case 'LetDecl': {
      const symbolId = ctx.letIndex.get(spanKey(decl.span)) ?? makeSymbolId(`?let_${decl.name}`);
      const value = desugarExpr(decl.value, ctx);
      const bindingType: IonType = decl.type_ !== null
        ? resolveAnnotation(decl.type_, ctx.nameIndex, new Map(), [])
        : lookupType(decl.value.span, ctx);
      const node: LetNode = {
        kind: 'Let',
        name: decl.name,
        symbolId,
        bindingType,
        value,
        body: sentinelUnit(decl.span),
        span: decl.span,
        type: { kind: 'Unit' },
      };
      decls.push(node);
      break;
    }
    case 'DataDecl':
      data.push(desugarDataDecl(decl, ctx));
      break;
    case 'ExternDecl':
      decls.push(desugarExternDecl(decl, ctx));
      break;
    case 'TypeAliasDecl':
    case 'UseDecl':
      // Type-erased; resolved by binder — dropped
      break;
    case 'ModuleDecl':
      for (const inner of decl.decls) {
        desugarDecl(inner, data, decls, ctx);
      }
      break;
  }
}

function desugarFnDecl(decl: AstFnDeclNode, ctx: DesugarCtx): LetNode {
  const symbolId = ctx.fnDeclIndex.get(decl.name) ?? makeSymbolId(`?fn_${decl.name}`);

  const params: Param[] = decl.params.map(p => ({
    name: p.name,
    symbolId: ctx.varIndex.get(spanKey(p.span)) ?? makeSymbolId(`?param_${p.name}`),
    type: resolveParamType(p, ctx),
    span: p.span,
  }));

  const retType: IonType = decl.returnType !== null
    ? resolveAnnotation(decl.returnType, ctx.nameIndex, new Map(), [])
    : { kind: 'TypeVar', id: `?ret_${decl.name}` };

  const fnType: FnType = {
    kind: 'Fn',
    params: params.map(p => p.type),
    ret: retType,
    effects: new Set(decl.effects),
  };

  const body = desugarExpr(decl.body, ctx);

  const absNode: AbsNode = {
    kind: 'Abs',
    params,
    body,
    captures: [],
    span: decl.span,
    type: fnType,
  };

  return {
    kind: 'Let',
    name: decl.name,
    symbolId,
    bindingType: fnType,
    value: absNode,
    body: sentinelUnit(decl.span),
    span: decl.span,
    type: { kind: 'Unit' },
  };
}

function desugarExternDecl(decl: AstExternDeclNode, ctx: DesugarCtx): LetNode {
  const symbolId = ctx.fnDeclIndex.get(decl.name) ?? makeSymbolId(`?extern_${decl.name}`);

  const foreignAttr = decl.attributes.find(a => a.name === 'foreign');
  const foreignModule = foreignAttr?.args[0] ?? '';
  const foreignSymbol = foreignAttr?.args[1] ?? decl.name;
  const foreignTemplate = foreignAttr?.args[2] ?? '';

  const paramTypes: IonType[] = decl.params.map(p =>
    p.type_ !== null
      ? resolveAnnotation(p.type_, ctx.nameIndex, new Map(), [])
      : ({ kind: 'TypeVar', id: `?param_${p.name}` } as IonType),
  );
  const retType: IonType = decl.returnType !== null
    ? resolveAnnotation(decl.returnType, ctx.nameIndex, new Map(), [])
    : { kind: 'Unit' };

  const sig: ForeignSignature = {
    params: paramTypes,
    ret: retType,
    template: foreignTemplate,
    paramNames: decl.params.map(p => p.name),
  };

  const fnType: FnType = {
    kind: 'Fn',
    params: paramTypes,
    ret: retType,
    effects: new Set(decl.effects),
  };

  const foreignRef: ForeignRefNode = {
    kind: 'ForeignRef',
    target: 'unknown',
    module: foreignModule,
    symbol: foreignSymbol,
    sig,
    span: decl.span,
    type: fnType,
  };

  return {
    kind: 'Let',
    name: decl.name,
    symbolId,
    bindingType: fnType,
    value: foreignRef,
    body: sentinelUnit(decl.span),
    span: decl.span,
    type: { kind: 'Unit' },
  };
}

function desugarDataDecl(
  decl: import('../ast/nodes.js').AstDataDeclNode,
  ctx: DesugarCtx,
): AdtDeclNode {
  const symbolId = ctx.nameIndex.get(decl.name) ?? makeSymbolId(`?data_${decl.name}`);
  const dataType: IonType = { kind: 'User', name: decl.name, symbolId, args: [] };
  const variants: AdtVariant[] = decl.variants.map(v => desugarVariant(v, ctx));

  return {
    kind: 'AdtDecl',
    name: decl.name,
    symbolId,
    variants,
    span: decl.span,
    type: dataType,
  };
}

function desugarVariant(variant: AstDataVariant, ctx: DesugarCtx): AdtVariant {
  const symbolId = ctx.nameIndex.get(variant.name) ?? makeSymbolId(`?variant_${variant.name}`);

  switch (variant.kind) {
    case 'UnitVariant':
      return { tag: variant.name, symbolId, fields: [], span: variant.span };

    case 'TupleVariant': {
      const fields: Param[] = variant.fields.map((ann, i) => ({
        name: `_${i}`,
        symbolId: makeSymbolId(`__variant_field_${variant.name}_${i}`),
        type: resolveAnnotation(ann, ctx.nameIndex, new Map(), []),
        span: variant.span,
      }));
      return { tag: variant.name, symbolId, fields, span: variant.span };
    }

    case 'RecordVariant': {
      const fields: Param[] = variant.fields.map(field => ({
        name: field.name,
        symbolId: makeSymbolId(`__variant_field_${variant.name}_${field.name}`),
        type: resolveAnnotation(field.type_, ctx.nameIndex, new Map(), []),
        span: field.span,
      }));
      return { tag: variant.name, symbolId, fields, span: variant.span };
    }
  }
}

// ---------------------------------------------------------------------------
// Expression lowering
// ---------------------------------------------------------------------------

function desugarExpr(expr: AstExprNode, ctx: DesugarCtx): IonIRNode {
  const type = lookupType(expr.span, ctx);

  switch (expr.kind) {
    case 'LiteralInt':
      return { kind: 'Literal', value: { kind: 'Int', value: Number(expr.value) }, span: expr.span, type: { kind: 'Int' } };

    case 'LiteralFloat':
      return { kind: 'Literal', value: { kind: 'Float', value: expr.value }, span: expr.span, type: { kind: 'Float' } };

    case 'LiteralBool':
      return { kind: 'Literal', value: { kind: 'Bool', value: expr.value }, span: expr.span, type: { kind: 'Bool' } };

    case 'LiteralNull':
      return { kind: 'Literal', value: { kind: 'Null' }, span: expr.span, type: { kind: 'Null' } };

    case 'StringLit':
      return desugarStringLit(expr, ctx);

    case 'Ident': {
      const symbolId = ctx.resolutionMap.get(spanKey(expr.span)) ?? makeSymbolId(`unresolved::${expr.name}`);
      return { kind: 'Var', name: expr.name, symbolId, span: expr.span, type };
    }

    case 'BinopExpr': {
      const leftIR = desugarExpr(expr.left, ctx);
      const rightIR = desugarExpr(expr.right, ctx);
      const leftType = lookupType(expr.left.span, ctx);
      const rightType = lookupType(expr.right.span, ctx);
      const opName = binopName(expr.op);
      const callee: VarNode = {
        kind: 'Var',
        name: opName,
        symbolId: makeSymbolId(`builtin::${opName}`),
        span: expr.span,
        type: { kind: 'Fn', params: [leftType, rightType], ret: type, effects: new Set() },
      };
      return { kind: 'App', callee, args: [leftIR, rightIR], span: expr.span, type };
    }

    case 'UnaryExpr': {
      const operandIR = desugarExpr(expr.operand, ctx);
      const operandType = lookupType(expr.operand.span, ctx);
      const opName = unaryName(expr.op);
      const callee: VarNode = {
        kind: 'Var',
        name: opName,
        symbolId: makeSymbolId(`builtin::${opName}`),
        span: expr.span,
        type: { kind: 'Fn', params: [operandType], ret: type, effects: new Set() },
      };
      return { kind: 'App', callee, args: [operandIR], span: expr.span, type };
    }

    case 'CallExpr': {
      const callee = desugarExpr(expr.callee, ctx);
      const args = expr.args.map(a => desugarExpr(a.value, ctx));
      return { kind: 'App', callee, args, span: expr.span, type };
    }

    case 'LambdaExpr': {
      const params: Param[] = expr.params.map(p => ({
        name: p.name,
        symbolId: ctx.varIndex.get(spanKey(p.span)) ?? makeSymbolId(`?param_${p.name}`),
        type: resolveParamType(p, ctx),
        span: p.span,
      }));
      const body = desugarExpr(expr.body, ctx);
      return { kind: 'Abs', params, body, captures: [], span: expr.span, type };
    }

    case 'PipelineExpr': {
      // left |> right  ≡  right(left)
      const callee = desugarExpr(expr.right, ctx);
      const arg = desugarExpr(expr.left, ctx);
      return { kind: 'App', callee, args: [arg], span: expr.span, type };
    }

    case 'IfElseExpr': {
      const scrutinee = desugarExpr(expr.cond, ctx);
      const thenBody = desugarExpr(expr.then, ctx);
      const elseBody = desugarExpr(expr.else_, ctx);
      const trueArm: CaseArm = {
        pattern: { kind: 'Literal', value: { kind: 'Bool', value: true }, span: expr.span },
        body: thenBody,
        span: expr.span,
      };
      const wildcardArm: CaseArm = {
        pattern: { kind: 'Wildcard', span: expr.span },
        body: elseBody,
        span: expr.span,
      };
      return { kind: 'Case', scrutinee, arms: [trueArm, wildcardArm], span: expr.span, type };
    }

    case 'MatchExpr': {
      const scrutinee = desugarExpr(expr.scrutinee, ctx);
      const arms = expr.arms.map(arm => desugarArm(arm, ctx));
      return { kind: 'Case', scrutinee, arms, span: expr.span, type };
    }

    case 'LetExpr': {
      const symbolId = ctx.letIndex.get(spanKey(expr.span)) ?? makeSymbolId(`?let_${expr.name}`);
      const value = desugarExpr(expr.value, ctx);
      const body = desugarExpr(expr.body, ctx);
      const bindingType = lookupType(expr.value.span, ctx);
      const bodyType = lookupType(expr.body.span, ctx);
      return {
        kind: 'Let',
        name: expr.name,
        symbolId,
        bindingType,
        value,
        body,
        span: expr.span,
        type: bodyType,
      };
    }

    case 'AccessorExpr': {
      const receiver = desugarExpr(expr.receiver, ctx);
      return { kind: 'Accessor', receiver, member: expr.field, span: expr.span, type };
    }

    case 'PropagateExpr':
      return desugarPropagate(expr, type, ctx);

    case 'ListLit': {
      const elements = expr.elements.map(el => desugarExpr(el, ctx));
      return { kind: 'ListLit', elements, span: expr.span, type };
    }
  }
}

// ---------------------------------------------------------------------------
// String interpolation
// ---------------------------------------------------------------------------

function desugarStringLit(expr: AstStringLitNode, ctx: DesugarCtx): IonIRNode {
  const strType: IonType = { kind: 'Str' };

  if (expr.parts.length === 0) {
    return { kind: 'Literal', value: { kind: 'Str', value: '' }, span: expr.span, type: strType };
  }

  const first = expr.parts[0];
  if (expr.parts.length === 1 && first !== undefined) {
    if (first.kind === 'TextPart') {
      return { kind: 'Literal', value: { kind: 'Str', value: first.text }, span: expr.span, type: strType };
    }
    return desugarExpr(first.expr, ctx);
  }

  const concatFnType: FnType = { kind: 'Fn', params: [strType, strType], ret: strType, effects: new Set() };
  const concatId = makeSymbolId('builtin::__str_concat__');

  function partToIR(part: AstStringPart): IonIRNode {
    if (part.kind === 'TextPart') {
      return { kind: 'Literal', value: { kind: 'Str', value: part.text }, span: part.span, type: strType };
    }
    return desugarExpr(part.expr, ctx);
  }

  // Non-null: length >= 2 checked above
  let acc: IonIRNode = partToIR(expr.parts[0]!);
  for (let i = 1; i < expr.parts.length; i++) {
    const next = partToIR(expr.parts[i]!);
    const concatVar: VarNode = {
      kind: 'Var',
      name: '__str_concat__',
      symbolId: concatId,
      span: expr.span,
      type: concatFnType,
    };
    acc = { kind: 'App', callee: concatVar, args: [acc, next], span: expr.span, type: strType };
  }

  return acc;
}

// ---------------------------------------------------------------------------
// PropagateExpr lowering
// ---------------------------------------------------------------------------

/**
 * The PropagateExpr and its inner expression share the same spanKey (same startCol),
 * so the typeMap entry for the inner span is overwritten by the checker to the unwrapped
 * type. Use the symbol annotation for Ident inner expressions to recover the original type.
 */
function resolveInnerPropagateType(inner: AstExprNode, ctx: DesugarCtx): IonType {
  if (inner.kind === 'Ident') {
    const symId = ctx.resolutionMap.get(spanKey(inner.span));
    if (symId !== undefined) {
      const info = ctx.symbolTable.symbols.get(symId);
      if (info?.typeAnnotation != null) {
        return resolveAnnotation(info.typeAnnotation, ctx.nameIndex, new Map(), []);
      }
    }
  }
  return lookupType(inner.span, ctx);
}

function desugarPropagate(
  expr: import('../ast/nodes.js').AstPropagateExprNode,
  exprType: IonType,
  ctx: DesugarCtx,
): IonIRNode {
  const innerIR = desugarExpr(expr.inner, ctx);
  const innerType = resolveInnerPropagateType(expr.inner, ctx);

  if (innerType.kind === 'Result') {
    const propV = freshSymbolId(ctx);
    const propE = freshSymbolId(ctx);

    const okPat: CasePattern = {
      kind: 'Constructor',
      ctorName: 'Ok',
      symbolId: makeSymbolId('builtin::Ok'),
      fields: [{ kind: 'Var', name: '__prop_v', symbolId: propV, span: expr.span }],
      span: expr.span,
    };
    const errPat: CasePattern = {
      kind: 'Constructor',
      ctorName: 'Err',
      symbolId: makeSymbolId('builtin::Err'),
      fields: [{ kind: 'Var', name: '__prop_e', symbolId: propE, span: expr.span }],
      span: expr.span,
    };

    const okBody: VarNode = {
      kind: 'Var',
      name: '__prop_v',
      symbolId: propV,
      span: expr.span,
      type: innerType.ok,
    };
    const errBody: ConstructorNode = {
      kind: 'Constructor',
      ctorName: 'Err',
      symbolId: makeSymbolId('builtin::Err'),
      args: [{ kind: 'Var', name: '__prop_e', symbolId: propE, span: expr.span, type: innerType.err }],
      span: expr.span,
      type: exprType,
    };

    return {
      kind: 'Case',
      scrutinee: innerIR,
      arms: [
        { pattern: okPat, body: okBody, span: expr.span },
        { pattern: errPat, body: errBody, span: expr.span },
      ],
      span: expr.span,
      type: exprType,
    };
  }

  if (innerType.kind === 'Option') {
    const propV = freshSymbolId(ctx);

    const somePat: CasePattern = {
      kind: 'Constructor',
      ctorName: 'Some',
      symbolId: makeSymbolId('builtin::Some'),
      fields: [{ kind: 'Var', name: '__prop_v', symbolId: propV, span: expr.span }],
      span: expr.span,
    };
    const nonePat: CasePattern = {
      kind: 'Constructor',
      ctorName: 'None',
      symbolId: makeSymbolId('builtin::None'),
      fields: [],
      span: expr.span,
    };

    const someBody: VarNode = {
      kind: 'Var',
      name: '__prop_v',
      symbolId: propV,
      span: expr.span,
      type: innerType.inner,
    };
    const noneBody: ConstructorNode = {
      kind: 'Constructor',
      ctorName: 'None',
      symbolId: makeSymbolId('builtin::None'),
      args: [],
      span: expr.span,
      type: exprType,
    };

    return {
      kind: 'Case',
      scrutinee: innerIR,
      arms: [
        { pattern: somePat, body: someBody, span: expr.span },
        { pattern: nonePat, body: noneBody, span: expr.span },
      ],
      span: expr.span,
      type: exprType,
    };
  }

  // Fallback: non-Result/Option (should not occur after a clean type check)
  return innerIR;
}

// ---------------------------------------------------------------------------
// Match arm and pattern lowering
// ---------------------------------------------------------------------------

function desugarArm(arm: AstMatchArm, ctx: DesugarCtx): CaseArm {
  const base = {
    pattern: desugarPattern(arm.pattern, ctx),
    body: desugarExpr(arm.body, ctx),
    span: arm.span,
  };
  if (arm.guard !== null) {
    return { ...base, guard: desugarExpr(arm.guard, ctx) };
  }
  return base;
}

function desugarPattern(pat: AstPatternNode, ctx: DesugarCtx): CasePattern {
  switch (pat.kind) {
    case 'WildcardPat':
      return { kind: 'Wildcard', span: pat.span };

    case 'IdentPat': {
      const symbolId = ctx.varIndex.get(spanKey(pat.span)) ?? makeSymbolId(`?pat_${pat.name}`);
      return { kind: 'Var', name: pat.name, symbolId, span: pat.span };
    }

    case 'ConstructorPat': {
      const symbolId = ctx.resolutionMap.get(spanKey(pat.span)) ?? makeSymbolId(`?ctor_${pat.tag}`);
      const fields = pat.fields.map(f => desugarPattern(f, ctx));
      return { kind: 'Constructor', ctorName: pat.tag, symbolId, fields, span: pat.span };
    }

    case 'LiteralPat': {
      const value = desugarLiteralValue(pat.value);
      return { kind: 'Literal', value, span: pat.span };
    }

    case 'TuplePat':
      return { kind: 'Tuple', fields: pat.elements.map(e => desugarPattern(e, ctx)), span: pat.span };
  }
}

type AstLiteralPatValue = LiteralIntNode | LiteralFloatNode | LiteralBoolNode | LiteralNullNode | AstStringLitNode;

function desugarLiteralValue(lit: AstLiteralPatValue): LiteralValue {
  switch (lit.kind) {
    case 'LiteralInt':
      return { kind: 'Int', value: Number(lit.value) };
    case 'LiteralFloat':
      return { kind: 'Float', value: lit.value };
    case 'LiteralBool':
      return { kind: 'Bool', value: lit.value };
    case 'LiteralNull':
      return { kind: 'Null' };
    case 'StringLit': {
      const text = (lit.parts as readonly import('../ast/nodes.js').AstStringPart[])
        .filter((p): p is AstTextPart => p.kind === 'TextPart')
        .map(p => p.text)
        .join('');
      return { kind: 'Str', value: text };
    }
  }
}
