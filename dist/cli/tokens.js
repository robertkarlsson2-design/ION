import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { deserializeModule } from '../ir/serde.js';
import { encodeModule } from '../wire/encoder.js';
import { prettyPrintModule } from '../wire/pretty.js';
import { countTokens } from './tokenizer.js';
// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------
/**
 * Computes wire and pretty token counts for a deserialized IonIRModule.
 * reductionPercent = (prettyTokens - wireTokens) / prettyTokens * 100
 */
export function computeReport(filePath, module, tokenizer) {
    const wireText = encodeModule(module);
    const prettyText = prettyPrintModule(module);
    const wireTokens = countTokens(wireText, tokenizer);
    const prettyTokens = countTokens(prettyText, tokenizer);
    const reductionPercent = prettyTokens === 0
        ? 0
        : ((prettyTokens - wireTokens) / prettyTokens) * 100;
    return {
        file: filePath,
        tokenizer,
        wireTokens,
        prettyTokens,
        reductionPercent: Math.round(reductionPercent * 100) / 100,
    };
}
/**
 * Compares a new report to a committed baseline.
 * wireChangePct > +2.0 sets exceeded = true (CI failure threshold).
 */
export function compareToBaseline(report, baseline) {
    const wireChangePct = baseline.wireTokens === 0
        ? 0
        : ((report.wireTokens - baseline.wireTokens) / baseline.wireTokens) * 100;
    return {
        report,
        baseline,
        wireChangePct: Math.round(wireChangePct * 100) / 100,
        exceeded: wireChangePct > 2.0,
    };
}
function parseArgs(args) {
    let filePath = null;
    let tokenizer = 'cl100k';
    let json = false;
    let baselinePath = null;
    let saveBaselinePath = null;
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === '--tokenizer') {
            i++;
            const val = args[i];
            if (val !== 'cl100k' && val !== 'o200k') {
                return { error: `--tokenizer must be cl100k or o200k, got: ${val ?? '(missing)'}` };
            }
            tokenizer = val;
        }
        else if (arg === '--json') {
            json = true;
        }
        else if (arg === '--baseline') {
            i++;
            const val = args[i];
            if (val === undefined)
                return { error: '--baseline requires a path argument' };
            baselinePath = val;
        }
        else if (arg === '--save-baseline') {
            i++;
            const val = args[i];
            if (val === undefined)
                return { error: '--save-baseline requires a path argument' };
            saveBaselinePath = val;
        }
        else if (arg !== undefined && !arg.startsWith('--')) {
            if (filePath !== null)
                return { error: 'unexpected extra positional argument' };
            filePath = arg;
        }
        else if (arg !== undefined) {
            return { error: `unknown flag: ${arg}` };
        }
        i++;
    }
    if (filePath === null)
        return { error: 'missing required positional argument: <file>' };
    return { filePath, tokenizer, json, baselinePath, saveBaselinePath };
}
// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------
function formatHuman(report) {
    const lines = [
        `file:      ${report.file}`,
        `tokenizer: ${report.tokenizer}`,
        `wire:      ${report.wireTokens} tokens`,
        `pretty:    ${report.prettyTokens} tokens`,
        `reduction: ${report.reductionPercent.toFixed(1)}%`,
    ];
    return lines.join('\n') + '\n';
}
// ---------------------------------------------------------------------------
// Main entry point (returns exit code, does NOT call process.exit)
// ---------------------------------------------------------------------------
/**
 * Runs the `ion tokens` command.
 * Returns { exitCode } where 0 = success, 1 = CI failure or I/O error, 2 = argument error.
 * Callers (the binary shim) are responsible for calling process.exit.
 */
export async function runTokens(args) {
    const parsed = parseArgs(args);
    if ('error' in parsed) {
        process.stdout.write(`error: ${parsed.error}\n`);
        process.stdout.write('usage: ion tokens <file> [--tokenizer cl100k|o200k] [--json] [--baseline <baseline.json>] [--save-baseline <out.json>]\n');
        return { exitCode: 2 };
    }
    const { filePath, tokenizer, json: jsonMode, baselinePath, saveBaselinePath } = parsed;
    let fileText;
    try {
        fileText = await readFile(filePath, 'utf-8');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(`error: cannot read file '${filePath}': ${msg}\n`);
        return { exitCode: 1 };
    }
    let module;
    try {
        module = deserializeModule(fileText);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(`error: failed to deserialize '${filePath}': ${msg}\n`);
        return { exitCode: 1 };
    }
    const report = computeReport(filePath, module, tokenizer);
    if (saveBaselinePath !== null) {
        try {
            await writeFile(saveBaselinePath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stdout.write(`error: cannot write baseline '${saveBaselinePath}': ${msg}\n`);
            return { exitCode: 1 };
        }
    }
    let exitCode = 0;
    if (baselinePath !== null) {
        let baselineText;
        try {
            baselineText = await readFile(baselinePath, 'utf-8');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stdout.write(`error: cannot read baseline '${baselinePath}': ${msg}\n`);
            return { exitCode: 1 };
        }
        let baseline;
        try {
            baseline = JSON.parse(baselineText);
        }
        catch {
            process.stdout.write(`error: baseline '${baselinePath}' is not valid JSON\n`);
            return { exitCode: 1 };
        }
        const comparison = compareToBaseline(report, baseline);
        if (comparison.exceeded) {
            process.stdout.write(`CI FAILURE: wire token count increased by ${comparison.wireChangePct.toFixed(2)}% (threshold: +2.00%)\n`);
            exitCode = 1;
        }
    }
    if (jsonMode) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
    else {
        process.stdout.write(formatHuman(report));
    }
    return { exitCode };
}
// ---------------------------------------------------------------------------
// Binary entry point — only executes when this file is run directly
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    runTokens(process.argv.slice(2)).then(({ exitCode }) => {
        process.exit(exitCode);
    });
}
