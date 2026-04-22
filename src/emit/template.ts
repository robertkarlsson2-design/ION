/** Branded opaque type: a string that has already been fully emitted by the emitter. */
export type EmittedExpr = string & { readonly __brand: 'EmittedExpr' };

/**
 * Wrap a fully-emitted string as an EmittedExpr.
 * Only emitter internals should call this; consumers must not bypass the brand.
 */
export function wrapEmitted(s: string): EmittedExpr {
  return s as EmittedExpr;
}

/**
 * Expand a ForeignSignature template by substituting $1..$N positional
 * placeholders with the corresponding already-emitted argument expressions.
 *
 * - Placeholders are 1-indexed ($1 = args[0]).
 * - Multi-digit indices are supported ($10, $12, …).
 * - $0 throws RangeError (invalid).
 * - Out-of-bounds $N throws RangeError.
 * - Substitution is single-pass and non-recursive.
 */
export function expandTemplate(
  template: string,
  args: readonly EmittedExpr[],
): string {
  return template.replace(/\$(\d+)/g, (match, digits: string) => {
    const n = parseInt(digits, 10);
    if (n === 0) {
      throw new RangeError(`$0 is not a valid placeholder; arguments are 1-indexed`);
    }
    if (n > args.length) {
      throw new RangeError(
        `Template placeholder $${n} is out of bounds; only ${args.length} argument(s) provided`,
      );
    }
    return args[n - 1];
  });
}
