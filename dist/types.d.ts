/** Source location covering a range of characters in a file. */
export interface Span {
    /** Absolute path to the source file. */
    file: string;
    /** 1-based line number of the first character. */
    startLine: number;
    /** 0-based column of the first character. */
    startCol: number;
    /** 1-based line number of the last character. */
    endLine: number;
    /** 0-based column past the last character. */
    endCol: number;
}
/** Opaque identifier produced by the Binder; all other stages treat it as a black box. */
export type SymbolId = string & {
    readonly __brand: 'SymbolId';
};
/** Cast a raw string to a SymbolId — only the Binder should call this. */
export declare function makeSymbolId(raw: string): SymbolId;
