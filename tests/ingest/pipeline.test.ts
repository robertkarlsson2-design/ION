import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/ingest/pipeline.js';
import type {
  CSTNode,
  IngestPlugin,
  IngestResult,
  LLMFallbackHandler,
  PatternMatcher,
  PipelineConfig,
} from '../../src/ingest/types.js';
import type { IonIRNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span, SymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 0 };
const unitType: IonType = { kind: 'Unit' };
const sid = 'test:x:0' as SymbolId;

function makeLeaf(type: string, row = 0): CSTNode {
  return {
    type,
    text: '',
    isNamed: true,
    startPosition: { row, column: 0 },
    endPosition: { row, column: 0 },
    children: [],
  };
}

function makeParent(type: string, children: CSTNode[], row = 0): CSTNode {
  return {
    type,
    text: '',
    isNamed: true,
    startPosition: { row, column: 0 },
    endPosition: { row, column: 0 },
    children,
  };
}

function makeRoot(children: CSTNode[]): CSTNode {
  return {
    type: 'root',
    text: '',
    isNamed: false,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
    children,
  };
}

function makePlugin(root: CSTNode): IngestPlugin {
  return { language: 'test', parse: () => root };
}

function makeVar(): IonIRNode {
  return { kind: 'Var', name: 'x', symbolId: sid, span, type: unitType };
}

function makeModuleRef(): IonIRNode {
  return { kind: 'ModuleRef', modulePath: ['foo'], symbolId: sid, span, type: unitType };
}

function makeAdtDecl(): IonIRNode {
  return { kind: 'AdtDecl', name: 'Foo', symbolId: sid, variants: [], span, type: unitType };
}

function makeOopClass(): IonIRNode {
  return {
    kind: 'OopClass',
    name: 'Bar',
    symbolId: sid,
    interfaces: [],
    fields: [],
    methods: [],
    span,
    type: unitType,
  };
}

/** Pattern that matches every node with the given IonIR result. */
function matchAll(ionNode: IonIRNode): PatternMatcher {
  return { match: () => ionNode };
}

/** Pattern that matches nodes by CST type. */
function matchType(type: string, ionNode: IonIRNode): PatternMatcher {
  return { match: (node: CSTNode) => (node.type === type ? ionNode : null) };
}

/** LLM that always succeeds with the given IonIR node. */
function llmAlways(ionNode: IonIRNode): LLMFallbackHandler {
  return { translate: async () => ionNode };
}

/** LLM that always returns null (translation failed). */
function llmNever(): LLMFallbackHandler {
  return { translate: async () => null };
}

function makeConfig(
  root: CSTNode,
  overrides: Partial<Omit<PipelineConfig, 'plugin'>> = {},
): PipelineConfig {
  return {
    plugin: makePlugin(root),
    patterns: [],
    moduleName: 'test.module',
    ...overrides,
  };
}

async function run(root: CSTNode, overrides: Partial<Omit<PipelineConfig, 'plugin'>> = {}): Promise<IngestResult> {
  return runPipeline('source', makeConfig(root, overrides));
}

// ---------------------------------------------------------------------------
// Suite A — layer attribution
// ---------------------------------------------------------------------------

describe('A: layer attribution', () => {
  it('A1: all patterns match → all traces are pattern, stats.pattern === trace count', async () => {
    const ionNode = makeVar();
    const root = makeRoot([makeLeaf('a'), makeLeaf('b'), makeLeaf('c')]);
    const result = await run(root, { patterns: [matchAll(ionNode)] });

    expect(result.traces).toHaveLength(3);
    expect(result.traces.every(t => t.layer === 'pattern')).toBe(true);
    expect(result.stats.pattern).toBe(3);
    expect(result.stats.llm).toBe(0);
    expect(result.stats.unhandled).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('A2: no patterns, no LLM → zero traces, stats.unhandled === namedNodeCount, errors non-empty', async () => {
    const leaves = [makeLeaf('a'), makeLeaf('b'), makeLeaf('c')];
    const root = makeRoot(leaves);
    const result = await run(root, { patterns: [] });

    expect(result.traces).toHaveLength(0);
    expect(result.stats.unhandled).toBe(leaves.length);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('A3: no patterns, LLM provided → all top-level traces are llm, zero errors', async () => {
    // parent has one unhandled leaf child, so LLM is triggered for parent
    const leaf = makeLeaf('leaf');
    const parent = makeParent('parent', [leaf]);
    const root = makeRoot([parent]);
    const result = await run(root, { llmFallback: llmAlways(makeVar()) });

    expect(result.traces).toHaveLength(1);
    expect(result.traces[0]?.layer).toBe('llm');
    expect(result.errors).toHaveLength(0);
  });

  it('A4: mixed — some patterns, some LLM → correct counts per layer', async () => {
    // nodeA: pattern matches directly
    // nodeB: has unhandled leaf child → LLM translates nodeB
    // nodeC: leaf, no pattern, no LLM coverage → error
    const nodeA = makeLeaf('a');
    const leaf = makeLeaf('leaf');
    const nodeB = makeParent('b', [leaf]);
    const nodeC = makeLeaf('c');
    const root = makeRoot([nodeA, nodeB, nodeC]);

    const result = await run(root, {
      patterns: [matchType('a', makeVar())],
      llmFallback: llmAlways(makeVar()),
    });

    expect(result.stats.pattern).toBe(1);
    expect(result.stats.llm).toBe(1);
    expect(result.stats.unhandled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suite B — module assembly
// ---------------------------------------------------------------------------

describe('B: module assembly', () => {
  it('B1: module.ionir === "1.0"', async () => {
    const result = await run(makeRoot([]));
    expect(result.module.ionir).toBe('1.0');
  });

  it('B2: module.module equals config.moduleName', async () => {
    const result = await runPipeline('', {
      plugin: makePlugin(makeRoot([])),
      patterns: [],
      moduleName: 'org.acme.users',
    });
    expect(result.module.module).toBe('org.acme.users');
  });

  it('B3: module.decls contains only non-ModuleRef, non-AdtDecl nodes from traces', async () => {
    const varNode = makeVar();
    const root = makeRoot([makeLeaf('v')]);
    const result = await run(root, { patterns: [matchAll(varNode)] });

    expect(result.module.decls).toHaveLength(1);
    expect(result.module.decls[0]).toBe(varNode);
    expect(result.module.imports).toHaveLength(0);
    expect(result.module.data).toHaveLength(0);
  });

  it('B4: module.data contains only AdtDecl nodes, module.imports contains only ModuleRef nodes', async () => {
    const adtNode = makeAdtDecl();
    const refNode = makeModuleRef();
    const varNode = makeVar();

    const root = makeRoot([makeLeaf('adt'), makeLeaf('ref'), makeLeaf('var')]);
    const result = await run(root, {
      patterns: [
        matchType('adt', adtNode),
        matchType('ref', refNode),
        matchType('var', varNode),
      ],
    });

    expect(result.module.data).toHaveLength(1);
    expect(result.module.data[0]?.kind).toBe('AdtDecl');
    expect(result.module.imports).toHaveLength(1);
    expect(result.module.imports[0]?.kind).toBe('ModuleRef');
    expect(result.module.decls).toHaveLength(1);
  });

  it('B5: module.dialects contains "core" always; contains "ion-oop" when OopClass is present', async () => {
    const resultEmpty = await run(makeRoot([]));
    expect(resultEmpty.module.dialects).toContain('core');

    const oopNode = makeOopClass();
    const root = makeRoot([makeLeaf('cls')]);
    const result = await run(root, { patterns: [matchAll(oopNode)] });
    expect(result.module.dialects).toContain('core');
    expect(result.module.dialects).toContain('ion-oop');
  });
});

// ---------------------------------------------------------------------------
// Suite C — stats invariant
// ---------------------------------------------------------------------------

describe('C: stats invariant', () => {
  it('C1: stats.pattern + stats.llm + stats.unhandled equals total named nodes walked (flat tree)', async () => {
    // Flat tree: 5 nodes, 2 pattern, 3 unhandled
    const nodes = ['p1', 'p2', 'u1', 'u2', 'u3'].map(t => makeLeaf(t));
    const root = makeRoot(nodes);
    const result = await run(root, {
      patterns: [matchType('p1', makeVar()), matchType('p2', makeVar())],
    });

    const { pattern, llm, unhandled } = result.stats;
    expect(pattern + llm + unhandled).toBe(nodes.length);
  });
});

// ---------------------------------------------------------------------------
// Suite D — context extraction (tested indirectly via LLM context parameter)
// ---------------------------------------------------------------------------

describe('D: context extraction', () => {
  it('D1: extractContext returns at most 100 lines for a 1000-line source', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`);
    const source = lines.join('\n');

    const leaf = makeLeaf('leaf');
    // parent at row 500 with one unhandled child → LLM triggered for parent
    const parent = makeParent('parent', [leaf], 500);
    const root = makeRoot([parent]);

    let capturedContext = '';
    const llm: LLMFallbackHandler = {
      translate: async (_node, ctx) => {
        capturedContext = ctx;
        return null;
      },
    };

    await runPipeline(source, { plugin: makePlugin(root), patterns: [], moduleName: 'x', llmFallback: llm });

    const contextLines = capturedContext.split('\n');
    expect(contextLines.length).toBeLessThanOrEqual(100);
    expect(contextLines.length).toBeGreaterThan(0);
  });

  it('D2: extractContext returns all lines when source has fewer than 100 lines', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const source = lines.join('\n');

    const leaf = makeLeaf('leaf');
    const parent = makeParent('parent', [leaf], 15);
    const root = makeRoot([parent]);

    let capturedContext = '';
    const llm: LLMFallbackHandler = {
      translate: async (_node, ctx) => {
        capturedContext = ctx;
        return null;
      },
    };

    await runPipeline(source, { plugin: makePlugin(root), patterns: [], moduleName: 'x', llmFallback: llm });

    const contextLines = capturedContext.split('\n');
    expect(contextLines.length).toBe(lines.length);
  });

  it('D3: position row=0 produces at most 50 lines (no underflow)', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i}`);
    const source = lines.join('\n');

    const leaf = makeLeaf('leaf');
    const parent = makeParent('parent', [leaf], 0);
    const root = makeRoot([parent]);

    let capturedContext = '';
    const llm: LLMFallbackHandler = {
      translate: async (_node, ctx) => {
        capturedContext = ctx;
        return null;
      },
    };

    await runPipeline(source, { plugin: makePlugin(root), patterns: [], moduleName: 'x', llmFallback: llm });

    const contextLines = capturedContext.split('\n');
    expect(contextLines.length).toBeLessThanOrEqual(50);
    // First line should be line0 (no negative index underflow)
    expect(contextLines[0]).toBe('line0');
  });
});

// ---------------------------------------------------------------------------
// Suite E — edge cases
// ---------------------------------------------------------------------------

describe('E: edge cases', () => {
  it('E1: empty source (no named children) → empty module, zero errors', async () => {
    const root = makeRoot([]);
    const result = await run(root);

    expect(result.traces).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.module.decls).toHaveLength(0);
    expect(result.module.data).toHaveLength(0);
    expect(result.module.imports).toHaveLength(0);
  });

  it('E2: patterns=[] and no fallback → all nodes become errors', async () => {
    const root = makeRoot([makeLeaf('a'), makeLeaf('b')]);
    const result = await run(root, { patterns: [] });

    expect(result.traces).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.stats.unhandled).toBe(2);
  });

  it('E3: LLM returns null → error pushed, not a trace', async () => {
    const leaf = makeLeaf('leaf');
    const parent = makeParent('parent', [leaf]);
    const root = makeRoot([parent]);

    const result = await run(root, { llmFallback: llmNever() });

    expect(result.traces).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.stats.llm).toBe(0);
  });
});
