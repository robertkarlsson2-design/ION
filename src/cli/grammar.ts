import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GBNF_ION, ION_IR_SCHEMA } from '../grammar/manifest.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  outDir: string;
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  let outDir = '.';

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--out-dir') {
      i++;
      const val = args[i];
      if (val === undefined) return { error: '--out-dir requires a path argument' };
      outDir = val;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      return { error: `unexpected positional argument: ${arg}` };
    } else if (arg !== undefined) {
      return { error: `unknown flag: ${arg}` };
    }
    i++;
  }

  return { outDir };
}

// ---------------------------------------------------------------------------
// Main entry point (returns exit code, does NOT call process.exit)
// ---------------------------------------------------------------------------

export interface RunResult {
  exitCode: number;
}

/**
 * Runs the `ion grammar` command.
 * Writes ion.gbnf and ion-ir-schema.json to the specified output directory.
 */
export async function runGrammar(args: string[]): Promise<RunResult> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    process.stdout.write(`error: ${parsed.error}\n`);
    process.stdout.write('usage: ion grammar [--out-dir <dir>]\n');
    return { exitCode: 2 };
  }

  const { outDir } = parsed;

  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`error: cannot create output directory '${outDir}': ${msg}\n`);
    return { exitCode: 1 };
  }

  const gbnfPath = join(outDir, 'ion.gbnf');
  const schemaPath = join(outDir, 'ion-ir-schema.json');

  try {
    await writeFile(gbnfPath, GBNF_ION, 'utf-8');
    process.stdout.write(`wrote: ${gbnfPath}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`error: cannot write '${gbnfPath}': ${msg}\n`);
    return { exitCode: 1 };
  }

  try {
    await writeFile(schemaPath, JSON.stringify(ION_IR_SCHEMA, null, 2) + '\n', 'utf-8');
    process.stdout.write(`wrote: ${schemaPath}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`error: cannot write '${schemaPath}': ${msg}\n`);
    return { exitCode: 1 };
  }

  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Binary entry point — only executes when run directly
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runGrammar(process.argv.slice(2))
    .then(({ exitCode }) => { process.exit(exitCode); })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`fatal: ${msg}\n`);
      process.exit(1);
    });
}
