import type { IonIRModule } from './nodes.js';
/** Thrown when serialization input is malformed or version-incompatible. */
export declare class IonIRSerdeError extends Error {
    constructor(message: string);
}
/** Serialize an IonIRModule to a compact, deterministic JSON string. */
export declare function serialize(module: IonIRModule): string;
/** Deserialize a JSON string to an IonIRModule. Throws IonIRSerdeError on invalid input. */
export declare function deserialize(json: string): IonIRModule;
