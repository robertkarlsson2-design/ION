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
// Fixture helpers
// ---------------------------------------------------------------------------

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const UNIT: IonType = { kind: 'Unit' };
const SYM = makeSymbolId('');

function strLit(value: string): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Str', value }, span: SPAN, type: { kind: 'Str' } };
}

function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}

function appNode(tag: string, attrStr: string, ...children: IonIRNode[]): IonIRNode {
  return { kind: 'App', callee: varNode(tag), args: [strLit(attrStr), ...children], span: SPAN, type: UNIT };
}

function makeHtmlModule(): IonIRModule {
  const divApp = appNode('div', 'class=app', appNode('h1', '', strLit('Hello from Ion!')));
  return {
    ionir: '1.0',
    module: 'sample-html',
    version: '0.0.0',
    dialects: [],
    imports: [],
    data: [],
    decls: [
      {
        kind: 'Let',
        name: 'App',
        symbolId: SYM,
        bindingType: { kind: 'Never' },
        value: divApp,
        body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span: SPAN, type: { kind: 'Int' } },
        span: SPAN,
        type: UNIT,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runBuild — html target', () => {
  let tmpDir: string;
  let srcDir: string;
  let outDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-html-build-test-'));
    srcDir = join(tmpDir, 'src');
    outDir = join(tmpDir, 'out');
    configPath = join(tmpDir, 'ion.config.json');
    await mkdir(srcDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('compiles wire-format .ion to .html and output contains <!DOCTYPE html>', async () => {
    const wire = encodeModule(makeHtmlModule());
    await writeFile(join(srcDir, 'app.ion'), wire, 'utf-8');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'html',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const output = await readFile(join(outDir, 'app.html'), 'utf-8');
    expect(output).toContain('<!DOCTYPE html>');
  }, 30000);

  it('returns exitCode 0 for target html from config file', async () => {
    const wire = encodeModule(makeHtmlModule());
    await writeFile(join(srcDir, 'app.ion'), wire, 'utf-8');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'html',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const htmlExists = await readFile(join(outDir, 'app.html'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(htmlExists).toBe(true);
  });

  it('--target html overrides config target', async () => {
    const wire = encodeModule(makeHtmlModule());
    await writeFile(join(srcDir, 'app.ion'), wire, 'utf-8');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--target', 'html', '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const htmlExists = await readFile(join(outDir, 'app.html'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(htmlExists).toBe(true);

    const jsExists = await readFile(join(outDir, 'app.js'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(jsExists).toBe(false);
  });
});
