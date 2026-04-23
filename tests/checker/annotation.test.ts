import { describe, it, expect } from 'vitest';
import { makeSymbolId } from '../../src/types.js';
import type { SymbolId, Span } from '../../src/types.js';
import type { IonType } from '../../src/ir/types.js';
import type { CheckError } from '../../src/checker/types.js';
import { resolveAnnotation } from '../../src/checker/annotation.js';
import type { TypeAnnotation } from '../../src/ast/types.js';

const SPAN: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 3 };

function named(name: string): TypeAnnotation {
  return { kind: 'Named', name, span: SPAN };
}

function generic(name: string, args: TypeAnnotation[]): TypeAnnotation {
  return { kind: 'Generic', name, args, span: SPAN };
}

function fnAnn(params: TypeAnnotation[], ret: TypeAnnotation): TypeAnnotation {
  return { kind: 'Fn', params, ret, effects: [], span: SPAN };
}

describe('resolveAnnotation', () => {
  it('Named Int → IntType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(named('Int'), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Int' });
    expect(errors).toHaveLength(0);
  });

  it('Named Str → StrType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(named('Str'), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Str' });
    expect(errors).toHaveLength(0);
  });

  it('Named Bool → BoolType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(named('Bool'), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Bool' });
    expect(errors).toHaveLength(0);
  });

  it('Named Unit → UnitType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(named('Unit'), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Unit' });
    expect(errors).toHaveLength(0);
  });

  it('Named Float → FloatType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(named('Float'), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Float' });
    expect(errors).toHaveLength(0);
  });

  it('Named Null → NullType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(named('Null'), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Null' });
    expect(errors).toHaveLength(0);
  });

  it('Named Never → NeverType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(named('Never'), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Never' });
    expect(errors).toHaveLength(0);
  });

  it('Named T in typeParamEnv → returns the mapped TypeVar', () => {
    const errors: CheckError[] = [];
    const tv: IonType = { kind: 'TypeVar', id: 'fn.T' };
    const tpEnv = new Map<string, IonType>([['T', tv]]);
    const result = resolveAnnotation(named('T'), new Map(), tpEnv, errors);
    expect(result).toEqual(tv);
    expect(errors).toHaveLength(0);
  });

  it('Named UserType with nameIndex entry → UserType', () => {
    const errors: CheckError[] = [];
    const colorId = makeSymbolId('test$Color$0');
    const nameIndex = new Map<string, SymbolId>([['Color', colorId]]);
    const result = resolveAnnotation(named('Color'), nameIndex, new Map(), errors);
    expect(result).toEqual({ kind: 'User', name: 'Color', symbolId: colorId, args: [] });
    expect(errors).toHaveLength(0);
  });

  it('Named Unknown without nameIndex entry → UnknownType error + TypeVar fallback', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(named('Unknown'), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'TypeVar', id: 'Unknown' });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('UnknownType');
    expect(errors[0]?.code).toBe('E0406');
    const err = errors[0];
    if (err?.kind === 'UnknownType') {
      expect(err.name).toBe('Unknown');
    }
  });

  it('Generic List[Int] → ListType { elem: Int }', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(generic('List', [named('Int')]), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'List', elem: { kind: 'Int' } });
    expect(errors).toHaveLength(0);
  });

  it('Generic Map[Int, Str] → MapType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(generic('Map', [named('Int'), named('Str')]), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Map', key: { kind: 'Int' }, value: { kind: 'Str' } });
    expect(errors).toHaveLength(0);
  });

  it('Generic Option[Str] → OptionType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(generic('Option', [named('Str')]), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Option', inner: { kind: 'Str' } });
    expect(errors).toHaveLength(0);
  });

  it('Generic Result[Int, Str] → ResultType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(generic('Result', [named('Int'), named('Str')]), new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Result', ok: { kind: 'Int' }, err: { kind: 'Str' } });
    expect(errors).toHaveLength(0);
  });

  it('Fn [Int, Int] -> Int → FnType', () => {
    const errors: CheckError[] = [];
    const result = resolveAnnotation(fnAnn([named('Int'), named('Int')], named('Int')), new Map(), new Map(), errors);
    expect(result).toEqual({
      kind: 'Fn',
      params: [{ kind: 'Int' }, { kind: 'Int' }],
      ret: { kind: 'Int' },
      effects: new Set(),
    });
    expect(errors).toHaveLength(0);
  });

  it('Tuple (Int, Str) → TupleType { elements: [Int, Str] }', () => {
    const errors: CheckError[] = [];
    const ann: TypeAnnotation = { kind: 'Tuple', elements: [named('Int'), named('Str')], span: SPAN };
    const result = resolveAnnotation(ann, new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Tuple', elements: [{ kind: 'Int' }, { kind: 'Str' }] });
    expect(errors).toHaveLength(0);
  });

  it('empty Tuple () → TupleType { elements: [] }', () => {
    const errors: CheckError[] = [];
    const ann: TypeAnnotation = { kind: 'Tuple', elements: [], span: SPAN };
    const result = resolveAnnotation(ann, new Map(), new Map(), errors);
    expect(result).toEqual({ kind: 'Tuple', elements: [] });
    expect(errors).toHaveLength(0);
  });
});
