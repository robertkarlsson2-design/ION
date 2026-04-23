import type { TypeAnnotation } from '../ast/types.js';
import type { IonType, TypeVar } from '../ir/types.js';
import type { SymbolId, Span } from '../types.js';
import type { ModuleSymbolTable } from '../binder/symbol-table.js';
import type { CheckError } from './errors.js';
import { makeSymbolId } from '../types.js';

const INT: IonType = { kind: 'Int' };
const FLOAT: IonType = { kind: 'Float' };
const STR: IonType = { kind: 'Str' };
const BOOL: IonType = { kind: 'Bool' };
const NULL: IonType = { kind: 'Null' };
const UNIT: IonType = { kind: 'Unit' };
const NEVER: IonType = { kind: 'Never' };

const PRIMITIVES: Readonly<Record<string, IonType>> = {
  Int: INT,
  Float: FLOAT,
  Str: STR,
  Bool: BOOL,
  Null: NULL,
  Unit: UNIT,
};

/** Synthetic SymbolId used for compiler-generated type references with no source symbol. */
const SYNTHETIC_ID: SymbolId = makeSymbolId('__synthetic__');

/**
 * Resolve a surface-syntax TypeAnnotation to a fully-resolved IonType.
 * Emits E0401 into `errors` for unknown named types; returns Never in that case.
 */
export function resolveAnnotation(
  ann: TypeAnnotation,
  typeParams: ReadonlyMap<string, TypeVar>,
  symbolTable: ModuleSymbolTable,
  errors: CheckError[],
  span: Span,
): IonType {
  switch (ann.kind) {
    case 'Named': {
      const prim = PRIMITIVES[ann.name];
      if (prim !== undefined) return prim;

      const tv = typeParams.get(ann.name);
      if (tv !== undefined) return tv;

      for (const entry of symbolTable.symbols.values()) {
        if (
          entry.name === ann.name &&
          (entry.kind === 'data' || entry.kind === 'typeAlias')
        ) {
          return { kind: 'User', name: ann.name, symbolId: entry.id, args: [] };
        }
      }

      errors.push({
        kind: 'TypeMismatch',
        code: 'E0401',
        expected: NEVER,
        found: NEVER,
        span: ann.span,
        message: `Unknown type '${ann.name}'`,
        suggestion: `Define '${ann.name}' as a data type or type alias, or check for a typo`,
      });
      return NEVER;
    }

    case 'Generic': {
      const args = ann.args.map(a =>
        resolveAnnotation(a, typeParams, symbolTable, errors, span),
      );

      switch (ann.name) {
        case 'List':
          return { kind: 'List', elem: args[0] ?? NEVER };
        case 'Map':
          return { kind: 'Map', key: args[0] ?? NEVER, value: args[1] ?? NEVER };
        case 'Option':
          return { kind: 'Option', inner: args[0] ?? NEVER };
        case 'Result':
          return { kind: 'Result', ok: args[0] ?? NEVER, err: args[1] ?? NEVER };
        default: {
          for (const entry of symbolTable.symbols.values()) {
            if (
              entry.name === ann.name &&
              (entry.kind === 'data' || entry.kind === 'typeAlias')
            ) {
              return { kind: 'User', name: ann.name, symbolId: entry.id, args };
            }
          }
          return { kind: 'User', name: ann.name, symbolId: SYNTHETIC_ID, args };
        }
      }
    }

    case 'Fn': {
      const params = ann.params.map(p =>
        resolveAnnotation(p, typeParams, symbolTable, errors, span),
      );
      const ret = resolveAnnotation(ann.ret, typeParams, symbolTable, errors, span);
      return { kind: 'Fn', params, ret, effects: new Set(ann.effects) };
    }

    case 'Tuple': {
      const args = ann.elements.map(e =>
        resolveAnnotation(e, typeParams, symbolTable, errors, span),
      );
      return { kind: 'User', name: `Tuple${ann.elements.length}`, symbolId: SYNTHETIC_ID, args };
    }
  }
}
