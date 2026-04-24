import { describe, it, expect } from 'vitest';
import { SourceMapBuilder } from '../../src/emit/sourcemap.js';
import type { SourceMapping } from '../../src/emit/sourcemap.js';

const ION_FILE = '/workspace/src/users.ion';
const ION_TEXT = 'let x = 42\nlet y = 99\n';

describe('SourceMapBuilder', () => {
  it('produces valid ECMA v3 JSON with version 3', () => {
    const builder = new SourceMapBuilder();
    builder.addMapping({
      generatedLine: 1,
      generatedCol: 0,
      sourceFile: ION_FILE,
      sourceLine: 0,
      sourceCol: 0,
    });
    const json = builder.toJSON({ file: 'users.js', sourceContents: new Map([[ION_FILE, ION_TEXT]]) });
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(3);
    expect(parsed.file).toBe('users.js');
    expect(typeof parsed.mappings).toBe('string');
    expect(Array.isArray(parsed.names)).toBe(true);
    expect(parsed.names).toHaveLength(0);
  });

  it('sources array contains unique ion file paths', () => {
    const builder = new SourceMapBuilder();
    builder.addMapping({ generatedLine: 0, generatedCol: 0, sourceFile: '/a.ion', sourceLine: 0, sourceCol: 0 });
    builder.addMapping({ generatedLine: 1, generatedCol: 0, sourceFile: '/b.ion', sourceLine: 0, sourceCol: 0 });
    builder.addMapping({ generatedLine: 2, generatedCol: 0, sourceFile: '/a.ion', sourceLine: 1, sourceCol: 0 });
    const parsed = JSON.parse(builder.toJSON({ file: 'out.js', sourceContents: new Map() }));
    expect(parsed.sources).toEqual(['/a.ion', '/b.ion']);
  });

  it('sourcesContent matches provided source text', () => {
    const builder = new SourceMapBuilder();
    builder.addMapping({ generatedLine: 1, generatedCol: 0, sourceFile: ION_FILE, sourceLine: 0, sourceCol: 0 });
    const contents = new Map([[ION_FILE, ION_TEXT]]);
    const parsed = JSON.parse(builder.toJSON({ file: 'users.js', sourceContents: contents }));
    expect(parsed.sourcesContent).toEqual([ION_TEXT]);
  });

  it('sourcesContent is null for files missing from sourceContents map', () => {
    const builder = new SourceMapBuilder();
    builder.addMapping({ generatedLine: 0, generatedCol: 0, sourceFile: '/missing.ion', sourceLine: 0, sourceCol: 0 });
    const parsed = JSON.parse(builder.toJSON({ file: 'out.js', sourceContents: new Map() }));
    expect(parsed.sourcesContent).toEqual([null]);
  });

  it('empty mappings produces mappings: "" and empty sources', () => {
    const builder = new SourceMapBuilder();
    const parsed = JSON.parse(builder.toJSON({ file: 'out.js', sourceContents: new Map() }));
    expect(parsed.mappings).toBe('');
    expect(parsed.sources).toEqual([]);
    expect(parsed.sourcesContent).toEqual([]);
  });

  it('is deterministic: same mappings in different insertion order produce identical VLQ after re-sort', () => {
    const m1: SourceMapping = { generatedLine: 0, generatedCol: 0, sourceFile: ION_FILE, sourceLine: 0, sourceCol: 0 };
    const m2: SourceMapping = { generatedLine: 0, generatedCol: 6, sourceFile: ION_FILE, sourceLine: 0, sourceCol: 4 };
    const m3: SourceMapping = { generatedLine: 1, generatedCol: 0, sourceFile: ION_FILE, sourceLine: 1, sourceCol: 0 };

    const b1 = new SourceMapBuilder();
    b1.addMapping(m1); b1.addMapping(m2); b1.addMapping(m3);

    const b2 = new SourceMapBuilder();
    b2.addMapping(m3); b2.addMapping(m2); b2.addMapping(m1);

    const contents = new Map([[ION_FILE, ION_TEXT]]);
    const j1 = JSON.parse(b1.toJSON({ file: 'out.js', sourceContents: contents }));
    const j2 = JSON.parse(b2.toJSON({ file: 'out.js', sourceContents: contents }));
    expect(j1.mappings).toBe(j2.mappings);
  });

  it('mappings string has correct number of line separators', () => {
    const builder = new SourceMapBuilder();
    // Two mappings on lines 0 and 2 (line 1 is empty)
    builder.addMapping({ generatedLine: 0, generatedCol: 0, sourceFile: ION_FILE, sourceLine: 0, sourceCol: 0 });
    builder.addMapping({ generatedLine: 2, generatedCol: 0, sourceFile: ION_FILE, sourceLine: 2, sourceCol: 0 });
    const parsed = JSON.parse(builder.toJSON({ file: 'out.js', sourceContents: new Map([[ION_FILE, ION_TEXT]]) }));
    // Lines 0, 1, 2 → two semicolons
    expect(parsed.mappings.split(';')).toHaveLength(3);
  });
});
