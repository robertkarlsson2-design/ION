export type {
  IonType,
  IntType,
  FloatType,
  StrType,
  BoolType,
  NullType,
  UnitType,
  ListType,
  MapType,
  OptionType,
  ResultType,
  FnType,
  UserType,
  TypeVar,
  NeverType,
  EffectSet,
} from '../ir/types.js';

import type {
  IonType,
  TypeVar,
  ListType,
  MapType,
  OptionType,
  ResultType,
  FnType,
  UserType,
} from '../ir/types.js';

/** Maps TypeVar.id to the concrete type it has been unified with. */
export type Substitution = Map<string, IonType>;

/** Create a fresh type inference variable using the given counter. */
export function freshVar(counter: { n: number }): TypeVar {
  return { kind: 'TypeVar', id: `t${counter.n++}` };
}

/** Apply a substitution to a type, following TypeVar chains transitively. */
export function applySubst(s: Substitution, t: IonType): IonType {
  switch (t.kind) {
    case 'Int':
    case 'Float':
    case 'Str':
    case 'Bool':
    case 'Null':
    case 'Unit':
    case 'Never':
      return t;
    case 'TypeVar': {
      const resolved = s.get(t.id);
      if (resolved === undefined) return t;
      return applySubst(s, resolved);
    }
    case 'List':
      return { kind: 'List', elem: applySubst(s, t.elem) };
    case 'Map':
      return { kind: 'Map', key: applySubst(s, t.key), value: applySubst(s, t.value) };
    case 'Option':
      return { kind: 'Option', inner: applySubst(s, t.inner) };
    case 'Result':
      return { kind: 'Result', ok: applySubst(s, t.ok), err: applySubst(s, t.err) };
    case 'Fn':
      return {
        kind: 'Fn',
        params: t.params.map(p => applySubst(s, p)),
        ret: applySubst(s, t.ret),
        effects: t.effects,
      };
    case 'User':
      return {
        kind: 'User',
        name: t.name,
        symbolId: t.symbolId,
        args: t.args.map(a => applySubst(s, a)),
      };
  }
}

/** Render an IonType as a human-readable string for error messages. */
export function typeToString(t: IonType): string {
  switch (t.kind) {
    case 'Int': return 'Int';
    case 'Float': return 'Float';
    case 'Str': return 'Str';
    case 'Bool': return 'Bool';
    case 'Null': return 'Null';
    case 'Unit': return 'Unit';
    case 'Never': return 'Never';
    case 'TypeVar': return `?${t.id}`;
    case 'List': return `List<${typeToString(t.elem)}>`;
    case 'Map': return `Map<${typeToString(t.key)}, ${typeToString(t.value)}>`;
    case 'Option': return `Option<${typeToString(t.inner)}>`;
    case 'Result': return `Result<${typeToString(t.ok)}, ${typeToString(t.err)}>`;
    case 'Fn': {
      const ps = t.params.map(typeToString).join(', ');
      const effs = t.effects.size > 0 ? ` !${[...t.effects].join(' !')}` : '';
      return `(${ps}) -> ${typeToString(t.ret)}${effs}`;
    }
    case 'User':
      if (t.args.length === 0) return t.name;
      return `${t.name}<${t.args.map(typeToString).join(', ')}>`;
  }
}

/** Deep structural equality for types (does not dereference TypeVars via substitution). */
export function typesEqual(a: IonType, b: IonType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'Int':
    case 'Float':
    case 'Str':
    case 'Bool':
    case 'Null':
    case 'Unit':
    case 'Never':
      return true;
    case 'TypeVar':
      return a.id === (b as TypeVar).id;
    case 'List':
      return typesEqual(a.elem, (b as ListType).elem);
    case 'Map': {
      const bm = b as MapType;
      return typesEqual(a.key, bm.key) && typesEqual(a.value, bm.value);
    }
    case 'Option':
      return typesEqual(a.inner, (b as OptionType).inner);
    case 'Result': {
      const br = b as ResultType;
      return typesEqual(a.ok, br.ok) && typesEqual(a.err, br.err);
    }
    case 'Fn': {
      const bf = b as FnType;
      if (a.params.length !== bf.params.length) return false;
      for (let i = 0; i < a.params.length; i++) {
        // Array bounds are checked by the length guard above.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (!typesEqual(a.params[i]!, bf.params[i]!)) return false;
      }
      return typesEqual(a.ret, bf.ret);
    }
    case 'User': {
      const bu = b as UserType;
      if (a.name !== bu.name || a.args.length !== bu.args.length) return false;
      for (let i = 0; i < a.args.length; i++) {
        // Array bounds are checked by the length guard above.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (!typesEqual(a.args[i]!, bu.args[i]!)) return false;
      }
      return true;
    }
  }
}
