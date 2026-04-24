import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseArgs,
  deriveModuleName,
  buildReport,
  runIngest,
} from '../../src/cli/ingest.js';
import type { IngestPlugin, LayerStats } from '../../src/ingest/types.js';
import type { CSTNode } from '../../src/ingest/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Suite A — argument parsing
// ---------------------------------------------------------------------------

describe('A: parseArgs', () => {
  it('A1: missing --skill → error containing "skill"', () => {
    const result = parseArgs(['src/foo.js']);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/skill/i);
  });

  it('A2: missing positional path → error', () => {
    const result = parseArgs(['--skill', 'javascript']);
    expect('error' in result).toBe(true);
  });

  it('A3: unknown flag --foobar → error', () => {
    const result = parseArgs(['src/foo.js', '--skill', 'javascript', '--foobar']);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/foobar/);
  });

  it('A4: --batch flag sets batch === true', () => {
    const result = parseArgs(['src/', '--skill', 'javascript', '--batch']);
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.batch).toBe(true);
  });

  it('A5: --dry-run sets dryRun === true', () => {
    const result = parseArgs(['src/foo.js', '--skill', 'javascript', '--dry-run']);
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.dryRun).toBe(true);
  });

  it('A6: --report sets report === true', () => {
    const result = parseArgs(['src/foo.js', '--skill', 'javascript', '--report']);
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.report).toBe(true);
  });

  it('A7: --no-llm sets noLlm === true', () => {
    const result = parseArgs(['src/foo.js', '--skill', 'javascript', '--no-llm']);
    expect('error' in result).toBe(false);
    if (!('error' in result)) expect(result.noLlm).toBe(true);
  });

  it('A8: all flags together parse correctly', () => {
    const result = parseArgs([
      'src/foo.js', '--skill', 'javascript',
      '--batch', '--dry-run', '--report', '--no-llm',
    ]);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.batch).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.report).toBe(true);
      expect(result.noLlm).toBe(true);
    }
  });

  it('A9: --skill without a value → error', () => {
    const result = parseArgs(['src/foo.js', '--skill']);
    expect('error' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite B — deriveModuleName
// ---------------------------------------------------------------------------

describe('B: deriveModuleName', () => {
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
// Suite C — buildReport
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
// Suite D — runIngest single file, dry-run
// ---------------------------------------------------------------------------

describe('D: runIngest single file dry-run', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('D1: dry-run does not write .ion file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-test-'));
    const jsFile = join(tmpDir, 'foo.js');
    await writeFile(jsFile, 'const x = 1;', 'utf-8');

    const { exitCode } = await runIngest(
      [jsFile, '--skill', 'javascript', '--dry-run'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );

    expect(exitCode).toBe(0);
    // .ion file must NOT exist
    await expect(readFile(join(tmpDir, 'foo.ion'), 'utf-8')).rejects.toThrow();
  });

  it('D2: --report outputs JSON to stdout', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-test-'));
    const jsFile = join(tmpDir, 'bar.js');
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
// Suite E — runIngest single file, actual write
// ---------------------------------------------------------------------------

describe('E: runIngest single file write', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('E1: writes .ion file next to source, content starts with I1', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-test-'));
    const jsFile = join(tmpDir, 'hello.js');
    await writeFile(jsFile, 'function hello() {}', 'utf-8');

    const { exitCode } = await runIngest(
      [jsFile, '--skill', 'javascript'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );

    expect(exitCode).toBe(0);
    const ionFile = join(tmpDir, 'hello.ion');
    const content = await readFile(ionFile, 'utf-8');
    expect(content.startsWith('I1\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite F — runIngest batch mode
// ---------------------------------------------------------------------------

describe('F: runIngest batch mode', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('F1: batch mode writes .ion for each .js file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-batch-'));
    await writeFile(join(tmpDir, 'a.js'), 'const a = 1;', 'utf-8');
    await writeFile(join(tmpDir, 'b.js'), 'const b = 2;', 'utf-8');
    await writeFile(join(tmpDir, 'c.js'), 'const c = 3;', 'utf-8');

    const { exitCode } = await runIngest(
      [tmpDir, '--skill', 'javascript', '--batch'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );

    expect(exitCode).toBe(0);
    for (const name of ['a.ion', 'b.ion', 'c.ion']) {
      const content = await readFile(join(tmpDir, name), 'utf-8');
      expect(content.startsWith('I1\n')).toBe(true);
    }
  });

  it('F2: --report in batch mode reports files count', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-batch-'));
    await writeFile(join(tmpDir, 'x.js'), '', 'utf-8');
    await writeFile(join(tmpDir, 'y.js'), '', 'utf-8');
    await writeFile(join(tmpDir, 'z.js'), '', 'utf-8');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await runIngest(
        [tmpDir, '--skill', 'javascript', '--batch', '--dry-run', '--report'],
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
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-ingest-batch-'));
    const jsFile = join(tmpDir, 'single.js');
    await writeFile(jsFile, '', 'utf-8');

    const { exitCode } = await runIngest(
      [jsFile, '--skill', 'javascript', '--batch'],
      { plugin: makeEmptyPlugin(), patterns: [] },
    );

    expect(exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Suite G — error cases
// ---------------------------------------------------------------------------

describe('G: error cases', () => {
  it('G1: unsupported skill → exit 2', async () => {
    const { exitCode } = await runIngest(
      ['/tmp/nonexistent.js', '--skill', 'rust'],
      { plugin: makeEmptyPlugin(), patterns: [] },
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
