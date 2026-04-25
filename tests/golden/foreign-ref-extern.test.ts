import { describe, it, expect } from 'vitest';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';
import type { ForeignRefNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';

describe('ForeignRef extern golden — expandTemplate end-to-end', () => {
  it('expands array push template to correct JS fragment', () => {
    const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
    const listType: IonType = { kind: 'List', elem: { kind: 'Int' } };
    const intType: IonType = { kind: 'Int' };
    const unitType: IonType = { kind: 'Unit' };

    const node: ForeignRefNode = {
      kind: 'ForeignRef',
      target: 'js',
      module: 'array',
      symbol: 'push',
      sig: {
        params: [listType, intType],
        ret: unitType,
        template: '$1.push($2)',
        paramNames: ['arr', 'item'],
      },
      span,
      type: unitType,
    };

    const result = expandTemplate(node.sig.template, [
      wrapEmitted('myList'),
      wrapEmitted('42'),
    ]);

    expect(result).toBe('myList.push(42)');
  });
});
