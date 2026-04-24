import { describe, it, expect } from 'vitest';
import { topoSort } from '../../src/binder/graph.js';
import type { ModuleNode } from '../../src/binder/graph.js';

function node(name: string, deps: string[] = []): ModuleNode {
  return { name, deps };
}

describe('topoSort', () => {
  it('empty input returns empty order', () => {
    expect(topoSort([])).toEqual({ order: [] });
  });

  it('single node with no deps', () => {
    expect(topoSort([node('A')])).toEqual({ order: ['A'] });
  });

  it('linear chain A→B→C returns leaves first', () => {
    const result = topoSort([node('A', ['B']), node('B', ['C']), node('C')]);
    expect(result).toEqual({ order: ['C', 'B', 'A'] });
  });

  it('diamond A→{B,C}→D: D appears before B and C, which appear before A', () => {
    const nodes = [
      node('A', ['B', 'C']),
      node('B', ['D']),
      node('C', ['D']),
      node('D'),
    ];
    const result = topoSort(nodes);
    expect('order' in result).toBe(true);
    if (!('order' in result)) return;
    const { order } = result;
    expect(order.indexOf('D')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('D')).toBeLessThan(order.indexOf('C'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('A'));
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('A'));
  });

  it('cycle A→B→A returns { cycle } containing A and B', () => {
    const result = topoSort([node('A', ['B']), node('B', ['A'])]);
    expect('cycle' in result).toBe(true);
    if (!('cycle' in result)) return;
    expect(result.cycle).toContain('A');
    expect(result.cycle).toContain('B');
  });

  it('self-loop A→A returns { cycle }', () => {
    const result = topoSort([node('A', ['A'])]);
    expect('cycle' in result).toBe(true);
    if (!('cycle' in result)) return;
    expect(result.cycle).toContain('A');
  });

  it('disconnected components: all nodes appear in order', () => {
    const nodes = [node('X'), node('Y'), node('Z')];
    const result = topoSort(nodes);
    expect('order' in result).toBe(true);
    if (!('order' in result)) return;
    expect(result.order.sort()).toEqual(['X', 'Y', 'Z']);
  });

  it('large linear chain (15 000 nodes) completes without stack overflow', () => {
    const n = 15_000;
    const nodes: ModuleNode[] = [];
    for (let i = 0; i < n; i++) {
      nodes.push(node(`m${i}`, i + 1 < n ? [`m${i + 1}`] : []));
    }
    const result = topoSort(nodes);
    expect('order' in result).toBe(true);
    if (!('order' in result)) return;
    expect(result.order).toHaveLength(n);
    expect(result.order[0]).toBe(`m${n - 1}`);
    expect(result.order[n - 1]).toBe('m0');
  });
});
