import type { AstMatchArm, AstPatternNode } from '../ast/nodes.js';
import type { IonType } from '../ir/types.js';
import type { Span } from '../types.js';
import type { CheckError } from './types.js';

/**
 * Check that match arms are exhaustive for the given scrutinee type.
 * Pushes an InexhaustiveMatch error if coverage is incomplete.
 *
 * @param arms - All match arms from the match expression
 * @param scrutineeType - Resolved type of the scrutinee
 * @param adtVariants - Map from ADT type name to its variant names
 * @param span - Span of the match expression for error reporting
 * @param errors - Accumulator for errors
 */
export function checkExhaustiveness(
  arms: readonly AstMatchArm[],
  scrutineeType: IonType,
  adtVariants: ReadonlyMap<string, readonly string[]>,
  span: Span,
  errors: CheckError[],
): void {
  // An unguarded wildcard or ident pattern covers everything.
  if (arms.some(isUnguardedWildcard)) return;

  switch (scrutineeType.kind) {
    case 'Bool': {
      const trueArm = arms.some(a => matchesBoolLit(a.pattern, true));
      const falseArm = arms.some(a => matchesBoolLit(a.pattern, false));
      const missing: string[] = [];
      if (!trueArm) missing.push('true');
      if (!falseArm) missing.push('false');
      if (missing.length > 0) reportMissing(missing, span, errors);
      return;
    }

    case 'Option': {
      const hasSome = arms.some(a => a.pattern.kind === 'ConstructorPat' && a.pattern.tag === 'Some');
      const hasNone = arms.some(a => a.pattern.kind === 'ConstructorPat' && a.pattern.tag === 'None');
      const missing: string[] = [];
      if (!hasSome) missing.push('Some');
      if (!hasNone) missing.push('None');
      if (missing.length > 0) reportMissing(missing, span, errors);
      return;
    }

    case 'Result': {
      const hasOk = arms.some(a => a.pattern.kind === 'ConstructorPat' && a.pattern.tag === 'Ok');
      const hasErr = arms.some(a => a.pattern.kind === 'ConstructorPat' && a.pattern.tag === 'Err');
      const missing: string[] = [];
      if (!hasOk) missing.push('Ok');
      if (!hasErr) missing.push('Err');
      if (missing.length > 0) reportMissing(missing, span, errors);
      return;
    }

    case 'User': {
      const variants = adtVariants.get(scrutineeType.name);
      if (variants === null || variants === undefined) {
        // Unknown ADT — require a wildcard arm.
        reportMissing(['<wildcard>'], span, errors);
        return;
      }
      const covered = new Set<string>();
      for (const arm of arms) {
        for (const tag of coveredTags(arm.pattern)) covered.add(tag);
      }
      const missing = variants.filter(v => !covered.has(v));
      if (missing.length > 0) reportMissing(missing, span, errors);
      return;
    }

    default:
      reportMissing(['<wildcard>'], span, errors);
  }
}

/** An unguarded wildcard or unguarded ident pattern covers any value. */
function isUnguardedWildcard(arm: AstMatchArm): boolean {
  if (arm.guard !== null) return false;
  return arm.pattern.kind === 'WildcardPat' || arm.pattern.kind === 'IdentPat';
}

function matchesBoolLit(pattern: AstPatternNode, value: boolean): boolean {
  return (
    pattern.kind === 'LiteralPat' &&
    pattern.value.kind === 'LiteralBool' &&
    pattern.value.value === value
  );
}

function coveredTags(pattern: AstPatternNode): string[] {
  if (pattern.kind === 'ConstructorPat') return [pattern.tag];
  return [];
}

function reportMissing(missing: string[], span: Span, errors: CheckError[]): void {
  errors.push({
    kind: 'NonExhaustiveMatch',
    code: 'E0403',
    missing,
    span,
    message: `Non-exhaustive match: missing cases ${missing.join(', ')}`,
    suggestion: `Add arm(s) for: ${missing.join(', ')}`,
  });
}
