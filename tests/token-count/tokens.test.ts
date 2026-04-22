import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserializeModule } from '../../src/ir/serde.js';
import { computeReport, compareToBaseline, runTokens } from '../../src/cli/tokens.js';
import type { TokenReport } from '../../src/cli/tokens.js';

const FIXTURES_DIR = join(fileURLToPath(import.meta.url), '../fixtures');
const FIXTURE_FILE = join(FIXTURES_DIR, 'users.ionir.json');

async function loadFixtureModule() {
  const text = await readFile(FIXTURE_FILE, 'utf-8');
  return deserializeModule(text);
}

// ---------------------------------------------------------------------------
// T1 — computeReport returns consistent types
// ---------------------------------------------------------------------------

describe('computeReport', () => {
  it('T1: returns positive integer token counts and valid reductionPercent', async () => {
    const module = await loadFixtureModule();
    const report = computeReport(FIXTURE_FILE, module, 'cl100k');
    expect(Number.isInteger(report.wireTokens)).toBe(true);
    expect(Number.isInteger(report.prettyTokens)).toBe(true);
    expect(report.wireTokens).toBeGreaterThan(0);
    expect(report.prettyTokens).toBeGreaterThan(0);
    expect(report.reductionPercent).toBeGreaterThanOrEqual(0);
    expect(report.reductionPercent).toBeLessThanOrEqual(100);
  });

  // T2 — wire tokens < pretty tokens
  it('T2: wire token count is less than pretty token count', async () => {
    const module = await loadFixtureModule();
    const report = computeReport(FIXTURE_FILE, module, 'cl100k');
    expect(report.wireTokens).toBeLessThan(report.prettyTokens);
  });

  // T3 — ≥30% reduction on fixture
  it('T3: wire encoding achieves at least 30% token reduction vs pretty', async () => {
    const module = await loadFixtureModule();
    const report = computeReport(FIXTURE_FILE, module, 'cl100k');
    expect(report.reductionPercent).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// T4–T6 — compareToBaseline threshold logic
// ---------------------------------------------------------------------------

describe('compareToBaseline', () => {
  const baselineReport: TokenReport = {
    file: FIXTURE_FILE,
    tokenizer: 'cl100k',
    wireTokens: 100,
    prettyTokens: 300,
    reductionPercent: 66.67,
  };

  it('T4: detects +3% wire regression (exceeded = true)', () => {
    const report: TokenReport = {
      ...baselineReport,
      wireTokens: 103,
    };
    const result = compareToBaseline(report, baselineReport);
    expect(result.exceeded).toBe(true);
    expect(result.wireChangePct).toBeCloseTo(3.0, 1);
  });

  it('T5: passes when wire is exactly at threshold 2.0% (exceeded = false, threshold is strict >)', () => {
    const report: TokenReport = {
      ...baselineReport,
      wireTokens: 102,
    };
    const result = compareToBaseline(report, baselineReport);
    expect(result.exceeded).toBe(false);
    expect(result.wireChangePct).toBeCloseTo(2.0, 1);
  });

  it('T6: passes when wire tokens are below baseline (exceeded = false)', () => {
    const report: TokenReport = {
      ...baselineReport,
      wireTokens: 95,
    };
    const result = compareToBaseline(report, baselineReport);
    expect(result.exceeded).toBe(false);
    expect(result.wireChangePct).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// T7 — cl100k and o200k both return positive integers within 20% of each other
// ---------------------------------------------------------------------------

describe('tokenizer comparison', () => {
  it('T7: cl100k and o200k both produce positive integer counts within 20% of each other', async () => {
    const module = await loadFixtureModule();
    const cl = computeReport(FIXTURE_FILE, module, 'cl100k');
    const o2 = computeReport(FIXTURE_FILE, module, 'o200k');
    expect(Number.isInteger(cl.wireTokens)).toBe(true);
    expect(Number.isInteger(o2.wireTokens)).toBe(true);
    expect(cl.wireTokens).toBeGreaterThan(0);
    expect(o2.wireTokens).toBeGreaterThan(0);
    const ratio = Math.max(cl.wireTokens, o2.wireTokens) / Math.min(cl.wireTokens, o2.wireTokens);
    expect(ratio).toBeLessThan(1.2);
  });
});

// ---------------------------------------------------------------------------
// T8 — runTokens with --json writes valid JSON to stdout
// ---------------------------------------------------------------------------

describe('runTokens --json', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T8: --json output is parseable JSON with all required fields', async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const result = await runTokens([FIXTURE_FILE, '--json']);
    expect(result.exitCode).toBe(0);

    const output = chunks.join('');
    let parsed: unknown;
    expect(() => { parsed = JSON.parse(output); }).not.toThrow();
    const report = parsed as TokenReport;
    expect(typeof report.wireTokens).toBe('number');
    expect(typeof report.prettyTokens).toBe('number');
    expect(typeof report.reductionPercent).toBe('number');
    expect(report.tokenizer).toBe('cl100k');
  });
});

// ---------------------------------------------------------------------------
// T9 — runTokens with --baseline exits 1 on regression
// ---------------------------------------------------------------------------

describe('runTokens --baseline regression', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T9: exits with code 1 when wire tokens exceed baseline by more than 2%', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const module = await loadFixtureModule();
    const realReport = computeReport(FIXTURE_FILE, module, 'cl100k');

    const tinyBaseline: TokenReport = {
      file: FIXTURE_FILE,
      tokenizer: 'cl100k',
      wireTokens: Math.floor(realReport.wireTokens * 0.9),
      prettyTokens: realReport.prettyTokens,
      reductionPercent: realReport.reductionPercent,
    };

    const tmpBaseline = join(FIXTURES_DIR, '__tmp_baseline_test.json');
    await writeFile(tmpBaseline, JSON.stringify(tinyBaseline, null, 2), 'utf-8');

    try {
      const result = await runTokens([FIXTURE_FILE, '--baseline', tmpBaseline]);
      expect(result.exitCode).toBe(1);
    } finally {
      await unlink(tmpBaseline).catch(() => undefined);
    }
  });
});
