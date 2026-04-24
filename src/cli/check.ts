import { readFile, stat, glob } from 'node:fs/promises';

const MAX_FILE_SIZE = 64 * 1024 * 1024;
import { pathToFileURL } from 'node:url';
import { lex } from '../lexer/index.js';
import { parseModule, ParseError } from '../parser/declarations.js';
import { buildModule } from '../ast/builder.js';
import { bindModule } from '../binder/index.js';
import type { BindError } from '../binder/index.js';
import { checkModule } from '../checker/index.js';
import type { CheckError } from '../checker/index.js';
import type { Span } from '../types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RunResult {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ParsedArgs {
  files: string[];
  all: boolean;
  json: boolean;
}

interface Diagnostic {
  file: string;
  code: string;
  message: string;
  span: Span;
  suggestion: string | null;
}

interface JsonDiagnostic {
  file: string;
  code: string;
  message: string;
  span: {
    file: string;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  suggestion: string | null;
}

interface JsonOutput {
  errorCount: number;
  errors: JsonDiagnostic[];
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  const files: string[] = [];
  let all = false;
  let json = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      files.push(arg);
    } else if (arg !== undefined) {
      return { error: `unknown flag: ${arg}` };
    }
    i++;
  }

  if (all && files.length > 0) {
    return { error: '--all and explicit file paths are mutually exclusive' };
  }
  if (!all && files.length === 0) {
    return { error: 'at least one file path or --all is required' };
  }

  return { files, all, json };
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

async function collectFiles(parsed: ParsedArgs): Promise<string[] | { error: string }> {
  if (!parsed.all) {
    return parsed.files;
  }
  const found: string[] = [];
  try {
    for await (const file of glob('**/*.ion', { cwd: process.cwd() })) {
      found.push(file);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `failed to enumerate .ion files: ${msg}` };
  }
  return found;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapBindError(e: BindError, filePath: string): Diagnostic {
  switch (e.kind) {
    case 'UndefinedName':
      return {
        file: filePath,
        code: 'B0001',
        message: e.message,
        span: e.span,
        suggestion: 'check the spelling or add a declaration',
      };
    case 'DuplicateBinding':
      return {
        file: filePath,
        code: 'B0002',
        message: e.message,
        span: e.span,
        suggestion: 'rename one of the conflicting bindings',
      };
    case 'CircularImport':
      return {
        file: filePath,
        code: 'B0003',
        message: e.message,
        span: e.span,
        suggestion: 'break the import cycle by extracting shared code into a common module',
      };
  }
}

function mapCheckError(e: CheckError): Diagnostic {
  return {
    file: e.span.file,
    code: e.code,
    message: e.message,
    span: e.span,
    suggestion: e.suggestion,
  };
}

// ---------------------------------------------------------------------------
// Per-file pipeline
// ---------------------------------------------------------------------------

/**
 * Lex → parse → build AST → bind → check a single file.
 * Returns all diagnostics, or { ioError } if the file cannot be read.
 * ParseError is caught and converted to a single-element Diagnostic[].
 * Unexpected internal errors propagate to the caller.
 */
async function checkFile(filePath: string): Promise<Diagnostic[] | { ioError: string }> {
  try {
    const { size } = await stat(filePath);
    if (size > MAX_FILE_SIZE) {
      return { ioError: `file too large: '${filePath}' (${size} bytes, limit ${MAX_FILE_SIZE})` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ioError: `cannot read file '${filePath}': ${msg}` };
  }

  let src: string;
  try {
    src = await readFile(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ioError: `cannot read file '${filePath}': ${msg}` };
  }

  const tokens = lex(src, filePath);
  try {
    const cst = parseModule(tokens);
    const ast = buildModule(cst);
    const bindResult = bindModule(ast, filePath);
    const bindDiags = bindResult.errors.map(e => mapBindError(e, filePath));
    const checkResult = checkModule(ast, bindResult, filePath);
    const checkDiags = checkResult.errors.map(mapCheckError);
    return [...bindDiags, ...checkDiags];
  } catch (err) {
    if (err instanceof ParseError) {
      return [{
        file: filePath,
        code: err.code,
        message: err.message,
        span: err.span,
        suggestion: err.suggestion,
      }];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/**
 * Format diagnostics as human-readable text.
 * Includes a summary count line when there are errors.
 */
function formatHuman(diags: Diagnostic[]): string {
  const lines: string[] = [];
  for (const d of diags) {
    const loc = `${d.span.file}:${d.span.startLine}:${d.span.startCol}`;
    lines.push(`error[${d.code}]: ${d.message} at ${loc}`);
    if (d.suggestion !== null) {
      lines.push(`  suggestion: ${d.suggestion}`);
    }
  }
  lines.push(`found ${diags.length} error(s)`);
  return lines.join('\n');
}

/**
 * Format diagnostics as a JSON blob matching the JsonOutput shape.
 */
function formatJson(diags: Diagnostic[]): string {
  const output: JsonOutput = {
    errorCount: diags.length,
    errors: diags.map(d => ({
      file: d.file,
      code: d.code,
      message: d.message,
      span: {
        file: d.span.file,
        startLine: d.span.startLine,
        startCol: d.span.startCol,
        endLine: d.span.endLine,
        endCol: d.span.endCol,
      },
      suggestion: d.suggestion,
    })),
  };
  return JSON.stringify(output, null, 2);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const USAGE = 'usage: ion check <file> [<file>...] | --all [--json]\n';

/**
 * Runs the `ion check` command.
 * Returns { exitCode } where 0 = clean, 1 = diagnostics found, 2 = argument/I-O/internal error.
 * Callers (the binary shim) are responsible for calling process.exit.
 */
export async function runCheck(args: string[]): Promise<RunResult> {
  const parsed = parseArgs(args);
  if ('error' in parsed) {
    process.stderr.write(`error: ${parsed.error}\n`);
    process.stderr.write(USAGE);
    return { exitCode: 2 };
  }

  const collected = await collectFiles(parsed);
  if ('error' in collected) {
    process.stderr.write(`error: ${collected.error}\n`);
    return { exitCode: 2 };
  }

  const filesToCheck = collected;

  if (filesToCheck.length === 0) {
    process.stdout.write('warning: no .ion files found\n');
    return { exitCode: 0 };
  }

  const allDiags: Diagnostic[] = [];
  for (const filePath of filesToCheck) {
    const result = await checkFile(filePath);
    if ('ioError' in result) {
      process.stderr.write(`error: ${result.ioError}\n`);
      return { exitCode: 2 };
    }
    allDiags.push(...result);
  }

  if (parsed.json) {
    process.stdout.write(formatJson(allDiags) + '\n');
  } else if (allDiags.length > 0) {
    process.stdout.write(formatHuman(allDiags) + '\n');
  }

  return { exitCode: allDiags.length > 0 ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Binary entry point — only executes when this file is run directly
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCheck(process.argv.slice(2))
    .then(({ exitCode }) => { process.exit(exitCode); })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`fatal: ${msg}\n`);
      process.exit(2);
    });
}
