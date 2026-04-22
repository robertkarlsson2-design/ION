import type { Span } from '../types.js';
/** Effect tags from surface syntax; open set to support extension dialects. */
export type EffectTag = 'io' | 'async' | 'llm' | (string & Record<never, never>);
/** A type annotation as it appears in source code — pre-resolution. */
export type TypeAnnotation = NamedTypeAnnotation | GenericTypeAnnotation | FnTypeAnnotation | TupleTypeAnnotation;
export interface NamedTypeAnnotation {
    readonly kind: 'Named';
    readonly name: string;
    readonly span: Span;
}
export interface GenericTypeAnnotation {
    readonly kind: 'Generic';
    readonly name: string;
    readonly args: readonly TypeAnnotation[];
    readonly span: Span;
}
export interface FnTypeAnnotation {
    readonly kind: 'Fn';
    readonly params: readonly TypeAnnotation[];
    readonly ret: TypeAnnotation;
    readonly effects: readonly EffectTag[];
    readonly span: Span;
}
export interface TupleTypeAnnotation {
    readonly kind: 'Tuple';
    readonly elements: readonly TypeAnnotation[];
    readonly span: Span;
}
