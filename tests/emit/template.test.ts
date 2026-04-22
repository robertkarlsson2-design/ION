import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';

const wrap = wrapEmitted;

describe('expandTemplate', () => {
  // T1
  it('substitutes a single placeholder', () => {
    expect(expandTemplate('$1', [wrap('x')])).toBe('x');
  });

  // T2
  it('substitutes two distinct placeholders', () => {
    expect(expandTemplate('$1.push($2)', [wrap('arr'), wrap('val')])).toBe('arr.push(val)');
  });

  // T3
  it('substitutes a placeholder inside a call expression', () => {
    expect(expandTemplate('console.log($1)', [wrap('msg')])).toBe('console.log(msg)');
  });

  // T4
  it('substitutes the same placeholder repeated', () => {
    expect(expandTemplate('$1 + $1', [wrap('x')])).toBe('x + x');
  });

  // T5
  it('returns template verbatim when no placeholders present', () => {
    expect(expandTemplate('noop()', [])).toBe('noop()');
  });

  // T6
  it('throws RangeError when placeholder index is out of bounds', () => {
    expect(() => expandTemplate('$2', [wrap('a')])).toThrow(RangeError);
  });

  // T7
  it('throws RangeError for $0 (invalid 1-indexed placeholder)', () => {
    expect(() => expandTemplate('$0', [wrap('a')])).toThrow(RangeError);
  });

  // T8 — property: output length is consistent relative to args
  it('property: for any N-arg template, output length >= template length - placeholder bytes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        (strs) => {
          const args = strs.map(wrap);
          const n = strs.length;
          // Build a template that uses each $1..$N once
          const tmpl = strs.map((_, i) => `$${i + 1}`).join(',');
          const result = expandTemplate(tmpl, args);
          // Each placeholder $N contributes 2+ chars; result replaces them with actual strings
          expect(typeof result).toBe('string');
          expect(result).toBe(strs.join(','));
        },
      ),
    );
  });

  // T9 — ForeignRef golden check
  it('ForeignRef stdlib golden: $1.push($2) produces correct JS fragment', () => {
    const template = '$1.push($2)';
    const result = expandTemplate(template, [wrap('myList'), wrap('42')]);
    expect(result).toBe('myList.push(42)');
  });

  it('handles multi-digit placeholder index $10', () => {
    const args = Array.from({ length: 10 }, (_, i) => wrap(`arg${i + 1}`));
    expect(expandTemplate('$10', args)).toBe('arg10');
  });

  it('throws RangeError with descriptive message for $0', () => {
    expect(() => expandTemplate('$0', [wrap('a')])).toThrow(/1-indexed/);
  });

  it('throws RangeError with descriptive message for out-of-bounds', () => {
    expect(() => expandTemplate('$3', [wrap('a'), wrap('b')])).toThrow(/out of bounds/);
  });
});
