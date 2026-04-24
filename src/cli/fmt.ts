import { readFile, writeFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { deserializeModule, IonIRSerdeError } from '../ir/serde.js';
import { encodeModule } from '../wire/encoder.js';
import { prettyPrintModule, type PrettyOptions } from '../wire/pretty.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunResult {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  files: string[];
  mode: 'pretty' | 'wire' | 'check';
  indentSize: number;
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  const files: string[] = [];
  let mode: 'pretty' | 'wire' | 'check' | null = null;
  let indentSize = 2;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--pretty') {
      if (mode !== null && mode !== 'pretty') return { error: '--pretty, --wire, and --check are mutually exclusive' };
      mode = 'pretty';
    } else if (arg === '--wire') {
      if (mode !== null && mode !== 'wire') return { error: '--pretty, --wire, and --check are mutually exclusive' };
      mode = 'wire';
    } else if (arg === '--check') {
      if (mode !== null && mode !== 'check') return { error: '--pretty, --wire, and --check are mutually exclusive' };
      mode = 'check';
    } else if (arg === '--indent') {
      i++;
      const val = args[i];
      if (val === undefined) return { error: '--indent requires a numeric argument' };
      const n = parseInt(val, 10);
      if (!Number.isInteger(n) || n < 1) return { error: `--indent requires a positive integer, got: ${val}` };
      indentSize = n;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      files.push(arg);
    } else if (arg !== undefined) {
      return { error: `unknown flag: ${arg}` };
    }
    i++;
  }

  if (files.length === 0) return { error: 'at least one file path is required' };

  return { files, mode: mode ?? 'pretty', indentSize };
}

// ---------------------------------------------------------------------------
// Format detection helpers
// ---------------------------------------------------------------------------

/** Returns true when content starts with "module " — the only valid first token of prettyPrintModule output. Cannot start JSON. */
function looksLikeSurfaceSyntax(content: string): boolean {
  return content.startsWith('module ');
}

/** Returns true when content starts with "I1\n" — the wire version marker. */
function looksLikeWireFormat(content: string): boolean {
  return content.startsWith('I1\n');
}

// ---------------------------------------------------------------------------
// Per-file formatting
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 64 * 1024 * 1024; // 64 MB — IonIR files are typically kilobytes

/**
 * Format a single file. Returns whether the file content was already canonical.
 * In 'check' mode, never writes. In 'pretty'/'wire' modes, writes if changed.
 *
 * NOTE: Only JSON-serialized IonIRModule input is supported. Wire-format input
 * cannot be read back (no wire decoder exists yet). Attempting to read a wire-
 * formatted file as input will produce an IonIRSerdeError.
 */
async function formatFile(
  filePath: string,
  mode: 'pretty' | 'wire' | 'check',
  opts: PrettyOptions,
): Promise<{ changed: boolean; error?: string }> {
  try {
    const { size } = await stat(filePath);
    if (size > MAX_FILE_SIZE) {
      return { changed: false, error: `file too large: '${filePath}' (${size} bytes, limit ${MAX_FILE_SIZE})` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { changed: false, error: `cannot read file '${filePath}': ${msg}` };
  }

  let original: string;
  try {
    original = await readFile(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { changed: false, error: `cannot read file '${filePath}': ${msg}` };
  }

  let formatted: string;
  try {
    const mod = deserializeModule(original);
    formatted = mode === 'wire'
      ? encodeModule(mod)
      : prettyPrintModule(mod, opts);
  } catch (err) {
    if (err instanceof IonIRSerdeError) {
      if (mode === 'check') {
        if (looksLikeSurfaceSyntax(original)) {
          return { changed: false };
        }
        if (looksLikeWireFormat(original)) {
          return { changed: true };
        }
      }
      return { changed: false, error: `failed to deserialize '${filePath}': ${err.message}` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { changed: false, error: `failed to format '${filePath}': ${msg}` };
  }

  const changed = formatted !== original;

  if (mode !== 'check' && changed) {
    try {
      await writeFile(filePath, formatted, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { changed, error: `cannot write file '${filePath}': ${msg}` };
    }
  }

  return { changed };
}

// ---------------------------------------------------------------------------
// Main entry point (returns exit code, does NOT call process.exit)
// ---------------------------------------------------------------------------

const USAGE = 'usage: ion fmt [--pretty|--wire|--check] [--indent <n>] <file> [<file>...]\n';

/**
 * Runs the `ion fmt` command.
 * Returns { exitCode } where 0 = success, 1 = I/O or format error, 2 = argument error.
 * In --check mode exits 1 if any file is not already in canonical form.
 * Callers (the binary shim) are responsible for calling process.exit.
 */
export async function runFmt(args: string[]): Promise<RunResult> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.stderr.write(USAGE);
    return { exitCode: 2 };
  }

  const { files, mode, indentSize } = parsed;
  const opts: PrettyOptions = { indentSize };

  let exitCode = 0;

  for (const filePath of files) {
    const result = await formatFile(filePath, mode, opts);
    if (result.error !== undefined) {
      process.stderr.write(`error: ${result.error}\n`);
      exitCode = 1;
    } else if (mode === 'check' && result.changed) {
      process.stderr.write(`${filePath}: not in canonical form\n`);
      exitCode = 1;
    }
  }

  return { exitCode };
}

// ---------------------------------------------------------------------------
// Binary entry point — only executes when this file is run directly
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runFmt(process.argv.slice(2))
    .then(({ exitCode }) => { process.exit(exitCode); })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`fatal: ${msg}\n`);
      process.exit(1);
    });
}
