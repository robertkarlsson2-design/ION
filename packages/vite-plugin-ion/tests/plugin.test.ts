import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeModule } from '../../../src/wire/encoder.js';
import { makeSymbolId } from '../../../src/types.js';
import type { IonIRModule, IonIRNode } from '../../../src/ir/nodes.js';
import type { IonType } from '../../../src/ir/types.js';
import ion from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture helpers (mirrored from tests/cli/build-react.test.ts)
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

function makeReactModule(): IonIRModule {
  const divApp = appNode('div', 'class=app', strLit('Hello from Ion!'));
  return {
    ionir: '1.0',
    module: 'sample-react',
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

describe('vite-plugin-ion', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ion-vite-plugin-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // resolveId tests
  // -------------------------------------------------------------------------

  describe('resolveId', () => {
    it('intercepts ./App.tsx when App.ion sibling exists', async () => {
      await writeFile(join(tmpDir, 'App.ion'), 'placeholder', 'utf-8');
      const plugin = ion();
      const importer = join(tmpDir, 'main.tsx');

      const result = (plugin.resolveId as Function).call({}, './App.tsx', importer);
      expect(result).toBe(`\0ion-virtual:${join(tmpDir, 'App.tsx')}`);
    });

    it('intercepts direct ./App.ion import', async () => {
      await writeFile(join(tmpDir, 'App.ion'), 'placeholder', 'utf-8');
      const plugin = ion();
      const importer = join(tmpDir, 'main.tsx');

      const result = (plugin.resolveId as Function).call({}, './App.ion', importer);
      expect(result).toBe(`\0ion-virtual:${join(tmpDir, 'App.tsx')}`);
    });

    it('intercepts extensionless ./App when App.ion exists', async () => {
      await writeFile(join(tmpDir, 'App.ion'), 'placeholder', 'utf-8');
      const plugin = ion();
      const importer = join(tmpDir, 'main.tsx');

      const result = (plugin.resolveId as Function).call({}, './App', importer);
      expect(result).toBe(`\0ion-virtual:${join(tmpDir, 'App.tsx')}`);
    });

    it('returns null when no .ion sibling exists', async () => {
      const plugin = ion();
      const importer = join(tmpDir, 'main.tsx');

      const result = (plugin.resolveId as Function).call({}, './App.tsx', importer);
      expect(result).toBeNull();
    });

    it('returns null for bare module specifiers', async () => {
      const plugin = ion();

      expect((plugin.resolveId as Function).call({}, 'react', undefined)).toBeNull();
      expect((plugin.resolveId as Function).call({}, 'vite', undefined)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // load tests
  // -------------------------------------------------------------------------

  describe('load', () => {
    it('returns null for non-virtual IDs', async () => {
      const plugin = ion();
      const result = await (plugin.load as Function).call(
        { error: (msg: string) => { throw new Error(msg); } },
        '/some/absolute/path/App.tsx',
      );
      expect(result).toBeNull();
    });

    it('compiles valid wire-format .ion and returns TSX code', async () => {
      const wire = encodeModule(makeReactModule());
      const ionPath = join(tmpDir, 'App.ion');
      await writeFile(ionPath, wire, 'utf-8');

      const plugin = ion();
      const virtualId = `\0ion-virtual:${join(tmpDir, 'App.tsx')}`;

      const result = await (plugin.load as Function).call(
        { error: (msg: string) => { throw new Error(msg); } },
        virtualId,
      );

      expect(result).not.toBeNull();
      expect(result.map).toBeNull();
      expect(result.code).toContain("import React from 'react'");
      expect(result.code).toContain('const App: React.FC');
    });

    it('calls this.error when .ion file contains invalid Ion source', async () => {
      const ionPath = join(tmpDir, 'Bad.ion');
      await writeFile(ionPath, 'this is not valid ion @@@@', 'utf-8');

      const plugin = ion();
      const virtualId = `\0ion-virtual:${join(tmpDir, 'Bad.tsx')}`;

      await expect(
        (plugin.load as Function).call(
          { error: (msg: string) => { throw new Error(msg); } },
          virtualId,
        ),
      ).rejects.toThrow();
    });
  });
});
