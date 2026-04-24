import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  parseArgs,
  loadConfig,
  compileFile,
  buildOnce,
  runBuild,
} from '../../src/cli/build.js';
import type { IonConfig } from '../../src/cli/build.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ion-build-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeTempFile(dir: string, name: string, content: string): Promise<string> {
  const parts = name.split('/');
  if (parts.length > 1) {
    await mkdir(join(dir, ...parts.slice(0, -1)), { recursive: true });
  }
  const filePath = join(dir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

async function writeConfig(dir: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(join(dir, 'ion.config.json'), JSON.stringify(config), 'utf-8');
}

function captureOutput(): { getStdout: () => string; getStderr: () => string } {
  let stdoutBuf = '';
  let stderrBuf = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderrBuf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  });
  return {
    getStdout: () => stdoutBuf,
    getStderr: () => stderrBuf,
  };
}

// ---------------------------------------------------------------------------
// Ion source fixtures
// ---------------------------------------------------------------------------

const VALID_SRC = 'fn add(a: Int, b: Int) -> Int = a + b\n';
const VALID_SRC2 = 'fn mul(a: Int, b: Int) -> Int = a * b\n';
const PARSE_ERROR_SRC = 'fn bad(\n';
const BIND_ERROR_SRC = 'fn foo(x: Int) -> Int = undeclaredName\n';
const TYPE_ERROR_SRC = 'fn bad(x: Int) -> Str = x\n';

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
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs — happy paths', () => {
  it('returns defaults with no args', () => {
    const result = parseArgs([]);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.target).toBeNull();
    expect(result.watch).toBe(false);
    expect(result.noSourcemap).toBe(false);
    expect(result.configPath).toContain('ion.config.json');
  });

  it('parses --target javascript', () => {
    const result = parseArgs(['--target', 'javascript']);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.target).toBe('javascript');
  });

  it('parses --watch', () => {
    const result = parseArgs(['--watch']);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.watch).toBe(true);
  });

  it('parses --no-sourcemap', () => {
    const result = parseArgs(['--no-sourcemap']);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.noSourcemap).toBe(true);
  });

  it('parses all flags together', () => {
    const result = parseArgs(['--target', 'javascript', '--watch', '--no-sourcemap']);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.target).toBe('javascript');
    expect(result.watch).toBe(true);
    expect(result.noSourcemap).toBe(true);
  });
});

describe('parseArgs — errors', () => {
  it('rejects unknown flags', () => {
    const result = parseArgs(['--unknown-flag']);
    expect('error' in result).toBe(true);
  });

  it('rejects positional arguments', () => {
    const result = parseArgs(['src/foo.ion']);
    expect('error' in result).toBe(true);
  });

  it('rejects --target without a value', () => {
    const result = parseArgs(['--target']);
    expect('error' in result).toBe(true);
  });

  it('rejects --target followed immediately by another flag', () => {
    const result = parseArgs(['--target', '--watch']);
    expect('error' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig — valid config', () => {
  it('loads minimal config with only target', async () => {
    await writeConfig(tempDir, { target: 'javascript' });
    const result = await loadConfig(join(tempDir, 'ion.config.json'), null);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.target).toBe('javascript');
    expect(result.sources).toEqual(['**/*.ion']);
    expect(result.outDir).toBe('out');
    expect(result.version).toBe('0.0.0');
  });

  it('loads config with all fields', async () => {
    await writeConfig(tempDir, {
      target: 'javascript',
      sources: ['src/**/*.ion'],
      outDir: 'build',
      version: '1.2.3',
    });
    const result = await loadConfig(join(tempDir, 'ion.config.json'), null);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.sources).toEqual(['src/**/*.ion']);
    expect(result.outDir).toBe('build');
    expect(result.version).toBe('1.2.3');
  });

  it('applies targetOverride over config target', async () => {
    await writeConfig(tempDir, { target: 'javascript' });
    const result = await loadConfig(join(tempDir, 'ion.config.json'), 'javascript');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.target).toBe('javascript');
  });
});

describe('loadConfig — errors', () => {
  it('returns error when file is missing', async () => {
    const result = await loadConfig(join(tempDir, 'ion.config.json'), null);
    expect('error' in result).toBe(true);
  });

  it('returns error for invalid JSON', async () => {
    await writeFile(join(tempDir, 'ion.config.json'), 'not json', 'utf-8');
    const result = await loadConfig(join(tempDir, 'ion.config.json'), null);
    expect('error' in result).toBe(true);
  });

  it('returns error when target is missing', async () => {
    await writeConfig(tempDir, { outDir: 'out' });
    const result = await loadConfig(join(tempDir, 'ion.config.json'), null);
    expect('error' in result).toBe(true);
  });

  it('returns error for unsupported target', async () => {
    await writeConfig(tempDir, { target: 'cobol' });
    const result = await loadConfig(join(tempDir, 'ion.config.json'), null);
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toContain('cobol');
  });

  it('returns error when sources is not an array', async () => {
    await writeConfig(tempDir, { target: 'javascript', sources: 'bad' });
    const result = await loadConfig(join(tempDir, 'ion.config.json'), null);
    expect('error' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compileFile
// ---------------------------------------------------------------------------

describe('compileFile — clean file', () => {
  it('writes .js output for a valid ion file', async () => {
    const config: IonConfig = {
      target: 'javascript',
      sources: ['**/*.ion'],
      outDir: 'out',
      version: '0.0.0',
    };
    const inputPath = await writeTempFile(tempDir, 'add.ion', VALID_SRC);
    const result = await compileFile(inputPath, config, tempDir, true);
    expect('ioError' in result).toBe(false);
    expect('diagnostics' in result).toBe(false);
    if ('ioError' in result || 'diagnostics' in result) return;
    expect(result.outputPath).toContain('out');
    expect(result.outputPath).toMatch(/\.js$/);
    const js = await readFile(result.outputPath, 'utf-8');
    expect(js.length).toBeGreaterThan(0);
  });

  it('writes .js.map file when noSourcemap is false', async () => {
    const config: IonConfig = {
      target: 'javascript',
      sources: ['**/*.ion'],
      outDir: 'out',
      version: '0.0.0',
    };
    const inputPath = await writeTempFile(tempDir, 'add.ion', VALID_SRC);
    const result = await compileFile(inputPath, config, tempDir, false);
    if ('ioError' in result || 'diagnostics' in result) {
      expect.fail('expected CompileSuccess');
      return;
    }
    expect(result.mapPath).not.toBeNull();
    expect(result.mapPath).toMatch(/\.js\.map$/);
    const map = await readFile(result.mapPath!, 'utf-8');
    expect(() => JSON.parse(map)).not.toThrow();
  });

  it('does not write .js.map when noSourcemap is true', async () => {
    const config: IonConfig = {
      target: 'javascript',
      sources: ['**/*.ion'],
      outDir: 'out',
      version: '0.0.0',
    };
    const inputPath = await writeTempFile(tempDir, 'add.ion', VALID_SRC);
    const result = await compileFile(inputPath, config, tempDir, true);
    if ('ioError' in result || 'diagnostics' in result) {
      expect.fail('expected CompileSuccess');
      return;
    }
    expect(result.mapPath).toBeNull();
  });
});

describe('compileFile — ion files with errors', () => {
  it('returns CompileDiagnostics for a parse error', async () => {
    const config: IonConfig = {
      target: 'javascript',
      sources: ['**/*.ion'],
      outDir: 'out',
      version: '0.0.0',
    };
    const inputPath = await writeTempFile(tempDir, 'bad.ion', PARSE_ERROR_SRC);
    const result = await compileFile(inputPath, config, tempDir, true);
    expect('diagnostics' in result).toBe(true);
    if (!('diagnostics' in result)) return;
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('returns CompileDiagnostics for a bind error', async () => {
    const config: IonConfig = {
      target: 'javascript',
      sources: ['**/*.ion'],
      outDir: 'out',
      version: '0.0.0',
    };
    const inputPath = await writeTempFile(tempDir, 'bind.ion', BIND_ERROR_SRC);
    const result = await compileFile(inputPath, config, tempDir, true);
    expect('diagnostics' in result).toBe(true);
    if (!('diagnostics' in result)) return;
    expect(result.diagnostics.some(d => d.code === 'B0001')).toBe(true);
  });

  it('returns CompileDiagnostics for a type error', async () => {
    const config: IonConfig = {
      target: 'javascript',
      sources: ['**/*.ion'],
      outDir: 'out',
      version: '0.0.0',
    };
    const inputPath = await writeTempFile(tempDir, 'type.ion', TYPE_ERROR_SRC);
    const result = await compileFile(inputPath, config, tempDir, true);
    expect('diagnostics' in result).toBe(true);
    if (!('diagnostics' in result)) return;
    expect(result.diagnostics.some(d => d.code === 'E0401')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildOnce
// ---------------------------------------------------------------------------

describe('buildOnce', () => {
  it('compiles multiple files in parallel and writes all outputs', async () => {
    const config: IonConfig = {
      target: 'javascript',
      sources: ['**/*.ion'],
      outDir: 'out',
      version: '0.0.0',
    };
    await writeTempFile(tempDir, 'a.ion', VALID_SRC);
    await writeTempFile(tempDir, 'b.ion', VALID_SRC2);
    captureOutput();
    const { hadErrors } = await buildOnce(
      [join(tempDir, 'a.ion'), join(tempDir, 'b.ion')],
      config,
      tempDir,
      true,
    );
    expect(hadErrors).toBe(false);
    const jsA = await readFile(join(tempDir, 'out', 'a.js'), 'utf-8');
    const jsB = await readFile(join(tempDir, 'out', 'b.js'), 'utf-8');
    expect(jsA.length).toBeGreaterThan(0);
    expect(jsB.length).toBeGreaterThan(0);
  });

  it('returns hadErrors true when a file has errors', async () => {
    const config: IonConfig = {
      target: 'javascript',
      sources: ['**/*.ion'],
      outDir: 'out',
      version: '0.0.0',
    };
    await writeTempFile(tempDir, 'good.ion', VALID_SRC);
    await writeTempFile(tempDir, 'bad.ion', BIND_ERROR_SRC);
    const { getStdout } = captureOutput();
    const { hadErrors } = await buildOnce(
      [join(tempDir, 'good.ion'), join(tempDir, 'bad.ion')],
      config,
      tempDir,
      true,
    );
    expect(hadErrors).toBe(true);
    expect(getStdout()).toContain('error[B0001]');
  });
});

// ---------------------------------------------------------------------------
// runBuild — end-to-end
// ---------------------------------------------------------------------------

describe('runBuild — no config', () => {
  it('exits 2 when ion.config.json is missing', async () => {
    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const { getStderr } = captureOutput();
      const { exitCode } = await runBuild([]);
      expect(exitCode).toBe(2);
      expect(getStderr()).toContain('error');
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe('runBuild — clean project', () => {
  it('exits 0 and writes JS output files', async () => {
    await writeConfig(tempDir, { target: 'javascript' });
    await writeTempFile(tempDir, 'src/main.ion', VALID_SRC);
    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const { getStdout } = captureOutput();
      const { exitCode } = await runBuild([]);
      expect(exitCode).toBe(0);
      const out = getStdout();
      expect(out).toContain('✓');
      const js = await readFile(join(tempDir, 'out', 'src', 'main.js'), 'utf-8');
      expect(js.length).toBeGreaterThan(0);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('exits 0 with --no-sourcemap, no .map files written', async () => {
    await writeConfig(tempDir, { target: 'javascript' });
    await writeTempFile(tempDir, 'main.ion', VALID_SRC);
    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      captureOutput();
      const { exitCode } = await runBuild(['--no-sourcemap']);
      expect(exitCode).toBe(0);
      // .js.map should not exist
      await expect(readFile(join(tempDir, 'out', 'main.js.map'), 'utf-8'))
        .rejects.toThrow();
    } finally {
      process.chdir(origCwd);
    }
  });

  it('exits 0 with --target javascript override', async () => {
    await writeConfig(tempDir, { target: 'javascript' });
    await writeTempFile(tempDir, 'add.ion', VALID_SRC);
    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      captureOutput();
      const { exitCode } = await runBuild(['--target', 'javascript']);
      expect(exitCode).toBe(0);
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe('runBuild — project with errors', () => {
  it('exits 1 when a file has compile errors', async () => {
    await writeConfig(tempDir, { target: 'javascript' });
    await writeTempFile(tempDir, 'bad.ion', BIND_ERROR_SRC);
    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const { getStdout } = captureOutput();
      const { exitCode } = await runBuild([]);
      expect(exitCode).toBe(1);
      expect(getStdout()).toContain('error[B0001]');
    } finally {
      process.chdir(origCwd);
    }
  });
});

describe('runBuild — argument errors', () => {
  it('exits 2 for unknown flag', async () => {
    const { getStderr } = captureOutput();
    const { exitCode } = await runBuild(['--unknown-flag']);
    expect(exitCode).toBe(2);
    expect(getStderr()).toContain('error');
  });

  it('exits 2 for positional argument', async () => {
    const { getStderr } = captureOutput();
    const { exitCode } = await runBuild(['src/foo.ion']);
    expect(exitCode).toBe(2);
    expect(getStderr()).toContain('error');
  });

  it('exits 0 with warning when no .ion files are found', async () => {
    await writeConfig(tempDir, { target: 'javascript' });
    const origCwd = process.cwd();
    try {
      process.chdir(tempDir);
      const { getStdout } = captureOutput();
      const { exitCode } = await runBuild([]);
      expect(exitCode).toBe(0);
      expect(getStdout()).toContain('warning');
    } finally {
      process.chdir(origCwd);
    }
  });
});
