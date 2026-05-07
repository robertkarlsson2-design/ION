import { describe, it, expect } from 'vitest';
import { emitTS, normalizeModuleSpecifier } from '../../emitters/typescript/emit.js';
import type { IonIRModule } from '../../src/ir/nodes.js';

/**
 * Regression test for the relative-import-extension bug.
 *
 * TypeScript with `module: ESNext` + `moduleResolution: Bundler` preserves
 * extensionless relative imports (`./foo`) in the emitted .js. Node 22 in
 * pure-ESM mode then refuses to resolve them with `ERR_MODULE_NOT_FOUND`.
 *
 * Fix: the TS emitter now appends `.js` to relative module specifiers when
 * they don't already carry a known extension. Bare package imports (`express`,
 * `@scope/pkg`) are untouched.
 */
describe('TS emitter — relative imports get .js extension (Node ESM compat)', () => {
  describe('normalizeModuleSpecifier', () => {
    it('appends .js to extensionless relative paths', () => {
      expect(normalizeModuleSpecifier('./foo')).toBe('./foo.js');
      expect(normalizeModuleSpecifier('./foo/bar')).toBe('./foo/bar.js');
      expect(normalizeModuleSpecifier('../bar/baz')).toBe('../bar/baz.js');
      expect(normalizeModuleSpecifier('../../middleware/auth')).toBe('../../middleware/auth.js');
      expect(normalizeModuleSpecifier('./')).toBe('./.js'); // edge case — no name
    });

    it('leaves bare package specifiers alone', () => {
      expect(normalizeModuleSpecifier('express')).toBe('express');
      expect(normalizeModuleSpecifier('pg')).toBe('pg');
      expect(normalizeModuleSpecifier('@scope/pkg')).toBe('@scope/pkg');
      expect(normalizeModuleSpecifier('@scope/pkg-name')).toBe('@scope/pkg-name');
      expect(normalizeModuleSpecifier('react-dom/client')).toBe('react-dom/client');
    });

    it('leaves already-extensioned relative paths alone', () => {
      expect(normalizeModuleSpecifier('./foo.js')).toBe('./foo.js');
      expect(normalizeModuleSpecifier('./foo.mjs')).toBe('./foo.mjs');
      expect(normalizeModuleSpecifier('./foo.cjs')).toBe('./foo.cjs');
      expect(normalizeModuleSpecifier('./foo.ts')).toBe('./foo.ts');
      expect(normalizeModuleSpecifier('./foo.tsx')).toBe('./foo.tsx');
      expect(normalizeModuleSpecifier('./config.json')).toBe('./config.json');
      expect(normalizeModuleSpecifier('../bar/baz.js')).toBe('../bar/baz.js');
    });

    it('is case-insensitive on extension check', () => {
      expect(normalizeModuleSpecifier('./Foo.JS')).toBe('./Foo.JS');
      expect(normalizeModuleSpecifier('./Foo.TS')).toBe('./Foo.TS');
    });
  });

  describe('emitTS — full pipeline', () => {
    it('emits relative imports with .js extension on named imports', async () => {
      const { decodeModule } = await import('../../src/wire/decoder.js');
      // Reference a named export from a relative module path
      const wire =
        'I1\nM test v=0.1.0 d=core\nF let r:any=app(ffi:js:./routes/health:healthRouter)';
      const ts = emitTS(decodeModule(wire) as IonIRModule);
      expect(ts).toMatch(/import\s*\{\s*healthRouter\s*\}\s*from\s+'\.\/routes\/health\.js';/);
      expect(ts).not.toMatch(/import\s*\{\s*healthRouter\s*\}\s*from\s+'\.\/routes\/health';/);
    });

    it('emits relative imports with .js extension on default imports', async () => {
      const { decodeModule } = await import('../../src/wire/decoder.js');
      const wire =
        'I1\nM test v=0.1.0 d=core\nF let app:any=app(ffi:js:./routes/health:default)';
      const ts = emitTS(decodeModule(wire) as IonIRModule);
      // default-import binding name comes from the module path
      expect(ts).toMatch(/import\s+\w+\s+from\s+'\.\/routes\/health\.js';/);
    });

    it('emits relative imports with .js extension on parent paths', async () => {
      const { decodeModule } = await import('../../src/wire/decoder.js');
      const wire =
        'I1\nM test v=0.1.0 d=core\nF let m:any=app(ffi:js:../../middleware/auth:createAuthMiddleware)';
      const ts = emitTS(decodeModule(wire) as IonIRModule);
      expect(ts).toMatch(/import\s*\{\s*createAuthMiddleware\s*\}\s*from\s+'\.\.\/\.\.\/middleware\/auth\.js';/);
    });

    it('leaves bare package imports unchanged', async () => {
      const { decodeModule } = await import('../../src/wire/decoder.js');
      const wire =
        'I1\nM test v=0.1.0 d=core\nF let r:any=app(ffi:js:express:Router);let p:any=app(ffi:js:pg:Pool)';
      const ts = emitTS(decodeModule(wire) as IonIRModule);
      expect(ts).toMatch(/import\s*\{\s*Router\s*\}\s*from\s+'express';/);
      expect(ts).toMatch(/import\s*\{\s*Pool\s*\}\s*from\s+'pg';/);
      // Should NOT have appended .js to bare specifiers
      expect(ts).not.toMatch(/from\s+'express\.js'/);
      expect(ts).not.toMatch(/from\s+'pg\.js'/);
    });

    it('combines default + named for the same relative module on one line with .js', async () => {
      const { decodeModule } = await import('../../src/wire/decoder.js');
      const wire =
        'I1\nM test v=0.1.0 d=core\nF let r:any=app(ffi:js:./helpers:default);let h:any=app(ffi:js:./helpers:helperFn,0)';
      const ts = emitTS(decodeModule(wire) as IonIRModule);
      // Single combined line, with .js on the relative specifier
      expect(ts).toMatch(/import\s+\w+,\s*\{\s*helperFn\s*\}\s*from\s+'\.\/helpers\.js';/);
    });
  });
});
