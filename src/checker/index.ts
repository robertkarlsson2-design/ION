import type { AstModule } from '../ast/nodes.js';
import type { BindResult } from '../binder/index.js';
import type { SymbolId } from '../types.js';
import type { IonType } from '../ir/types.js';
import type { CheckResult, TypeEnv, NodeTypeMap, CheckError } from './types.js';
import {
  checkDeclTypes,
  inferDeclBodies,
  buildVarIndex,
  buildLetIndex,
  buildFnDeclIndex,
  buildNameIndex,
  applySubstEnv,
  emptySubst,
} from './infer.js';
import type { InferCtx } from './infer.js';
import type { EffectTag } from '../ast/types.js';

export type { CheckResult, TypeEnv, NodeTypeMap, CheckError };
export type {
  TypeMismatchError,
  InexhaustiveMatchError,
  InvalidPropagateError,
  EffectViolationError,
  MissingAnnotationError,
  UnknownTypeError,
} from './types.js';

/**
 * Type-check a bound module using Algorithm W Hindley-Milner inference.
 *
 * @param module - The parsed and built AST module
 * @param bindResult - Symbol table and resolution map from the binder
 * @param modulePath - Module path string (e.g. 'my.module')
 */
export function checkModule(
  module: AstModule,
  bindResult: BindResult,
  modulePath: string,
): CheckResult {
  // Suppress unused parameter warning; modulePath is reserved for cross-module use.
  void modulePath;

  const { symbolTable, resolutionMap } = bindResult;

  const ctx: InferCtx = {
    symbolTable,
    resolutionMap,
    varIndex: buildVarIndex(symbolTable),
    letIndex: buildLetIndex(symbolTable),
    fnDeclIndex: buildFnDeclIndex(symbolTable),
    nameIndex: buildNameIndex(symbolTable),
    astDecls: module.decls,
    adtVariants: new Map(),
    typeEnv: new Map<SymbolId, IonType>(),
    nodeTypes: new Map<string, IonType>(),
    subst: emptySubst(),
    errors: [],
    counter: { value: 0 },
    currentFnEffects: new Set<EffectTag>(),
    effectsUsed: new Set<EffectTag>(),
  };

  // Pass 1: register declared types for all symbols.
  checkDeclTypes(module.decls, ctx);

  // Pass 2: infer function and let declaration bodies.
  inferDeclBodies(module.decls, ctx);

  // Apply final substitution to resolve residual TypeVars.
  const finalTypeEnv: ReadonlyMap<SymbolId, IonType> = applySubstEnv(ctx.subst, ctx.typeEnv);
  const finalNodeTypes: ReadonlyMap<string, IonType> = applySubstEnv(ctx.subst, ctx.nodeTypes);

  return {
    typeEnv: finalTypeEnv as TypeEnv,
    nodeTypes: finalNodeTypes as NodeTypeMap,
    errors: ctx.errors,
  };
}
