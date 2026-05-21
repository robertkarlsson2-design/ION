import { readFileSync, writeFileSync, readdirSync, statSync, watch } from 'fs';
import { join, relative, basename, dirname } from 'path';
import { parseRoute } from '../gen/parsers/route.js';
import { generateRoute as genRoute } from '../gen/generators/route.js';
import { parseServiceFile, generateServiceFile } from '../gen/index.js';
import { parseScreen, generateScreen, parseAdminList, generateAdminList } from '../gen/index.js';

function detectPattern(src: string): 'route' | 'query' | 'screen' | 'adminList' | null {
  const first = src.trimStart().split('\n')[0].trim();
  if (first.startsWith('/')) return 'route';
  if (first.startsWith('query ') || first.startsWith('transaction ')) return 'query';
  // AdminList: PascalCase + /admin/path + 'paginated' on first line
  if (/^[A-Z]\w*\s+\/\S+\s+.*paginated/.test(first)) return 'adminList';
  // Screen: PascalCase component name alone on first line
  if (/^[A-Z]\w*$/.test(first)) return 'screen';
  return null;
}

function processFile(defPath: string): { outPath: string; written: boolean } {
  const src = readFileSync(defPath, 'utf-8');
  const stem = basename(defPath, '.def');
  const dir = dirname(defPath);
  const outPath = join(dir, `${stem}.ts`);

  const pattern = detectPattern(src);
  if (!pattern) {
    process.stderr.write(`warn: ${defPath}: unknown pattern, skipping\n`);
    return { outPath, written: false };
  }

  let output: string;
  if (pattern === 'route') {
    const spec = parseRoute(src, stem);
    output = genRoute(spec);
  } else if (pattern === 'query') {
    const specs = parseServiceFile(src);
    output = generateServiceFile(specs);
  } else if (pattern === 'adminList') {
    const spec = parseAdminList(src);
    output = generateAdminList(spec);
  } else {
    const spec = parseScreen(src);
    output = generateScreen(spec);
  }

  writeFileSync(outPath, output);
  return { outPath, written: true };
}

function collectDefFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') walk(full);
      else if (entry.endsWith('.def')) results.push(full);
    }
  }
  walk(root);
  return results;
}

export async function runGen(args: string[]): Promise<{ exitCode: number }> {
  const watchMode = args.includes('--watch');
  const paths = args.filter(a => !a.startsWith('--'));
  const target = paths[0] ?? '.';

  const stat = statSync(target);
  const files = stat.isFile() ? [target] : collectDefFiles(target);

  if (files.length === 0) {
    process.stderr.write(`ion gen: no .def files found under ${target}\n`);
    return { exitCode: 0 };
  }

  let errors = 0;
  for (const f of files) {
    try {
      const { outPath, written } = processFile(f);
      if (written) process.stdout.write(`  gen  ${relative(process.cwd(), f)} -> ${relative(process.cwd(), outPath)}\n`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`error: ${f}: ${msg}\n`);
      errors++;
    }
  }

  if (watchMode) {
    process.stdout.write(`watching ${target}...\n`);
    watch(target, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith('.def')) return;
      const full = join(target, filename);
      try {
        const { outPath, written } = processFile(full);
        if (written) process.stdout.write(`  gen  ${filename} -> ${basename(outPath)}\n`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`error: ${filename}: ${msg}\n`);
      }
    });
    await new Promise(() => {}); // keep alive
  }

  return { exitCode: errors > 0 ? 1 : 0 };
}
