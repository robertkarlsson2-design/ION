import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { deserializeModule } from '../../src/ir/serde.js';
import { encodeModule } from '../../src/wire/encoder.js';
import { prettyPrintModule } from '../../src/wire/pretty.js';
import type { IonIRModule } from '../../src/ir/nodes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures');
const GOLDEN_DIR = join(__dirname, 'golden');

const FIXTURE_NAMES = [
  '01-minimal',
  '02-adt-variants',
  '03-fn-abs',
  '04-let-block',
  '05-imports',
  '06-effects',
  '07-oop-class',
  '08-adt-match',
  '09-foreign-ref',
  '10-complex',
] as const;

const UPDATE_GOLDEN = process.env['UPDATE_GOLDEN'] === '1';

async function loadFixture(name: string): Promise<IonIRModule> {
  const json = await readFile(join(FIXTURE_DIR, `${name}.ionir.json`), 'utf-8');
  return deserializeModule(json);
}

async function compareOrWrite(goldenPath: string, actual: string): Promise<void> {
  if (UPDATE_GOLDEN) {
    await writeFile(goldenPath, actual, 'utf-8');
  } else {
    const expected = await readFile(goldenPath, 'utf-8');
    expect(actual).toBe(expected);
  }
}

describe('golden — pretty-print (.ion)', () => {
  for (const name of FIXTURE_NAMES) {
    it(name, async () => {
      const mod = await loadFixture(name);
      const actual = prettyPrintModule(mod);
      await compareOrWrite(join(GOLDEN_DIR, `${name}.ion`), actual);
    });
  }
});

describe('golden — wire encode (.ionw)', () => {
  for (const name of FIXTURE_NAMES) {
    it(name, async () => {
      const mod = await loadFixture(name);
      const actual = encodeModule(mod);
      await compareOrWrite(join(GOLDEN_DIR, `${name}.ionw`), actual);
    });
  }
});
