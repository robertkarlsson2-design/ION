import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { encodeModule } from '../../src/wire/encoder.js';
import { prettyPrintModule } from '../../src/wire/pretty.js';
import { serializeModule, deserializeModule } from '../../src/ir/serde.js';
import { moduleArb } from './helpers.js';

describe('properties — wire encoder', () => {
  it('P1: encodeModule is deterministic', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        return encodeModule(m) === encodeModule(m);
      }),
      { numRuns: 200 },
    );
  });

  it('P3: encodeModule is serde-stable', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        return encodeModule(deserializeModule(serializeModule(m))) === encodeModule(m);
      }),
      { numRuns: 200 },
    );
  });

  it('P5: encodeModule output is non-empty', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        return encodeModule(m).length > 0;
      }),
      { numRuns: 200 },
    );
  });

  it('P6: wire output has M-header line', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        const output = encodeModule(m);
        return output.split('\n').some(line => line.startsWith('M '));
      }),
      { numRuns: 200 },
    );
  });
});

describe('properties — pretty printer', () => {
  it('P2: prettyPrintModule is deterministic', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        return prettyPrintModule(m) === prettyPrintModule(m);
      }),
      { numRuns: 200 },
    );
  });

  it('P4: prettyPrintModule contains module path', () => {
    fc.assert(
      fc.property(moduleArb, m => {
        return prettyPrintModule(m).includes(m.module);
      }),
      { numRuns: 200 },
    );
  });
});
