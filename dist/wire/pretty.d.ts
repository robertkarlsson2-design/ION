import type { IonIRModule, IonIRNode } from '../ir/nodes.js';
import type { IonType } from '../ir/types.js';
export interface PrettyOptions {
    readonly indentSize?: number;
}
/** Render an IonType to its surface type annotation. */
export declare function prettyPrintType(type: IonType): string;
/** Render any single IonIRNode at a given indent depth. */
export declare function prettyPrintNode(node: IonIRNode, depth?: number, opts?: PrettyOptions): string;
/** Render a full IonIRModule to .ion surface syntax. */
export declare function prettyPrintModule(mod: IonIRModule, opts?: PrettyOptions): string;
