import type { IonIRModule, IonIRNode } from '../ir/nodes.js';
// Generated from ion/src/prelude/shake.ion — see scripts/compile-ion.mjs
import {
  collectAllNames as _rawCollectAllNames,
  shouldKeepDecl as _rawShouldKeepDecl,
} from '../ion-generated/prelude/shake.js';

// Re-type the generated functions at the boundary (generated code uses `never`).
const collectAllNames = _rawCollectAllNames as (decls: readonly IonIRNode[]) => string[];
const shouldKeepDecl = _rawShouldKeepDecl as (decl: IonIRNode, names: string[]) => boolean;

/**
 * Remove unused prelude ForeignRef Let declarations from the IR module.
 * A ForeignRef Let is kept only if its name is referenced anywhere in the module.
 *
 * Logic implemented in ION wire format (ion/src/prelude/shake.ion) and compiled
 * to TypeScript via scripts/compile-ion.mjs as part of the self-hosting build.
 */
export function shakePreludeDecls(module: IonIRModule): IonIRModule {
  const names = collectAllNames(module.decls);
  const filteredDecls = module.decls.filter(d => shouldKeepDecl(d, names));
  return { ...module, decls: filteredDecls };
}
