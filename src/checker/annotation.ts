import type { TypeAnnotation } from '../ast/types.js';
import type { IonType } from '../ir/types.js';
import { makeSymbolId, type SymbolId } from '../types.js';
import type { CheckError } from './types.js';

/**
 * Resolve a surface TypeAnnotation to a fully-resolved IonType.
 *
 * @param ann - The annotation node from the AST
 * @param nameIndex - User type name → SymbolId (Data and TypeAlias declarations)
 * @param typeParamEnv - In-scope type parameter names → their TypeVar
 * @param errors - Accumulator for resolution errors
 */
export function resolveAnnotation(
  ann: TypeAnnotation,
  nameIndex: ReadonlyMap<string, SymbolId>,
  typeParamEnv: ReadonlyMap<string, IonType>,
  errors: CheckError[],
): IonType {
  switch (ann.kind) {
    case 'Named': {
      const prim = resolvePrimitive(ann.name);
      if (prim !== null) return prim;
      const tv = typeParamEnv.get(ann.name);
      if (tv !== undefined) return tv;
      // Convention: lowercase names are implicit type variables (a, b, t, elem, acc, …)
      if (/^[a-z]/.test(ann.name)) {
        return { kind: 'TypeVar', id: ann.name };
      }
      const sid = nameIndex.get(ann.name);
      if (sid === undefined) {
        // Unknown uppercase names are FFI / foreign types — pass through as User so
        // emitters render the original name (e.g. Request, Pool, Buffer).
        return { kind: 'User', name: ann.name, symbolId: makeSymbolId(''), args: [] };
      }
      return { kind: 'User', name: ann.name, symbolId: sid, args: [] };
    }

    case 'Generic': {
      const resolvedArgs = ann.args.map(a =>
        resolveAnnotation(a, nameIndex, typeParamEnv, errors),
      );
      switch (ann.name) {
        case 'List':
          return { kind: 'List', elem: resolvedArgs[0] ?? { kind: 'TypeVar', id: '__list_elem' } };
        case 'Map':
          return {
            kind: 'Map',
            key: resolvedArgs[0] ?? { kind: 'TypeVar', id: '__map_key' },
            value: resolvedArgs[1] ?? { kind: 'TypeVar', id: '__map_value' },
          };
        case 'Option':
          return { kind: 'Option', inner: resolvedArgs[0] ?? { kind: 'TypeVar', id: '__opt_inner' } };
        case 'Result':
          return {
            kind: 'Result',
            ok: resolvedArgs[0] ?? { kind: 'TypeVar', id: '__result_ok' },
            err: resolvedArgs[1] ?? { kind: 'TypeVar', id: '__result_err' },
          };
        default: {
          const sid = nameIndex.get(ann.name);
          if (sid === undefined) {
            // Unknown generic uppercase names are FFI types — pass through as User.
            return { kind: 'User', name: ann.name, symbolId: makeSymbolId(''), args: resolvedArgs };
          }
          return { kind: 'User', name: ann.name, symbolId: sid, args: resolvedArgs };
        }
      }
    }

    case 'Fn':
      return {
        kind: 'Fn',
        params: ann.params.map(p => resolveAnnotation(p, nameIndex, typeParamEnv, errors)),
        ret: resolveAnnotation(ann.ret, nameIndex, typeParamEnv, errors),
        effects: new Set(ann.effects),
      };

    case 'Tuple':
      return {
        kind: 'Tuple',
        elements: ann.elements.map(e => resolveAnnotation(e, nameIndex, typeParamEnv, errors)),
      };
  }
}

function resolvePrimitive(name: string): IonType | null {
  switch (name) {
    case 'Int': return { kind: 'Int' };
    case 'Float': return { kind: 'Float' };
    case 'Str': return { kind: 'Str' };
    case 'Bool': return { kind: 'Bool' };
    case 'Unit': return { kind: 'Unit' };
    case 'Null': return { kind: 'Null' };
    case 'Never': return { kind: 'Never' };
    default: return null;
  }
}
