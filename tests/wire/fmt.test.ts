import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runFmt } from '../../src/cli/fmt.js';
import { serializeModule } from '../../src/ir/serde.js';
import { encodeModule } from '../../src/wire/encoder.js';
import { prettyPrintModule } from '../../src/wire/pretty.js';
import { makeSymbolId } from '../../src/types.js';
import type { IonIRModule } from '../../src/ir/nodes.js';
import type { Span } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 1 };
const sid = makeSymbolId('fmt:x:0');

const minimalModule: IonIRModule = {
  ionir: '1.0',
  module: 'org.example',
  version: '0.1.0',
  dialects: ['core'],
  imports: [],
  data: [],
  decls: [{ kind: 'Var', name: 'x', symbolId: sid, span, type: { kind: 'Int' } }],
};

let tmpDir: string | null = null;

async function makeTmp(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), 'ion-fmt-test-'));
  return tmpDir;
}

async function writeTmp(dir: string, name: string, content: string): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tmpDir !== null) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

// ---------------------------------------------------------------------------
// F1 — --pretty rewrites JSON IR to surface syntax
// ---------------------------------------------------------------------------

describe('runFmt --pretty', () => {
  it('F1: rewrites a JSON IR file to surface syntax containing "module"', async () => {
    const dir = await makeTmp();
    const filePath = await writeTmp(dir, 'a.ion', serializeModule(minimalModule));
    const result = await runFmt(['--pretty', filePath]);
    expect(result.exitCode).toBe(0);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('module org.example');
  });
});

// ---------------------------------------------------------------------------
// F2 — --wire rewrites JSON IR to wire format
// ---------------------------------------------------------------------------

describe('runFmt --wire', () => {
  it('F2: rewrites a JSON IR file to wire format starting with "I1"', async () => {
    const dir = await makeTmp();
    const filePath = await writeTmp(dir, 'b.ion', serializeModule(minimalModule));
    const result = await runFmt(['--wire', filePath]);
    expect(result.exitCode).toBe(0);
    const content = await readFile(filePath, 'utf-8');
    expect(content.startsWith('I1\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F3 — mutually exclusive mode flags produce exit 2
// ---------------------------------------------------------------------------

describe('runFmt mutually exclusive flags', () => {
  it('F3: combining --pretty and --wire returns exit 2', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runFmt(['--pretty', '--wire', 'some.ion']);
    expect(result.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F4 — --check exits 1 when file is not canonical and does not write
// ---------------------------------------------------------------------------

describe('runFmt --check non-canonical', () => {
  it('F4: exits 1 on unformatted JSON, does not modify the file', async () => {
    const dir = await makeTmp();
    const rawJson = serializeModule(minimalModule);
    const filePath = await writeTmp(dir, 'd.ion', rawJson);
    const chunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const result = await runFmt(['--check', filePath]);
    expect(result.exitCode).toBe(1);
    // File must not have been modified
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe(rawJson);
    // Filename should be printed
    const output = chunks.join('');
    expect(output).toContain('d.ion');
  });
});

// ---------------------------------------------------------------------------
// F5 — multiple files are all formatted
// ---------------------------------------------------------------------------

describe('runFmt multiple files', () => {
  it('F5: formats two files in a single call', async () => {
    const dir = await makeTmp();
    const file1 = await writeTmp(dir, 'e1.ion', serializeModule(minimalModule));
    const file2 = await writeTmp(dir, 'e2.ion', serializeModule(minimalModule));
    const result = await runFmt(['--pretty', file1, file2]);
    expect(result.exitCode).toBe(0);
    const c1 = await readFile(file1, 'utf-8');
    const c2 = await readFile(file2, 'utf-8');
    expect(c1).toContain('module org.example');
    expect(c2).toContain('module org.example');
  });
});

// ---------------------------------------------------------------------------
// F6 — no files → exit 2
// ---------------------------------------------------------------------------

describe('runFmt no files', () => {
  it('F6: exits 2 when no file paths are provided', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runFmt(['--pretty']);
    expect(result.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F7 — unknown flag → exit 2
// ---------------------------------------------------------------------------

describe('runFmt unknown flag', () => {
  it('F7: exits 2 on an unknown flag', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runFmt(['--foo', 'file.ion']);
    expect(result.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F8 — unreadable file → exit 1
// ---------------------------------------------------------------------------

describe('runFmt unreadable file', () => {
  it('F8: exits 1 when the file path does not exist', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runFmt(['/nonexistent/path/does-not-exist.ion']);
    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F9 — --pretty on already-formatted output does not overwrite when deserialization fails
// ---------------------------------------------------------------------------

describe('runFmt --pretty on already-formatted file', () => {
  it('F9: --pretty on already-formatted output does not overwrite when deserialization fails', async () => {
    const dir = await makeTmp();
    const filePath = await writeTmp(dir, 'f.ion', serializeModule(minimalModule));
    const first = await runFmt(['--pretty', filePath]);
    expect(first.exitCode).toBe(0);
    const after1 = await readFile(filePath, 'utf-8');
    // Second pass: file now contains surface syntax, not JSON → deserialization fails
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const second = await runFmt(['--pretty', filePath]);
    expect(second.exitCode).toBe(1);
    const after2 = await readFile(filePath, 'utf-8');
    // Deserialization failure must not corrupt the file
    expect(after2).toBe(after1);
  });
});

// ---------------------------------------------------------------------------
// F10 — --wire first pass produces expected wire encoding; second pass succeeds
// ---------------------------------------------------------------------------

describe('runFmt --wire first pass encoding', () => {
  it('F10: first pass produces expected wire encoding; second pass on wire input exits 0', async () => {
    const dir = await makeTmp();
    const filePath = await writeTmp(dir, 'g.ion', serializeModule(minimalModule));
    const first = await runFmt(['--wire', filePath]);
    expect(first.exitCode).toBe(0);
    const wireContent = await readFile(filePath, 'utf-8');
    const expected = encodeModule(minimalModule);
    expect(wireContent).toBe(expected);
    // Second pass: wire input is now supported via decodeModule → exit 0.
    const second = await runFmt(['--wire', filePath]);
    expect(second.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F11 — --check on a file already in canonical pretty form exits 0
// ---------------------------------------------------------------------------

describe('runFmt --check on already-pretty file', () => {
  it('F11: exits 0 when file was previously formatted with --pretty (surface syntax)', async () => {
    const dir = await makeTmp();
    const filePath = await writeTmp(dir, 'h.ion', serializeModule(minimalModule));
    // First: convert to pretty (surface syntax)
    const first = await runFmt(['--pretty', filePath]);
    expect(first.exitCode).toBe(0);
    const prettyContent = await readFile(filePath, 'utf-8');
    expect(prettyContent.startsWith('module ')).toBe(true);
    // Second: --check on the now-surface-syntax file must exit 0
    const chunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const result = await runFmt(['--check', filePath]);
    expect(result.exitCode).toBe(0);
    expect(chunks.join('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// F12 — --check on a canonically-encoded wire file exits 0
// ---------------------------------------------------------------------------

describe('runFmt --check on canonical wire file', () => {
  it('F12: --check exits 0 when a wire file is already in canonical form', async () => {
    const dir = await makeTmp();
    // Start from JSON, encode to wire.
    const filePath = await writeTmp(dir, 'i.ion', serializeModule(minimalModule));
    await runFmt(['--wire', filePath]);
    // Second --wire pass encodes from wire → same output → no change.
    await runFmt(['--wire', filePath]);
    // --check should now exit 0 (file is already canonical).
    const check = await runFmt(['--check', filePath]);
    expect(check.exitCode).toBe(0);
  });
});
