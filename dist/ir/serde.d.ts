import type { IonIRModule } from './nodes.js';
export declare class IonIRSerdeError extends Error {
    readonly path: string;
    constructor(message: string, path: string);
}
/** Serializes an IonIRModule to a formatted JSON string. EffectSet is sorted for determinism. */
export declare function serializeModule(module: IonIRModule): string;
/** Deserializes an IonIRModule from a JSON string, throwing IonIRSerdeError on structural violations. */
export declare function deserializeModule(json: string): IonIRModule;
