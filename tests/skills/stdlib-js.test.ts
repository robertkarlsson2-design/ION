import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import type { ExternBlockDeclNode, ExternBlockItemFn } from '../../src/parser/index.js';

const STDLIB_PATH = resolve(
  fileURLToPath(import.meta.url),
  '../../../skills/javascript/stdlib.ion',
);

function loadStdlib() {
  const source = readFileSync(STDLIB_PATH, 'utf-8');
  const tokens = lex(source, 'stdlib.ion');
  return parseModule(tokens);
}

describe('skills/javascript/stdlib.ion', () => {
  it('parses without errors', () => {
    expect(() => loadStdlib()).not.toThrow();
  });

  it('has exactly one top-level extern block', () => {
    const mod = loadStdlib();
    expect(mod.decls).toHaveLength(1);
    expect(mod.decls[0]?.kind).toBe('ExternBlockDecl');
  });

  it('has target "javascript"', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    expect(block.target).toBe('javascript');
  });

  it('contains at least 140 fn items', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    const fnItems = block.items.filter(i => i.kind === 'ExternBlockItemFn');
    expect(fnItems.length).toBeGreaterThanOrEqual(140);
  });

  it('contains at least 5 type items', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    const typeItems = block.items.filter(i => i.kind === 'ExternBlockItemType');
    expect(typeItems.length).toBeGreaterThanOrEqual(5);
  });

  it('total items >= 150', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    expect(block.items.length).toBeGreaterThanOrEqual(150);
  });

  it('contains specific required declarations', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    const names = new Set(block.items.map(i => i.name));

    const required = [
      'console_log', 'console_error',
      'push', 'pop', 'map', 'filter', 'reduce', 'forEach',
      'object_keys', 'object_values', 'object_entries',
      'promise_all', 'promise_resolve',
      'str_toUpperCase', 'str_toLowerCase', 'str_trim', 'str_split',
      'math_abs', 'math_floor', 'math_ceil', 'math_random',
      'json_stringify', 'json_parse',
      'fs_readFileSync', 'fs_writeFileSync', 'fs_existsSync',
      'path_join', 'path_dirname', 'path_basename',
      'number_isNaN', 'number_parseFloat',
    ];

    for (const name of required) {
      expect(names.has(name), `missing declaration: ${name}`).toBe(true);
    }
  });

  it('all fn items have non-empty names', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    for (const item of block.items) {
      expect(item.name.length, `item name must not be empty`).toBeGreaterThan(0);
    }
  });

  it('all fn item templates with params contain at least one $ placeholder', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    const fnItems = block.items.filter((i): i is ExternBlockItemFn => i.kind === 'ExternBlockItemFn');
    for (const item of fnItems) {
      if (item.params.length > 0) {
        expect(
          item.template.includes('$'),
          `fn '${item.name}' has params but template '${item.template}' lacks a $ placeholder`,
        ).toBe(true);
      }
      expect(
        item.template.length,
        `fn '${item.name}' has empty template`,
      ).toBeGreaterThan(0);
    }
  });

  it('all type item templates are non-empty', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    const typeItems = block.items.filter(i => i.kind === 'ExternBlockItemType');
    for (const item of typeItems) {
      expect(
        item.template.length,
        `type '${item.name}' has empty template`,
      ).toBeGreaterThan(0);
    }
  });

  it('type items include List, Option, Map, Result, Pair, Set', () => {
    const mod = loadStdlib();
    const block = mod.decls[0] as ExternBlockDeclNode;
    const typeNames = new Set(
      block.items.filter(i => i.kind === 'ExternBlockItemType').map(i => i.name),
    );
    for (const name of ['List', 'Option', 'Map', 'Result', 'Pair', 'Set']) {
      expect(typeNames.has(name), `missing type: ${name}`).toBe(true);
    }
  });
});
