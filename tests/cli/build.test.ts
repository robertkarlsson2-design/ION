import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/cli/config.js';
import { resolveOutputPath, runBuild } from '../../src/cli/build.js';

// ---------------------------------------------------------------------------
// resolveOutputPath
// ---------------------------------------------------------------------------

describe('resolveOutputPath', () => {
  it('replaces .ion extension with target extension', () => {
    const result = resolveOutputPath(
      '/project/src/foo.ion',
      '/project/src',
      '/project/out',
      '.js',
    );
    expect(result).toBe(join('/project/out', 'foo.js'));
  });

  it('preserves subdirectory structure', () => {
    const result = resolveOutputPath(
      '/project/src/a/b/c.ion',
      '/project/src',
      '/project/out',
      '.js',
    );
    expect(result).toBe(join('/project/out', 'a', 'b', 'c.js'));
  });

  it('works with .ts extension', () => {
    const result = resolveOutputPath(
      '/project/src/util.ion',
      '/project/src',
      '/project/dist',
      '.ts',
    );
    expect(result).toBe(join('/project/dist', 'util.ts'));
  });

  it('handles rootDir equal to ionPath directory', () => {
    const result = resolveOutputPath(
      '/project/main.ion',
      '/project',
      '/out',
      '.js',
    );
    expect(result).toBe(join('/out', 'main.js'));
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-config-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('parses a valid config', async () => {
    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'dist',
      rootDir: 'src',
    }), 'utf-8');

    const result = await loadConfig(configPath);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.version).toBe('1');
      expect(result.target).toBe('javascript');
      expect(result.outDir).toBe('dist');
      expect(result.rootDir).toBe('src');
    }
  });

  it('parses optional fields', async () => {
    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'dist',
      rootDir: 'src',
      wireFormat: true,
      plugins: ['myplugin'],
      include: ['**/*.ion'],
      exclude: ['**/*.test.ion'],
      sourceMap: false,
    }), 'utf-8');

    const result = await loadConfig(configPath);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.wireFormat).toBe(true);
      expect(result.plugins).toEqual(['myplugin']);
      expect(result.include).toEqual(['**/*.ion']);
      expect(result.exclude).toEqual(['**/*.test.ion']);
      expect(result.sourceMap).toBe(false);
    }
  });

  it('returns error for missing target field', async () => {
    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      outDir: 'dist',
      rootDir: 'src',
    }), 'utf-8');

    const result = await loadConfig(configPath);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('"target"');
    }
  });

  it('returns error for wrong version', async () => {
    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '2',
      target: 'javascript',
      outDir: 'dist',
      rootDir: 'src',
    }), 'utf-8');

    const result = await loadConfig(configPath);
    expect('error' in result).toBe(true);
  });

  it('returns error for invalid JSON', async () => {
    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, '{ not valid json }', 'utf-8');

    const result = await loadConfig(configPath);
    expect('error' in result).toBe(true);
  });

  it('returns error for non-existent file', async () => {
    const result = await loadConfig(join(tmpDir, 'nonexistent.json'));
    expect('error' in result).toBe(true);
  });

  it('unknown target is allowed (not validated at load time)', async () => {
    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'rust',
      outDir: 'dist',
      rootDir: 'src',
    }), 'utf-8');

    const result = await loadConfig(configPath);
    expect('error' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runBuild — argument parsing errors
// ---------------------------------------------------------------------------

describe('runBuild arg parsing', () => {
  it('returns exitCode 2 for unknown flag', async () => {
    const result = await runBuild(['--unknown-flag']);
    expect(result.exitCode).toBe(2);
  });

  it('returns exitCode 2 when --config is missing its argument', async () => {
    const result = await runBuild(['--config']);
    expect(result.exitCode).toBe(2);
  });

  it('returns exitCode 2 when --target is missing its argument', async () => {
    const result = await runBuild(['--target']);
    expect(result.exitCode).toBe(2);
  });

  it('returns exitCode 2 when config file does not exist', async () => {
    const result = await runBuild(['--config', '/nonexistent/ion.config.json']);
    expect(result.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runBuild — end-to-end integration
// ---------------------------------------------------------------------------

describe('runBuild integration', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-build-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('compiles a minimal .ion file and writes a .js output', async () => {
    const srcDir = join(tmpDir, 'src');
    const outDir = join(tmpDir, 'out');
    await mkdir(srcDir);

    await writeFile(join(srcDir, 'hello.ion'), 'fn id(x: Int) -> Int = x\n', 'utf-8');

    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const output = await readFile(join(outDir, 'hello.js'), 'utf-8');
    expect(output).toContain('"use strict";');
  });

  it('excludes *.test.ion files by default', async () => {
    const srcDir = join(tmpDir, 'src');
    const outDir = join(tmpDir, 'out');
    await mkdir(srcDir);

    await writeFile(join(srcDir, 'main.ion'), 'fn id(x: Int) -> Int = x\n', 'utf-8');
    await writeFile(join(srcDir, 'main.test.ion'), 'fn t(x: Int) -> Int = x\n', 'utf-8');

    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    await runBuild(['--config', configPath, '--no-sourcemap']);

    const mainExists = await readFile(join(outDir, 'main.js'), 'utf-8').then(() => true).catch(() => false);
    const testExists = await readFile(join(outDir, 'main.test.js'), 'utf-8').then(() => true).catch(() => false);

    expect(mainExists).toBe(true);
    expect(testExists).toBe(false);
  });

  it('returns exitCode 1 when a .ion file has a parse error', async () => {
    const srcDir = join(tmpDir, 'src');
    await mkdir(srcDir);

    await writeFile(join(srcDir, 'bad.ion'), 'fn ((( broken syntax\n', 'utf-8');

    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(1);
  });

  it('returns exitCode 2 for unsupported target', async () => {
    const srcDir = join(tmpDir, 'src');
    await mkdir(srcDir);

    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'cobol',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath]);
    expect(result.exitCode).toBe(2);
  });

  it('writes source map file when --no-sourcemap is not set', async () => {
    const srcDir = join(tmpDir, 'src');
    const outDir = join(tmpDir, 'out');
    await mkdir(srcDir);

    await writeFile(join(srcDir, 'fn.ion'), 'fn id(x: Int) -> Int = x\n', 'utf-8');

    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    await runBuild(['--config', configPath]);

    const mapExists = await readFile(join(outDir, 'fn.js.map'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(mapExists).toBe(true);

    const jsContent = await readFile(join(outDir, 'fn.js'), 'utf-8');
    expect(jsContent).toContain('sourceMappingURL=fn.js.map');
  });

  it('--target flag overrides config target', async () => {
    const srcDir = join(tmpDir, 'src');
    await mkdir(srcDir);

    const configPath = join(tmpDir, 'ion.config.json');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'cobol',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    // Override with a supported target
    const result = await runBuild(['--config', configPath, '--target', 'javascript', '--no-sourcemap']);
    // No .ion files so it should succeed with 0
    expect(result.exitCode).toBe(0);
  });
});
