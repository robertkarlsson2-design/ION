import type { TypeAnnotation } from '../ast/types.js';
import type { IonType, TypeVar } from '../ir/types.js';
import type { SymbolId } from '../types.js';
import { makeSymbolId } from '../types.js';
import type { CheckError } from './errors.js';

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
      const sid = nameIndex.get(ann.name);
      if (sid === undefined) {
        errors.push({
          kind: 'UnknownType',
          code: 'E0406',
          name: ann.name,
          span: ann.span,
          message: `Unknown type '${ann.name}'`,
          suggestion: 'Declare the type or check your imports',
        });
        // Return a TypeVar as fallback so inference can continue.
        const fallback: TypeVar = { kind: 'TypeVar', id: ann.name };
        return fallback;
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
            errors.push({
              kind: 'UnknownType',
              code: 'E0406',
              name: ann.name,
              span: ann.span,
              message: `Unknown generic type '${ann.name}'`,
              suggestion: 'Declare the type or check your imports',
            });
            return { kind: 'TypeVar', id: ann.name };
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
      // TupleType has no IonType variant; represent as UserType with synthetic __Tuple name.
      return {
        kind: 'User',
        name: '__Tuple',
        symbolId: makeSymbolId('__tuple'),
        args: ann.elements.map(e => resolveAnnotation(e, nameIndex, typeParamEnv, errors)),
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
