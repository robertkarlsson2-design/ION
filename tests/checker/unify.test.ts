import { describe, it, expect } from 'vitest';
import type { IonType } from '../../src/ir/types.js';
import type { CheckError } from '../../src/checker/types.js';
import { unify, emptySubst, applySubst, occursIn, typesEqual } from '../../src/checker/unifier.js';
import type { Span } from '../../src/types.js';

const SPAN: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 3 };

const INT: IonType = { kind: 'Int' };
const STR: IonType = { kind: 'Str' };
const BOOL: IonType = { kind: 'Bool' };

function tv(id: string): IonType {
  return { kind: 'TypeVar', id };
}

describe('unify', () => {
  it('Int with Int → no error, identity substitution', () => {
    const errors: CheckError[] = [];
    const s = unify(INT, INT, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(0);
    expect(applySubst(s, INT)).toEqual(INT);
  });

  it('Int with Str → TypeMismatch error', () => {
    const errors: CheckError[] = [];
    unify(INT, STR, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('TypeMismatch');
    expect(errors[0]?.code).toBe('E0401');
  });

  it('TypeVar a with Int → { a: Int }', () => {
    const errors: CheckError[] = [];
    const s = unify(tv('a'), INT, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(0);
    expect(applySubst(s, tv('a'))).toEqual(INT);
  });

  it('Int with TypeVar a → { a: Int } (symmetric)', () => {
    const errors: CheckError[] = [];
    const s = unify(INT, tv('a'), emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(0);
    expect(applySubst(s, tv('a'))).toEqual(INT);
  });

  it('Fn([Int], Str) with Fn([TypeVar a], TypeVar b) → { a: Int, b: Str }', () => {
    const errors: CheckError[] = [];
    const fnConcrete: IonType = { kind: 'Fn', params: [INT], ret: STR, effects: new Set() };
    const fnPoly: IonType = { kind: 'Fn', params: [tv('a')], ret: tv('b'), effects: new Set() };
    const s = unify(fnConcrete, fnPoly, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(0);
    expect(applySubst(s, tv('a'))).toEqual(INT);
    expect(applySubst(s, tv('b'))).toEqual(STR);
  });

  it('TypeVar a with List<TypeVar a> → occurs-check error (TypeMismatch)', () => {
    const errors: CheckError[] = [];
    const listOfA: IonType = { kind: 'List', elem: tv('a') };
    unify(tv('a'), listOfA, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('TypeMismatch');
  });

  it('Option<Int> with Option<TypeVar x> → { x: Int }', () => {
    const errors: CheckError[] = [];
    const optInt: IonType = { kind: 'Option', inner: INT };
    const optX: IonType = { kind: 'Option', inner: tv('x') };
    const s = unify(optInt, optX, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(0);
    expect(applySubst(s, tv('x'))).toEqual(INT);
  });

  it('Result<Int, Str> with Result<TypeVar a, TypeVar b> → binds both vars', () => {
    const errors: CheckError[] = [];
    const res: IonType = { kind: 'Result', ok: INT, err: STR };
    const resVars: IonType = { kind: 'Result', ok: tv('a'), err: tv('b') };
    const s = unify(res, resVars, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(0);
    expect(applySubst(s, tv('a'))).toEqual(INT);
    expect(applySubst(s, tv('b'))).toEqual(STR);
  });

  it('Fn with wrong param count → TypeMismatch', () => {
    const errors: CheckError[] = [];
    const fn1: IonType = { kind: 'Fn', params: [INT], ret: BOOL, effects: new Set() };
    const fn2: IonType = { kind: 'Fn', params: [INT, STR], ret: BOOL, effects: new Set() };
    unify(fn1, fn2, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('TypeMismatch');
  });
});

describe('occursIn', () => {
  it('a in TypeVar a → true', () => {
    expect(occursIn('a', tv('a'))).toBe(true);
  });

  it('a in TypeVar b → false', () => {
    expect(occursIn('a', tv('b'))).toBe(false);
  });

  it('a in Int → false', () => {
    expect(occursIn('a', INT)).toBe(false);
  });

  it('a in List<TypeVar a> → true', () => {
    expect(occursIn('a', { kind: 'List', elem: tv('a') })).toBe(true);
  });

  it('a in Fn([TypeVar a], Int) → true', () => {
    expect(occursIn('a', { kind: 'Fn', params: [tv('a')], ret: INT, effects: new Set() })).toBe(true);
  });
});

describe('typesEqual', () => {
  it('Int equals Int', () => {
    expect(typesEqual(INT, INT)).toBe(true);
  });

  it('Int does not equal Str', () => {
    expect(typesEqual(INT, STR)).toBe(false);
  });

  it('TypeVar a equals TypeVar a', () => {
    expect(typesEqual(tv('a'), tv('a'))).toBe(true);
  });

  it('TypeVar a does not equal TypeVar b', () => {
    expect(typesEqual(tv('a'), tv('b'))).toBe(false);
  });
});

describe('Tuple unification', () => {
  it('unifies (Int, Str) with (Int, Str)', () => {
    const errors: CheckError[] = [];
    const t1: IonType = { kind: 'Tuple', elements: [INT, STR] };
    const t2: IonType = { kind: 'Tuple', elements: [INT, STR] };
    const s = unify(t1, t2, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(0);
    expect(applySubst(s, t1)).toEqual(t1);
  });

  it('fails to unify (Int, Str) with (Int, Bool)', () => {
    const errors: CheckError[] = [];
    const t1: IonType = { kind: 'Tuple', elements: [INT, STR] };
    const t2: IonType = { kind: 'Tuple', elements: [INT, BOOL] };
    unify(t1, t2, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('TypeMismatch');
  });

  it('fails to unify arity-mismatch tuples', () => {
    const errors: CheckError[] = [];
    const t1: IonType = { kind: 'Tuple', elements: [INT, STR] };
    const t2: IonType = { kind: 'Tuple', elements: [INT] };
    unify(t1, t2, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('TypeMismatch');
  });

  it('unifies (TypeVar a, Str) with (Int, Str) → binds a to Int', () => {
    const errors: CheckError[] = [];
    const t1: IonType = { kind: 'Tuple', elements: [tv('a'), STR] };
    const t2: IonType = { kind: 'Tuple', elements: [INT, STR] };
    const s = unify(t1, t2, emptySubst(), SPAN, errors);
    expect(errors).toHaveLength(0);
    expect(applySubst(s, tv('a'))).toEqual(INT);
  });

  it('occursIn a in Tuple<TypeVar a, Int> → true', () => {
    const tup: IonType = { kind: 'Tuple', elements: [tv('a'), INT] };
    expect(occursIn('a', tup)).toBe(true);
  });

  it('occursIn a in Tuple<Int, Str> → false', () => {
    const tup: IonType = { kind: 'Tuple', elements: [INT, STR] };
    expect(occursIn('a', tup)).toBe(false);
  });

  it('typesEqual (Int, Str) equals (Int, Str)', () => {
    const t1: IonType = { kind: 'Tuple', elements: [INT, STR] };
    const t2: IonType = { kind: 'Tuple', elements: [INT, STR] };
    expect(typesEqual(t1, t2)).toBe(true);
  });

  it('typesEqual (Int, Str) does not equal (Int, Bool)', () => {
    const t1: IonType = { kind: 'Tuple', elements: [INT, STR] };
    const t2: IonType = { kind: 'Tuple', elements: [INT, BOOL] };
    expect(typesEqual(t1, t2)).toBe(false);
  });
});
