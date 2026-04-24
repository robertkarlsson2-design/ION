import { describe, it, expect } from 'vitest';
import { formatIonType } from '../../src/lsp/type-format.js';
import type { IonType } from '../../src/ir/types.js';

describe('formatIonType', () => {
  it('formats primitives', () => {
    expect(formatIonType({ kind: 'Int' })).toBe('Int');
    expect(formatIonType({ kind: 'Float' })).toBe('Float');
    expect(formatIonType({ kind: 'Str' })).toBe('Str');
    expect(formatIonType({ kind: 'Bool' })).toBe('Bool');
    expect(formatIonType({ kind: 'Null' })).toBe('Null');
    expect(formatIonType({ kind: 'Unit' })).toBe('Unit');
    expect(formatIonType({ kind: 'Never' })).toBe('Never');
  });

  it('formats List', () => {
    const t: IonType = { kind: 'List', elem: { kind: 'Int' } };
    expect(formatIonType(t)).toBe('List[Int]');
  });

  it('formats Map', () => {
    const t: IonType = { kind: 'Map', key: { kind: 'Str' }, value: { kind: 'Bool' } };
    expect(formatIonType(t)).toBe('Map[Str, Bool]');
  });

  it('formats Option', () => {
    const t: IonType = { kind: 'Option', inner: { kind: 'Int' } };
    expect(formatIonType(t)).toBe('Option[Int]');
  });

  it('formats Result', () => {
    const t: IonType = { kind: 'Result', ok: { kind: 'Str' }, err: { kind: 'Int' } };
    expect(formatIonType(t)).toBe('Result[Str, Int]');
  });

  it('formats Fn with no effects', () => {
    const t: IonType = {
      kind: 'Fn',
      params: [{ kind: 'Int' }],
      ret: { kind: 'Bool' },
      effects: new Set(),
    };
    expect(formatIonType(t)).toBe('Fn(Int) -> Bool');
  });

  it('formats Fn with effects', () => {
    const t: IonType = {
      kind: 'Fn',
      params: [{ kind: 'Int' }],
      ret: { kind: 'Bool' },
      effects: new Set(['io']),
    };
    expect(formatIonType(t)).toBe('Fn(Int) -> Bool { io }');
  });

  it('formats Fn with multiple params', () => {
    const t: IonType = {
      kind: 'Fn',
      params: [{ kind: 'Int' }, { kind: 'Str' }],
      ret: { kind: 'Bool' },
      effects: new Set(),
    };
    expect(formatIonType(t)).toBe('Fn(Int, Str) -> Bool');
  });

  it('formats User type with no args', () => {
    const t: IonType = { kind: 'User', name: 'Color', symbolId: 'sym$0' as never, args: [] };
    expect(formatIonType(t)).toBe('Color');
  });

  it('formats User type with type args', () => {
    const t: IonType = {
      kind: 'User',
      name: 'Pair',
      symbolId: 'sym$1' as never,
      args: [{ kind: 'Int' }, { kind: 'Str' }],
    };
    expect(formatIonType(t)).toBe('Pair[Int, Str]');
  });

  it('formats TypeVar', () => {
    const t: IonType = { kind: 'TypeVar', id: '42' };
    expect(formatIonType(t)).toBe("'t42");
  });

  it('formats nested types', () => {
    const t: IonType = { kind: 'List', elem: { kind: 'Option', inner: { kind: 'Str' } } };
    expect(formatIonType(t)).toBe('List[Option[Str]]');
  });
});
