import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  loadPatterns,
  compileRule,
  type PatternRule,
  type NodePattern,
  type ChildPattern,
} from '../../src/ingest/patterns.js';
import type { CSTNode, PatternMatcher } from '../../src/ingest/types.js';
import { runPipeline } from '../../src/ingest/pipeline.js';
import type { PipelineConfig } from '../../src/ingest/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLeaf(type: string, text = '', row = 0, col = 0): CSTNode {
  return {
    type,
    text,
    isNamed: true,
    startPosition: { row, column: col },
    endPosition: { row, column: col + text.length },
    children: [],
  };
}

function makeParent(type: string, children: CSTNode[], row = 0): CSTNode {
  return {
    type,
    text: children.map(c => c.text).join(''),
    isNamed: true,
    startPosition: { row, column: 0 },
    endPosition: { row, column: 0 },
    children,
  };
}

/** Minimal valid PatternRule */
function makeRule(overrides: Partial<PatternRule> = {}): PatternRule {
  return {
    id: 'test-rule',
    language: 'test',
    match: { nodeType: 'leaf' },
    conditions: [],
    emit: { kind: 'Var', name: 'x', symbolId: 'x' },
    ...overrides,
  };
}

const VALID_YAML_A = `
id: rule-a
language: javascript
match:
  nodeType: expr
conditions: []
emit:
  kind: Var
  name: foo
  symbolId: foo
`;

const VALID_YAML_B = `
id: rule-b
language: javascript
match:
  nodeType: stmt
conditions: []
emit:
  kind: Var
  name: bar
  symbolId: bar
`;

const MALFORMED_YAML = `
id: broken
language: javascript
match: [this is not valid yaml for our schema
`;

async function writeTempPatterns(files: Record<string, string>): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'ion-patterns-test-'));
  const patternsDir = join(base, 'patterns');
  await mkdir(patternsDir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(patternsDir, name), content, 'utf8');
  }
  return base;
}

// ── Suite A — Pattern loading ─────────────────────────────────────────────────

describe('A: pattern loading', () => {
  it('A1: loadPatterns with two valid YAML files returns 2 PatternMatcher instances', async () => {
    const skillDir = await writeTempPatterns({
      'rule-a.yaml': VALID_YAML_A,
      'rule-b.yaml': VALID_YAML_B,
    });
    const matchers = await loadPatterns(skillDir);
    expect(matchers).toHaveLength(2);
    expect(matchers.every(m => typeof m.match === 'function')).toBe(true);
  });

  it('A2: loadPatterns with no patterns/ subdirectory returns []', async () => {
    const skillDir = await mkdtemp(join(tmpdir(), 'ion-patterns-test-'));
    const matchers = await loadPatterns(skillDir);
    expect(matchers).toEqual([]);
  });

  it('A3: loadPatterns with one valid + one malformed YAML returns 1 matcher, no throw', async () => {
    // Suppress expected stderr output during this test
    const origStderr = process.stderr.write.bind(process.stderr);
    let errOutput = '';
    process.stderr.write = (chunk: string | Uint8Array) => {
      errOutput += typeof chunk === 'string' ? chunk : '';
      return true;
    };

    try {
      const skillDir = await writeTempPatterns({
        'good.yaml': VALID_YAML_A,
        'bad.yaml': MALFORMED_YAML,
      });
      const matchers = await loadPatterns(skillDir);
      expect(matchers).toHaveLength(1);
      expect(errOutput).toMatch(/skipping/);
    } finally {
      process.stderr.write = origStderr;
    }
  });
});

// ── Suite B — Structural matching ─────────────────────────────────────────────

describe('B: structural matching', () => {
  it('B1: nodeType mismatch returns null', () => {
    const rule = makeRule({ match: { nodeType: 'expr' } });
    const matcher = compileRule(rule);
    const node = makeLeaf('stmt');
    expect(matcher.match(node)).toBeNull();
  });

  it('B2: $VAR capture on matching node — non-null, binding captures node', () => {
    const node = makeLeaf('identifier', 'myVar', 1, 3);
    const matchPattern: NodePattern = { nodeType: 'identifier', capture: '$NAME' };
    const rule = makeRule({
      match: matchPattern,
      emit: { kind: 'Var', name: { metavar: '$NAME', field: 'text' }, symbolId: { metavar: '$NAME', field: 'text' } },
    });
    const matcher = compileRule(rule);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Var');
    // @ts-expect-error - dynamic field access for testing
    expect(result?.name).toBe('myVar');
  });

  it('B3: $$$BODY captures sequence of 3 children into CSTNode[]', () => {
    const children = [makeLeaf('a', 'a'), makeLeaf('b', 'b'), makeLeaf('c', 'c')];
    const parent = makeParent('block', children);
    const seqPattern: ChildPattern = { pattern: { capture: '$$$BODY' }, isSequence: true };
    const rule = makeRule({
      match: { nodeType: 'block', children: [seqPattern] },
      emit: { kind: 'Var', name: 'body', symbolId: 'body' },
    });
    const matcher = compileRule(rule);
    const result = matcher.match(parent);
    expect(result).not.toBeNull();
  });

  it('B4: $TYPE behaves identically to $VAR (single-node capture)', () => {
    const node = makeLeaf('type_annotation', 'string', 0, 5);
    const rule = makeRule({
      match: { nodeType: 'type_annotation', capture: '$TYPE' },
      emit: { kind: 'Var', name: { metavar: '$TYPE', field: 'text' }, symbolId: { metavar: '$TYPE', field: 'text' } },
    });
    const matcher = compileRule(rule);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    // @ts-expect-error - dynamic field access
    expect(result?.name).toBe('string');
  });

  it('B5: children list with wrong count returns null', () => {
    const parent = makeParent('block', [makeLeaf('a'), makeLeaf('b')]);
    const rule = makeRule({
      match: {
        nodeType: 'block',
        children: [
          { pattern: { nodeType: 'a' } },
          { pattern: { nodeType: 'b' } },
          { pattern: { nodeType: 'c' } },
        ],
      },
    });
    const matcher = compileRule(rule);
    expect(matcher.match(parent)).toBeNull();
  });
});

// ── Suite C — Conditions ──────────────────────────────────────────────────────

describe('C: conditions', () => {
  it('C1: has-children with matching count passes', () => {
    const parent = makeParent('block', [makeLeaf('a'), makeLeaf('b')]);
    const rule = makeRule({
      match: { nodeType: 'block' },
      conditions: [{ kind: 'has-children', count: 2 }],
    });
    const matcher = compileRule(rule);
    expect(matcher.match(parent)).not.toBeNull();
  });

  it('C2: has-children with wrong count returns null', () => {
    const parent = makeParent('block', [makeLeaf('a')]);
    const rule = makeRule({
      match: { nodeType: 'block' },
      conditions: [{ kind: 'has-children', count: 3 }],
    });
    const matcher = compileRule(rule);
    expect(matcher.match(parent)).toBeNull();
  });

  it('C3: is-type with matching tree-sitter node type passes', () => {
    const child = makeLeaf('identifier', 'x');
    const parent = makeParent('decl', [child]);
    const rule = makeRule({
      match: {
        nodeType: 'decl',
        children: [{ pattern: { nodeType: 'identifier', capture: '$X' } }],
      },
      conditions: [{ kind: 'is-type', var: '$X', type: 'identifier' }],
    });
    const matcher = compileRule(rule);
    expect(matcher.match(parent)).not.toBeNull();
  });

  it('C4: is-type with non-matching type returns null', () => {
    const child = makeLeaf('number', '42');
    const parent = makeParent('decl', [child]);
    const rule = makeRule({
      match: {
        nodeType: 'decl',
        children: [{ pattern: { nodeType: 'number', capture: '$X' } }],
      },
      conditions: [{ kind: 'is-type', var: '$X', type: 'identifier' }],
    });
    const matcher = compileRule(rule);
    expect(matcher.match(parent)).toBeNull();
  });

  it('C5: not-mutated-in always passes (documented stub)', () => {
    const node = makeLeaf('identifier', 'x');
    const rule = makeRule({
      match: { nodeType: 'identifier', capture: '$X' },
      conditions: [{ kind: 'not-mutated-in', var: '$X', scope: 'function' }],
    });
    const matcher = compileRule(rule);
    expect(matcher.match(node)).not.toBeNull();
  });
});

// ── Suite D — Emit / transform ────────────────────────────────────────────────

describe('D: emit and transform', () => {
  it('D1: emitting Var node from $NAME binding produces correct name and span', () => {
    const node = makeLeaf('identifier', 'myFn', 4, 2);
    const rule = makeRule({
      match: { nodeType: 'identifier', capture: '$NAME' },
      emit: {
        kind: 'Var',
        name: { metavar: '$NAME', field: 'text' },
        symbolId: { metavar: '$NAME', field: 'text' },
      },
    });
    const matcher = compileRule(rule);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Var');
    // @ts-expect-error - dynamic access
    expect(result?.name).toBe('myFn');
    expect(result?.span).toMatchObject({ startLine: 5, startCol: 2 });
  });

  it('D2: emitted node has type: { kind: Never } placeholder', () => {
    const node = makeLeaf('identifier', 'x');
    const rule = makeRule({
      match: { nodeType: 'identifier' },
      emit: { kind: 'Var', name: 'x', symbolId: 'x' },
    });
    const matcher = compileRule(rule);
    const result = matcher.match(node);
    expect(result?.type).toEqual({ kind: 'Never' });
  });

  it('D3: Span conversion from CST position is correct (row+1 → line)', () => {
    const node = makeLeaf('token', 'tok', 9, 5);
    const rule = makeRule({
      match: { nodeType: 'token' },
      emit: { kind: 'Var', name: 'tok', symbolId: 'tok' },
    });
    const result = compileRule(rule).match(node);
    expect(result?.span).toMatchObject({
      startLine: 10,
      startCol: 5,
      endLine: 10,
      endCol: 8,
    });
  });

  it('D4: symbolId is auto-prefixed with pattern: when derived from name', () => {
    const node = makeLeaf('identifier', 'myVar');
    const rule = makeRule({
      id: 'my-rule',
      match: { nodeType: 'identifier', capture: '$N' },
      emit: { kind: 'Var', name: { metavar: '$N', field: 'text' } },
    });
    const result = compileRule(rule).match(node);
    // @ts-expect-error - dynamic access
    expect(typeof result?.symbolId).toBe('string');
    // @ts-expect-error - dynamic access
    expect((result?.symbolId as string).startsWith('pattern:')).toBe(true);
  });

  it('D5: invalid emit.kind (unknown IonIR kind) returns null, no throw', () => {
    const node = makeLeaf('leaf', 'x');
    const rule = makeRule({
      match: { nodeType: 'leaf' },
      emit: { kind: 'UnknownKind9999', name: 'x', symbolId: 'x' },
    });
    expect(() => compileRule(rule).match(node)).not.toThrow();
    expect(compileRule(rule).match(node)).toBeNull();
  });
});

// ── Suite E — Error resilience ────────────────────────────────────────────────

describe('E: error resilience', () => {
  it('E1: match() never throws even if emit spec is completely malformed', () => {
    const node = makeLeaf('expr', 'x');
    const rule: PatternRule = {
      id: 'bad',
      language: 'test',
      match: { nodeType: 'expr' },
      conditions: [],
      // Cast to fool TypeScript — simulates a schema violation at runtime
      emit: null as unknown as Record<string, unknown>,
    };
    const matcher = compileRule(rule);
    expect(() => matcher.match(node)).not.toThrow();
    expect(matcher.match(node)).toBeNull();
  });

  it('E2: calling match() 1000 times on non-matching nodes produces no state leak', () => {
    const rule = makeRule({ match: { nodeType: 'target' } });
    const matcher = compileRule(rule);
    for (let i = 0; i < 1000; i++) {
      expect(matcher.match(makeLeaf('other', 'x', i))).toBeNull();
    }
    // Confirm a real match still works after all the misses
    expect(matcher.match(makeLeaf('target', 'x'))).not.toBeNull();
  });

  it('E3: loadPatterns result passes directly into runPipeline config.patterns without type errors', async () => {
    const skillDir = await writeTempPatterns({ 'rule-a.yaml': VALID_YAML_A });
    const matchers = await loadPatterns(skillDir);

    // Type compatibility: PatternMatcher[] from loadPatterns must be accepted by PipelineConfig
    const config: PipelineConfig = {
      plugin: { language: 'test', parse: () => makeLeaf('root', '') },
      patterns: matchers,
      moduleName: 'test.module',
    };

    // runPipeline must accept it without compile errors; runtime succeeds
    const result = await runPipeline('', config);
    expect(result).toBeTruthy();
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
