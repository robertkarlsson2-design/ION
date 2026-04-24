import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGate, type ExecFileFn, type SpawnFn } from '../../src/ingest/gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExec(stdout: string, code: number): ExecFileFn {
  return async () => ({ stdout, code });
}

const noopExec: ExecFileFn = async () => ({
  stdout: JSON.stringify({ errorCount: 0, errors: [] }),
  code: 0,
});

const noopSpawn: SpawnFn = async () => ({ passed: true, output: '' });

function makeCheckJson(errors: Array<{
  file: string; code: string; message: string;
  startLine: number; startCol: number;
}>): string {
  return JSON.stringify({
    errorCount: errors.length,
    errors: errors.map(e => ({
      file: e.file,
      code: e.code,
      message: e.message,
      span: { file: e.file, startLine: e.startLine, startCol: e.startCol, endLine: e.startLine, endCol: e.startCol + 1 },
      suggestion: null,
    })),
  });
}

// ---------------------------------------------------------------------------
// Temp directory setup
// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ion-gate-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Suite A — detectFramework (tested via GateResult.detectedFramework)
// ---------------------------------------------------------------------------

describe('Suite A: detectFramework', () => {
  it('A1: returns vitest when vitest.config.ts exists', async () => {
    await writeFile(join(dir, 'vitest.config.ts'), '');
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBe('vitest');
  });

  it('A2: returns vitest when package.json has vitest devDependency', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^1.0.0' } }));
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBe('vitest');
  });

  it('A3: returns jest when jest.config.js exists', async () => {
    await writeFile(join(dir, 'jest.config.js'), '');
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBe('jest');
  });

  it('A4: returns jest when package.json has jest dep and no vitest', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29.0.0' } }));
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBe('jest');
  });

  it('A5: returns pytest when pytest.ini exists', async () => {
    await writeFile(join(dir, 'pytest.ini'), '');
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBe('pytest');
  });

  it('A6: returns pytest when pyproject.toml exists', async () => {
    await writeFile(join(dir, 'pyproject.toml'), '');
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBe('pytest');
  });

  it('A7: returns maven when pom.xml exists', async () => {
    await writeFile(join(dir, 'pom.xml'), '');
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBe('maven');
  });

  it('A8: returns null for empty directory', async () => {
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBeNull();
  });

  it('A9: vitest takes priority over jest when both configs exist', async () => {
    await writeFile(join(dir, 'vitest.config.ts'), '');
    await writeFile(join(dir, 'jest.config.js'), '');
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBe('vitest');
  });
});

// ---------------------------------------------------------------------------
// Suite B — ion check phase
// ---------------------------------------------------------------------------

describe('Suite B: ion check phase', () => {
  it('B1: passed true and empty errors when ion check returns no errors', async () => {
    const fakeExec = makeExec(JSON.stringify({ errorCount: 0, errors: [] }), 0);
    const result = await runGate({ ionFiles: ['foo.ion'], workDir: dir }, fakeExec);
    expect(result.passed).toBe(true);
    expect(result.ionCheckErrors).toHaveLength(0);
    expect(result.llmRetryContext).toBeNull();
  });

  it('B2: passed false and llmRetryContext non-null when ion check returns an error', async () => {
    const errorJson = makeCheckJson([{
      file: 'foo.ion', code: 'B0001', message: 'undefined: x',
      startLine: 3, startCol: 5,
    }]);
    const fakeExec = makeExec(errorJson, 1);
    const result = await runGate({ ionFiles: ['foo.ion'], workDir: dir }, fakeExec);
    expect(result.passed).toBe(false);
    expect(result.ionCheckErrors).toHaveLength(1);
    expect(result.ionCheckErrors[0]?.code).toBe('B0001');
    expect(result.llmRetryContext).not.toBeNull();
  });

  it('B3: empty ionFiles skips exec entirely', async () => {
    let called = false;
    const trackingExec: ExecFileFn = async () => {
      called = true;
      return { stdout: '', code: 0 };
    };
    const result = await runGate({ ionFiles: [], workDir: dir }, trackingExec);
    expect(called).toBe(false);
    expect(result.ionCheckErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite C — test phase
// ---------------------------------------------------------------------------

describe('Suite C: test phase', () => {
  it('C1: detectedFramework null implies testOutput null', async () => {
    // empty dir → no framework detected
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.detectedFramework).toBeNull();
    expect(result.testOutput).toBeNull();
  });

  it('C2: spawn exits 0 → passed true', async () => {
    await writeFile(join(dir, 'vitest.config.ts'), '');
    const fakeSpawn: SpawnFn = async () => ({ passed: true, output: 'All tests passed' });
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, fakeSpawn);
    expect(result.passed).toBe(true);
    expect(result.testOutput).toBe('All tests passed');
  });

  it('C3: spawn exits 1 → passed false and testOutput contains failure output', async () => {
    await writeFile(join(dir, 'vitest.config.ts'), '');
    const fakeSpawn: SpawnFn = async () => ({ passed: false, output: '3 tests failed' });
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, fakeSpawn);
    expect(result.passed).toBe(false);
    expect(result.testOutput).toBe('3 tests failed');
    expect(result.llmRetryContext).toContain('3 tests failed');
  });
});

// ---------------------------------------------------------------------------
// Suite D — llmRetryContext (tested via GateResult.llmRetryContext)
// ---------------------------------------------------------------------------

describe('Suite D: llmRetryContext', () => {
  it('D1: includes ion check errors section when errors are present', async () => {
    const errorJson = makeCheckJson([{
      file: 'foo.ion', code: 'B0001', message: 'undefined: x',
      startLine: 3, startCol: 5,
    }]);
    const fakeExec = makeExec(errorJson, 1);
    const result = await runGate({ ionFiles: ['foo.ion'], workDir: dir }, fakeExec);
    expect(result.llmRetryContext).toContain('=== ion check errors ===');
    expect(result.llmRetryContext).toContain('error[B0001]');
    expect(result.llmRetryContext).toContain('foo.ion:3:5');
  });

  it('D2: includes test failures section when tests fail', async () => {
    await writeFile(join(dir, 'vitest.config.ts'), '');
    const fakeSpawn: SpawnFn = async () => ({ passed: false, output: 'test X failed' });
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, fakeSpawn);
    expect(result.llmRetryContext).toContain('=== test failures ===');
    expect(result.llmRetryContext).toContain('test X failed');
  });

  it('D3: truncates test output in llmRetryContext at 8000 chars but preserves full testOutput', async () => {
    await writeFile(join(dir, 'vitest.config.ts'), '');
    const longOutput = 'x'.repeat(10_000);
    const fakeSpawn: SpawnFn = async () => ({ passed: false, output: longOutput });
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, fakeSpawn);
    expect(result.testOutput).toBe(longOutput);
    const testSection = (result.llmRetryContext ?? '').split('=== test failures ===\n')[1] ?? '';
    expect(testSection.length).toBe(8_000);
  });

  it('D4: returns null when no check errors and tests pass', async () => {
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, noopSpawn);
    expect(result.llmRetryContext).toBeNull();
  });

  it('D5: llmRetryContext is non-null when tests fail with empty output', async () => {
    await writeFile(join(dir, 'vitest.config.ts'), '');
    const fakeSpawn: SpawnFn = async () => ({ passed: false, output: '' });
    const result = await runGate({ ionFiles: [], workDir: dir }, noopExec, fakeSpawn);
    expect(result.passed).toBe(false);
    expect(result.llmRetryContext).not.toBeNull();
  });
});
