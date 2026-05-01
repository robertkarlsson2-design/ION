import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Plugin } from 'vite';
import { compileIonSource } from '../../../src/api.js';
import { emitReact } from '../../../emitters/react/emit.js';
import { emitTS } from '../../../emitters/typescript/emit.js';
import type { EmitFn } from '../../../src/api.js';

export interface IonPluginOptions {
  target?: string;
}

const VIRTUAL_PREFIX = '\0ion-virtual:';

function resolveEmitter(target: string): EmitFn {
  if (target === 'react') return emitReact;
  if (target === 'typescript') return emitTS;
  throw new Error(`vite-plugin-ion: unsupported target "${target}". Supported targets: react, typescript`);
}

export default function ion(options: IonPluginOptions = {}): Plugin {
  const target = options.target ?? 'react';
  const virtualExt = target === 'react' ? '.tsx' : '.ts';
  const emitFn = resolveEmitter(target);

  return {
    name: 'vite-plugin-ion',
    enforce: 'pre',

    resolveId(id: string, importer: string | undefined) {
      if (!id.startsWith('.') && !id.startsWith('/')) return null;

      const importerDir = importer ? dirname(resolve(importer)) : process.cwd();

      let ionPath: string;
      if (id.endsWith('.ion')) {
        ionPath = resolve(importerDir, id);
      } else {
        const stripped = id.replace(/\.(tsx|ts|jsx|js)$/, '');
        ionPath = resolve(importerDir, stripped) + '.ion';
      }

      if (!existsSync(ionPath)) return null;

      return VIRTUAL_PREFIX + ionPath.replace(/\.ion$/, virtualExt);
    },

    async load(id: string) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;

      const tsPath = id.slice(VIRTUAL_PREFIX.length);
      const ionPath = tsPath.replace(/\.(tsx|ts|jsx|js)$/, '.ion');

      const src = await readFile(ionPath, 'utf-8');
      const result = compileIonSource(src, ionPath, emitFn);

      if (!result.ok) {
        const errorLines = result.errors.map(
          e => `[${e.code}] ${e.message} at ${e.span.file}:${e.span.startLine}:${e.span.startCol}`,
        );
        this.error(`Ion compilation failed:\n${errorLines.join('\n')}`);
      }

      return { code: result.output, map: null };
    },
  };
}
