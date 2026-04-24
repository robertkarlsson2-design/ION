import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runCheck } from '../../src/cli/check.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ion-check-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeTempFile(dir: string, name: string, content: string): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

type WriteSpy = ReturnType<typeof vi.spyOn<NodeJS.WriteStream, 'write'>>;

function captureOutput(): { stdout: WriteSpy; stderr: WriteSpy; getStdout: () => string; getStderr: () => string } {
  let stdoutBuf = '';
  let stderrBuf = '';
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderrBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  });
  return {
    stdout,
    stderr,
    getStdout: () => stdoutBuf,
    getStderr: () => stderrBuf,
  };
}

// ---------------------------------------------------------------------------
// Test sources
// ---------------------------------------------------------------------------

const VALID_SRC = 'fn add(a: Int, b: Int) -> Int = a + b\n';
const PARSE_ERROR_SRC = 'fn bad(\n';
const BIND_ERROR_SRC = 'fn foo(x: Int) -> Int = undeclaredName\n';
const TYPE_ERROR_SRC = 'fn bad(x: Int) -> Str = x\n';
const VALID_SRC2 = 'fn mul(a: Int, b: Int) -> Int = a + b\n';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await makeTempDir();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runCheck — valid file', () => {
  it('exits 0 with no stdout output for a valid file', async () => {
    const filePath = await writeTempFile(tempDir, 'valid.ion', VALID_SRC);
    const { getStdout } = captureOutput();
    const { exitCode } = await runCheck([filePath]);
    expect(exitCode).toBe(0);
    expect(getStdout()).toBe('');
  });

  it('--json exits 0 with empty errors array for a valid file', async () => {
    const filePath = await writeTempFile(tempDir, 'valid.ion', VALID_SRC);
    const { getStdout } = captureOutput();
    const { exitCode } = await runCheck(['--json', filePath]);
    expect(exitCode).toBe(0);
    const out = JSON.parse(getStdout()) as { errorCount: number; errors: unknown[] };
    expect(out.errorCount).toBe(0);
    expect(out.errors).toHaveLength(0);
  });
});

describe('runCheck — parse error', () => {
  it('exits 1 and human output contains error[P prefix', async () => {
    const filePath = await writeTempFile(tempDir, 'parse-err.ion', PARSE_ERROR_SRC);
    const { getStdout } = captureOutput();
    const { exitCode } = await runCheck([filePath]);
    expect(exitCode).toBe(1);
    expect(getStdout()).toMatch(/error\[P/);
  });
});

describe('runCheck — bind error', () => {
  it('exits 1 and output contains error[B0001]', async () => {
    const filePath = await writeTempFile(tempDir, 'bind-err.ion', BIND_ERROR_SRC);
    const { getStdout } = captureOutput();
    const { exitCode } = await runCheck([filePath]);
    expect(exitCode).toBe(1);
    expect(getStdout()).toContain('error[B0001]');
  });
});

describe('runCheck — type error', () => {
  it('exits 1 and output contains error[E0401]', async () => {
    const filePath = await writeTempFile(tempDir, 'type-err.ion', TYPE_ERROR_SRC);
    const { getStdout } = captureOutput();
    const { exitCode } = await runCheck([filePath]);
    expect(exitCode).toBe(1);
    expect(getStdout()).toContain('error[E0401]');
  });
});

describe('runCheck — multiple files', () => {
  it('aggregates errors across all files', async () => {
    const f1 = await writeTempFile(tempDir, 'bind.ion', BIND_ERROR_SRC);
    const f2 = await writeTempFile(tempDir, 'type.ion', TYPE_ERROR_SRC);
    const { getStdout } = captureOutput();
    const { exitCode } = await runCheck([f1, f2]);
    expect(exitCode).toBe(1);
    const out = getStdout();
    expect(out).toContain('error[B0001]');
    expect(out).toContain('error[E0401]');
  });

  it('multi-file all-clean exits 0', async () => {
    const f1 = await writeTempFile(tempDir, 'a.ion', VALID_SRC);
    const f2 = await writeTempFile(tempDir, 'b.ion', VALID_SRC2);
    const { getStdout } = captureOutput();
    const { exitCode } = await runCheck([f1, f2]);
    expect(exitCode).toBe(0);
    expect(getStdout()).toBe('');
  });
});

describe('runCheck — --json flag', () => {
  it('outputs valid JSON with correct shape on error', async () => {
    const filePath = await writeTempFile(tempDir, 'type-err.ion', TYPE_ERROR_SRC);
    const { getStdout } = captureOutput();
    const { exitCode } = await runCheck(['--json', filePath]);
    expect(exitCode).toBe(1);
    const out = JSON.parse(getStdout()) as { errorCount: number; errors: unknown[] };
    expect(out.errorCount).toBeGreaterThan(0);
    expect(out.errors.length).toBe(out.errorCount);
    const first = out.errors[0] as Record<string, unknown>;
    expect(typeof first['file']).toBe('string');
    expect(typeof first['code']).toBe('string');
    expect(typeof first['message']).toBe('string');
    expect(first['span']).toBeDefined();
  });
});

describe('runCheck — --all flag', () => {
  it('scans cwd and finds .ion files', async () => {
    await writeTempFile(tempDir, 'a.ion', VALID_SRC);
    await writeTempFile(tempDir, 'b.ion', VALID_SRC2);
    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const { getStdout } = captureOutput();
      const { exitCode } = await runCheck(['--all']);
      expect(exitCode).toBe(0);
      expect(getStdout()).toBe('');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('--all with no .ion files exits 0 with a warning', async () => {
    const emptyDir = await makeTempDir();
    const origCwd = process.cwd();
    try {
      process.chdir(emptyDir);
      const { getStdout } = captureOutput();
      const { exitCode } = await runCheck(['--all']);
      expect(exitCode).toBe(0);
      expect(getStdout()).toContain('warning');
    } finally {
      process.chdir(origCwd);
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('runCheck — argument errors', () => {
  it('exits 2 when --all and explicit files are both provided', async () => {
    const filePath = await writeTempFile(tempDir, 'a.ion', VALID_SRC);
    const { getStderr } = captureOutput();
    const { exitCode } = await runCheck(['--all', filePath]);
    expect(exitCode).toBe(2);
    expect(getStderr()).toContain('error');
  });

  it('exits 2 when no files and no --all', async () => {
    const { getStderr } = captureOutput();
    const { exitCode } = await runCheck([]);
    expect(exitCode).toBe(2);
    expect(getStderr()).toContain('error');
  });

  it('exits 2 for an unknown flag', async () => {
    const { getStderr } = captureOutput();
    const { exitCode } = await runCheck(['--unknown-flag']);
    expect(exitCode).toBe(2);
    expect(getStderr()).toContain('unknown flag');
  });
});

describe('runCheck — I/O error', () => {
  it('exits 2 when a file does not exist', async () => {
    const { getStderr } = captureOutput();
    const { exitCode } = await runCheck([join(tempDir, 'nonexistent.ion')]);
    expect(exitCode).toBe(2);
    expect(getStderr()).toContain('error');
  });
});
