import { describe, it, expect } from 'vitest';
import { printJsModuleWithMappings } from '../../emitters/javascript/printer.js';
import type { JsModule, JsConst, JsArrow } from '../../emitters/javascript/js-ast.js';
import type { Span } from '../../src/types.js';

const SOURCE_FILE = '/workspace/src/test.ion';

function makeSpan(startLine: number, startCol: number): Span {
  return { file: SOURCE_FILE, startLine, startCol, endLine: startLine, endCol: startCol + 1 };
}

describe('printJsModuleWithMappings', () => {
  it('single const with ionSpan maps to correct generated position', () => {
    // "use strict";\nconst x = 42;\n
    // Line 0: "use strict";
    // Line 1: const x = 42;   ← generatedLine=1, generatedCol=0
    const mod: JsModule = {
      kind: 'JsModule',
      helpers: [],
      dataDecls: [],
      bodyDecls: [
        {
          kind: 'JsConst',
          name: 'x',
          value: { kind: 'JsNumber', value: 42 },
          ionSpan: makeSpan(3, 0),
        } satisfies JsConst,
      ],
    };

    const { source, mappings } = printJsModuleWithMappings(mod, SOURCE_FILE);

    // Output must match printJsModule
    expect(source).toBe('"use strict";\nconst x = 42;\n');

    expect(mappings).toHaveLength(1);
    const m = mappings[0];
    expect(m.generatedLine).toBe(1);
    expect(m.generatedCol).toBe(0);
    expect(m.sourceFile).toBe(SOURCE_FILE);
    // Span.startLine is 1-based → sourceLine must be 0-based: 3 - 1 = 2
    expect(m.sourceLine).toBe(2);
    expect(m.sourceCol).toBe(0);
  });

  it('node with ionSpan undefined produces no mapping', () => {
    const mod: JsModule = {
      kind: 'JsModule',
      helpers: [],
      dataDecls: [],
      bodyDecls: [
        { kind: 'JsConst', name: 'y', value: { kind: 'JsNumber', value: 7 } },
      ],
    };

    const { mappings } = printJsModuleWithMappings(mod, SOURCE_FILE);
    expect(mappings).toHaveLength(0);
  });

  it('two consts: second is on generated line 2', () => {
    // Output:
    // Line 0: "use strict";
    // Line 1: const x = 1;
    // Line 2: const y = 2;
    const mod: JsModule = {
      kind: 'JsModule',
      helpers: [],
      dataDecls: [],
      bodyDecls: [
        {
          kind: 'JsConst',
          name: 'x',
          value: { kind: 'JsNumber', value: 1 },
          ionSpan: makeSpan(1, 0),
        } satisfies JsConst,
        {
          kind: 'JsConst',
          name: 'y',
          value: { kind: 'JsNumber', value: 2 },
          ionSpan: makeSpan(2, 0),
        } satisfies JsConst,
      ],
    };

    const { source, mappings } = printJsModuleWithMappings(mod, SOURCE_FILE);

    expect(source).toBe('"use strict";\nconst x = 1;\nconst y = 2;\n');
    expect(mappings).toHaveLength(2);

    expect(mappings[0].generatedLine).toBe(1);
    expect(mappings[0].generatedCol).toBe(0);
    expect(mappings[0].sourceLine).toBe(0); // 1 - 1

    expect(mappings[1].generatedLine).toBe(2);
    expect(mappings[1].generatedCol).toBe(0);
    expect(mappings[1].sourceLine).toBe(1); // 2 - 1
  });

  it('multi-line: column resets to 0 after a newline', () => {
    // helpers section adds an extra line before bodyDecls
    // "use strict";\n<helperConst>\n<bodyConst>\n
    // Line 0: "use strict";
    // Line 1: const helper = 0;
    // Line 2: const main = 1;
    const mod: JsModule = {
      kind: 'JsModule',
      helpers: [
        {
          kind: 'JsConst',
          name: 'helper',
          value: { kind: 'JsNumber', value: 0 },
          ionSpan: makeSpan(1, 0),
        } satisfies JsConst,
      ],
      dataDecls: [],
      bodyDecls: [
        {
          kind: 'JsConst',
          name: 'main',
          value: { kind: 'JsNumber', value: 1 },
          ionSpan: makeSpan(5, 0),
        } satisfies JsConst,
      ],
    };

    const { source, mappings } = printJsModuleWithMappings(mod, SOURCE_FILE);

    expect(source).toBe('"use strict";\nconst helper = 0;\nconst main = 1;\n');
    expect(mappings).toHaveLength(2);

    // helper: generated line 1, col 0
    expect(mappings[0].generatedLine).toBe(1);
    expect(mappings[0].generatedCol).toBe(0);

    // main: generated line 2, col 0 (column reset after \n)
    expect(mappings[1].generatedLine).toBe(2);
    expect(mappings[1].generatedCol).toBe(0);
  });

  it('arrow function body span is tracked at correct col', () => {
    // const fn = x => x;
    // The arrow's ionSpan should map to col 11 (after "const fn = ")
    const arrowNode: JsArrow = {
      kind: 'JsArrow',
      params: ['x'],
      body: { kind: 'JsIdent', name: 'x' },
      ionSpan: makeSpan(2, 4),
    };
    const mod: JsModule = {
      kind: 'JsModule',
      helpers: [],
      dataDecls: [],
      bodyDecls: [
        { kind: 'JsConst', name: 'fn', value: arrowNode } satisfies JsConst,
      ],
    };

    const { source, mappings } = printJsModuleWithMappings(mod, SOURCE_FILE);

    expect(source).toBe('"use strict";\nconst fn = x => x;\n');
    // Arrow span recorded at position BEFORE "x => x"
    // "const fn = " is 11 chars, so col = 11
    const arrowMapping = mappings.find(m => m.sourceLine === 1 && m.sourceCol === 4);
    expect(arrowMapping).toBeDefined();
    expect(arrowMapping?.generatedLine).toBe(1);
    expect(arrowMapping?.generatedCol).toBe(11);
  });
});
