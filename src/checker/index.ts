import type { AstModule } from '../ast/nodes.js';
import type { BindResult } from '../binder/index.js';
import type { IonType } from '../ir/types.js';
import type { CheckError } from './errors.js';
import type { InferCtx } from './infer.js';
import {
  checkDeclTypes,
  inferDeclBodies,
  buildVarIndex,
  buildLetIndex,
  buildFnDeclIndex,
  buildNameIndex,
  spanKey,
} from './infer.js';
import { emptySubst } from './unifier.js';

export type { CheckError } from './errors.js';
export { formatCheckError } from './errors.js';
export type { IonType } from '../ir/types.js';

/** Maps spanKey(span) → resolved IonType for every expression node. */
export type TypeMap = ReadonlyMap<string, IonType>;

export interface CheckResult {
  readonly typeMap: TypeMap;
  readonly errors: readonly CheckError[];
}

export { spanKey };

/**
 * Type-check a bound module.
 * Resolves every expression's IonType and emits structured errors with codes E0401–E0406.
 */
export function checkModule(
  module: AstModule,
  bindResult: BindResult,
  _modulePath: string,
): CheckResult {
  const ctx: InferCtx = {
    symbolTable: bindResult.symbolTable,
    resolutionMap: bindResult.resolutionMap,
    varIndex: buildVarIndex(bindResult.symbolTable),
    letIndex: buildLetIndex(bindResult.symbolTable),
    fnDeclIndex: buildFnDeclIndex(bindResult.symbolTable),
    nameIndex: buildNameIndex(bindResult.symbolTable),
    astDecls: module.decls,
    adtVariants: new Map(),
    typeEnv: new Map(),
    nodeTypes: new Map(),
    subst: emptySubst(),
    errors: [],
    counter: { value: 0 },
    currentFnEffects: new Set(),
    effectsUsed: new Set(),
  };
  checkDeclTypes(module.decls, ctx);
  inferDeclBodies(module.decls, ctx);
  return { typeMap: ctx.nodeTypes, errors: ctx.errors };
}
