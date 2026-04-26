import { describe, it, expect } from 'vitest';
import { emitTsDts } from '../../emitters/typescript/emit-dts.js';
import { lex } from '../../src/lexer/index.js';
import { parseModule } from '../../src/parser/declarations.js';
import { buildModule } from '../../src/ast/builder.js';
import { bindModule } from '../../src/binder/index.js';
import { checkModule } from '../../src/checker/index.js';
import { desugarModule } from '../../src/desugar/index.js';
import type {
  IonIRModule,
  OopClassNode,
  OopInterfaceNode,
  EffectDeclNode,
} from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import type { Span } from '../../src/types.js';
import type { SymbolId } from '../../src/types.js';

/** End-to-end pipeline: Ion source string → emitted .d.ts string. */
function compile(src: string, moduleName = 'TestModule'): string {
  const tokens = lex(src, `${moduleName}.ion`);
  const cst = parseModule(tokens);
  const ast = buildModule(cst);
  const bind = bindModule(ast, moduleName);
  const check = checkModule(ast, bind, moduleName);
  const ir = desugarModule(ast, bind, check, moduleName, '0.0.0');
  return emitTsDts(ir);
}

// ---------------------------------------------------------------------------
// Direct IR construction helpers
// ---------------------------------------------------------------------------

const S: Span = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const sym = (s: string): SymbolId => s as SymbolId;
const STR: IonType = { kind: 'Str' };
const INT: IonType = { kind: 'Int' };
const UNIT: IonType = { kind: 'Unit' };
const BOOL: IonType = { kind: 'Bool' };

function makeModule(decls: IonIRModule['decls'], data: IonIRModule['data'] = []): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test',
    version: '0.0.0',
    dialects: ['core'],
    imports: [],
    data,
    decls,
  };
}

// ---------------------------------------------------------------------------
// Module structure
// ---------------------------------------------------------------------------

describe('emitTsDts — module structure', () => {
  it('does not emit "use strict"', () => {
    const out = compile('fn id(x: Int) -> Int = x');
    expect(out).not.toContain('"use strict"');
  });

  it('does not emit prelude declarations', () => {
    const out = compile('fn squares(n: Int) -> Int = n * n');
    expect(out).not.toContain('const map');
    expect(out).not.toContain('const filter');
    expect(out).not.toContain('const range');
    expect(out).not.toContain('const fold');
  });

  it('does not emit function bodies', () => {
    const out = compile('fn add(a: Int, b: Int) -> Int = a + b');
    expect(out).not.toContain('return');
    expect(out).not.toContain('=>');
    expect(out).not.toContain('{');
  });
});

// ---------------------------------------------------------------------------
// Let function declarations
// ---------------------------------------------------------------------------

describe('emitTsDts — function declarations', () => {
  it('emits a zero-param function as declare function', () => {
    const out = compile('fn answer() -> Int = 42');
    expect(out).toContain('export declare function answer(): number;');
  });

  it('emits typed parameters and return type', () => {
    const out = compile('fn add(a: Int, b: Int) -> Int = a + b');
    expect(out).toContain('export declare function add(a: number, b: number): number;');
  });

  it('emits a string-returning function', () => {
    const out = compile('fn greet(name: Str) -> Str = name');
    expect(out).toContain('export declare function greet(name: string): string;');
  });

  it('emits a boolean-returning function', () => {
    const out = compile('fn positive(n: Int) -> Bool = n > 0');
    expect(out).toContain('export declare function positive(n: number): boolean;');
  });
});

// ---------------------------------------------------------------------------
// Let constant declarations
// ---------------------------------------------------------------------------

describe('emitTsDts — const declarations', () => {
  it('emits a typed constant as declare const', () => {
    const out = compile('let pi: Float = 3.14');
    expect(out).toContain('export declare const pi: number;');
  });

  it('emits an integer constant as declare const', () => {
    const out = compile('let answer: Int = 42');
    expect(out).toContain('export declare const answer: number;');
  });
});

// ---------------------------------------------------------------------------
// ADT declarations
// ---------------------------------------------------------------------------

describe('emitTsDts — ADT unit variants', () => {
  it('emits a union type alias for the ADT name', () => {
    const out = compile('data Direction = North | South | East | West');
    expect(out).toContain(
      'export type Direction = { _tag: "North" } | { _tag: "South" } | { _tag: "East" } | { _tag: "West" };',
    );
  });

  it('emits export declare const for each unit variant', () => {
    const out = compile('data Direction = North | South | East | West');
    expect(out).toContain('export declare const North: { readonly _tag: "North" };');
    expect(out).toContain('export declare const South: { readonly _tag: "South" };');
    expect(out).toContain('export declare const East: { readonly _tag: "East" };');
    expect(out).toContain('export declare const West: { readonly _tag: "West" };');
  });
});

describe('emitTsDts — ADT record variants', () => {
  it('emits a union type alias with field shapes', () => {
    const out = compile('data Point = Point { x: Int; y: Int }');
    expect(out).toContain('export type Point = { _tag: "Point"; x: number; y: number };');
  });

  it('emits export declare function for record variants', () => {
    const out = compile('data Point = Point { x: Int; y: Int }');
    expect(out).toContain('export declare function Point(x: number, y: number): Point;');
  });

  it('emits mixed unit and record variants', () => {
    const out = compile('data Shape = Circle { radius: Float } | Square { side: Float } | Empty');
    expect(out).toContain('export type Shape = ');
    expect(out).toContain('export declare function Circle(radius: number): Shape;');
    expect(out).toContain('export declare function Square(side: number): Shape;');
    expect(out).toContain('export declare const Empty: { readonly _tag: "Empty" };');
  });
});

// ---------------------------------------------------------------------------
// Extern (ForeignRef) declarations
// ---------------------------------------------------------------------------

describe('emitTsDts — extern declarations', () => {
  it('emits an extern as export declare const with function type', () => {
    const out = compile(
      '@foreign("console", "warn", "console.warn($1)")\nextern fn jsWarn(msg: Str) -> Unit',
    );
    expect(out).toContain('export declare const jsWarn:');
    expect(out).not.toContain('console.warn');
  });

  it('does NOT emit prelude-named externs (overridden by prelude)', () => {
    const out = compile(
      '@foreign("Math", "sqrt", "Math.sqrt($1)")\nextern fn sqrt(x: Float) -> Float',
    );
    // 'sqrt' is a prelude name and should be skipped
    expect(out).not.toContain('declare const sqrt');
    expect(out).not.toContain('declare function sqrt');
  });
});

// ---------------------------------------------------------------------------
// OopClass (direct IR construction)
// ---------------------------------------------------------------------------

describe('emitTsDts — OopClass', () => {
  it('emits export declare class with field type', () => {
    const classNode: OopClassNode = {
      kind: 'OopClass',
      name: 'Dog',
      symbolId: sym('Dog'),
      interfaces: [],
      fields: [{ name: 'name', symbolId: sym('name'), type: STR, span: S }],
      methods: [],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([classNode]));
    expect(out).toContain('export declare class Dog {');
    expect(out).toContain('  name: string;');
    expect(out).toContain('  constructor(name: string);');
  });

  it('emits method signatures without bodies', () => {
    const classNode: OopClassNode = {
      kind: 'OopClass',
      name: 'Cat',
      symbolId: sym('Cat'),
      interfaces: [],
      fields: [],
      methods: [
        {
          name: 'speak',
          symbolId: sym('speak'),
          params: [],
          retType: STR,
          isAbstract: false,
          isStatic: false,
          span: S,
          body: { kind: 'Literal', value: { kind: 'Str', value: 'Meow' }, span: S, type: STR },
        },
      ],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([classNode]));
    expect(out).toContain('  speak(): string;');
    expect(out).not.toContain('Meow');
  });

  it('preserves private visibility on fields', () => {
    const classNode: OopClassNode = {
      kind: 'OopClass',
      name: 'Secret',
      symbolId: sym('Secret'),
      interfaces: [],
      fields: [
        { name: 'token', symbolId: sym('token'), type: STR, span: S, visibility: 'private' },
      ],
      methods: [],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([classNode]));
    expect(out).toContain('  private token: string;');
  });

  it('emits generic type params in class header', () => {
    const classNode: OopClassNode = {
      kind: 'OopClass',
      name: 'Box',
      symbolId: sym('Box'),
      interfaces: [],
      fields: [{ name: 'value', symbolId: sym('value'), type: { kind: 'TypeVar', id: 'T' }, span: S }],
      methods: [],
      span: S,
      type: UNIT,
      typeParams: ['T'],
    };
    const out = emitTsDts(makeModule([classNode]));
    expect(out).toContain('export declare class Box<T> {');
  });

  it('does not emit method bodies', () => {
    const classNode: OopClassNode = {
      kind: 'OopClass',
      name: 'Counter',
      symbolId: sym('Counter'),
      interfaces: [],
      fields: [{ name: 'count', symbolId: sym('count'), type: INT, span: S }],
      methods: [
        {
          name: 'increment',
          symbolId: sym('increment'),
          params: [],
          retType: INT,
          isAbstract: false,
          isStatic: false,
          span: S,
          body: { kind: 'Literal', value: { kind: 'Int', value: 1 }, span: S, type: INT },
        },
      ],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([classNode]));
    expect(out).toContain('  increment(): number;');
    expect(out).not.toContain('return 1');
    expect(out).not.toContain('return 1;');
  });
});

// ---------------------------------------------------------------------------
// OopInterface (direct IR construction)
// ---------------------------------------------------------------------------

describe('emitTsDts — OopInterface', () => {
  it('emits export interface with method signatures', () => {
    const ifaceNode: OopInterfaceNode = {
      kind: 'OopInterface',
      name: 'Animal',
      symbolId: sym('Animal'),
      members: [
        {
          name: 'speak',
          symbolId: sym('speak'),
          type: { kind: 'Fn', params: [], ret: STR, effects: new Set() },
          span: S,
        },
      ],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([ifaceNode]));
    expect(out).toContain('export interface Animal {');
    expect(out).toContain('  speak(): string;');
  });

  it('emits property members', () => {
    const ifaceNode: OopInterfaceNode = {
      kind: 'OopInterface',
      name: 'Named',
      symbolId: sym('Named'),
      members: [
        { name: 'name', symbolId: sym('name'), type: STR, span: S },
      ],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([ifaceNode]));
    expect(out).toContain('  name: string;');
  });

  it('emits generic type params in interface header', () => {
    const ifaceNode: OopInterfaceNode = {
      kind: 'OopInterface',
      name: 'Container',
      symbolId: sym('Container'),
      members: [],
      span: S,
      type: UNIT,
      typeParams: ['T'],
    };
    const out = emitTsDts(makeModule([ifaceNode]));
    expect(out).toContain('export interface Container<T> {');
  });
});

// ---------------------------------------------------------------------------
// EffectDecl (direct IR construction)
// ---------------------------------------------------------------------------

describe('emitTsDts — EffectDecl', () => {
  it('emits effect as export type alias without comment preamble', () => {
    const effectNode: EffectDeclNode = {
      kind: 'EffectDecl',
      name: 'Logger',
      symbolId: sym('Logger'),
      operations: [
        {
          name: 'log',
          params: [{ name: 'msg', symbolId: sym('msg'), type: STR, span: S }],
          retType: UNIT,
          span: S,
        },
      ],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([effectNode]));
    expect(out).toContain('export type Logger_Effect = { log(msg: string): void };');
    expect(out).not.toContain('// Effect:');
  });

  it('emits multiple operations separated by semicolons', () => {
    const effectNode: EffectDeclNode = {
      kind: 'EffectDecl',
      name: 'IO',
      symbolId: sym('IO'),
      operations: [
        {
          name: 'read',
          params: [],
          retType: STR,
          span: S,
        },
        {
          name: 'write',
          params: [{ name: 's', symbolId: sym('s'), type: STR, span: S }],
          retType: UNIT,
          span: S,
        },
      ],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([effectNode]));
    expect(out).toContain('read(): string; write(s: string): void');
  });

  it('does not include the Effect: comment', () => {
    const effectNode: EffectDeclNode = {
      kind: 'EffectDecl',
      name: 'State',
      symbolId: sym('State'),
      operations: [
        { name: 'get', params: [], retType: INT, span: S },
      ],
      span: S,
      type: UNIT,
    };
    const out = emitTsDts(makeModule([effectNode]));
    expect(out).not.toContain('// Effect:');
    expect(out).toContain('export type State_Effect');
  });
});

// ---------------------------------------------------------------------------
// RawInject passthrough
// ---------------------------------------------------------------------------

describe('emitTsDts — output quality', () => {
  it('all declarations start with export', () => {
    const out = compile(
      'fn add(a: Int, b: Int) -> Int = a + b\nlet count: Int = 0',
    );
    for (const line of out.split('\n').filter(l => l.trim().length > 0)) {
      expect(line).toMatch(/^export /);
    }
  });
});
