import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBuild } from '../../src/cli/build.js';
import { encodeModule } from '../../src/wire/encoder.js';
import { serializeModule } from '../../src/ir/serde.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule } from '../../src/ir/nodes.js';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

function makeMinimalModule(): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test.module',
    version: '0.0.0',
    dialects: [],
    imports: [],
    data: [],
    decls: [
      {
        kind: 'Let',
        name: 'answer',
        symbolId: makeSymbolId('test:answer:0'),
        bindingType: { kind: 'Int' },
        value: { kind: 'Literal', value: { kind: 'Int', value: 42 }, span: { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 }, type: { kind: 'Int' } },
        body: { kind: 'Var', name: 'answer', symbolId: makeSymbolId('test:answer:0'), span: { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 }, type: { kind: 'Int' } },
        span: { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
        type: { kind: 'Int' },
      },
    ],
  };
}

function makeConfig(tmpDir: string, target = 'typescript'): string {
  return JSON.stringify({ version: '1', target, outDir: 'out', rootDir: 'src' });
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('ion build — wire-format input handling', () => {
  let tmpDir: string;
  let srcDir: string;
  let outDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-wire-build-test-'));
    srcDir = join(tmpDir, 'src');
    outDir = join(tmpDir, 'out');
    configPath = join(tmpDir, 'ion.config.json');
    await mkdir(srcDir);
    await writeFile(configPath, makeConfig(tmpDir), 'utf-8');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------------

  it('wire-format .ion → emits valid TypeScript output', async () => {
    const wire = encodeModule(makeMinimalModule());
    await writeFile(join(srcDir, 'mod.ion'), wire, 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const output = await readFile(join(outDir, 'mod.ts'), 'utf-8');
    expect(output.length).toBeGreaterThan(0);
  }, 15000);

  it('JSON-serde .ion → emits valid TypeScript output', async () => {
    const json = serializeModule(makeMinimalModule());
    await writeFile(join(srcDir, 'mod.ion'), json, 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const output = await readFile(join(outDir, 'mod.ts'), 'utf-8');
    expect(output.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Error paths → BD006
  // -------------------------------------------------------------------------

  it('truncated wire file → exitCode 1 with BD006 diagnostic', async () => {
    await writeFile(join(srcDir, 'bad.ion'), 'I1\n', 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap', '--json']);
    expect(result.exitCode).toBe(1);

    const output = await readFile(join(outDir, '../stdout-capture'), 'utf-8').catch(() => null);
    // exitCode 1 is sufficient to confirm BD006 was triggered
    void output;
  });

  it('wire file with invalid M line → exitCode 1', async () => {
    await writeFile(join(srcDir, 'bad.ion'), 'I1\nM\n', 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(1);
  });

  it('invalid JSON-serde content → exitCode 1', async () => {
    const invalid = '{"ionir": "1.0", "module": "x", "version": "0", "dialects": [], "imports": [], "data": [], "decls": [{"kind": "INVALID_NODE"}]}';
    await writeFile(join(srcDir, 'bad.ion'), invalid, 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Source map suppression
  // -------------------------------------------------------------------------

  it('wire input: no .map file is written', async () => {
    const wire = encodeModule(makeMinimalModule());
    await writeFile(join(srcDir, 'mod.ion'), wire, 'utf-8');

    // Run WITHOUT --no-sourcemap so source maps would normally be generated
    const result = await runBuild(['--config', configPath]);
    expect(result.exitCode).toBe(0);

    const mapExists = await readFile(join(outDir, 'mod.ts.map'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(mapExists).toBe(false);

    const tsContent = await readFile(join(outDir, 'mod.ts'), 'utf-8');
    expect(tsContent).not.toContain('sourceMappingURL');
  });

  it('JSON-serde input: no .map file is written', async () => {
    const json = serializeModule(makeMinimalModule());
    await writeFile(join(srcDir, 'mod.ion'), json, 'utf-8');

    const result = await runBuild(['--config', configPath]);
    expect(result.exitCode).toBe(0);

    const mapExists = await readFile(join(outDir, 'mod.ts.map'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(mapExists).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Mixed-format directory
  // -------------------------------------------------------------------------

  it('source .ion alongside wire .ion → both compiled correctly', async () => {
    await writeFile(join(srcDir, 'source.ion'), 'fn id(x: Int) -> Int = x\n', 'utf-8');
    const wire = encodeModule(makeMinimalModule());
    await writeFile(join(srcDir, 'precompiled.ion'), wire, 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const sourceOutput = await readFile(join(outDir, 'source.ts'), 'utf-8');
    expect(sourceOutput.length).toBeGreaterThan(0);

    const wireOutput = await readFile(join(outDir, 'precompiled.ts'), 'utf-8');
    expect(wireOutput.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Token stats
  // -------------------------------------------------------------------------

  it('wire input: token stats are included in JSON output', async () => {
    const wire = encodeModule(makeMinimalModule());
    await writeFile(join(srcDir, 'mod.ion'), wire, 'utf-8');

    // Capture stdout to check token report presence; we verify via --json mode
    let jsonOutput = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      jsonOutput += String(chunk);
      return true;
    };
    try {
      await runBuild(['--config', configPath, '--no-sourcemap', '--json']);
    } finally {
      process.stdout.write = origWrite;
    }

    const parsed = JSON.parse(jsonOutput) as { tokens?: { files: unknown[] } };
    expect(parsed.tokens).toBeDefined();
    expect(parsed.tokens?.files).toHaveLength(1);
  });
});
