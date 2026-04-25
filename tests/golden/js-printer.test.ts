import { describe, it, expect } from 'vitest';
import { printJsModule } from '../../emitters/javascript/printer.js';
import type { JsModule, JsNode } from '../../emitters/javascript/js-ast.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mod(bodyDecls: readonly JsNode[]): JsModule {
  return { kind: 'JsModule', helpers: [], dataDecls: [], bodyDecls };
}

function modWithHelpers(helpers: readonly JsNode[], bodyDecls: readonly JsNode[]): JsModule {
  return { kind: 'JsModule', helpers, dataDecls: [], bodyDecls };
}

function modWithData(dataDecls: readonly JsNode[], bodyDecls: readonly JsNode[]): JsModule {
  return { kind: 'JsModule', helpers: [], dataDecls, bodyDecls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('printJsModule', () => {
  it('always starts with "use strict";', () => {
    const out = printJsModule(mod([]));
    expect(out.startsWith('"use strict";\n')).toBe(true);
  });

  it('prints JsConst with number literal', () => {
    const out = printJsModule(mod([{ kind: 'JsConst', name: 'x', value: { kind: 'JsNumber', value: 42 } }]));
    expect(out).toContain('const x = 42;');
  });

  it('prints JsConst with boolean literal', () => {
    const out = printJsModule(mod([{ kind: 'JsConst', name: 't', value: { kind: 'JsBool', value: true } }]));
    expect(out).toContain('const t = true;');
  });

  it('prints JsConst with null literal', () => {
    const out = printJsModule(mod([{ kind: 'JsConst', name: 'n', value: { kind: 'JsNull' } }]));
    expect(out).toContain('const n = null;');
  });

  it('prints JsString with double quotes', () => {
    const out = printJsModule(mod([{ kind: 'JsConst', name: 's', value: { kind: 'JsString', value: 'hello' } }]));
    expect(out).toContain('const s = "hello";');
  });

  it('escapes backslash and double quote in JsString', () => {
    const out = printJsModule(mod([
      { kind: 'JsConst', name: 's', value: { kind: 'JsString', value: 'a"b\\c' } },
    ]));
    expect(out).toContain('"a\\"b\\\\c"');
  });

  it('escapes newline, carriage return, tab in JsString', () => {
    const out = printJsModule(mod([
      { kind: 'JsConst', name: 's', value: { kind: 'JsString', value: 'a\nb\rc\td' } },
    ]));
    expect(out).toContain('"a\\nb\\rc\\td"');
  });

  it('prints JsArrow with zero params', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'f',
        value: { kind: 'JsArrow', params: [], body: { kind: 'JsNumber', value: 0 } },
      },
    ]));
    expect(out).toContain('() => 0');
  });

  it('prints JsArrow with one param — no parens', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'f',
        value: { kind: 'JsArrow', params: ['x'], body: { kind: 'JsIdent', name: 'x' } },
      },
    ]));
    expect(out).toContain('x => x');
  });

  it('prints JsArrow with multiple params — with parens', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'f',
        value: { kind: 'JsArrow', params: ['a', 'b'], body: { kind: 'JsIdent', name: 'a' } },
      },
    ]));
    expect(out).toContain('(a, b) => a');
  });

  it('wraps object literal body in parens in JsArrow', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'mk',
        value: {
          kind: 'JsArrow', params: ['x'],
          body: {
            kind: 'JsObject',
            props: [{ kind: 'JsObjectProp', key: 'x', value: { kind: 'JsIdent', name: 'x' }, shorthand: true }],
          },
        },
      },
    ]));
    expect(out).toContain('x => ({ x })');
  });

  it('prints JsCall with normal callee', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'r',
        value: {
          kind: 'JsCall',
          callee: { kind: 'JsIdent', name: 'f' },
          args: [{ kind: 'JsNumber', value: 1 }, { kind: 'JsNumber', value: 2 }],
        },
      },
    ]));
    expect(out).toContain('f(1, 2)');
  });

  it('wraps arrow callee in parens in JsCall', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'r',
        value: {
          kind: 'JsCall',
          callee: { kind: 'JsArrow', params: ['x'], body: { kind: 'JsIdent', name: 'x' } },
          args: [{ kind: 'JsNumber', value: 5 }],
        },
      },
    ]));
    expect(out).toContain('(x => x)(5)');
  });

  it('prints JsIife with JsConst and JsReturn', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'r',
        value: {
          kind: 'JsIife',
          body: [
            { kind: 'JsConst', name: 'tmp', value: { kind: 'JsNumber', value: 10 } },
            { kind: 'JsReturn', value: { kind: 'JsIdent', name: 'tmp' } },
          ],
        },
      },
    ]));
    expect(out).toContain('(() => {');
    expect(out).toContain('const tmp = 10;');
    expect(out).toContain('return tmp;');
  });

  it('prints JsIfElse chain (if / else if / else)', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'r',
        value: {
          kind: 'JsIife',
          body: [{
            kind: 'JsIfElse',
            branches: [
              { cond: { kind: 'JsBool', value: true }, body: [{ kind: 'JsReturn', value: { kind: 'JsNumber', value: 1 } }] },
              { cond: { kind: 'JsBool', value: false }, body: [{ kind: 'JsReturn', value: { kind: 'JsNumber', value: 2 } }] },
            ],
            elseBranch: [{ kind: 'JsReturn', value: { kind: 'JsNumber', value: 3 } }],
          }],
        },
      },
    ]));
    expect(out).toContain('if (true)');
    expect(out).toContain('else if (false)');
    expect(out).toContain('else');
    expect(out).toContain('return 1;');
    expect(out).toContain('return 2;');
    expect(out).toContain('return 3;');
  });

  it('prints JsSwitch with JsSwitchCase', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'r',
        value: {
          kind: 'JsIife',
          body: [
            { kind: 'JsConst', name: '_s', value: { kind: 'JsIdent', name: 'x' } },
            {
              kind: 'JsSwitch',
              expr: { kind: 'JsMember', receiver: { kind: 'JsIdent', name: '_s' }, member: '_tag' },
              cases: [
                {
                  kind: 'JsSwitchCase',
                  label: 'Foo',
                  body: [{ kind: 'JsReturn', value: { kind: 'JsNumber', value: 0 } }],
                },
              ],
            },
          ],
        },
      },
    ]));
    expect(out).toContain('switch (_s._tag)');
    expect(out).toContain('case "Foo"');
    expect(out).toContain('return 0;');
  });

  it('prints JsClass with constructor and methods', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsClass',
        name: 'Point',
        ctor: {
          kind: 'JsMethod',
          name: 'constructor',
          params: ['x', 'y'],
          isStatic: false,
          body: [
            {
              kind: 'JsAssign',
              lhs: { kind: 'JsMember', receiver: { kind: 'JsIdent', name: 'this' }, member: 'x' },
              rhs: { kind: 'JsIdent', name: 'x' },
            },
          ],
        },
        methods: [
          {
            kind: 'JsMethod',
            name: 'area',
            params: [],
            isStatic: false,
            body: [{ kind: 'JsReturn', value: { kind: 'JsNumber', value: 0 } }],
          },
        ],
      },
    ]));
    expect(out).toContain('class Point {');
    expect(out).toContain('constructor(x, y)');
    expect(out).toContain('this.x = x;');
    expect(out).toContain('area()');
  });

  it('prints JsClass with extends', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsClass',
        name: 'Child',
        superClass: 'Parent',
        ctor: { kind: 'JsMethod', name: 'constructor', params: [], isStatic: false, body: [] },
        methods: [],
      },
    ]));
    expect(out).toContain('class Child extends Parent {');
  });

  it('prints JsObject with shorthand and explicit props', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'obj',
        value: {
          kind: 'JsObject',
          props: [
            { kind: 'JsObjectProp', key: '_tag', value: { kind: 'JsString', value: 'Foo' }, shorthand: false },
            { kind: 'JsObjectProp', key: 'x', value: { kind: 'JsIdent', name: 'x' }, shorthand: true },
          ],
        },
      },
    ]));
    expect(out).toContain('{ _tag: "Foo", x }');
  });

  it('prints JsTryCatch with JsInstanceof check', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'r',
        value: {
          kind: 'JsIife',
          body: [{
            kind: 'JsTryCatch',
            tryBody: [{ kind: 'JsReturn', value: { kind: 'JsNumber', value: 1 } }],
            catchParam: '_e',
            catchBody: [
              {
                kind: 'JsIfElse',
                branches: [{
                  cond: { kind: 'JsInstanceof', expr: { kind: 'JsIdent', name: '_e' }, className: 'MyError' },
                  body: [{ kind: 'JsReturn', value: { kind: 'JsNumber', value: 0 } }],
                }],
                elseBranch: undefined,
              },
              { kind: 'JsThrow', value: { kind: 'JsIdent', name: '_e' } },
            ],
          }],
        },
      },
    ]));
    expect(out).toContain('try {');
    expect(out).toContain('catch (_e)');
    expect(out).toContain('_e instanceof MyError');
    expect(out).toContain('throw _e;');
  });

  it('prints module output order: use strict, helpers, data decls, body decls', () => {
    const helper: JsNode = { kind: 'JsLineComment', text: 'helper' };
    const dataDecl: JsNode = { kind: 'JsLineComment', text: 'data' };
    const bodyDecl: JsNode = { kind: 'JsConst', name: 'x', value: { kind: 'JsNumber', value: 1 } };
    const m: JsModule = { kind: 'JsModule', helpers: [helper], dataDecls: [dataDecl], bodyDecls: [bodyDecl] };
    const out = printJsModule(m);
    const iStrict = out.indexOf('"use strict"');
    const iHelper = out.indexOf('// helper');
    const iData = out.indexOf('// data');
    const iBody = out.indexOf('const x');
    expect(iStrict).toBeGreaterThan(-1);
    expect(iHelper).toBeGreaterThan(iStrict);
    expect(iData).toBeGreaterThan(iHelper);
    expect(iBody).toBeGreaterThan(iData);
  });

  it('prints JsTemplateLit with string and expression parts', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 's',
        value: {
          kind: 'JsTemplateLit',
          parts: ['Effect: ', { kind: 'JsIdent', name: 'operation' }],
        },
      },
    ]));
    expect(out).toContain('`Effect: ${operation}`');
  });

  it('prints JsBinary expression', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'r',
        value: {
          kind: 'JsBinary', op: '===',
          left: { kind: 'JsIdent', name: 'x' },
          right: { kind: 'JsNumber', value: 0 },
        },
      },
    ]));
    expect(out).toContain('x === 0');
  });

  it('prints JsNew', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'p',
        value: {
          kind: 'JsNew',
          className: 'Point',
          args: [{ kind: 'JsNumber', value: 1 }, { kind: 'JsNumber', value: 2 }],
        },
      },
    ]));
    expect(out).toContain('new Point(1, 2)');
  });

  it('prints JsMember access', () => {
    const out = printJsModule(mod([
      {
        kind: 'JsConst', name: 'v',
        value: { kind: 'JsMember', receiver: { kind: 'JsIdent', name: 'obj' }, member: 'field' },
      },
    ]));
    expect(out).toContain('obj.field');
  });

  it('prints helpers before data decls before body decls (blank line separated)', () => {
    const m = modWithData(
      [{ kind: 'JsLineComment', text: 'ADT: X' }],
      [{ kind: 'JsConst', name: 'y', value: { kind: 'JsNumber', value: 2 } }],
    );
    const out = printJsModule(m);
    const iAdt = out.indexOf('// ADT: X');
    const iY = out.indexOf('const y');
    expect(iAdt).toBeGreaterThan(-1);
    expect(iY).toBeGreaterThan(iAdt);
  });
});
