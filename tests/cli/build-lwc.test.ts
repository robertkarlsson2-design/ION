import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
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

function strLit(value: string): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Str', value }, span: SPAN, type: { kind: 'Str' } };
}

function intLit(value: number): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Int', value }, span: SPAN, type: { kind: 'Int' } };
}

function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}

function appNode(tag: string, attrStr: string, ...children: IonIRNode[]): IonIRNode {
  return { kind: 'App', callee: varNode(tag), args: [strLit(attrStr), ...children], span: SPAN, type: UNIT };
}

function makeLwcModule(): IonIRModule {
  const divApp = appNode('div', 'class=container', strLit('Hello LWC!'));
  return {
    ionir: '1.0',
    module: 'sample-lwc',
    version: '0.0.0',
    dialects: [],
    imports: [],
    data: [],
    decls: [
      {
        kind: 'Let',
        name: 'page',
        symbolId: SYM,
        bindingType: { kind: 'Never' },
        value: divApp,
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

describe('runBuild — lwc target (multi-file bundle)', () => {
  let tmpDir: string;
  let srcDir: string;
  let outDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-lwc-build-test-'));
    srcDir = join(tmpDir, 'src');
    outDir = join(tmpDir, 'out');
    configPath = join(tmpDir, 'ion.config.json');
    await mkdir(srcDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('compiles wire-format .ion to a 4-file LWC bundle directory', async () => {
    const wire = encodeModule(makeLwcModule());
    await writeFile(join(srcDir, 'app.ion'), wire, 'utf-8');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'lwc',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    // Bundle directory should exist as a directory (not a single .lwc file)
    const bundleDir = join(outDir, 'app');
    const dirStat = await stat(bundleDir);
    expect(dirStat.isDirectory()).toBe(true);

    // All four LWC files should be present.
    const html = await readFile(join(bundleDir, 'app.html'), 'utf-8');
    const js = await readFile(join(bundleDir, 'app.js'), 'utf-8');
    const css = await readFile(join(bundleDir, 'app.css'), 'utf-8');
    const meta = await readFile(join(bundleDir, 'app.js-meta.xml'), 'utf-8');

    expect(html).toContain('<template>');
    expect(html).toContain('</template>');
    expect(typeof js).toBe('string');
    expect(typeof css).toBe('string');
    expect(meta).toContain('<?xml');
    expect(meta).toContain('LightningComponentBundle');
  });

  it('--target lwc overrides config target', async () => {
    const wire = encodeModule(makeLwcModule());
    await writeFile(join(srcDir, 'app.ion'), wire, 'utf-8');
    await writeFile(configPath, JSON.stringify({
      version: '1',
      target: 'javascript',
      outDir: 'out',
      rootDir: 'src',
    }), 'utf-8');

    const result = await runBuild(['--config', configPath, '--target', 'lwc', '--no-sourcemap']);
    expect(result.exitCode).toBe(0);

    const htmlExists = await readFile(join(outDir, 'app', 'app.html'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(htmlExists).toBe(true);

    const jsAtRootExists = await readFile(join(outDir, 'app.js'), 'utf-8')
      .then(() => true)
      .catch(() => false);
    expect(jsAtRootExists).toBe(false);
  });
});
