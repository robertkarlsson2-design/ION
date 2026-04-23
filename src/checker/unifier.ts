import type { IonType } from '../ir/types.js';
import type { Span } from '../types.js';
import type { CheckError } from './types.js';

export type Substitution = Map<string, IonType>;

/** Return an empty substitution. */
export function emptySubst(): Substitution {
  return new Map();
}

/**
 * Compose s1 after s2: result = {a: applySubst(s1, t) for (a,t) in s2} ∪ s1.
 * Applying the composed substitution is equivalent to applying s2 then s1.
 */
export function composeSubst(s1: Substitution, s2: Substitution): Substitution {
  const result: Substitution = new Map();
  for (const [k, v] of s2) {
    result.set(k, applySubst(s1, v));
  }
  for (const [k, v] of s1) {
    if (!result.has(k)) result.set(k, v);
  }
  return result;
}

/** Chase TypeVar chains and apply substitution structurally. */
export function applySubst(subst: Substitution, type: IonType): IonType {
  switch (type.kind) {
    case 'TypeVar': {
      const bound = subst.get(type.id);
      if (bound === undefined) return type;
      // Chase: substitute the bound type as well.
      return applySubst(subst, bound);
    }
    case 'Fn':
      return {
        kind: 'Fn',
        params: type.params.map(p => applySubst(subst, p)),
        ret: applySubst(subst, type.ret),
        effects: type.effects,
      };
    case 'List':
      return { kind: 'List', elem: applySubst(subst, type.elem) };
    case 'Map':
      return { kind: 'Map', key: applySubst(subst, type.key), value: applySubst(subst, type.value) };
    case 'Option':
      return { kind: 'Option', inner: applySubst(subst, type.inner) };
    case 'Result':
      return { kind: 'Result', ok: applySubst(subst, type.ok), err: applySubst(subst, type.err) };
    case 'User':
      return { ...type, args: type.args.map(a => applySubst(subst, a)) };
    default:
      return type;
  }
}

/** Apply substitution to all values in a type environment map. */
export function applySubstEnv<K>(
  subst: Substitution,
  env: Map<K, IonType>,
): Map<K, IonType> {
  const result = new Map<K, IonType>();
  for (const [k, v] of env) {
    result.set(k, applySubst(subst, v));
  }
  return result;
}

/** Returns true if TypeVar `id` appears free in `type` (occurs check). */
export function occursIn(id: string, type: IonType): boolean {
  switch (type.kind) {
    case 'TypeVar': return type.id === id;
    case 'Fn': return type.params.some(p => occursIn(id, p)) || occursIn(id, type.ret);
    case 'List': return occursIn(id, type.elem);
    case 'Map': return occursIn(id, type.key) || occursIn(id, type.value);
    case 'Option': return occursIn(id, type.inner);
    case 'Result': return occursIn(id, type.ok) || occursIn(id, type.err);
    case 'User': return type.args.some(a => occursIn(id, a));
    default: return false;
  }
}

/**
 * Unify t1 with t2 under the current substitution.
 * Returns the extended substitution, or pushes a TypeMismatch error and returns unchanged.
 */
export function unify(
  t1: IonType,
  t2: IonType,
  subst: Substitution,
  span: Span,
  errors: CheckError[],
): Substitution {
  const a = applySubst(subst, t1);
  const b = applySubst(subst, t2);

  if (typesEqual(a, b)) return subst;

  if (a.kind === 'TypeVar') {
    if (b.kind !== 'TypeVar' && occursIn(a.id, b)) {
      errors.push(makeMismatch(t1, t2, span));
      return subst;
    }
    return composeSubst(new Map([[a.id, b]]), subst);
  }

  if (b.kind === 'TypeVar') {
    if (occursIn(b.id, a)) {
      errors.push(makeMismatch(t1, t2, span));
      return subst;
    }
    return composeSubst(new Map([[b.id, a]]), subst);
  }

  if (a.kind === 'Never' || b.kind === 'Never') return subst;

  if (a.kind === 'Fn' && b.kind === 'Fn') {
    if (a.params.length !== b.params.length) {
      errors.push(makeMismatch(t1, t2, span));
      return subst;
    }
    let s = subst;
    for (let i = 0; i < a.params.length; i++) {
      // Non-null: both arrays have length a.params.length.
      s = unify(a.params[i]!, b.params[i]!, s, span, errors);
    }
    return unify(a.ret, b.ret, s, span, errors);
  }

  if (a.kind === 'List' && b.kind === 'List') {
    return unify(a.elem, b.elem, subst, span, errors);
  }

  if (a.kind === 'Map' && b.kind === 'Map') {
    const s = unify(a.key, b.key, subst, span, errors);
    return unify(a.value, b.value, s, span, errors);
  }

  if (a.kind === 'Option' && b.kind === 'Option') {
    return unify(a.inner, b.inner, subst, span, errors);
  }

  if (a.kind === 'Result' && b.kind === 'Result') {
    const s = unify(a.ok, b.ok, subst, span, errors);
    return unify(a.err, b.err, s, span, errors);
  }

  if (a.kind === 'User' && b.kind === 'User' && a.name === b.name) {
    if (a.args.length !== b.args.length) {
      errors.push(makeMismatch(t1, t2, span));
      return subst;
    }
    let s = subst;
    for (let i = 0; i < a.args.length; i++) {
      // Non-null: both arrays have length a.args.length.
      s = unify(a.args[i]!, b.args[i]!, s, span, errors);
    }
    return s;
  }

  errors.push(makeMismatch(t1, t2, span));
  return subst;
}

/** Structural equality of two types (ignoring effects on FnType). */
export function typesEqual(a: IonType, b: IonType): boolean {
  if (a.kind !== b.kind) return false;
  if (
    a.kind === 'Int' || a.kind === 'Float' || a.kind === 'Str' ||
    a.kind === 'Bool' || a.kind === 'Null' || a.kind === 'Unit' || a.kind === 'Never'
  ) return true;
  if (a.kind === 'TypeVar' && b.kind === 'TypeVar') return a.id === b.id;
  if (a.kind === 'List' && b.kind === 'List') return typesEqual(a.elem, b.elem);
  if (a.kind === 'Map' && b.kind === 'Map') {
    return typesEqual(a.key, b.key) && typesEqual(a.value, b.value);
  }
  if (a.kind === 'Option' && b.kind === 'Option') return typesEqual(a.inner, b.inner);
  if (a.kind === 'Result' && b.kind === 'Result') {
    return typesEqual(a.ok, b.ok) && typesEqual(a.err, b.err);
  }
  if (a.kind === 'Fn' && b.kind === 'Fn') {
    return (
      a.params.length === b.params.length &&
      a.params.every((p, i) => typesEqual(p, b.params[i]!)) &&
      typesEqual(a.ret, b.ret)
    );
  }
  if (a.kind === 'User' && b.kind === 'User') {
    return (
      a.name === b.name &&
      a.args.length === b.args.length &&
      a.args.every((arg, i) => typesEqual(arg, b.args[i]!))
    );
  }
  return false;
}

/** Human-readable type string for error messages. */
export function typeStr(type: IonType): string {
  switch (type.kind) {
    case 'Int': return 'Int';
    case 'Float': return 'Float';
    case 'Str': return 'Str';
    case 'Bool': return 'Bool';
    case 'Null': return 'Null';
    case 'Unit': return 'Unit';
    case 'Never': return 'Never';
    case 'TypeVar': return `'${type.id}`;
    case 'List': return `List<${typeStr(type.elem)}>`;
    case 'Map': return `Map<${typeStr(type.key)}, ${typeStr(type.value)}>`;
    case 'Option': return `Option<${typeStr(type.inner)}>`;
    case 'Result': return `Result<${typeStr(type.ok)}, ${typeStr(type.err)}>`;
    case 'Fn':
      return `(${type.params.map(typeStr).join(', ')}) -> ${typeStr(type.ret)}`;
    case 'User':
      if (type.args.length === 0) return type.name;
      return `${type.name}<${type.args.map(typeStr).join(', ')}>`;
  }
}

function makeMismatch(expected: IonType, actual: IonType, span: Span): CheckError {
  return {
    kind: 'TypeMismatch',
    code: 'E0401',
    expected,
    actual,
    span,
    message: `Type mismatch: expected ${typeStr(expected)}, got ${typeStr(actual)}`,
  };
}
