import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TestFramework = 'jest' | 'vitest' | 'pytest' | 'maven';

export interface CheckFailure {
  readonly file: string;
  readonly code: string;
  readonly message: string;
  readonly startLine: number;
  readonly startCol: number;
}

export interface GateResult {
  readonly passed: boolean;
  readonly ionCheckErrors: readonly CheckFailure[];
  readonly detectedFramework: TestFramework | null;
  /** Raw stdout+stderr from test runner, or null if no framework detected. */
  readonly testOutput: string | null;
  /** null iff passed === true. */
  readonly llmRetryContext: string | null;
}

export interface GateConfig {
  readonly ionFiles: readonly string[];
  readonly workDir: string;
  readonly ionBin?: string;
}

/** Internal injection type — substitute a fake in tests to avoid real subprocesses. */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; code: number }>;

/** Internal injection type — substitute a fake in tests to avoid real subprocesses. */
export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  cwd: string,
) => Promise<{ passed: boolean; output: string }>;

// ---------------------------------------------------------------------------
// JSON types for ion check --json output
// ---------------------------------------------------------------------------

interface JsonSpan {
  startLine: number;
  startCol: number;
}

interface JsonDiagnostic {
  file: string;
  code: string;
  message: string;
  span: JsonSpan;
}

interface JsonCheckOutput {
  errorCount: number;
  errors: JsonDiagnostic[];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isJsonDiagnostic(v: unknown): v is JsonDiagnostic {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  if (typeof d['file'] !== 'string') return false;
  if (typeof d['code'] !== 'string') return false;
  if (typeof d['message'] !== 'string') return false;
  if (typeof d['span'] !== 'object' || d['span'] === null) return false;
  const span = d['span'] as Record<string, unknown>;
  return typeof span['startLine'] === 'number' && typeof span['startCol'] === 'number';
}

function isJsonCheckOutput(value: unknown): value is JsonCheckOutput {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['errorCount'] === 'number' && Array.isArray(v['errors']);
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  jest?: unknown;
}

function isPackageJson(value: unknown): value is PackageJson {
  return typeof value === 'object' && value !== null;
}

// ---------------------------------------------------------------------------
// Default subprocess implementations
// ---------------------------------------------------------------------------

// Exit code -1 is a sentinel meaning the binary was not found (ENOENT).
function defaultExec(file: string, args: readonly string[]): Promise<{ stdout: string; code: number }> {
  return new Promise(resolve => {
    execFile(file, [...args], { encoding: 'utf-8' }, (err, stdout) => {
      if (err === null) {
        resolve({ stdout, code: 0 });
        return;
      }
      const nodeErr = err as NodeJS.ErrnoException & { stdout?: string };
      if (nodeErr.code === 'ENOENT') {
        resolve({ stdout: '', code: -1 });
        return;
      }
      const exitCode = typeof nodeErr.code === 'number' ? nodeErr.code : 1;
      resolve({ stdout: nodeErr.stdout ?? '', code: exitCode });
    });
  });
}

function defaultSpawn(cmd: string, args: readonly string[], cwd: string): Promise<{ passed: boolean; output: string }> {
  return new Promise(resolve => {
    const child = nodeSpawn(cmd, [...args], { cwd, stdio: 'pipe' });
    const chunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { chunks.push(chunk); });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ passed: false, output: '[timeout after 5 minutes]' });
    }, 300_000);

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({
        passed: code === 0,
        output: Buffer.concat(chunks).toString('utf-8'),
      });
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({ passed: false, output: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Ion check phase
// ---------------------------------------------------------------------------

function parseCheckOutput(stdout: string): CheckFailure[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!isJsonCheckOutput(parsed)) return [];
  return parsed.errors.filter(isJsonDiagnostic).map(e => ({
    file: e.file,
    code: e.code,
    message: e.message,
    startLine: e.span.startLine,
    startCol: e.span.startCol,
  }));
}

async function runIonCheck(
  ionFiles: readonly string[],
  ionBin: string,
  _exec: ExecFileFn,
): Promise<CheckFailure[]> {
  if (ionFiles.length === 0) return [];

  const { stdout, code } = await _exec(ionBin, ['check', '--json', ...ionFiles]);

  if (code === -1) {
    return [{
      file: '',
      code: 'G0001',
      message: `ion check binary not found: '${ionBin}'`,
      startLine: 0,
      startCol: 0,
    }];
  }
  if (code === 0) return [];
  if (code === 2) throw new Error(`ion check exited with I/O error (exit code 2): ${stdout}`);

  return parseCheckOutput(stdout);
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

async function detectFramework(workDir: string): Promise<TestFramework | null> {
  async function exists(name: string): Promise<boolean> {
    try {
      await stat(join(workDir, name));
      return true;
    } catch {
      return false;
    }
  }

  if (await exists('vitest.config.ts') || await exists('vitest.config.js')) {
    return 'vitest';
  }

  try {
    const pkgContent = await readFile(join(workDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent) as unknown;
    if (isPackageJson(pkg)) {
      const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const testScript = pkg.scripts?.['test'] ?? '';
      if ('vitest' in allDeps || testScript.includes('vitest')) return 'vitest';
      if ('jest' in allDeps || testScript.includes('jest') || 'jest' in pkg) return 'jest';
    }
  } catch {
    // no package.json or invalid JSON — continue
  }

  if (
    await exists('jest.config.ts') ||
    await exists('jest.config.js') ||
    await exists('jest.config.cjs')
  ) {
    return 'jest';
  }

  if (await exists('pytest.ini') || await exists('pyproject.toml')) {
    return 'pytest';
  }

  if (await exists('pom.xml')) {
    return 'maven';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Test run phase
// ---------------------------------------------------------------------------

const FRAMEWORK_COMMANDS: Record<TestFramework, readonly [string, ...string[]]> = {
  vitest: ['npx', 'vitest', 'run'],
  jest: ['npx', 'jest', '--ci'],
  pytest: ['python', '-m', 'pytest'],
  maven: ['mvn', 'test'],
};

async function runTests(
  framework: TestFramework,
  workDir: string,
  _spawn: SpawnFn,
): Promise<{ passed: boolean; output: string }> {
  const [cmd, ...args] = FRAMEWORK_COMMANDS[framework];
  return _spawn(cmd, args, workDir);
}

// ---------------------------------------------------------------------------
// Retry context assembly
// ---------------------------------------------------------------------------

const MAX_TEST_OUTPUT = 8_000;

function buildLlmRetryContext(
  errors: readonly CheckFailure[],
  testOutput: string | null,
): string | null {
  const parts: string[] = [];

  if (errors.length > 0) {
    parts.push('=== ion check errors ===');
    for (const e of errors) {
      parts.push(`${e.file}:${e.startLine}:${e.startCol} error[${e.code}]: ${e.message}`);
    }
  }

  if (testOutput !== null) {
    const trimmed = testOutput.trim();
    if (trimmed.length > 0) {
      parts.push('=== test failures ===');
      parts.push(trimmed.length > MAX_TEST_OUTPUT ? trimmed.slice(0, MAX_TEST_OUTPUT) : trimmed);
    }
  }

  return parts.length === 0 ? null : parts.join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Runs `ion check` on emitted Ion files and auto-detects + runs project tests.
 * Returns a structured result suitable for feeding into an LLM retry loop.
 */
export async function runGate(
  config: GateConfig,
  _exec: ExecFileFn = defaultExec,
  _spawn: SpawnFn = defaultSpawn,
): Promise<GateResult> {
  const ionBin = config.ionBin ?? 'ion';

  const ionCheckErrors = await runIonCheck(config.ionFiles, ionBin, _exec);

  const detectedFramework = await detectFramework(config.workDir);

  let testOutput: string | null = null;
  let testsPassed = true;

  if (detectedFramework !== null) {
    const testResult = await runTests(detectedFramework, config.workDir, _spawn);
    testOutput = testResult.output;
    testsPassed = testResult.passed;
  }

  const checkPassed = ionCheckErrors.length === 0;
  const passed = checkPassed && testsPassed;

  const llmRetryContext = buildLlmRetryContext(
    ionCheckErrors,
    testsPassed ? null : testOutput,
  );

  return {
    passed,
    ionCheckErrors,
    detectedFramework,
    testOutput,
    llmRetryContext,
  };
}
