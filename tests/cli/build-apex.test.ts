import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBuild } from '../../src/cli/build.js';
import { encodeModule } from '../../src/wire/encoder.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';

// ---------------------------------------------------------------------------
// Fixture helpers — mirror tests/cli/build-react.test.ts
// ---------------------------------------------------------------------------

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const UNIT: IonType = { kind: 'Unit' };
const SYM = makeSymbolId('');

function intLit(value: number): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Int', value }, span: SPAN, type: { kind: 'Int' } };
}

function makeApexModule(): IonIRModule {
  // A minimal Apex-friendly module: empty decls, a meaningful module name.
  return {
    ionir: '1.0',
    module: 'task-manager',
    version: '0.0.0',
    dialects: [],
    imports: [],
    data: [],
    decls: [
      {
        kind: 'Let',
        name: 'noop',
        symbolId: SYM,
        bindingType: { kind: 'Never' },
        value: intLit(0),
        body: intLit(0),
        span: SPAN,
        type: UNIT,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runBuild — apex target', () => {
  let tmpDir: string;
  let srcDir: string;
  let outDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-apex-build-test-'));
    srcDir = join(tmpDir, 'src');
    outDir = join(tmpDir, 'out');
    configPath = join(tmpDir, 'ion.config.json');
    await mkdir(srcDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('compiles wire-format .ion to .cls with public class wrapper', async () => {
    const wire = encodeModule(makeApexModule());
    await writeFile(join(srcDir, 'task-manager.ion'), wire, 'utf-8');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'apex',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const output = await readFile(join(outDir, 'task-manager.cls'), 'utf-8');
    expect(output).toContain('public with sharing class');
    expect(output).toContain('TaskManagerController');
  });

  it('--target apex overrides config target', async () => {
    const wire = encodeModule(makeApexModule());
    await writeFile(join(srcDir, 'task-manager.ion'), wire, 'utf-8');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--target', 'apex', '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const clsExists = await readFile(join(outDir, 'task-manager.cls'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(clsExists).toBe(true);

    const jsExists = await readFile(join(outDir, 'task-manager.js'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(jsExists).toBe(false);
  });
});
