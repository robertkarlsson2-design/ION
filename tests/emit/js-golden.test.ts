import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IonIRModule,
  LetNode,
  AbsNode,
  AppNode,
  ForeignRefNode,
} from '../../src/ir/nodes.js';
import type { Span, SymbolId } from '../../src/types.js';
import type { IonType } from '../../src/ir/types.js';
import { emitModule } from '../../skills/javascript/emitter.js';

const GOLDEN_DIR = join(import.meta.dirname, '../golden/emit/js');

const span: Span = { file: 'test.ion', startLine: 1, startCol: 0, endLine: 1, endCol: 10 };
const tInt: IonType = { kind: 'Int' };
const tStr: IonType = { kind: 'Str' };
const tUnit: IonType = { kind: 'Unit' };

function sid(s: string): SymbolId {
  return s as SymbolId;
}

// ---------------------------------------------------------------------------
// Golden: identity function (Abs + Var)
// ---------------------------------------------------------------------------

describe('golden: identity.ion', () => {
  it('emits expected JsProgram JSON', () => {
    // Represents: let identity = \x -> x
    const identityModule: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [
        {
          kind: 'Let',
          name: 'identity',
          symbolId: sid('test:identity:0'),
          bindingType: { kind: 'Fn', params: [tInt], ret: tInt, effects: new Set() },
          value: {
            kind: 'Abs',
            params: [{ name: 'x', symbolId: sid('test:x:1'), type: tInt, span }],
            body: { kind: 'Var', name: 'x', symbolId: sid('test:x:1'), span, type: tInt },
            captures: [],
            span,
            type: { kind: 'Fn', params: [tInt], ret: tInt, effects: new Set() },
          } satisfies AbsNode,
          body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
          span,
          type: tInt,
        } satisfies LetNode,
      ],
    };

    const prog = emitModule(identityModule);
    const actual = JSON.parse(JSON.stringify(prog));
    const expected = JSON.parse(readFileSync(join(GOLDEN_DIR, 'identity.expected.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Golden: extern-call.ion (ForeignRef template expansion)
// ---------------------------------------------------------------------------

describe('golden: extern-call.ion', () => {
  it('emits expected JsProgram JSON with template-expanded RawExpression', () => {
    // Represents:
    //   extern console_log : (Str) -> Unit = "console.log($1)"
    //   let result = console_log("hello")
    const externCallModule: IonIRModule = {
      ionir: '1.0',
      module: 'test',
      version: '0.1.0',
      dialects: ['core'],
      imports: [],
      data: [],
      decls: [
        {
          kind: 'Let',
          name: 'console_log',
          symbolId: sid('test:console_log:0'),
          bindingType: { kind: 'Fn', params: [tStr], ret: tUnit, effects: new Set() },
          value: {
            kind: 'ForeignRef',
            target: 'js',
            module: 'std',
            symbol: 'console_log',
            sig: { params: [tStr], ret: tUnit, template: 'console.log($1)' },
            span,
            type: { kind: 'Fn', params: [tStr], ret: tUnit, effects: new Set() },
          } satisfies ForeignRefNode,
          body: {
            kind: 'Let',
            name: 'result',
            symbolId: sid('test:result:1'),
            bindingType: tUnit,
            value: {
              kind: 'App',
              callee: {
                kind: 'Var',
                name: 'console_log',
                symbolId: sid('test:console_log:0'),
                span,
                type: { kind: 'Fn', params: [tStr], ret: tUnit, effects: new Set() },
              },
              args: [{ kind: 'Literal', value: { kind: 'Str', value: 'hello' }, span, type: tStr }],
              span,
              type: tUnit,
            } satisfies AppNode,
            body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span, type: tInt },
            span,
            type: tUnit,
          } satisfies LetNode,
          span,
          type: tUnit,
        } satisfies LetNode,
      ],
    };

    const prog = emitModule(externCallModule);
    const actual = JSON.parse(JSON.stringify(prog));
    const expected = JSON.parse(readFileSync(join(GOLDEN_DIR, 'extern-call.expected.json'), 'utf8'));
    expect(actual).toEqual(expected);
  });
});
