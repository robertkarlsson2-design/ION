import type { IonIRModule } from '../ir/nodes.js';
/** Thrown when encoding encounters an irrecoverable structural problem. */
export declare class WireEncodeError extends Error {
    readonly path: readonly string[];
    constructor(message: string, path: readonly string[]);
}
/**
 * Encodes an IonIRModule to .ionw text (byte-stable, deterministic).
 * Sections are emitted in order: I1 M S? T? X? D* F*
 */
export declare function encodeModule(module: IonIRModule): string;
