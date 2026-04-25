import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';

// Prevent tree-sitter WASM initialization when importing ingest.ts.
vi.mock('../../../emitters/javascript/parser.js', () => ({
  parseJavaScript: vi.fn(() => ({
    root: {
      type: 'program',
      text: '',
      isNamed: false,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
      children: [],
    },
    hasErrors: false,
    errors: [],
  })),
}));

import {
  parseArgs,
  validateSkillName,
  resolvePlugin,
  deriveModuleName,
  collectSourceFiles,
  ingestSingleFile,
  aggregateStats,
  formatReport,
  buildReport,
  runIngest,
  MAX_SOURCE_BYTES,
  type IngestFileResult,
} from '../../src/cli/ingest.js';
import type { IngestPlugin, LLMFallbackHandler, PatternMatcher, LayerStats, CSTNode } from '../../src/ingest/types.js';
import type { IonIRNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { SymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sid = 'test:x:0' as SymbolId;
const unitType: IonType = { kind: 'Unit' };

function makeStubPlugin(): IngestPlugin {
  return {
    language: 'test',
    parse: () => ({
      type: 'program',
      text: '',
      isNamed: false,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
      children: [],
    }),
  };
}

function makeEmptyPlugin(): IngestPlugin {
  return {
    language: 'javascript',
    parse(_source: string): CSTNode {
      return {
        type: 'program',
        text: '',
        isNamed: true,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 0 },
        children: [],
      };
    },
  };
}

function makePatternMatcher(ionNode: IonIRNode): PatternMatcher {
  return {
    ruleId: 'test-rule',
    match: () => ionNode,
  };
}

function makeLetNode(): IonIRNode {
  const span = { file: 'test.js', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
  const lit: IonIRNode = {
    kind: 'Literal',
    value: { kind: 'Int', value: 1 },
    span,
    type: unitType,
  };
  return {
    kind: 'Let',
    name: 'x',
    symbolId: sid,
    bindingType: unitType,
    value: lit,
    body: lit,
    span,
    type: unitType,
  };
}

function makeStubLlmFallback(): LLMFallbackHandler {
  return {
    translate: vi.fn().mockResolvedValue(null),
  };
}

// ---------------------------------------------------------------------------
// Temp directory setup (for groups that use beforeEach)
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-cli-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Group 1 / Suite A: Argument parsing
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('1. missing positional path returns error', () => {
    const result = parseArgs(['--skill', 'javascript']);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/path/i);
  });

  it('2. missing --skill returns error', () => {
    const result = parseArgs(['src/foo.js']);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/skill/i);
  });

  it('3. unknown flag returns error', () => {
    const result = parseArgs(['src/foo.js', '--skill', 'javascript', '--foo']);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('--foo');
  });

  it('4. all flags parsed correctly', () => {
    const result = parseArgs([
      'src/foo.js',
      '--skill', 'javascript',
      '--batch',
      '--dry-run',
      '--report',
      '--no-llm',
    ]);
    expect(result).not.toHaveProperty('error');
    const parsed = result as Exclude<typeof result, { error: string }>;
    expect(parsed.skill).toBe('javascript');
    expect(parsed.batch).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.report).toBe(true);
    expect(parsed.noLlm).toBe(true);
  });

  it('5. --skill without value returns error', () => {
    const result = parseArgs(['src/foo.js', '--skill']);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/skill requires a value/i);
  });

  it('6. valid minimal args returns correct defaults', () => {
    const result = parseArgs(['src/foo.js', '--skill', 'javascript']);
    expect(result).not.toHaveProperty('error');
    const parsed = result as Exclude<typeof result, { error: string }>;
    expect(parsed.batch).toBe(false);
    expect(parsed.dryRun).toBe(false);
    expect(parsed.report).toBe(false);
    expect(parsed.noLlm).toBe(false);
  });

  it('7. positional path is captured correctly', () => {
    const result = parseArgs(['my/source/file.js', '--skill', 'javascript']);
    expect(result).not.toHaveProperty('error');
    const parsed = result as Exclude<typeof result, { error: string }>;
    expect(parsed.path).toBe('my/source/file.js');
  });

  it('A4: --batch flag sets batch === true', () => {
    const result = parseArgs(['src/', '--skill', 'javascript', '--batch']);
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.batch).toBe(true);
  });

  it('A9: --skill without a value → error', () => {
    const result = parseArgs(['src/foo.js', '--skill']);
    expect('error' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 2: Skill validation / resolution
// ---------------------------------------------------------------------------

describe('validateSkillName + resolvePlugin', () => {
  it('8. path traversal attempt is blocked', () => {
    const result = validateSkillName('../etc/passwd');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/traversal/i);
  });

  it('9. javascript skill resolves without error', () => {
    const result = resolvePlugin('javascript');
    expect(result).not.toHaveProperty('error');
    const plugin = result as Exclude<typeof result, { error: string }>;
    expect(plugin.language).toBe('javascript');
    expect(typeof plugin.parse).toBe('function');
  });

  it('10. unsupported skill returns error', () => {
    const result = resolvePlugin('cobol');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('unsupported skill: cobol');
  });
});

// ---------------------------------------------------------------------------
// Group 3 / Suite B: Module name derivation
// ---------------------------------------------------------------------------

describe('deriveModuleName', () => {
  it('11. src/api/users.js → src.api.users', () => {
    expect(deriveModuleName('src/api/users.js')).toBe('src.api.users');
  });

  it('12. ./index.ts → index', () => {
    expect(deriveModuleName('./index.ts')).toBe('index');
  });

  it('13. Windows-style path is normalized', () => {
    expect(deriveModuleName('C:\\foo\\bar.ts')).toBe('C:.foo.bar');
  });

  it('B1: src/utils/foo-bar.js with root src → utils.foo_bar', () => {
    const name = deriveModuleName('src/utils/foo-bar.js', 'src');
    expect(name).toBe('utils.foo_bar');
  });

  it('B2: index.js with root = dirname → index', () => {
    const name = deriveModuleName('/tmp/project/index.js', '/tmp/project');
    expect(name).toBe('index');
  });

  it('B3: nested path with dashes and slashes is fully converted', () => {
    const name = deriveModuleName('/a/my-app/src/lib/some-util.js', '/a/my-app/src');
    expect(name).toBe('lib.some_util');
  });
});

// ---------------------------------------------------------------------------
// Suite C: buildReport
// ---------------------------------------------------------------------------

describe('C: buildReport', () => {
  it('C1: empty stats list → all zeros, no divide-by-zero', () => {
    const r = buildReport([]);
    expect(r.files).toBe(0);
    expect(r.constructs).toBe(0);
    expect(r.autoPercent).toBe(0);
    expect(r.llmPercent).toBe(0);
    expect(r.flaggedPercent).toBe(0);
  });

  it('C2: single stat all-zero → percentages all zero', () => {
    const stats: LayerStats = { pattern: 0, llm: 0, unhandled: 0 };
    const r = buildReport([stats]);
    expect(r.files).toBe(1);
    expect(r.autoPercent).toBe(0);
    expect(r.llmPercent).toBe(0);
    expect(r.flaggedPercent).toBe(0);
  });

  it('C3: mixed stats → percentages sum to 100', () => {
    const stats: LayerStats = { pattern: 6, llm: 2, unhandled: 2 };
    const r = buildReport([stats]);
    expect(r.constructs).toBe(10);
    expect(r.autoPercent + r.llmPercent + r.flaggedPercent).toBeCloseTo(100, 10);
  });

  it('C4: multiple files → files count and totals are summed', () => {
    const s1: LayerStats = { pattern: 4, llm: 1, unhandled: 0 };
    const s2: LayerStats = { pattern: 2, llm: 0, unhandled: 3 };
    const r = buildReport([s1, s2]);
    expect(r.files).toBe(2);
    expect(r.auto).toBe(6);
    expect(r.llm).toBe(1);
    expect(r.flagged).toBe(3);
    expect(r.constructs).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Group 4: File collection
// ---------------------------------------------------------------------------

describe('collectSourceFiles', () => {
  it('14. single file mode returns array with resolved path', async () => {
    const files = await collectSourceFiles('src/api/users.js', false);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(resolve('src/api/users.js'));
  });

  it('15. batch mode with glob returns matched files', async () => {
    await writeFile(join(tmpDir, 'alpha.js'), 'a');
    await writeFile(join(tmpDir, 'beta.js'), 'b');
    await writeFile(join(tmpDir, 'gamma.ts'), 'c');

    const files = await collectSourceFiles(join(tmpDir, '*.js'), true);
    expect(files).toHaveLength(2);
    expect(files.map(f => f.endsWith('.js')).every(Boolean)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 5: ingestSingleFile behavior
// ---------------------------------------------------------------------------

describe('ingestSingleFile', () => {
  it('16. writes .ion file adjacent to input with encoded content', async () => {
    const inputPath = join(tmpDir, 'hello.js');
    await writeFile(inputPath, '// empty');

    const result = await ingestSingleFile(inputPath, makeStubPlugin(), [], undefined, false);

    expect(result.skipped).toBe(false);
    expect(result.outputPath).toBe(join(tmpDir, 'hello.ion'));

    const written = await readFile(result.outputPath, 'utf-8');
    // Wire format always starts with the version line "I1"
    expect(written).toMatch(/^I1\n/);
  });

  it('17. dryRun=true returns result but writes no file', async () => {
    const inputPath = join(tmpDir, 'noop.js');
    await writeFile(inputPath, '// dry');

    const result = await ingestSingleFile(inputPath, makeStubPlugin(), [], undefined, true);

    expect(result.skipped).toBe(false);
    await expect(readFile(result.outputPath, 'utf-8')).rejects.toThrow();
  });

  it('18. file exceeding maxBytes is skipped without pipeline call', async () => {
    const inputPath = join(tmpDir, 'big.js');
    await writeFile(inputPath, 'x'.repeat(200));

    let pluginCalled = false;
    const trackingPlugin: IngestPlugin = {
      language: 'test',
      parse: () => {
        pluginCalled = true;
        return makeStubPlugin().parse('');
      },
    };

    const result = await ingestSingleFile(
      inputPath, trackingPlugin, [], undefined, false, 100,
    );

    expect(result.skipped).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(pluginCalled).toBe(false);
  });

  it('19. unreadable / nonexistent file returns error in result', async () => {
    const result = await ingestSingleFile(
      '/nonexistent/path/file.js', makeStubPlugin(), [], undefined, false,
    );

    expect(result.skipped).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBeTruthy();
  });

  it('20. llmFallback=undefined passes no fallback to pipeline', async () => {
    const inputPath = join(tmpDir, 'no-llm.js');
    await writeFile(inputPath, '');

    const result = await ingestSingleFile(inputPath, makeStubPlugin(), [], undefined, false);

    // With an empty CST (no named children), pipeline reports no errors and no traces
    expect(result.skipped).toBe(false);
    expect(result.stats.llm).toBe(0);
  });

  it('21. module name is derived from relative path and embedded in output', async () => {
    const inputPath = join(tmpDir, 'my.module.js');
    await writeFile(inputPath, '');

    const result = await ingestSingleFile(inputPath, makeStubPlugin(), [], undefined, false);

    const wire = await readFile(result.outputPath, 'utf-8');
    const expectedModuleName = deriveModuleName(relative(process.cwd(), inputPath));
    // The module line is "M <moduleName> v=0.0.0"
    expect(wire).toContain(`M ${expectedModuleName} `);
  });
});

// ---------------------------------------------------------------------------
// Group 6: Report aggregation
// ---------------------------------------------------------------------------

describe('aggregateStats + formatReport', () => {
  function makeResult(
    overrides: Partial<IngestFileResult> = {},
  ): IngestFileResult {
    return {
      inputPath: '/tmp/a.js',
      outputPath: '/tmp/a.ion',
      stats: { pattern: 0, llm: 0, unhandled: 0 },
      errors: [],
      skipped: false,
      ...overrides,
    };
  }

  it('22. aggregateStats sums pattern/llm/unhandled across results', () => {
    const results: IngestFileResult[] = [
      makeResult({ stats: { pattern: 3, llm: 1, unhandled: 0 } }),
      makeResult({ stats: { pattern: 2, llm: 0, unhandled: 2 } }),
    ];
    const agg = aggregateStats(results);
    expect(agg.pattern).toBe(5);
    expect(agg.llm).toBe(1);
    expect(agg.unhandled).toBe(2);
  });

  it('23. formatReport outputs valid JSON with correct structure', () => {
    const results: IngestFileResult[] = [
      makeResult({ stats: { pattern: 4, llm: 2, unhandled: 1 } }),
    ];
    const json = JSON.parse(formatReport(results)) as {
      files: number;
      errorCount: number;
      stats: { pattern: number; llm: number; unhandled: number };
      errors: unknown[];
    };
    expect(json.files).toBe(1);
    expect(json.errorCount).toBe(0);
    expect(json.stats.pattern).toBe(4);
    expect(json.stats.llm).toBe(2);
    expect(json.stats.unhandled).toBe(1);
    expect(Array.isArray(json.errors)).toBe(true);
  });

  it('24. formatReport includes per-file error messages', () => {
    const dummyCstNode = {
      type: 'error',
      text: '',
      isNamed: false,
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
      children: [],
    } as const;

    const results: IngestFileResult[] = [
      makeResult({
        inputPath: '/src/foo.js',
        errors: [
          { message: 'No handler for foo', cstNode: dummyCstNode },
          { message: 'No handler for bar', cstNode: dummyCstNode },
        ],
      }),
      makeResult({ inputPath: '/src/baz.js' }),
    ];
    const json = JSON.parse(formatReport(results)) as {
      files: number;
      errorCount: number;
      errors: Array<{ file: string; message: string }>;
    };
    expect(json.files).toBe(2);
    expect(json.errorCount).toBe(2);
    expect(json.errors).toHaveLength(2);
    expect(json.errors[0]?.file).toBe('/src/foo.js');
    expect(json.errors[0]?.message).toBe('No handler for foo');
  });
});

// ---------------------------------------------------------------------------
// Group 7 / Suite G: End-to-end error paths
// ---------------------------------------------------------------------------

describe('runIngest end-to-end', () => {
  it('25. unsupported skill exits with code 2 and makes no pipeline calls', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    try {
      const result = await runIngest(['src/foo.js', '--skill', 'cobol']);
      expect(result.exitCode).toBe(2);
      expect(stderrChunks.join('')).toContain('unsupported skill: cobol');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('G1: unsupported skill → exit 2', async () => {
    const { exitCode } = await runIngest(
      ['/tmp/nonexistent.js', '--skill', 'rust'],
    );
    expect(exitCode).toBe(2);
  });

  it('G2: missing path → exit 2', async () => {
    const { exitCode } = await runIngest(
      ['/tmp/__nonexistent_ion_test_file__.js', '--skill', 'javascript'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );
    expect(exitCode).toBe(2);
  });

  it('G3: missing --skill → exit 2', async () => {
    const { exitCode } = await runIngest(['/tmp/foo.js']);
    expect(exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Suite D: runIngest single file, dry-run
// ---------------------------------------------------------------------------

describe('D: runIngest single file dry-run', () => {
  let localTmpDir: string;

  afterEach(async () => {
    if (localTmpDir) await rm(localTmpDir, { recursive: true, force: true });
  });

  it('D1: dry-run does not write .ion file', async () => {
    localTmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-test-'));
    const jsFile = join(localTmpDir, 'foo.js');
    await writeFile(jsFile, 'const x = 1;', 'utf-8');

    const { exitCode } = await runIngest(
      [jsFile, '--skill', 'javascript', '--dry-run'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );

    expect(exitCode).toBe(0);
    // .ion file must NOT exist
    await expect(readFile(join(localTmpDir, 'foo.ion'), 'utf-8')).rejects.toThrow();
  });

  it('D2: --report outputs JSON to stdout', async () => {
    localTmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-test-'));
    const jsFile = join(localTmpDir, 'bar.js');
    await writeFile(jsFile, '', 'utf-8');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { exitCode } = await runIngest(
        [jsFile, '--skill', 'javascript', '--dry-run', '--report'],
        { plugin: makeEmptyPlugin(), patterns: [] },
      );
      expect(exitCode).toBe(0);
      const calls = writeSpy.mock.calls.map(([arg]) => String(arg));
      const reportCall = calls.find(s => s.trim().startsWith('{'));
      expect(reportCall).toBeDefined();
      if (reportCall !== undefined) {
        const parsed: unknown = JSON.parse(reportCall);
        expect(parsed).toMatchObject({ files: 1 });
      }
    } finally {
      writeSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Suite E: runIngest single file, actual write
// ---------------------------------------------------------------------------

describe('E: runIngest single file write', () => {
  let localTmpDir: string;

  afterEach(async () => {
    if (localTmpDir) await rm(localTmpDir, { recursive: true, force: true });
  });

  it('E1: writes .ion file next to source, content starts with I1', async () => {
    localTmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-test-'));
    const jsFile = join(localTmpDir, 'hello.js');
    await writeFile(jsFile, 'function hello() {}', 'utf-8');

    const { exitCode } = await runIngest(
      [jsFile, '--skill', 'javascript'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );

    expect(exitCode).toBe(0);
    const ionFile = join(localTmpDir, 'hello.ion');
    const content = await readFile(ionFile, 'utf-8');
    expect(content.startsWith('I1\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite F: runIngest batch mode
// ---------------------------------------------------------------------------

describe('F: runIngest batch mode', () => {
  let localTmpDir: string;

  afterEach(async () => {
    if (localTmpDir) await rm(localTmpDir, { recursive: true, force: true });
  });

  it('F1: batch mode writes .ion for each .js file', async () => {
    localTmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-batch-'));
    await writeFile(join(localTmpDir, 'a.js'), 'const a = 1;', 'utf-8');
    await writeFile(join(localTmpDir, 'b.js'), 'const b = 2;', 'utf-8');
    await writeFile(join(localTmpDir, 'c.js'), 'const c = 3;', 'utf-8');

    const { exitCode } = await runIngest(
      [localTmpDir, '--skill', 'javascript', '--batch'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );

    expect(exitCode).toBe(0);
    for (const name of ['a.ion', 'b.ion', 'c.ion']) {
      const content = await readFile(join(localTmpDir, name), 'utf-8');
      expect(content.startsWith('I1\n')).toBe(true);
    }
  });

  it('F2: --report in batch mode reports files count', async () => {
    localTmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-batch-'));
    await writeFile(join(localTmpDir, 'x.js'), '', 'utf-8');
    await writeFile(join(localTmpDir, 'y.js'), '', 'utf-8');
    await writeFile(join(localTmpDir, 'z.js'), '', 'utf-8');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runIngest(
        [localTmpDir, '--skill', 'javascript', '--batch', '--dry-run', '--report'],
        { plugin: makeEmptyPlugin(), patterns: [] },
      );
      const calls = writeSpy.mock.calls.map(([arg]) => String(arg));
      const reportCall = calls.find(s => s.trim().startsWith('{'));
      expect(reportCall).toBeDefined();
      if (reportCall !== undefined) {
        const parsed: unknown = JSON.parse(reportCall);
        expect(parsed).toMatchObject({ files: 3 });
      }
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('F3: --batch with a file path (not directory) → exit 2', async () => {
    localTmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-batch-'));
    const jsFile = join(localTmpDir, 'single.js');
    await writeFile(jsFile, '', 'utf-8');

    const { exitCode } = await runIngest(
      [jsFile, '--skill', 'javascript', '--batch'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );

    expect(exitCode).toBe(2);
  });
});
