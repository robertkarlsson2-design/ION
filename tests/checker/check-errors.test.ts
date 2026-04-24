import { describe, it, expect } from 'vitest';
import { formatCheckError } from '../../src/checker/errors.js';
import type { CheckError } from '../../src/checker/errors.js';
import type { Span } from '../../src/types.js';

const span: Span = { file: 'src/foo.ion', startLine: 5, startCol: 3, endLine: 5, endCol: 10 };

// ---------------------------------------------------------------------------
// E0401 — TypeMismatch
// ---------------------------------------------------------------------------

describe('formatCheckError — E0401 TypeMismatch', () => {
  const err: CheckError = {
    kind: 'TypeMismatch',
    code: 'E0401',
    expected: { kind: 'Int' },
    found: { kind: 'Str' },
    span,
    message: 'Type mismatch: expected Int, got Str',
    suggestion: 'Change the expression to produce Int',
  };

  it('includes error code', () => {
    expect(formatCheckError(err)).toContain('error[E0401]');
  });

  it('includes span location', () => {
    expect(formatCheckError(err)).toContain('src/foo.ion:5:3');
  });

  it('renders expected type', () => {
    expect(formatCheckError(err)).toContain('expected: Int');
  });

  it('renders found type', () => {
    expect(formatCheckError(err)).toContain('found:    Str');
  });

  it('includes suggestion', () => {
    expect(formatCheckError(err)).toContain('suggestion: Change the expression to produce Int');
  });
});

// ---------------------------------------------------------------------------
// E0402 — UnannotatedTopLevel
// ---------------------------------------------------------------------------

describe('formatCheckError — E0402 UnannotatedTopLevel', () => {
  const err: CheckError = {
    kind: 'UnannotatedTopLevel',
    code: 'E0402',
    name: 'myVar',
    expectedAnnotation: ': <Type>',
    span,
    message: `Top-level binding 'myVar' requires a type annotation`,
    suggestion: 'Add a type annotation',
  };

  it('includes error code', () => {
    expect(formatCheckError(err)).toContain('error[E0402]');
  });

  it('renders expectedAnnotation', () => {
    expect(formatCheckError(err)).toContain('expected annotation: : <Type>');
  });

  it('includes suggestion', () => {
    expect(formatCheckError(err)).toContain('suggestion: Add a type annotation');
  });
});

// ---------------------------------------------------------------------------
// E0403 — NonExhaustiveMatch
// ---------------------------------------------------------------------------

describe('formatCheckError — E0403 NonExhaustiveMatch', () => {
  const err: CheckError = {
    kind: 'NonExhaustiveMatch',
    code: 'E0403',
    missing: ['Some', 'None'],
    span,
    message: 'Non-exhaustive match: missing arms for Some, None',
    suggestion: 'Add match arms for Some(_) and None',
  };

  it('includes error code', () => {
    expect(formatCheckError(err)).toContain('error[E0403]');
  });

  it('renders missing arms', () => {
    expect(formatCheckError(err)).toContain('missing arms: Some, None');
  });

  it('includes suggestion', () => {
    expect(formatCheckError(err)).toContain('suggestion: Add match arms for Some(_) and None');
  });
});

// ---------------------------------------------------------------------------
// E0404 — InvalidPropagate
// ---------------------------------------------------------------------------

describe('formatCheckError — E0404 InvalidPropagate', () => {
  const err: CheckError = {
    kind: 'InvalidPropagate',
    code: 'E0404',
    found: { kind: 'Str' },
    expected: 'Option | Result',
    span,
    message: `The '?' operator requires an Option or Result type, got Str`,
    suggestion: `Only use '?' on Option<T> or Result<T, E> values`,
  };

  it('includes error code', () => {
    expect(formatCheckError(err)).toContain('error[E0404]');
  });

  it('renders found type', () => {
    expect(formatCheckError(err)).toContain('found:    Str');
  });

  it('renders expected types', () => {
    expect(formatCheckError(err)).toContain('expected: Option | Result');
  });

  it('includes suggestion', () => {
    expect(formatCheckError(err)).toContain('suggestion:');
  });
});

// ---------------------------------------------------------------------------
// E0405 — EffectMismatch
// ---------------------------------------------------------------------------

describe('formatCheckError — E0405 EffectMismatch', () => {
  it('shows "(none declared)" when no effects are declared', () => {
    const err: CheckError = {
      kind: 'EffectMismatch',
      code: 'E0405',
      unexpected: 'io',
      expected: [],
      span,
      message: `Function 'f' uses undeclared effect 'io'`,
      suggestion: `Add '!io' to the function declaration or remove the use`,
    };
    const formatted = formatCheckError(err);
    expect(formatted).toContain('error[E0405]');
    expect(formatted).toContain('unexpected: io');
    expect(formatted).toContain('expected effects: (none declared)');
    expect(formatted).toContain('suggestion:');
  });

  it('shows declared effects when present', () => {
    const err: CheckError = {
      kind: 'EffectMismatch',
      code: 'E0405',
      unexpected: 'llm',
      expected: ['async'],
      span,
      message: `Function 'f' uses undeclared effect 'llm'`,
      suggestion: `Add '!llm' to the function declaration or remove the use`,
    };
    const formatted = formatCheckError(err);
    expect(formatted).toContain('expected effects: async');
    expect(formatted).toContain('unexpected: llm');
  });
});

// ---------------------------------------------------------------------------
// E0406 — ArityMismatch
// ---------------------------------------------------------------------------

describe('formatCheckError — E0406 ArityMismatch', () => {
  const err: CheckError = {
    kind: 'ArityMismatch',
    code: 'E0406',
    expected: 2,
    found: 3,
    span,
    message: 'Expected 2 argument(s), found 3',
    suggestion: 'Provide exactly 2 argument(s)',
  };

  it('includes error code', () => {
    expect(formatCheckError(err)).toContain('error[E0406]');
  });

  it('renders expected arity', () => {
    expect(formatCheckError(err)).toContain('expected: 2');
  });

  it('renders found arity', () => {
    expect(formatCheckError(err)).toContain('found:    3');
  });

  it('includes suggestion', () => {
    expect(formatCheckError(err)).toContain('suggestion: Provide exactly 2 argument(s)');
  });
});
