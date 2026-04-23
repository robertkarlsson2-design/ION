import type {
  AstModule,
  AstDeclNode,
  AstExprNode,
  AstFnDeclNode,
  AstLambdaParam,
  AstLetExprNode,
  AstMatchArm,
  AstPatternNode,
  AstDataDeclNode,
  AstBinopExprNode,
} from '../ast/nodes.js';
import type { EffectTag } from '../ast/types.js';
import type { IonType, FnType, TypeVar } from '../ir/types.js';
import type { Span, SymbolId } from '../types.js';
import type { BindResult } from '../binder/index.js';
import type { SymbolKind, ModuleSymbolTable } from '../binder/symbol-table.js';

import { resolveAnnotation } from './resolve-annotation.js';
import { TypeEnv } from './type-env.js';
import { unify } from './unify.js';
import { applySubst, freshVar, typeToString } from './types.js';
import type { Substitution } from './types.js';
import type { CheckError } from './errors.js';

export type { CheckError } from './errors.js';
export { formatCheckError } from './errors.js';
export type { IonType } from '../ir/types.js';

/** Maps spanKey(span) → resolved IonType for every expression node. */
export type TypeMap = ReadonlyMap<string, IonType>;

export interface CheckResult {
  readonly typeMap: TypeMap;
  readonly errors: readonly CheckError[];
}

/** Compute span key — matches the binder's internal format exactly. */
export function spanKey(span: Span): string {
  return `${span.file}\0${span.startLine}\0${span.startCol}`;
}

const INT: IonType = { kind: 'Int' };
const FLOAT: IonType = { kind: 'Float' };
const STR: IonType = { kind: 'Str' };
const BOOL: IonType = { kind: 'Bool' };

/**
 * Type-check a bound module.
 * Resolves every expression's IonType and emits structured errors with codes E0401–E0406.
 */
export function checkModule(
  module: AstModule,
  bindResult: BindResult,
  modulePath: string,
): CheckResult {
  return new Checker(module, bindResult.symbolTable, modulePath).check();
}

class Checker {
  private readonly typeMap: Map<string, IonType> = new Map();
  private readonly errors: CheckError[] = [];
  private readonly subst: Substitution = new Map();
  private readonly counter: { n: number } = { n: 0 };
  private readonly dataDecls: Map<string, AstDataDeclNode> = new Map();

  constructor(
    private readonly module: AstModule,
    private readonly symbolTable: ModuleSymbolTable,
    private readonly _modulePath: string,
  ) {}

  check(): CheckResult {
    for (const decl of this.module.decls) {
      if (decl.kind === 'DataDecl') {
        this.dataDecls.set(decl.name, decl);
      }
    }

    const moduleEnv = this.buildModuleEnv();

    for (const decl of this.module.decls) {
      this.checkDecl(decl, moduleEnv);
    }

    return { typeMap: this.typeMap, errors: this.errors };
  }

  // ---------------------------------------------------------------------------
  // Module-level environment
  // ---------------------------------------------------------------------------

  private buildModuleEnv(): TypeEnv {
    let env = new TypeEnv(null);

    for (const decl of this.module.decls) {
      switch (decl.kind) {
        case 'FnDecl': {
          const id = this.findSymbolIdByName(decl.name, 'Fn');
          if (id !== undefined) env = env.extend(id, this.buildFnDeclType(decl));
          break;
        }
        case 'LetDecl': {
          const id = this.findSymbolIdByName(decl.name, 'Let');
          if (id !== undefined) {
            if (decl.type_ !== null) {
              env = env.extend(
                id,
                resolveAnnotation(
                  decl.type_,
                  new Map(),
                  this.symbolTable,
                  this.errors,
                  decl.span,
                ),
              );
            } else {
              this.errors.push({
                kind: 'UnannotatedTopLevel',
                code: 'E0402',
                name: decl.name,
                span: decl.span,
                message: `Top-level 'let ${decl.name}' has no type annotation`,
                suggestion: `Add a type annotation: let ${decl.name}: <Type> = ...`,
              });
              env = env.extend(id, freshVar(this.counter));
            }
          }
          break;
        }
        case 'ExternDecl': {
          const id = this.findSymbolIdByName(decl.name, 'Extern');
          if (id !== undefined) {
            const paramTypes = decl.params.map(p =>
              p.type_ !== null
                ? resolveAnnotation(
                    p.type_,
                    new Map(),
                    this.symbolTable,
                    this.errors,
                    p.span,
                  )
                : freshVar(this.counter),
            );
            const retType =
              decl.returnType !== null
                ? resolveAnnotation(
                    decl.returnType,
                    new Map(),
                    this.symbolTable,
                    this.errors,
                    decl.span,
                  )
                : freshVar(this.counter);
            const fnType: FnType = {
              kind: 'Fn',
              params: paramTypes,
              ret: retType,
              effects: new Set(decl.effects),
            };
            env = env.extend(id, fnType);
          }
          break;
        }
        default:
          break;
      }
    }

    return env;
  }

  private buildFnDeclType(decl: AstFnDeclNode): FnType {
    const tp = this.buildTypeParamsMap(decl.typeParams);
    const paramTypes = decl.params.map(p =>
      p.type_ !== null
        ? resolveAnnotation(p.type_, tp, this.symbolTable, this.errors, p.span)
        : freshVar(this.counter),
    );
    const retType =
      decl.returnType !== null
        ? resolveAnnotation(
            decl.returnType,
            tp,
            this.symbolTable,
            this.errors,
            decl.span,
          )
        : freshVar(this.counter);
    return { kind: 'Fn', params: paramTypes, ret: retType, effects: new Set(decl.effects) };
  }

  private buildTypeParamsMap(names: readonly string[]): ReadonlyMap<string, TypeVar> {
    const map = new Map<string, TypeVar>();
    for (const name of names) map.set(name, freshVar(this.counter));
    return map;
  }

  // ---------------------------------------------------------------------------
  // Declaration checking
  // ---------------------------------------------------------------------------

  private checkDecl(decl: AstDeclNode, moduleEnv: TypeEnv): void {
    switch (decl.kind) {
      case 'FnDecl': {
        const id = this.findSymbolIdByName(decl.name, 'Fn');
        if (id === undefined) break;

        const envType = moduleEnv.lookup(id);
        if (envType === undefined || envType.kind !== 'Fn') break;
        const fnType = envType;

        let bodyEnv = moduleEnv;
        for (let i = 0; i < decl.params.length; i++) {
          const param = decl.params[i];
          if (param === undefined) continue;
          const paramId = this.findSymbolBySpan(param.span);
          if (paramId !== undefined) {
            const paramType = fnType.params[i] ?? freshVar(this.counter);
            bodyEnv = bodyEnv.extend(paramId, paramType);
          }
        }

        const usedEffects = new Set<EffectTag>();
        const bodyType = this.inferExpr(decl.body, bodyEnv, usedEffects);

        const unifyErr = unify(bodyType, fnType.ret, this.subst, decl.body.span);
        if (unifyErr !== null) this.errors.push(unifyErr);

        this.checkEffects(usedEffects, new Set(decl.effects), decl.span);
        break;
      }

      case 'LetDecl': {
        const id = this.findSymbolIdByName(decl.name, 'Let');
        if (id === undefined) break;

        const declaredType = moduleEnv.lookup(id);
        if (declaredType === undefined) break;

        const usedEffects = new Set<EffectTag>();
        const valType = this.inferExpr(decl.value, moduleEnv, usedEffects);
        const unifyErr = unify(valType, declaredType, this.subst, decl.span);
        if (unifyErr !== null) this.errors.push(unifyErr);
        break;
      }

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Expression inference
  // ---------------------------------------------------------------------------

  private inferExpr(expr: AstExprNode, env: TypeEnv, usedEffects: Set<EffectTag>): IonType {
    const type = this.inferExprInner(expr, env, usedEffects);
    this.typeMap.set(spanKey(expr.span), applySubst(this.subst, type));
    return type;
  }

  private inferExprInner(
    expr: AstExprNode,
    env: TypeEnv,
    usedEffects: Set<EffectTag>,
  ): IonType {
    switch (expr.kind) {
      case 'LiteralInt':
        return INT;
      case 'LiteralFloat':
        return FLOAT;
      case 'LiteralBool':
        return BOOL;
      case 'LiteralNull':
        return { kind: 'Null' };

      case 'StringLit': {
        for (const part of expr.parts) {
          if (part.kind === 'InterpPart') this.inferExpr(part.expr, env, usedEffects);
        }
        return STR;
      }

      case 'Ident': {
        const symbolId = this.symbolTable.references.get(spanKey(expr.span));
        if (symbolId === undefined) return freshVar(this.counter);
        return env.lookup(symbolId) ?? freshVar(this.counter);
      }

      case 'BinopExpr':
        return this.inferBinop(expr, env, usedEffects);

      case 'UnaryExpr': {
        const operandType = this.inferExpr(expr.operand, env, usedEffects);
        const resolved = applySubst(this.subst, operandType);
        switch (expr.op) {
          case 'Neg': {
            if (
              resolved.kind !== 'Int' &&
              resolved.kind !== 'Float' &&
              resolved.kind !== 'TypeVar'
            ) {
              this.errors.push({
                kind: 'TypeMismatch',
                code: 'E0401',
                expected: INT,
                found: resolved,
                span: expr.span,
                message: `Unary '-' requires Int or Float, found ${typeToString(resolved)}`,
                suggestion: `Apply unary '-' only to Int or Float values`,
              });
            }
            return resolved;
          }
          case 'Not': {
            const err = unify(operandType, BOOL, this.subst, expr.span);
            if (err !== null) this.errors.push(err);
            return BOOL;
          }
        }
      }

      case 'CallExpr': {
        const calleeType = this.inferExpr(expr.callee, env, usedEffects);
        const resolvedCallee = applySubst(this.subst, calleeType);

        if (resolvedCallee.kind === 'Fn') {
          for (const effect of resolvedCallee.effects) usedEffects.add(effect);

          if (expr.args.length !== resolvedCallee.params.length) {
            this.errors.push({
              kind: 'ArityMismatch',
              code: 'E0406',
              expected: resolvedCallee.params.length,
              found: expr.args.length,
              span: expr.span,
              message: `Expected ${resolvedCallee.params.length} argument(s), found ${expr.args.length}`,
              suggestion: `Provide exactly ${resolvedCallee.params.length} argument(s)`,
            });
            for (const arg of expr.args) this.inferExpr(arg.value, env, usedEffects);
            return applySubst(this.subst, resolvedCallee.ret);
          }

          for (let i = 0; i < expr.args.length; i++) {
            const arg = expr.args[i];
            if (arg === undefined) continue;
            const paramType = resolvedCallee.params[i] ?? freshVar(this.counter);
            const argType = this.inferExpr(arg.value, env, usedEffects);
            const err = unify(argType, paramType, this.subst, arg.span);
            if (err !== null) this.errors.push(err);
          }

          return applySubst(this.subst, resolvedCallee.ret);
        }

        // Unknown callee — unify with an inferred fn type
        const retVar = freshVar(this.counter);
        const paramVars = expr.args.map(() => freshVar(this.counter));
        for (let i = 0; i < expr.args.length; i++) {
          const arg = expr.args[i];
          const pv = paramVars[i];
          if (arg === undefined || pv === undefined) continue;
          const argType = this.inferExpr(arg.value, env, usedEffects);
          const err = unify(argType, pv, this.subst, arg.span);
          if (err !== null) this.errors.push(err);
        }
        const inferredFn: FnType = {
          kind: 'Fn',
          params: paramVars,
          ret: retVar,
          effects: new Set(),
        };
        const fnErr = unify(calleeType, inferredFn, this.subst, expr.span);
        if (fnErr !== null) this.errors.push(fnErr);
        return retVar;
      }

      case 'LambdaExpr': {
        let lambdaEnv = env;
        const paramTypes: IonType[] = [];
        for (const param of expr.params) {
          const paramType = this.resolveLambdaParamType(param);
          paramTypes.push(paramType);
          const paramId = this.findSymbolBySpan(param.span);
          if (paramId !== undefined) lambdaEnv = lambdaEnv.extend(paramId, paramType);
        }
        const bodyType = this.inferExpr(expr.body, lambdaEnv, usedEffects);
        const fnType: FnType = {
          kind: 'Fn',
          params: paramTypes,
          ret: bodyType,
          effects: new Set(),
        };
        return fnType;
      }

      case 'PipelineExpr': {
        const leftType = this.inferExpr(expr.left, env, usedEffects);
        const rightType = this.inferExpr(expr.right, env, usedEffects);
        const resolvedRight = applySubst(this.subst, rightType);

        if (resolvedRight.kind === 'Fn') {
          for (const effect of resolvedRight.effects) usedEffects.add(effect);
          const firstParam = resolvedRight.params[0];
          if (firstParam !== undefined) {
            const err = unify(leftType, firstParam, this.subst, expr.span);
            if (err !== null) this.errors.push(err);
          }
          return applySubst(this.subst, resolvedRight.ret);
        }

        const retVar = freshVar(this.counter);
        const expectedFn: FnType = {
          kind: 'Fn',
          params: [leftType],
          ret: retVar,
          effects: new Set(),
        };
        const err = unify(rightType, expectedFn, this.subst, expr.span);
        if (err !== null) this.errors.push(err);
        return retVar;
      }

      case 'IfElseExpr': {
        const condType = this.inferExpr(expr.cond, env, usedEffects);
        const condErr = unify(condType, BOOL, this.subst, expr.cond.span);
        if (condErr !== null) this.errors.push(condErr);

        const thenType = this.inferExpr(expr.then, env, usedEffects);
        const elseType = this.inferExpr(expr.else_, env, usedEffects);

        const branchErr = unify(thenType, elseType, this.subst, expr.span);
        if (branchErr !== null) this.errors.push(branchErr);

        return applySubst(this.subst, thenType);
      }

      case 'MatchExpr': {
        const scrutineeType = this.inferExpr(expr.scrutinee, env, usedEffects);
        const resultVar = freshVar(this.counter);

        for (const arm of expr.arms) {
          const armEnv = this.buildArmEnv(arm.pattern, env, scrutineeType);
          if (arm.guard !== null) {
            const guardType = this.inferExpr(arm.guard, armEnv, usedEffects);
            const guardErr = unify(guardType, BOOL, this.subst, arm.guard.span);
            if (guardErr !== null) this.errors.push(guardErr);
          }
          const armType = this.inferExpr(arm.body, armEnv, usedEffects);
          const armErr = unify(resultVar, armType, this.subst, arm.body.span);
          if (armErr !== null) this.errors.push(armErr);
        }

        this.checkExhaustiveness(
          applySubst(this.subst, scrutineeType),
          expr.arms,
          expr.span,
        );

        return applySubst(this.subst, resultVar);
      }

      case 'LetExpr':
        return this.inferLetExpr(expr, env, usedEffects);

      case 'AccessorExpr': {
        const receiverType = this.inferExpr(expr.receiver, env, usedEffects);
        const resolved = applySubst(this.subst, receiverType);
        if (resolved.kind === 'User') {
          const dataDecl = this.dataDecls.get(resolved.name);
          if (dataDecl !== undefined) {
            for (const variant of dataDecl.variants) {
              if (variant.kind === 'RecordVariant') {
                for (const field of variant.fields) {
                  if (field.name === expr.field) {
                    return resolveAnnotation(
                      field.type_,
                      new Map(),
                      this.symbolTable,
                      this.errors,
                      expr.span,
                    );
                  }
                }
              }
            }
          }
        }
        return freshVar(this.counter);
      }

      case 'PropagateExpr': {
        const innerType = this.inferExpr(expr.inner, env, usedEffects);
        const resolved = applySubst(this.subst, innerType);
        if (resolved.kind === 'Option') return resolved.inner;
        if (resolved.kind === 'Result') return resolved.ok;

        this.errors.push({
          kind: 'InvalidPropagate',
          code: 'E0404',
          found: resolved,
          span: expr.span,
          message: `'?' operator requires Option<T> or Result<T, E>, found ${typeToString(resolved)}`,
          suggestion: `Only use '?' on Option<T> or Result<T, E> values`,
        });
        return freshVar(this.counter);
      }
    }
  }

  private inferLetExpr(
    expr: AstLetExprNode,
    env: TypeEnv,
    usedEffects: Set<EffectTag>,
  ): IonType {
    const valType = this.inferExpr(expr.value, env, usedEffects);

    if (expr.type_ !== null) {
      const annType = resolveAnnotation(
        expr.type_,
        new Map(),
        this.symbolTable,
        this.errors,
        expr.span,
      );
      const err = unify(valType, annType, this.subst, expr.span);
      if (err !== null) this.errors.push(err);
    }

    let bodyEnv = env;
    const letId = this.findSymbolBySpan(expr.span);
    if (letId !== undefined) {
      bodyEnv = env.extend(letId, applySubst(this.subst, valType));
    }

    return this.inferExpr(expr.body, bodyEnv, usedEffects);
  }

  private inferBinop(
    expr: AstBinopExprNode,
    env: TypeEnv,
    usedEffects: Set<EffectTag>,
  ): IonType {
    const leftType = this.inferExpr(expr.left, env, usedEffects);
    const rightType = this.inferExpr(expr.right, env, usedEffects);

    switch (expr.op) {
      case 'Add':
      case 'Sub':
      case 'Mul':
      case 'Div':
      case 'Mod': {
        const err = unify(leftType, rightType, this.subst, expr.span);
        if (err !== null) this.errors.push(err);
        const unified = applySubst(this.subst, leftType);
        if (
          unified.kind !== 'Int' &&
          unified.kind !== 'Float' &&
          unified.kind !== 'TypeVar'
        ) {
          this.errors.push({
            kind: 'TypeMismatch',
            code: 'E0401',
            expected: INT,
            found: unified,
            span: expr.span,
            message: `Arithmetic operator requires Int or Float operands, found ${typeToString(unified)}`,
            suggestion: `Use Int or Float values with arithmetic operators`,
          });
          return INT;
        }
        return unified;
      }

      case 'EqEq':
      case 'NotEq': {
        const err = unify(leftType, rightType, this.subst, expr.span);
        if (err !== null) this.errors.push(err);
        return BOOL;
      }

      case 'Lt':
      case 'Gt':
      case 'LtEq':
      case 'GtEq': {
        const err = unify(leftType, rightType, this.subst, expr.span);
        if (err !== null) this.errors.push(err);
        return BOOL;
      }

      case 'And':
      case 'Or': {
        const errL = unify(leftType, BOOL, this.subst, expr.left.span);
        if (errL !== null) this.errors.push(errL);
        const errR = unify(rightType, BOOL, this.subst, expr.right.span);
        if (errR !== null) this.errors.push(errR);
        return BOOL;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pattern arm environment
  // ---------------------------------------------------------------------------

  private buildArmEnv(
    pattern: AstPatternNode,
    env: TypeEnv,
    scrutineeType: IonType,
  ): TypeEnv {
    switch (pattern.kind) {
      case 'WildcardPat':
        return env;

      case 'IdentPat': {
        const id = this.findSymbolBySpan(pattern.span);
        if (id !== undefined) return env.extend(id, scrutineeType);
        return env;
      }

      case 'ConstructorPat': {
        let armEnv = env;
        for (const field of pattern.fields) {
          armEnv = this.buildArmEnv(field, armEnv, freshVar(this.counter));
        }
        return armEnv;
      }

      case 'LiteralPat':
        return env;

      case 'TuplePat': {
        let armEnv = env;
        for (const el of pattern.elements) {
          armEnv = this.buildArmEnv(el, armEnv, freshVar(this.counter));
        }
        return armEnv;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Exhaustiveness
  // ---------------------------------------------------------------------------

  private checkExhaustiveness(
    scrutineeType: IonType,
    arms: readonly AstMatchArm[],
    span: Span,
  ): void {
    const hasCatchAll = arms.some(
      arm =>
        arm.guard === null &&
        (arm.pattern.kind === 'WildcardPat' || arm.pattern.kind === 'IdentPat'),
    );
    if (hasCatchAll) return;

    switch (scrutineeType.kind) {
      case 'Bool': {
        const covered = new Set<boolean>();
        for (const arm of arms) {
          if (
            arm.pattern.kind === 'LiteralPat' &&
            arm.pattern.value.kind === 'LiteralBool'
          ) {
            covered.add(arm.pattern.value.value);
          }
        }
        const missing: string[] = [];
        if (!covered.has(true)) missing.push('true');
        if (!covered.has(false)) missing.push('false');
        if (missing.length > 0) {
          this.errors.push({
            kind: 'NonExhaustiveMatch',
            code: 'E0403',
            missing,
            span,
            message: `Non-exhaustive match on Bool: missing ${missing.join(', ')}`,
            suggestion: `Add arm(s) for: ${missing.join(', ')}`,
          });
        }
        break;
      }

      case 'Option': {
        const covered = new Set<string>();
        for (const arm of arms) {
          if (arm.pattern.kind === 'ConstructorPat') covered.add(arm.pattern.tag);
        }
        const missing: string[] = [];
        if (!covered.has('Some')) missing.push('Some');
        if (!covered.has('None')) missing.push('None');
        if (missing.length > 0) {
          this.errors.push({
            kind: 'NonExhaustiveMatch',
            code: 'E0403',
            missing,
            span,
            message: `Non-exhaustive match on Option: missing ${missing.join(', ')}`,
            suggestion: `Add arm(s) for: ${missing.join(', ')}`,
          });
        }
        break;
      }

      case 'Result': {
        const covered = new Set<string>();
        for (const arm of arms) {
          if (arm.pattern.kind === 'ConstructorPat') covered.add(arm.pattern.tag);
        }
        const missing: string[] = [];
        if (!covered.has('Ok')) missing.push('Ok');
        if (!covered.has('Err')) missing.push('Err');
        if (missing.length > 0) {
          this.errors.push({
            kind: 'NonExhaustiveMatch',
            code: 'E0403',
            missing,
            span,
            message: `Non-exhaustive match on Result: missing ${missing.join(', ')}`,
            suggestion: `Add arm(s) for: ${missing.join(', ')}`,
          });
        }
        break;
      }

      case 'User': {
        const dataDecl = this.dataDecls.get(scrutineeType.name);
        if (dataDecl === undefined) break;
        const covered = new Set<string>();
        for (const arm of arms) {
          if (arm.pattern.kind === 'ConstructorPat') covered.add(arm.pattern.tag);
        }
        const missing = dataDecl.variants.map(v => v.name).filter(n => !covered.has(n));
        if (missing.length > 0) {
          this.errors.push({
            kind: 'NonExhaustiveMatch',
            code: 'E0403',
            missing,
            span,
            message: `Non-exhaustive match on ${scrutineeType.name}: missing ${missing.join(', ')}`,
            suggestion: `Add arm(s) for: ${missing.join(', ')}`,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Effect checking
  // ---------------------------------------------------------------------------

  private checkEffects(
    usedEffects: Set<EffectTag>,
    declaredEffects: Set<EffectTag>,
    span: Span,
  ): void {
    for (const effect of usedEffects) {
      if (!declaredEffects.has(effect)) {
        this.errors.push({
          kind: 'EffectMismatch',
          code: 'E0405',
          unexpected: effect,
          span,
          message: `Function uses effect '${effect}' but it is not declared in the effect set`,
          suggestion: `Add '!${effect}' to the function's effect annotations`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Symbol table helpers
  // ---------------------------------------------------------------------------

  private findSymbolIdByName(name: string, kind: SymbolKind): SymbolId | undefined {
    for (const info of this.symbolTable.symbols.values()) {
      if (info.name === name && info.declKind === kind) return info.id;
    }
    return undefined;
  }

  private findSymbolBySpan(span: Span): SymbolId | undefined {
    for (const info of this.symbolTable.symbols.values()) {
      if (
        info.span.file === span.file &&
        info.span.startLine === span.startLine &&
        info.span.startCol === span.startCol
      ) {
        return info.id;
      }
    }
    return undefined;
  }

  private resolveLambdaParamType(param: AstLambdaParam): IonType {
    if (param.type_ !== null) {
      return resolveAnnotation(
        param.type_,
        new Map(),
        this.symbolTable,
        this.errors,
        param.span,
      );
    }
    return freshVar(this.counter);
  }
}
