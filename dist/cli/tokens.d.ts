import { type TokenizerName } from './tokenizer.js';
import type { IonIRModule } from '../ir/nodes.js';
export interface TokenReport {
    file: string;
    tokenizer: TokenizerName;
    wireTokens: number;
    prettyTokens: number;
    reductionPercent: number;
}
export interface BaselineComparison {
    report: TokenReport;
    baseline: TokenReport;
    wireChangePct: number;
    exceeded: boolean;
}
export interface RunResult {
    exitCode: number;
}
/**
 * Computes wire and pretty token counts for a deserialized IonIRModule.
 * reductionPercent = (prettyTokens - wireTokens) / prettyTokens * 100
 */
export declare function computeReport(filePath: string, module: IonIRModule, tokenizer: TokenizerName): TokenReport;
/**
 * Compares a new report to a committed baseline.
 * wireChangePct > +2.0 sets exceeded = true (CI failure threshold).
 */
export declare function compareToBaseline(report: TokenReport, baseline: TokenReport): BaselineComparison;
/**
 * Runs the `ion tokens` command.
 * Returns { exitCode } where 0 = success, 1 = CI failure or I/O error, 2 = argument error.
 * Callers (the binary shim) are responsible for calling process.exit.
 */
export declare function runTokens(args: string[]): Promise<RunResult>;
