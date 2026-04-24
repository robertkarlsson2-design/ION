import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { compileRule, loadPatterns, type PatternRule } from '../../../src/ingest/patterns.js';
import type { CSTNode } from '../../../src/ingest/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '../../../skills/javascript');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLeaf(type: string, text = '', row = 0, col = 0): CSTNode {
  return {
    type,
    text,
    isNamed: true,
    startPosition: { row, column: col },
    endPosition: { row, column: col + text.length },
    children: [],
  };
}

function makeParent(type: string, children: CSTNode[], row = 0): CSTNode {
  return {
    type,
    text: children.map(c => c.text).join(''),
    isNamed: true,
    startPosition: { row, column: 0 },
    endPosition: { row, column: 0 },
    children,
  };
}

// ── Group A: Variable declarations and functions ──────────────────────────────

describe('var-decl', () => {
  const rule: PatternRule = {
    id: 'var-decl',
    language: 'javascript',
    match: {
      nodeType: 'variable_declaration',
      children: [
        {
          pattern: {
            nodeType: 'variable_declarator',
            children: [
              { pattern: { nodeType: 'identifier', capture: '$NAME' } },
              { pattern: { capture: '$VALUE' } },
            ],
          },
        },
      ],
    },
    conditions: [{ kind: 'has-children', count: 1 }],
    emit: {
      kind: 'Let',
      name: { metavar: '$NAME', field: 'text' },
      symbolId: { metavar: '$NAME', field: 'text' },
      bindingType: { kind: 'Never' },
      value: { kind: 'Var', name: { metavar: '$VALUE', field: 'text' }, symbolId: { metavar: '$VALUE', field: 'text' }, type: { kind: 'Never' } },
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, type: { kind: 'Int' } },
    },
  };
  const matcher = compileRule(rule);

  it('matches variable_declaration with single declarator → Let', () => {
    const declarator = makeParent('variable_declarator', [makeLeaf('identifier', 'x'), makeLeaf('number', '42')]);
    const node = makeParent('variable_declaration', [declarator]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Let');
    // @ts-expect-error dynamic field
    expect(result?.name).toBe('x');
  });

  it('returns null for variable_declaration with multiple declarators', () => {
    const d1 = makeParent('variable_declarator', [makeLeaf('identifier', 'x'), makeLeaf('number', '1')]);
    const d2 = makeParent('variable_declarator', [makeLeaf('identifier', 'y'), makeLeaf('number', '2')]);
    const node = makeParent('variable_declaration', [d1, d2]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('arrow-fn-1p', () => {
  const rule: PatternRule = {
    id: 'arrow-fn-1p',
    language: 'javascript',
    match: {
      nodeType: 'arrow_function',
      children: [
        { pattern: { nodeType: 'identifier', capture: '$PARAM' } },
        { pattern: { capture: '$BODY' } },
      ],
    },
    conditions: [{ kind: 'is-type', var: '$PARAM', type: 'identifier' }],
    emit: {
      kind: 'Abs',
      params: [{ name: { metavar: '$PARAM', field: 'text' }, symbolId: { metavar: '$PARAM', field: 'text' }, type: { kind: 'Never' }, span: { metavar: '$PARAM', field: 'span' } }],
      body: { kind: 'Var', name: { metavar: '$BODY', field: 'text' }, symbolId: { metavar: '$BODY', field: 'text' }, type: { kind: 'Never' } },
      captures: [],
    },
  };
  const matcher = compileRule(rule);

  it('single-param arrow_function → Abs with correct param name', () => {
    const param = makeLeaf('identifier', 'x');
    const body = makeLeaf('identifier', 'x');
    const node = makeParent('arrow_function', [param, body]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Abs');
  });

  it('returns null for arrow_function with formal_parameters (multi-param)', () => {
    const params = makeLeaf('formal_parameters', '(x, y)');
    const body = makeLeaf('identifier', 'result');
    const node = makeParent('arrow_function', [params, body]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('arrow-fn-np', () => {
  const rule: PatternRule = {
    id: 'arrow-fn-np',
    language: 'javascript',
    match: {
      nodeType: 'arrow_function',
      children: [
        { pattern: { nodeType: 'formal_parameters', capture: '$PARAMS' } },
        { pattern: { capture: '$BODY' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'Abs',
      params: [{ name: { metavar: '$PARAMS', field: 'text' }, symbolId: { metavar: '$PARAMS', field: 'text' }, type: { kind: 'Never' }, span: { metavar: '$PARAMS', field: 'span' } }],
      body: { kind: 'Var', name: { metavar: '$BODY', field: 'text' }, symbolId: { metavar: '$BODY', field: 'text' }, type: { kind: 'Never' } },
      captures: [],
    },
  };
  const matcher = compileRule(rule);

  it('multi-param arrow_function → Abs', () => {
    const params = makeLeaf('formal_parameters', '(x, y)');
    const body = makeLeaf('identifier', 'result');
    const node = makeParent('arrow_function', [params, body]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Abs');
  });

  it('returns null for arrow_function with identifier param (single-param)', () => {
    const param = makeLeaf('identifier', 'x');
    const body = makeLeaf('identifier', 'x');
    const node = makeParent('arrow_function', [param, body]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('function-decl', () => {
  const rule: PatternRule = {
    id: 'function-decl',
    language: 'javascript',
    match: {
      nodeType: 'function_declaration',
      children: [
        { pattern: { nodeType: 'identifier', capture: '$NAME' } },
        { pattern: { nodeType: 'formal_parameters', capture: '$PARAMS' } },
        { pattern: { nodeType: 'statement_block', capture: '$BODY' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'Let',
      name: { metavar: '$NAME', field: 'text' },
      symbolId: { metavar: '$NAME', field: 'text' },
      bindingType: { kind: 'Never' },
      value: { kind: 'Abs', params: [], body: { kind: 'Literal', value: { kind: 'Null' }, type: { kind: 'Never' } }, captures: [], type: { kind: 'Never' } },
      body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, type: { kind: 'Int' } },
    },
  };
  const matcher = compileRule(rule);

  it('function_declaration with name/params/body → Let wrapping Abs', () => {
    const name = makeLeaf('identifier', 'foo');
    const params = makeLeaf('formal_parameters', '(x)');
    const body = makeLeaf('statement_block', '{}');
    const node = makeParent('function_declaration', [name, params, body]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Let');
    // @ts-expect-error dynamic field
    expect(result?.name).toBe('foo');
  });

  it('returns null for function_declaration with wrong child count', () => {
    const name = makeLeaf('identifier', 'foo');
    const node = makeParent('function_declaration', [name]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('return-stmt', () => {
  const rule: PatternRule = {
    id: 'return-stmt',
    language: 'javascript',
    match: {
      nodeType: 'return_statement',
      children: [{ pattern: { capture: '$EXPR' } }],
    },
    conditions: [],
    emit: {
      kind: 'Var',
      name: { metavar: '$EXPR', field: 'text' },
      symbolId: { metavar: '$EXPR', field: 'text' },
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('return_statement → Var passthrough', () => {
    const expr = makeLeaf('identifier', 'result');
    const node = makeParent('return_statement', [expr]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Var');
    // @ts-expect-error dynamic field
    expect(result?.name).toBe('result');
  });

  it('returns null for non-return_statement node', () => {
    expect(matcher.match(makeLeaf('expression_statement', 'x'))).toBeNull();
  });
});

// ── Group B: Array/Loop → Functional ─────────────────────────────────────────

describe('for-of-foreach', () => {
  const rule: PatternRule = {
    id: 'for-of-foreach',
    language: 'javascript',
    match: {
      nodeType: 'for_in_statement',
      children: [
        { pattern: { capture: '$BINDING' } },
        { pattern: { capture: '$ITERABLE' } },
        { pattern: { capture: '$BODY' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'App',
      callee: { kind: 'Var', name: 'forEach', symbolId: 'forEach', type: { kind: 'Never' } },
      args: [{ kind: 'Var', name: { metavar: '$ITERABLE', field: 'text' }, symbolId: { metavar: '$ITERABLE', field: 'text' }, type: { kind: 'Never' } }],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('for_in_statement with 3 children → App(forEach)', () => {
    const binding = makeLeaf('lexical_declaration', 'const x');
    const iterable = makeLeaf('identifier', 'arr');
    const body = makeLeaf('statement_block', '{}');
    const node = makeParent('for_in_statement', [binding, iterable, body]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('App');
    // @ts-expect-error dynamic field
    expect(result?.callee?.name).toBe('forEach');
  });

  it('returns null for for_in_statement with wrong child count', () => {
    const node = makeParent('for_in_statement', [makeLeaf('identifier', 'x')]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('array-map', () => {
  const rule: PatternRule = {
    id: 'array-map',
    language: 'javascript',
    match: {
      nodeType: 'call_expression',
      children: [
        { pattern: { nodeType: 'member_expression', children: [{ pattern: { capture: '$OBJ' } }, { pattern: { text: 'map' } }] } },
        { pattern: { nodeType: 'arguments', children: [{ pattern: { capture: '$ARG' } }] } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'App',
      callee: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } },
      args: [{ kind: 'Var', name: { metavar: '$ARG', field: 'text' }, symbolId: { metavar: '$ARG', field: 'text' }, type: { kind: 'Never' } }],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('arr.map(fn) call_expression → App with arr as callee', () => {
    const obj = makeLeaf('identifier', 'arr');
    const method = makeLeaf('property_identifier', 'map');
    const memberExpr = makeParent('member_expression', [obj, method]);
    const arg = makeLeaf('identifier', 'fn');
    const args = makeParent('arguments', [arg]);
    const node = makeParent('call_expression', [memberExpr, args]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('App');
    // @ts-expect-error dynamic field
    expect(result?.callee?.name).toBe('arr');
  });

  it('returns null when method name is not map', () => {
    const obj = makeLeaf('identifier', 'arr');
    const method = makeLeaf('property_identifier', 'forEach');
    const memberExpr = makeParent('member_expression', [obj, method]);
    const arg = makeLeaf('identifier', 'fn');
    const args = makeParent('arguments', [arg]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('array-filter', () => {
  const rule: PatternRule = {
    id: 'array-filter',
    language: 'javascript',
    match: {
      nodeType: 'call_expression',
      children: [
        { pattern: { nodeType: 'member_expression', children: [{ pattern: { capture: '$OBJ' } }, { pattern: { text: 'filter' } }] } },
        { pattern: { nodeType: 'arguments', children: [{ pattern: { capture: '$ARG' } }] } },
      ],
    },
    conditions: [],
    emit: { kind: 'App', callee: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } }, args: [], type: { kind: 'Never' } },
  };
  const matcher = compileRule(rule);

  it('arr.filter(fn) → App', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'arr'), makeLeaf('property_identifier', 'filter')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'pred')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)?.kind).toBe('App');
  });

  it('returns null when method is not filter', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'arr'), makeLeaf('property_identifier', 'map')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'fn')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('array-reduce', () => {
  const rule: PatternRule = {
    id: 'array-reduce',
    language: 'javascript',
    match: {
      nodeType: 'call_expression',
      children: [
        { pattern: { nodeType: 'member_expression', children: [{ pattern: { capture: '$OBJ' } }, { pattern: { text: 'reduce' } }] } },
        { pattern: { nodeType: 'arguments', children: [{ pattern: { capture: '$FN' } }, { pattern: { capture: '$INIT' } }] } },
      ],
    },
    conditions: [],
    emit: { kind: 'App', callee: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } }, args: [], type: { kind: 'Never' } },
  };
  const matcher = compileRule(rule);

  it('arr.reduce(fn, init) → App', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'arr'), makeLeaf('property_identifier', 'reduce')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'reducer'), makeLeaf('number', '0')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)?.kind).toBe('App');
  });

  it('returns null when arg count does not match reduce signature', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'arr'), makeLeaf('property_identifier', 'reduce')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'reducer')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('array-find', () => {
  const rule: PatternRule = {
    id: 'array-find',
    language: 'javascript',
    match: {
      nodeType: 'call_expression',
      children: [
        { pattern: { nodeType: 'member_expression', children: [{ pattern: { capture: '$OBJ' } }, { pattern: { text: 'find' } }] } },
        { pattern: { nodeType: 'arguments', children: [{ pattern: { capture: '$ARG' } }] } },
      ],
    },
    conditions: [],
    emit: { kind: 'App', callee: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } }, args: [], type: { kind: 'Never' } },
  };
  const matcher = compileRule(rule);

  it('arr.find(pred) → App', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'arr'), makeLeaf('property_identifier', 'find')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'pred')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)?.kind).toBe('App');
  });

  it('returns null when method is not find', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'arr'), makeLeaf('property_identifier', 'filter')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'pred')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('array-flatmap', () => {
  const rule: PatternRule = {
    id: 'array-flatmap',
    language: 'javascript',
    match: {
      nodeType: 'call_expression',
      children: [
        { pattern: { nodeType: 'member_expression', children: [{ pattern: { capture: '$OBJ' } }, { pattern: { text: 'flatMap' } }] } },
        { pattern: { nodeType: 'arguments', children: [{ pattern: { capture: '$ARG' } }] } },
      ],
    },
    conditions: [],
    emit: { kind: 'App', callee: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } }, args: [], type: { kind: 'Never' } },
  };
  const matcher = compileRule(rule);

  it('arr.flatMap(fn) → App', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'arr'), makeLeaf('property_identifier', 'flatMap')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'fn')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)?.kind).toBe('App');
  });

  it('returns null when method is not flatMap', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'arr'), makeLeaf('property_identifier', 'map')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'fn')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)).toBeNull();
  });
});

// ── Group C: Null Safety → Option ─────────────────────────────────────────────

describe('null-literal', () => {
  const rule: PatternRule = {
    id: 'null-literal',
    language: 'javascript',
    match: { text: 'null' },
    conditions: [],
    emit: { kind: 'Literal', value: { kind: 'Null' }, type: { kind: 'Never' } },
  };
  const matcher = compileRule(rule);

  it('null leaf node → Literal { Null }', () => {
    const node = makeLeaf('null', 'null');
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Literal');
    // @ts-expect-error dynamic field
    expect(result?.value?.kind).toBe('Null');
  });

  it('returns null for node with text !== null', () => {
    expect(matcher.match(makeLeaf('identifier', 'undefined'))).toBeNull();
  });
});

describe('undefined-literal', () => {
  const rule: PatternRule = {
    id: 'undefined-literal',
    language: 'javascript',
    match: { text: 'undefined' },
    conditions: [],
    emit: { kind: 'Literal', value: { kind: 'Null' }, type: { kind: 'Never' } },
  };
  const matcher = compileRule(rule);

  it('undefined leaf node → Literal { Null }', () => {
    const node = makeLeaf('identifier', 'undefined');
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Literal');
  });

  it('returns null for node with text !== undefined', () => {
    expect(matcher.match(makeLeaf('null', 'null'))).toBeNull();
  });
});

describe('eq-null', () => {
  const rule: PatternRule = {
    id: 'eq-null',
    language: 'javascript',
    match: {
      nodeType: 'binary_expression',
      children: [
        { pattern: { capture: '$LEFT' } },
        { pattern: { text: 'null' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'App',
      callee: { kind: 'Var', name: 'isNull', symbolId: 'isNull', type: { kind: 'Never' } },
      args: [{ kind: 'Var', name: { metavar: '$LEFT', field: 'text' }, symbolId: { metavar: '$LEFT', field: 'text' }, type: { kind: 'Never' } }],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('binary_expression with null rhs → App(isNull)', () => {
    const left = makeLeaf('identifier', 'x');
    const right = makeLeaf('null', 'null');
    const node = makeParent('binary_expression', [left, right]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('App');
    // @ts-expect-error dynamic field
    expect(result?.callee?.name).toBe('isNull');
  });

  it('returns null when rhs is not null', () => {
    const node = makeParent('binary_expression', [makeLeaf('identifier', 'x'), makeLeaf('number', '0')]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('neq-null', () => {
  const rule: PatternRule = {
    id: 'neq-null',
    language: 'javascript',
    match: {
      nodeType: 'binary_expression',
      children: [
        { pattern: { capture: '$LEFT' } },
        { pattern: { text: 'null' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'App',
      callee: { kind: 'Var', name: 'isNotNull', symbolId: 'isNotNull', type: { kind: 'Never' } },
      args: [],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('binary_expression with null rhs → App(isNotNull)', () => {
    const node = makeParent('binary_expression', [makeLeaf('identifier', 'x'), makeLeaf('null', 'null')]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('App');
    // @ts-expect-error dynamic field
    expect(result?.callee?.name).toBe('isNotNull');
  });

  it('returns null for non-binary_expression node', () => {
    expect(matcher.match(makeLeaf('identifier', 'x'))).toBeNull();
  });
});

describe('nullish-coalesce', () => {
  const rule: PatternRule = {
    id: 'nullish-coalesce',
    language: 'javascript',
    match: {
      nodeType: 'binary_expression',
      children: [
        { pattern: { capture: '$LEFT' } },
        { pattern: { capture: '$RIGHT' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'App',
      callee: { kind: 'Var', name: 'coalesce', symbolId: 'coalesce', type: { kind: 'Never' } },
      args: [],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('binary_expression with two operands → App(coalesce)', () => {
    const node = makeParent('binary_expression', [makeLeaf('identifier', 'x'), makeLeaf('identifier', 'y')]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('App');
    // @ts-expect-error dynamic field
    expect(result?.callee?.name).toBe('coalesce');
  });

  it('returns null for non-binary_expression', () => {
    expect(matcher.match(makeLeaf('identifier', 'x'))).toBeNull();
  });
});

// ── Group D: Promise / async-await ────────────────────────────────────────────

describe('await-expr', () => {
  const rule: PatternRule = {
    id: 'await-expr',
    language: 'javascript',
    match: {
      nodeType: 'await_expression',
      children: [{ pattern: { capture: '$EXPR' } }],
    },
    conditions: [],
    emit: {
      kind: 'Await',
      expr: { kind: 'Var', name: { metavar: '$EXPR', field: 'text' }, symbolId: { metavar: '$EXPR', field: 'text' }, type: { kind: 'Never' } },
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('await_expression → Await with inner expr', () => {
    const expr = makeLeaf('identifier', 'promise');
    const node = makeParent('await_expression', [expr]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Await');
    // @ts-expect-error dynamic field
    expect(result?.expr?.name).toBe('promise');
  });

  it('returns null for non-await_expression', () => {
    expect(matcher.match(makeLeaf('identifier', 'promise'))).toBeNull();
  });
});

describe('async-arrow', () => {
  const rule: PatternRule = {
    id: 'async-arrow',
    language: 'javascript',
    match: {
      nodeType: 'arrow_function',
      children: [
        { pattern: { nodeType: 'formal_parameters', capture: '$PARAMS' } },
        { pattern: { capture: '$BODY' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'AsyncBlock',
      body: { kind: 'Abs', params: [], body: { kind: 'Var', name: { metavar: '$BODY', field: 'text' }, symbolId: { metavar: '$BODY', field: 'text' }, type: { kind: 'Never' } }, captures: [], type: { kind: 'Never' } },
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('arrow_function with formal_parameters → AsyncBlock', () => {
    const params = makeLeaf('formal_parameters', '(x)');
    const body = makeLeaf('identifier', 'result');
    const node = makeParent('arrow_function', [params, body]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('AsyncBlock');
  });

  it('returns null for arrow_function with identifier param (no formal_parameters)', () => {
    const param = makeLeaf('identifier', 'x');
    const body = makeLeaf('identifier', 'x');
    const node = makeParent('arrow_function', [param, body]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('promise-then', () => {
  const rule: PatternRule = {
    id: 'promise-then',
    language: 'javascript',
    match: {
      nodeType: 'call_expression',
      children: [
        { pattern: { nodeType: 'member_expression', children: [{ pattern: { capture: '$OBJ' } }, { pattern: { text: 'then' } }] } },
        { pattern: { nodeType: 'arguments', children: [{ pattern: { capture: '$ARG' } }] } },
      ],
    },
    conditions: [],
    emit: { kind: 'App', callee: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } }, args: [], type: { kind: 'Never' } },
  };
  const matcher = compileRule(rule);

  it('p.then(handler) → App', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'p'), makeLeaf('property_identifier', 'then')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'handler')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)?.kind).toBe('App');
  });

  it('returns null when method is not then', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'p'), makeLeaf('property_identifier', 'catch')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'handler')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('promise-catch', () => {
  const rule: PatternRule = {
    id: 'promise-catch',
    language: 'javascript',
    match: {
      nodeType: 'call_expression',
      children: [
        { pattern: { nodeType: 'member_expression', children: [{ pattern: { capture: '$OBJ' } }, { pattern: { text: 'catch' } }] } },
        { pattern: { nodeType: 'arguments', children: [{ pattern: { capture: '$ARG' } }] } },
      ],
    },
    conditions: [],
    emit: { kind: 'App', callee: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } }, args: [], type: { kind: 'Never' } },
  };
  const matcher = compileRule(rule);

  it('p.catch(handler) → App', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'p'), makeLeaf('property_identifier', 'catch')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'errHandler')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)?.kind).toBe('App');
  });

  it('returns null when method is not catch', () => {
    const memberExpr = makeParent('member_expression', [makeLeaf('identifier', 'p'), makeLeaf('property_identifier', 'then')]);
    const args = makeParent('arguments', [makeLeaf('identifier', 'handler')]);
    const node = makeParent('call_expression', [memberExpr, args]);
    expect(matcher.match(node)).toBeNull();
  });
});

// ── Group E: Error Handling → Result ─────────────────────────────────────────

describe('try-catch', () => {
  const rule: PatternRule = {
    id: 'try-catch',
    language: 'javascript',
    match: {
      nodeType: 'try_statement',
      children: [
        { pattern: { nodeType: 'statement_block', capture: '$BODY' } },
        { pattern: { nodeType: 'catch_clause', capture: '$HANDLER' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'Case',
      scrutinee: { kind: 'Literal', value: { kind: 'Null' }, type: { kind: 'Never' } },
      arms: [],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('try_statement with catch_clause → Case', () => {
    const body = makeLeaf('statement_block', '{}');
    const handler = makeLeaf('catch_clause', 'catch(e) {}');
    const node = makeParent('try_statement', [body, handler]);
    expect(matcher.match(node)?.kind).toBe('Case');
  });

  it('returns null for try_statement without catch (1 child)', () => {
    const body = makeLeaf('statement_block', '{}');
    const node = makeParent('try_statement', [body]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('throw-error', () => {
  const rule: PatternRule = {
    id: 'throw-error',
    language: 'javascript',
    match: {
      nodeType: 'throw_statement',
      children: [{ pattern: { nodeType: 'new_expression', capture: '$ERR' } }],
    },
    conditions: [],
    emit: {
      kind: 'Effect',
      effectTag: 'io',
      body: { kind: 'Var', name: { metavar: '$ERR', field: 'text' }, symbolId: { metavar: '$ERR', field: 'text' }, type: { kind: 'Never' } },
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('throw new Error(...) → Effect', () => {
    const err = makeLeaf('new_expression', 'new Error("msg")');
    const node = makeParent('throw_statement', [err]);
    expect(matcher.match(node)?.kind).toBe('Effect');
  });

  it('returns null for throw expr where expr is not new_expression', () => {
    const expr = makeLeaf('identifier', 'err');
    const node = makeParent('throw_statement', [expr]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('new-expr', () => {
  const rule: PatternRule = {
    id: 'new-expr',
    language: 'javascript',
    match: {
      nodeType: 'new_expression',
      children: [
        { pattern: { nodeType: 'identifier', capture: '$CTOR' } },
        { pattern: { nodeType: 'arguments', capture: '$ARGS' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'OopNew',
      ctorSymbolId: { metavar: '$CTOR', field: 'text' },
      args: [],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('new_expression → OopNew with ctor name', () => {
    const ctor = makeLeaf('identifier', 'Foo');
    const args = makeLeaf('arguments', '()');
    const node = makeParent('new_expression', [ctor, args]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('OopNew');
    // @ts-expect-error dynamic field
    expect(result?.ctorSymbolId).toBe('Foo');
  });

  it('returns null for non-new_expression node', () => {
    expect(matcher.match(makeLeaf('call_expression', 'foo()'))).toBeNull();
  });
});

describe('throw-stmt', () => {
  const rule: PatternRule = {
    id: 'throw-stmt',
    language: 'javascript',
    match: {
      nodeType: 'throw_statement',
      children: [{ pattern: { capture: '$EXPR' } }],
    },
    conditions: [],
    emit: {
      kind: 'Effect',
      effectTag: 'io',
      body: { kind: 'Var', name: { metavar: '$EXPR', field: 'text' }, symbolId: { metavar: '$EXPR', field: 'text' }, type: { kind: 'Never' } },
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('throw expr → Effect', () => {
    const expr = makeLeaf('identifier', 'err');
    const node = makeParent('throw_statement', [expr]);
    expect(matcher.match(node)?.kind).toBe('Effect');
  });

  it('returns null for non-throw_statement node', () => {
    expect(matcher.match(makeLeaf('identifier', 'x'))).toBeNull();
  });
});

// ── Group F: Classes and OOP ──────────────────────────────────────────────────

describe('class-decl', () => {
  const rule: PatternRule = {
    id: 'class-decl',
    language: 'javascript',
    match: {
      nodeType: 'class_declaration',
      children: [
        { pattern: { nodeType: 'identifier', capture: '$NAME' } },
        { pattern: { nodeType: 'class_body', capture: '$BODY' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'OopClass',
      name: { metavar: '$NAME', field: 'text' },
      symbolId: { metavar: '$NAME', field: 'text' },
      interfaces: [],
      fields: [],
      methods: [],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('class_declaration → OopClass with class name', () => {
    const name = makeLeaf('identifier', 'Foo');
    const body = makeLeaf('class_body', '{}');
    const node = makeParent('class_declaration', [name, body]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('OopClass');
    // @ts-expect-error dynamic field
    expect(result?.name).toBe('Foo');
  });

  it('returns null for class_declaration with superclass (3 children)', () => {
    const name = makeLeaf('identifier', 'Foo');
    const superClass = makeLeaf('extends_clause', 'extends Bar');
    const body = makeLeaf('class_body', '{}');
    const node = makeParent('class_declaration', [name, superClass, body]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('method-call', () => {
  const rule: PatternRule = {
    id: 'method-call',
    language: 'javascript',
    match: {
      nodeType: 'call_expression',
      children: [
        { pattern: { nodeType: 'member_expression', children: [{ pattern: { capture: '$OBJ' } }, { pattern: { capture: '$METHOD' } }] } },
        { pattern: { capture: '$ARGS' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'OopVirtualCall',
      receiver: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } },
      method: { metavar: '$METHOD', field: 'text' },
      args: [],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('obj.method(args) call_expression → OopVirtualCall', () => {
    const obj = makeLeaf('identifier', 'obj');
    const method = makeLeaf('property_identifier', 'doSomething');
    const memberExpr = makeParent('member_expression', [obj, method]);
    const args = makeLeaf('arguments', '()');
    const node = makeParent('call_expression', [memberExpr, args]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('OopVirtualCall');
    // @ts-expect-error dynamic field
    expect(result?.receiver?.name).toBe('obj');
  });

  it('returns null for call_expression without member_expression callee', () => {
    const fn = makeLeaf('identifier', 'foo');
    const args = makeLeaf('arguments', '()');
    const node = makeParent('call_expression', [fn, args]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('member-access', () => {
  const rule: PatternRule = {
    id: 'member-access',
    language: 'javascript',
    match: {
      nodeType: 'member_expression',
      children: [
        { pattern: { capture: '$OBJ' } },
        { pattern: { capture: '$FIELD' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'Accessor',
      receiver: { kind: 'Var', name: { metavar: '$OBJ', field: 'text' }, symbolId: { metavar: '$OBJ', field: 'text' }, type: { kind: 'Never' } },
      member: { metavar: '$FIELD', field: 'text' },
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('member_expression → Accessor with receiver name and member', () => {
    const obj = makeLeaf('identifier', 'obj');
    const field = makeLeaf('property_identifier', 'foo');
    const node = makeParent('member_expression', [obj, field]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Accessor');
    // @ts-expect-error dynamic field
    expect(result?.receiver?.name).toBe('obj');
    // @ts-expect-error dynamic field
    expect(result?.member).toBe('foo');
  });

  it('returns null for non-member_expression node', () => {
    expect(matcher.match(makeLeaf('identifier', 'obj'))).toBeNull();
  });
});

// ── Group G: Structural Constructs ────────────────────────────────────────────

describe('if-else', () => {
  const rule: PatternRule = {
    id: 'if-else',
    language: 'javascript',
    match: {
      nodeType: 'if_statement',
      children: [
        { pattern: { capture: '$COND' } },
        { pattern: { nodeType: 'statement_block', capture: '$THEN' } },
        { pattern: { nodeType: 'else_clause', capture: '$ELSE' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'Case',
      scrutinee: { kind: 'Var', name: { metavar: '$COND', field: 'text' }, symbolId: { metavar: '$COND', field: 'text' }, type: { kind: 'Never' } },
      arms: [],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('if_statement with else_clause → Case', () => {
    const cond = makeLeaf('parenthesized_expression', '(x)');
    const then = makeLeaf('statement_block', '{}');
    const els = makeLeaf('else_clause', 'else {}');
    const node = makeParent('if_statement', [cond, then, els]);
    expect(matcher.match(node)?.kind).toBe('Case');
  });

  it('returns null for if_statement without else (2 children)', () => {
    const cond = makeLeaf('parenthesized_expression', '(x)');
    const then = makeLeaf('statement_block', '{}');
    const node = makeParent('if_statement', [cond, then]);
    expect(matcher.match(node)).toBeNull();
  });
});

describe('ternary', () => {
  const rule: PatternRule = {
    id: 'ternary',
    language: 'javascript',
    match: {
      nodeType: 'ternary_expression',
      children: [
        { pattern: { capture: '$COND' } },
        { pattern: { capture: '$THEN' } },
        { pattern: { capture: '$ELSE' } },
      ],
    },
    conditions: [],
    emit: {
      kind: 'Case',
      scrutinee: { kind: 'Var', name: { metavar: '$COND', field: 'text' }, symbolId: { metavar: '$COND', field: 'text' }, type: { kind: 'Never' } },
      arms: [],
      type: { kind: 'Never' },
    },
  };
  const matcher = compileRule(rule);

  it('ternary_expression → Case with condition as scrutinee', () => {
    const cond = makeLeaf('identifier', 'x');
    const then = makeLeaf('number', '1');
    const els = makeLeaf('number', '0');
    const node = makeParent('ternary_expression', [cond, then, els]);
    const result = matcher.match(node);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Case');
    // @ts-expect-error dynamic field
    expect(result?.scrutinee?.name).toBe('x');
  });

  it('returns null for non-ternary_expression', () => {
    expect(matcher.match(makeLeaf('identifier', 'x'))).toBeNull();
  });
});

// ── Integration ───────────────────────────────────────────────────────────────

it('loadPatterns from skills/javascript returns at least 30 matchers', async () => {
  const matchers = await loadPatterns(SKILL_DIR);
  expect(matchers.length).toBeGreaterThanOrEqual(30);
});
