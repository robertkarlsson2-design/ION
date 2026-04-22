import type { IonIRModule } from '../ir/nodes.js';
/** Encodes an IonIRModule to wire-format text. Deterministic and byte-stable. */
export declare function encodeModule(module: IonIRModule): string;
