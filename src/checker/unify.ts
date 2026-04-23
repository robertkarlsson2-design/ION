import type { IonType, FnType, UserType } from '../ir/types.js';
import type { Span } from '../types.js';
import type { CheckError } from './errors.js';
import type { Substitution } from './types.js';
import { applySubst, typeToString } from './types.js';

function occursIn(varId: string, t: IonType, s: Substitution): boolean {
  const resolved = applySubst(s, t);
  switch (resolved.kind) {
    case 'TypeVar': return resolved.id === varId;
    case 'Int':
    case 'Float':
    case 'Str':
    case 'Bool':
    case 'Null':
    case 'Unit':
    case 'Never':
      return false;
    case 'List': return occursIn(varId, resolved.elem, s);
    case 'Map':
      return occursIn(varId, resolved.key, s) || occursIn(varId, resolved.value, s);
    case 'Option': return occursIn(varId, resolved.inner, s);
    case 'Result':
      return occursIn(varId, resolved.ok, s) || occursIn(varId, resolved.err, s);
    case 'Fn':
      return (
        resolved.params.some(p => occursIn(varId, p, s)) ||
        occursIn(varId, resolved.ret, s)
      );
    case 'User':
      return resolved.args.some(a => occursIn(varId, a, s));
  }
}

function mismatch(expected: IonType, found: IonType, span: Span): CheckError {
  return {
    kind: 'TypeMismatch',
    code: 'E0401',
    expected,
    found,
    span,
    message: `Expected ${typeToString(expected)}, found ${typeToString(found)}`,
    suggestion: `Change the expression to produce ${typeToString(expected)}`,
  };
}

/**
 * Attempt to unify t1 and t2 under the given substitution.
 * Mutates `subst` on success. Returns null on success, a CheckError on failure.
 */
export function unify(
  t1: IonType,
  t2: IonType,
  subst: Substitution,
  span: Span,
): CheckError | null {
  const a = applySubst(subst, t1);
  const b = applySubst(subst, t2);

  if (a.kind === 'TypeVar' && b.kind === 'TypeVar' && a.id === b.id) return null;

  if (a.kind === 'TypeVar') {
    if (occursIn(a.id, b, subst)) {
      return {
        kind: 'TypeMismatch',
        code: 'E0401',
        expected: a,
        found: b,
        span,
        message: `Occurs check failed: cannot construct infinite type ${typeToString(a)} ~ ${typeToString(b)}`,
        suggestion: `Remove the circular type constraint`,
      };
    }
    subst.set(a.id, b);
    return null;
  }

  if (b.kind === 'TypeVar') {
    if (occursIn(b.id, a, subst)) {
      return {
        kind: 'TypeMismatch',
        code: 'E0401',
        expected: b,
        found: a,
        span,
        message: `Occurs check failed: cannot construct infinite type ${typeToString(b)} ~ ${typeToString(a)}`,
        suggestion: `Remove the circular type constraint`,
      };
    }
    subst.set(b.id, a);
    return null;
  }

  if (a.kind !== b.kind) return mismatch(a, b, span);

  switch (a.kind) {
    case 'Int':
    case 'Float':
    case 'Str':
    case 'Bool':
    case 'Null':
    case 'Unit':
    case 'Never':
      return null;

    case 'List':
      return unify(a.elem, (b as typeof a).elem, subst, span);

    case 'Map': {
      const bm = b as typeof a;
      return unify(a.key, bm.key, subst, span) ?? unify(a.value, bm.value, subst, span);
    }

    case 'Option':
      return unify(a.inner, (b as typeof a).inner, subst, span);

    case 'Result': {
      const br = b as typeof a;
      return unify(a.ok, br.ok, subst, span) ?? unify(a.err, br.err, subst, span);
    }

    case 'Fn': {
      const bf = b as FnType;
      if (a.params.length !== bf.params.length) {
        return {
          kind: 'ArityMismatch',
          code: 'E0406',
          expected: a.params.length,
          found: bf.params.length,
          span,
          message: `Function type arity mismatch: expected ${a.params.length} param(s), found ${bf.params.length}`,
          suggestion: `Ensure both function types have the same number of parameters`,
        };
      }
      for (let i = 0; i < a.params.length; i++) {
        // Array bounds are guarded by the length check above.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const err = unify(a.params[i]!, bf.params[i]!, subst, span);
        if (err !== null) return err;
      }
      return unify(a.ret, bf.ret, subst, span);
    }

    case 'User': {
      const bu = b as UserType;
      if (a.name !== bu.name || a.args.length !== bu.args.length) {
        return mismatch(a, b, span);
      }
      for (let i = 0; i < a.args.length; i++) {
        // Array bounds are guarded by the length check above.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const err = unify(a.args[i]!, bu.args[i]!, subst, span);
        if (err !== null) return err;
      }
      return null;
    }
  }
}
