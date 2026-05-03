import { describe, it, expect } from 'vitest';
import { emitTS, defaultImportLocalName } from '../../emitters/typescript/emit.js';

/**
 * Regression test for the `ffi:js:<module>:default` emission bug.
 *
 * Before the fix, `ffi:js:express:default` and friends emitted
 *   import { default } from 'express';
 *   const app = default();
 * which is a TS syntax error twice over: `default` is a reserved word and
 * cannot appear as a named-import binding nor as a bare expression. The fix
 * synthesizes a local binding name from the module specifier and emits a
 * default-import + bare-identifier callsite.
 */
describe('TS emitter — `ffi:js:<m>:default` default-import emission', () => {
  it('emits a default import (not a named `{ default }` binding)', async () => {
    const { decodeModule } = await import('../../src/wire/decoder.js');
    // `ffi:js:express:default()` at top level — module-import path + callsite
    const wire = 'I1\nM test v=0.1.0 d=core\nF let app:any=app(ffi:js:express:default)';
    const ts = emitTS(decodeModule(wire));

    // Import line: must NOT use `{ default }` (reserved-word syntax error).
    expect(ts).not.toMatch(/import\s*\{\s*default\s*\}\s*from/);
    // Must emit the canonical default-import form bound to the module name.
    expect(ts).toMatch(/import\s+express\s+from\s+'express';/);

    // Callsite: must NOT bare-call `default(...)` (reserved word).
    expect(ts).not.toMatch(/=\s*default\(/);
    expect(ts).toContain('express()');
  });

  it('mixes default + named imports onto one line', async () => {
    const { decodeModule } = await import('../../src/wire/decoder.js');
    // Module references both `useState` (named) and `default` from `react`.
    const wire =
      'I1\nM test v=0.1.0 d=core\nF let r:any=app(ffi:js:react:default);let h:any=app(ffi:js:react:useState,0)';
    const ts = emitTS(decodeModule(wire));

    // Should be a single combined import line, not two.
    expect(ts).toMatch(/import\s+react,\s*\{\s*useState\s*\}\s*from\s+'react';/);
    expect(ts).not.toMatch(/import\s*\{\s*default\s*\}\s*from\s+'react'/);
  });

  it('synthesizes a valid identifier from a scoped/path module specifier', () => {
    expect(defaultImportLocalName('express')).toBe('express');
    expect(defaultImportLocalName('cors')).toBe('cors');
    expect(defaultImportLocalName('react-dom/client')).toBe('reactDomClient');
    expect(defaultImportLocalName('@scope/pkg-name')).toBe('scopePkgName');
    // Digit-leading specifiers get a leading underscore so the identifier is
    // syntactically valid.
    expect(defaultImportLocalName('123pkg')).toBe('_123pkg');
  });
});
