import type {
  AstExprNode,
  AstDeclNode,
  AstPatternNode,
  AstFnDeclNode,
  AstDataVariant,
} from '../ast/nodes.js';
import type { IonType, TypeVar, FnType } from '../ir/types.js';
import type { SymbolId, Span } from '../types.js';
import type { SymbolTable } from '../binder/symbol-table.js';
import type { ResolutionMap } from '../binder/index.js';
import type { CheckError } from './types.js';
import { resolveAnnotation } from './annotation.js';
import { applySubst, applySubstEnv, composeSubst, emptySubst, unify, typeStr } from './unifier.js';
import { checkExhaustiveness } from './exhaust.js';
import type { Substitution } from './unifier.js';
import type { EffectTag } from '../ast/types.js';

/** Shared mutable state threaded through the inference pass. */
export interface InferCtx {
  readonly symbolTable: SymbolTable;
  readonly resolutionMap: ResolutionMap;
  /** spanKey(param.span) or spanKey(pattern.span) → SymbolId (Param + PatternBinding). */
  readonly varIndex: ReadonlyMap<string, SymbolId>;
  /** spanKey(let-binding span) → SymbolId for both LetDecl and LetExpr. */
  readonly letIndex: ReadonlyMap<string, SymbolId>;
  /** Declaration name → SymbolId for Fn and Extern entries. */
  readonly fnDeclIndex: ReadonlyMap<string, SymbolId>;
  /** Type name → SymbolId for Data and TypeAlias entries. */
  readonly nameIndex: ReadonlyMap<string, SymbolId>;
  /** Top-level AST declarations for field-type lookup. */
  readonly astDecls: readonly AstDeclNode[];
  /** ADT type name → ordered variant names (populated by checkDeclTypes). */
  readonly adtVariants: Map<string, string[]>;
  typeEnv: Map<SymbolId, IonType>;
  nodeTypes: Map<string, IonType>;
  subst: Substitution;
  readonly errors: CheckError[];
  readonly counter: { value: number };
  currentFnEffects: ReadonlySet<EffectTag>;
  effectsUsed: Set<EffectTag>;
}

/** Build a canonical span key matching the binder's format. */
export function spanKey(span: Span): string {
  return `${span.file}\0${span.startLine}\0${span.startCol}`;
}

/** Produce a new unique TypeVar using the context's monotonic counter. */
export function freshTypeVar(ctx: InferCtx): TypeVar {
  return { kind: 'TypeVar', id: `$t${ctx.counter.value++}` };
}

// ---------------------------------------------------------------------------
// Declaration type registration (pass 1)
// ---------------------------------------------------------------------------

/**
 * Register declared types for all declarations into ctx.typeEnv.
 * Does NOT infer expression bodies — that is pass 2 (inferDeclBodies).
 */
export function checkDeclTypes(decls: readonly AstDeclNode[], ctx: InferCtx): void {
  for (const decl of decls) {
    registerDeclType(decl, ctx);
  }
}

function registerDeclType(decl: AstDeclNode, ctx: InferCtx): void {
  switch (decl.kind) {
    case 'FnDecl':
      registerFnType(decl, ctx);
      break;

    case 'LetDecl': {
      const id = ctx.letIndex.get(spanKey(decl.span));
      if (id === undefined) break;
      if (decl.type_ === null) {
        ctx.errors.push({
          kind: 'UnannotatedTopLevel',
          code: 'E0402',
          name: decl.name,
          expectedAnnotation: ': <Type>',
          span: decl.span,
          message: `Top-level binding '${decl.name}' requires a type annotation`,
          suggestion: `Add a type annotation`,
        });
        ctx.typeEnv.set(id, freshTypeVar(ctx));
      } else {
        ctx.typeEnv.set(id, resolveAnnotation(decl.type_, ctx.nameIndex, new Map(), ctx.errors));
      }
      break;
    }

    case 'ExternDecl': {
      const id = ctx.fnDeclIndex.get(decl.name);
      if (id === undefined) break;
      const paramTypes = decl.params.map(p => {
        if (p.type_ === null) {
          ctx.errors.push({
            kind: 'UnannotatedTopLevel',
            code: 'E0402',
            name: p.name,
            expectedAnnotation: ': <Type>',
            span: p.span,
            message: `Extern parameter '${p.name}' requires a type annotation`,
            suggestion: `Add a type annotation`,
          });
          return freshTypeVar(ctx);
        }
        return resolveAnnotation(p.type_, ctx.nameIndex, new Map(), ctx.errors);
      });
      let retType: IonType;
      if (decl.returnType === null) {
        ctx.errors.push({
          kind: 'UnannotatedTopLevel',
          code: 'E0402',
          name: decl.name,
          expectedAnnotation: '-> <Type>',
          span: decl.span,
          message: `Extern '${decl.name}' requires a return type annotation`,
          suggestion: `Add a type annotation`,
        });
        retType = freshTypeVar(ctx);
      } else {
        retType = resolveAnnotation(decl.returnType, ctx.nameIndex, new Map(), ctx.errors);
      }
      const fnType: FnType = {
        kind: 'Fn',
        params: paramTypes,
        ret: retType,
        effects: new Set(decl.effects),
      };
      ctx.typeEnv.set(id, fnType);
      break;
    }

    case 'DataDecl': {
      const dataId = ctx.nameIndex.get(decl.name);
      if (dataId === undefined) break;

      // Build typeParam env for generic data types.
      const tpEnv = new Map<string, IonType>();
      for (const tp of decl.typeParams) {
        const tv: TypeVar = { kind: 'TypeVar', id: `${decl.name}.${tp}` };
        tpEnv.set(tp, tv);
      }

      const dataType: IonType = {
        kind: 'User',
        name: decl.name,
        symbolId: dataId,
        args: decl.typeParams.map(tp => ({ kind: 'TypeVar', id: `${decl.name}.${tp}` } as TypeVar)),
      };
      ctx.typeEnv.set(dataId, dataType);

      const variantNames: string[] = [];
      for (const variant of decl.variants) {
        variantNames.push(variant.name);
        const varId = ctx.nameIndex.get(variant.name);
        if (varId === undefined) continue;
        const ctorType = buildCtorType(variant, dataType, ctx.nameIndex, tpEnv, ctx.errors);
        ctx.typeEnv.set(varId, ctorType);
      }
      ctx.adtVariants.set(decl.name, variantNames);
      break;
    }

    case 'TypeAliasDecl': {
      const id = ctx.nameIndex.get(decl.name);
      if (id === undefined) break;
      const tpEnv = new Map<string, IonType>();
      for (const tp of decl.typeParams) {
        const tv: TypeVar = { kind: 'TypeVar', id: `${decl.name}.${tp}` };
        tpEnv.set(tp, tv);
      }
      const aliasType = resolveAnnotation(decl.type_, ctx.nameIndex, tpEnv, ctx.errors);
      ctx.typeEnv.set(id, aliasType);
      break;
    }

    case 'ModuleDecl':
      checkDeclTypes(decl.decls, ctx);
      break;

    case 'UseDecl':
      break;
  }
}

function registerFnType(decl: AstFnDeclNode, ctx: InferCtx): void {
  const fnId = ctx.fnDeclIndex.get(decl.name);
  if (fnId === undefined) return;

  const tpEnv = new Map<string, IonType>();
  for (const tp of decl.typeParams) {
    const tv: TypeVar = { kind: 'TypeVar', id: `${decl.name}.${tp}` };
    tpEnv.set(tp, tv);
  }

  const paramTypes: IonType[] = [];
  for (const param of decl.params) {
    const pt: IonType = param.type_ !== null
      ? resolveAnnotation(param.type_, ctx.nameIndex, tpEnv, ctx.errors)
      : freshTypeVar(ctx);
    paramTypes.push(pt);
    const paramId = ctx.varIndex.get(spanKey(param.span));
    if (paramId !== undefined) ctx.typeEnv.set(paramId, pt);
  }

  const retType: IonType = decl.returnType !== null
    ? resolveAnnotation(decl.returnType, ctx.nameIndex, tpEnv, ctx.errors)
    : freshTypeVar(ctx);

  const fnType: FnType = {
    kind: 'Fn',
    params: paramTypes,
    ret: retType,
    effects: new Set(decl.effects),
  };
  ctx.typeEnv.set(fnId, fnType);
}

function buildCtorType(
  variant: AstDataVariant,
  dataType: IonType,
  nameIndex: ReadonlyMap<string, SymbolId>,
  tpEnv: ReadonlyMap<string, IonType>,
  errors: CheckError[],
): IonType {
  switch (variant.kind) {
    case 'UnitVariant':
      return dataType;
    case 'TupleVariant': {
      const fieldTypes = variant.fields.map(f => resolveAnnotation(f, nameIndex, tpEnv, errors));
      return { kind: 'Fn', params: fieldTypes, ret: dataType, effects: new Set() };
    }
    case 'RecordVariant': {
      const fieldTypes = variant.fields.map(f => resolveAnnotation(f.type_, nameIndex, tpEnv, errors));
      return { kind: 'Fn', params: fieldTypes, ret: dataType, effects: new Set() };
    }
  }
}

// ---------------------------------------------------------------------------
// Declaration body inference (pass 2)
// ---------------------------------------------------------------------------

/** Infer the bodies of all function and let declarations. */
export function inferDeclBodies(decls: readonly AstDeclNode[], ctx: InferCtx): void {
  for (const decl of decls) {
    switch (decl.kind) {
      case 'FnDecl':
        inferFnBody(decl, ctx);
        break;
      case 'LetDecl': {
        const id = ctx.letIndex.get(spanKey(decl.span));
        if (id === undefined) break;
        const declaredType = ctx.typeEnv.get(id);
        if (declaredType === undefined) break;
        const valueType = inferExpr(decl.value, ctx);
        ctx.subst = unify(declaredType, valueType, ctx.subst, decl.span, ctx.errors);
        break;
      }
      case 'ModuleDecl':
        inferDeclBodies(decl.decls, ctx);
        break;
      default:
        break;
    }
  }
}

function inferFnBody(decl: AstFnDeclNode, ctx: InferCtx): void {
  const fnId = ctx.fnDeclIndex.get(decl.name);
  if (fnId === undefined) return;
  const fnType = ctx.typeEnv.get(fnId);
  if (fnType === undefined || fnType.kind !== 'Fn') return;

  // Save and reset effect tracking for this function body.
  const savedFnEffects = ctx.currentFnEffects;
  const savedEffectsUsed = ctx.effectsUsed;
  ctx.currentFnEffects = fnType.effects;
  ctx.effectsUsed = new Set();

  const bodyType = inferExpr(decl.body, ctx);
  ctx.subst = unify(bodyType, fnType.ret, ctx.subst, decl.span, ctx.errors);

  // Check that body uses only declared effects.
  const undeclared = [...ctx.effectsUsed].filter(e => !fnType.effects.has(e));
  for (const effect of undeclared) {
    ctx.errors.push({
      kind: 'EffectMismatch',
      code: 'E0405',
      unexpected: effect,
      expected: [...fnType.effects],
      span: decl.span,
      message: `Function '${decl.name}' uses undeclared effect '${effect}'`,
      suggestion: `Add '!${effect}' to the function declaration or remove the use`,
    });
  }

  ctx.currentFnEffects = savedFnEffects;
  ctx.effectsUsed = savedEffectsUsed;
}

// ---------------------------------------------------------------------------
// Expression type inference
// ---------------------------------------------------------------------------

/**
 * Infer the type of an expression, recording the result in ctx.nodeTypes.
 * Returns the inferred type under the current substitution.
 */
export function inferExpr(expr: AstExprNode, ctx: InferCtx): IonType {
  const t = computeType(expr, ctx);
  const resolved = applySubst(ctx.subst, t);
  ctx.nodeTypes.set(spanKey(expr.span), resolved);
  return resolved;
}

function computeType(expr: AstExprNode, ctx: InferCtx): IonType {
  switch (expr.kind) {
    case 'LiteralInt':
      return { kind: 'Int' };

    case 'LiteralFloat':
      return { kind: 'Float' };

    case 'LiteralBool':
      return { kind: 'Bool' };

    case 'LiteralNull':
      return { kind: 'Null' };

    case 'StringLit':
      for (const part of expr.parts) {
        if (part.kind === 'InterpPart') {
          const pt = inferExpr(part.expr, ctx);
          ctx.subst = unify(pt, { kind: 'Str' }, ctx.subst, part.span, ctx.errors);
        }
      }
      return { kind: 'Str' };

    case 'Ident': {
      const symId = ctx.resolutionMap.get(spanKey(expr.span));
      if (symId === undefined) return freshTypeVar(ctx);
      return applySubst(ctx.subst, ctx.typeEnv.get(symId) ?? freshTypeVar(ctx));
    }

    case 'BinopExpr': {
      const left = inferExpr(expr.left, ctx);
      const right = inferExpr(expr.right, ctx);
      switch (expr.op) {
        case 'Add':
        case 'Sub':
        case 'Mul':
        case 'Div':
        case 'Mod': {
          ctx.subst = unify(left, right, ctx.subst, expr.span, ctx.errors);
          const unified = applySubst(ctx.subst, left);
          if (
            unified.kind !== 'Int' &&
            unified.kind !== 'Float' &&
            unified.kind !== 'TypeVar'
          ) {
            ctx.errors.push({
              kind: 'TypeMismatch',
              code: 'E0401',
              expected: { kind: 'Int' },
              found: unified,
              span: expr.span,
              message: `Arithmetic operator requires Int or Float operands, found ${typeStr(unified)}`,
              suggestion: `Use Int or Float values with arithmetic operators`,
            });
            return { kind: 'Int' };
          }
          return unified;
        }
        case 'EqEq':
        case 'NotEq':
        case 'Lt':
        case 'Gt':
        case 'LtEq':
        case 'GtEq':
          ctx.subst = unify(left, right, ctx.subst, expr.span, ctx.errors);
          return { kind: 'Bool' };
        case 'And':
        case 'Or':
          ctx.subst = unify(left, { kind: 'Bool' }, ctx.subst, expr.span, ctx.errors);
          ctx.subst = unify(right, { kind: 'Bool' }, ctx.subst, expr.span, ctx.errors);
          return { kind: 'Bool' };
      }
    }

    case 'UnaryExpr': {
      const operand = inferExpr(expr.operand, ctx);
      switch (expr.op) {
        case 'Neg': {
          if (
            operand.kind !== 'Int' &&
            operand.kind !== 'Float' &&
            operand.kind !== 'TypeVar'
          ) {
            ctx.errors.push({
              kind: 'TypeMismatch',
              code: 'E0401',
              expected: { kind: 'Int' },
              found: operand,
              span: expr.span,
              message: `Unary '-' requires Int or Float, found ${typeStr(operand)}`,
              suggestion: `Apply unary '-' only to Int or Float values`,
            });
          }
          return applySubst(ctx.subst, operand);
        }
        case 'Not':
          ctx.subst = unify(operand, { kind: 'Bool' }, ctx.subst, expr.span, ctx.errors);
          return { kind: 'Bool' };
      }
    }

    case 'CallExpr': {
      const calleeType = inferExpr(expr.callee, ctx);
      const argTypes = expr.args.map(a => inferExpr(a.value, ctx));
      const resolvedFn = applySubst(ctx.subst, calleeType);
      if (resolvedFn.kind === 'Fn' && argTypes.length !== resolvedFn.params.length) {
        ctx.errors.push({
          kind: 'ArityMismatch',
          code: 'E0406',
          expected: resolvedFn.params.length,
          found: argTypes.length,
          span: expr.span,
          message: `Expected ${resolvedFn.params.length} argument(s), found ${argTypes.length}`,
          suggestion: `Provide exactly ${resolvedFn.params.length} argument(s)`,
        });
        for (const eff of resolvedFn.effects) {
          ctx.effectsUsed.add(eff);
        }
        return applySubst(ctx.subst, resolvedFn.ret);
      }
      const retVar = freshTypeVar(ctx);
      const expectedFnType: FnType = {
        kind: 'Fn',
        params: argTypes,
        ret: retVar,
        effects: new Set(),
      };
      ctx.subst = unify(calleeType, expectedFnType, ctx.subst, expr.span, ctx.errors);
      const resolvedCallee = applySubst(ctx.subst, calleeType);
      if (resolvedCallee.kind === 'Fn') {
        for (const eff of resolvedCallee.effects) {
          ctx.effectsUsed.add(eff);
        }
      }
      return applySubst(ctx.subst, retVar);
    }

    case 'LambdaExpr': {
      const paramTypes: IonType[] = [];
      for (const param of expr.params) {
        const pt: IonType = param.type_ !== null
          ? resolveAnnotation(param.type_, ctx.nameIndex, new Map(), ctx.errors)
          : freshTypeVar(ctx);
        paramTypes.push(pt);
        const paramId = ctx.varIndex.get(spanKey(param.span));
        if (paramId !== undefined) ctx.typeEnv.set(paramId, pt);
      }
      const bodyType = inferExpr(expr.body, ctx);
      const fnType: FnType = {
        kind: 'Fn',
        params: paramTypes,
        ret: bodyType,
        effects: new Set(),
      };
      return fnType;
    }

    case 'PipelineExpr': {
      // lhs |> rhs  desugars to  rhs(lhs)
      const argType = inferExpr(expr.left, ctx);
      const fnType = inferExpr(expr.right, ctx);
      const retVar = freshTypeVar(ctx);
      const expectedFn: FnType = { kind: 'Fn', params: [argType], ret: retVar, effects: new Set() };
      ctx.subst = unify(fnType, expectedFn, ctx.subst, expr.span, ctx.errors);
      return applySubst(ctx.subst, retVar);
    }

    case 'IfElseExpr': {
      const condType = inferExpr(expr.cond, ctx);
      ctx.subst = unify(condType, { kind: 'Bool' }, ctx.subst, expr.cond.span, ctx.errors);
      const thenType = inferExpr(expr.then, ctx);
      const elseType = inferExpr(expr.else_, ctx);
      ctx.subst = unify(thenType, elseType, ctx.subst, expr.span, ctx.errors);
      return applySubst(ctx.subst, thenType);
    }

    case 'MatchExpr': {
      const scrutType = inferExpr(expr.scrutinee, ctx);
      const resolved = applySubst(ctx.subst, scrutType);

      let armType: IonType = freshTypeVar(ctx);
      for (const arm of expr.arms) {
        const bindings = collectPatternBindings(arm.pattern, resolved, ctx);
        for (const [id, t] of bindings) {
          ctx.typeEnv.set(id, t);
        }
        if (arm.guard !== null) {
          const guardType = inferExpr(arm.guard, ctx);
          ctx.subst = unify(guardType, { kind: 'Bool' }, ctx.subst, arm.guard.span, ctx.errors);
        }
        const bodyType = inferExpr(arm.body, ctx);
        ctx.subst = unify(armType, bodyType, ctx.subst, arm.body.span, ctx.errors);
        armType = applySubst(ctx.subst, armType);
      }

      checkExhaustiveness(expr.arms, resolved, ctx.adtVariants, expr.span, ctx.errors);
      return armType;
    }

    case 'LetExpr': {
      const valueType = inferExpr(expr.value, ctx);
      let bindingType: IonType;
      if (expr.type_ !== null) {
        const annType = resolveAnnotation(expr.type_, ctx.nameIndex, new Map(), ctx.errors);
        ctx.subst = unify(valueType, annType, ctx.subst, expr.span, ctx.errors);
        bindingType = applySubst(ctx.subst, annType);
      } else {
        bindingType = applySubst(ctx.subst, valueType);
      }
      const bindingId = ctx.letIndex.get(spanKey(expr.span));
      if (bindingId !== undefined) ctx.typeEnv.set(bindingId, bindingType);
      return inferExpr(expr.body, ctx);
    }

    case 'AccessorExpr': {
      const receiverType = applySubst(ctx.subst, inferExpr(expr.receiver, ctx));
      if (receiverType.kind === 'User') {
        const fieldType = findRecordFieldType(receiverType.name, expr.field, ctx);
        if (fieldType !== null) return fieldType;
      }
      return freshTypeVar(ctx);
    }

    case 'PropagateExpr': {
      const innerType = applySubst(ctx.subst, inferExpr(expr.inner, ctx));
      if (innerType.kind === 'Option') return innerType.inner;
      if (innerType.kind === 'Result') return innerType.ok;
      ctx.errors.push({
        kind: 'InvalidPropagate',
        code: 'E0404',
        found: innerType,
        expected: 'Option | Result',
        span: expr.span,
        message: `The '?' operator requires an Option or Result type, got ${typeStr(innerType)}`,
        suggestion: `Only use '?' on Option<T> or Result<T, E> values`,
      });
      return freshTypeVar(ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern binding helpers
// ---------------------------------------------------------------------------

function collectPatternBindings(
  pattern: AstPatternNode,
  scrutType: IonType,
  ctx: InferCtx,
): Map<SymbolId, IonType> {
  const result = new Map<SymbolId, IonType>();
  walkPattern(pattern, scrutType, ctx, result);
  return result;
}

function walkPattern(
  pattern: AstPatternNode,
  type: IonType,
  ctx: InferCtx,
  out: Map<SymbolId, IonType>,
): void {
  switch (pattern.kind) {
    case 'WildcardPat':
      break;

    case 'IdentPat': {
      const id = ctx.varIndex.get(spanKey(pattern.span));
      if (id !== undefined) out.set(id, applySubst(ctx.subst, type));
      break;
    }

    case 'ConstructorPat': {
      const ctorId = ctx.resolutionMap.get(spanKey(pattern.span));
      if (ctorId !== undefined) {
        const ctorType = applySubst(ctx.subst, ctx.typeEnv.get(ctorId) ?? freshTypeVar(ctx));
        if (ctorType.kind === 'Fn') {
          for (let i = 0; i < pattern.fields.length && i < ctorType.params.length; i++) {
            // Non-null: both arrays checked by loop bounds.
            walkPattern(pattern.fields[i]!, ctorType.params[i]!, ctx, out);
          }
        }
      } else {
        walkBuiltinCtor(pattern.tag, pattern.fields, type, ctx, out);
      }
      break;
    }

    case 'LiteralPat':
      break;

    case 'TuplePat': {
      if (type.kind === 'User' && type.name === '__Tuple') {
        for (let i = 0; i < pattern.elements.length && i < type.args.length; i++) {
          // Non-null: both arrays checked by loop bounds.
          walkPattern(pattern.elements[i]!, type.args[i]!, ctx, out);
        }
      }
      break;
    }
  }
}

function walkBuiltinCtor(
  tag: string,
  fields: readonly AstPatternNode[],
  scrutType: IonType,
  ctx: InferCtx,
  out: Map<SymbolId, IonType>,
): void {
  switch (tag) {
    case 'Some':
      if (scrutType.kind === 'Option' && fields.length === 1) {
        walkPattern(fields[0]!, scrutType.inner, ctx, out);
      }
      break;
    case 'Ok':
      if (scrutType.kind === 'Result' && fields.length === 1) {
        walkPattern(fields[0]!, scrutType.ok, ctx, out);
      }
      break;
    case 'Err':
      if (scrutType.kind === 'Result' && fields.length === 1) {
        walkPattern(fields[0]!, scrutType.err, ctx, out);
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Field lookup for accessor expressions
// ---------------------------------------------------------------------------

function findRecordFieldType(
  typeName: string,
  fieldName: string,
  ctx: InferCtx,
): IonType | null {
  for (const decl of ctx.astDecls) {
    if (decl.kind === 'DataDecl' && decl.name === typeName) {
      for (const variant of decl.variants) {
        if (variant.kind === 'RecordVariant') {
          const field = variant.fields.find(f => f.name === fieldName);
          if (field !== undefined) {
            return resolveAnnotation(field.type_, ctx.nameIndex, new Map(), ctx.errors);
          }
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Index builders
// ---------------------------------------------------------------------------

/** Build varIndex (Param + PatternBinding) from the symbol table. */
export function buildVarIndex(symbolTable: SymbolTable): Map<string, SymbolId> {
  const idx = new Map<string, SymbolId>();
  for (const entry of symbolTable.all()) {
    if (entry.declKind === 'Param' || entry.declKind === 'PatternBinding') {
      idx.set(spanKey(entry.span), entry.id);
    }
  }
  return idx;
}

/** Build letIndex (LetDecl + LetExpr bindings) from the symbol table. */
export function buildLetIndex(symbolTable: SymbolTable): Map<string, SymbolId> {
  const idx = new Map<string, SymbolId>();
  for (const entry of symbolTable.all()) {
    if (entry.declKind === 'Let') {
      idx.set(spanKey(entry.span), entry.id);
    }
  }
  return idx;
}

/** Build fnDeclIndex (Fn + Extern) from the symbol table. */
export function buildFnDeclIndex(symbolTable: SymbolTable): Map<string, SymbolId> {
  const idx = new Map<string, SymbolId>();
  for (const entry of symbolTable.all()) {
    if (entry.declKind === 'Fn' || entry.declKind === 'Extern') {
      idx.set(entry.name, entry.id);
    }
  }
  return idx;
}

/** Build nameIndex (Data + TypeAlias) from the symbol table. */
export function buildNameIndex(symbolTable: SymbolTable): Map<string, SymbolId> {
  const idx = new Map<string, SymbolId>();
  for (const entry of symbolTable.all()) {
    if (entry.declKind === 'Data' || entry.declKind === 'TypeAlias') {
      idx.set(entry.name, entry.id);
    }
  }
  return idx;
}

// Re-export for use in index.ts
export { applySubstEnv, emptySubst, composeSubst };
