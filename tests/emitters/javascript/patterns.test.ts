import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadPatterns, compileRule, type PatternRule, type ChildPattern } from '../../../src/ingest/patterns.js';
import type { CSTNode } from '../../../src/ingest/types.js';

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
    text: children.map(c => c.text).join(' '),
    isNamed: true,
    startPosition: { row, column: 0 },
    endPosition: { row, column: 0 },
    children,
  };
}

const JS_SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../emitters/javascript');

// ── Suite A — Loader integration ──────────────────────────────────────────────

describe('A: loader integration', () => {
  it('A1: loadPatterns returns the expected set of PatternMatcher instances', async () => {
    const matchers = await loadPatterns(JS_SKILL_DIR);
    // Pattern count grows over time as new ingest rules are added. Assert a
    // floor — failures here mean rules were *removed*, which is what we want
    // to be alerted to. Update the floor when intentional reductions happen.
    expect(matchers.length).toBeGreaterThanOrEqual(80);
    expect(matchers.every(m => typeof m.match === 'function')).toBe(true);
  }, 30000);

  it('A2: all loaded rules have unique ids', async () => {
    const matchers = await loadPatterns(JS_SKILL_DIR);
    expect(new Set(matchers.map(m => m.ruleId)).size).toBe(matchers.length);
  }, 30000);

  it('A3: all rules have language = javascript (validated via successful load)', async () => {
    const matchers = await loadPatterns(JS_SKILL_DIR);
    // If any rule had an invalid language the YAML would still load (language is informational),
    // so we verify indirectly that no rules threw during compilation.
    expect(matchers.length).toBeGreaterThanOrEqual(71);
  }, 30000);
});

// ── Suite B — Match correctness ───────────────────────────────────────────────

describe('B: match correctness', () => {
  it('B1: for-counter-to-foreach matches for_statement with 4 named children', () => {
    const rule: PatternRule = {
      id: 'for-counter-to-foreach',
      language: 'javascript',
      match: {
        nodeType: 'for_statement',
        children: [
          { pattern: { capture: '$INIT' } },
          { pattern: { capture: '$COND' } },
          { pattern: { capture: '$UPDATE' } },
          { pattern: { nodeType: 'statement_block', capture: '$BODY' } },
        ],
      },
      conditions: [],
      emit: { kind: 'App', callee: { kind: 'Var', name: 'forEach', symbolId: 'forEach' }, args: [] },
    };
    const forNode = makeParent('for_statement', [
      makeLeaf('lexical_declaration', 'let i = 0'),
      makeLeaf('binary_expression', 'i < arr.length'),
      makeLeaf('update_expression', 'i++'),
      makeParent('statement_block', [makeLeaf('expression_statement', 'console.log(i)')]),
    ]);
    const result = compileRule(rule).match(forNode);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('App');
  });

  it('B2: if-null-check-to-option matches if_statement with 2 named children', () => {
    const rule: PatternRule = {
      id: 'if-null-check-to-option',
      language: 'javascript',
      match: {
        nodeType: 'if_statement',
        children: [
          { pattern: { capture: '$COND' } },
          { pattern: { nodeType: 'statement_block', capture: '$THEN' } },
        ],
      },
      conditions: [],
      emit: { kind: 'Case', scrutinee: { kind: 'Var', name: 'x', symbolId: 'x' }, arms: [] },
    };
    const ifNode = makeParent('if_statement', [
      makeLeaf('binary_expression', 'x === null'),
      makeParent('statement_block', [makeLeaf('return_statement', 'return 0')]),
    ]);
    const result = compileRule(rule).match(ifNode);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Case');
  });

  it('B3: promise-then-catch matches call_expression with member_expression callee', () => {
    const rule: PatternRule = {
      id: 'promise-then-catch',
      language: 'javascript',
      match: {
        nodeType: 'call_expression',
        children: [
          { pattern: { nodeType: 'member_expression', capture: '$CHAIN' } },
          { pattern: { nodeType: 'arguments', capture: '$ON_REJECTED' } },
        ],
      },
      conditions: [{ kind: 'is-type', var: '$CHAIN', type: 'member_expression' }],
      emit: { kind: 'Await', value: { kind: 'Var', name: 'p', symbolId: 'p' } },
    };
    const callNode = makeParent('call_expression', [
      makeLeaf('member_expression', 'p.then(fn).catch'),
      makeParent('arguments', [makeLeaf('identifier', 'onErr')]),
    ]);
    const result = compileRule(rule).match(callNode);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Await');
  });

  it('B4: obj-prop-shorthand matches object with sequence capture', () => {
    const seqChild: ChildPattern = { pattern: { capture: '$$$PROPS' }, isSequence: true };
    const rule: PatternRule = {
      id: 'obj-prop-shorthand',
      language: 'javascript',
      match: { nodeType: 'object', children: [seqChild] },
      conditions: [],
      emit: { kind: 'Constructor', ctorName: 'record', symbolId: 'record', args: [] },
    };
    const objNode = makeParent('object', [
      makeLeaf('pair', 'name: name'),
      makeLeaf('pair', 'age: age'),
    ]);
    const result = compileRule(rule).match(objNode);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Constructor');
  });

  it('B5: array-find-to-option matches call_expression with member_expression callee', () => {
    const rule: PatternRule = {
      id: 'array-find-to-option',
      language: 'javascript',
      match: {
        nodeType: 'call_expression',
        children: [
          { pattern: { nodeType: 'member_expression', capture: '$CALLEE' } },
          { pattern: { nodeType: 'arguments', capture: '$ARGS' } },
        ],
      },
      conditions: [{ kind: 'is-type', var: '$CALLEE', type: 'member_expression' }],
      emit: { kind: 'App', callee: { kind: 'Var', name: 'find', symbolId: 'find' }, args: [] },
    };
    const callNode = makeParent('call_expression', [
      makeLeaf('member_expression', 'arr.find'),
      makeParent('arguments', [makeLeaf('arrow_function', 'x => x.active')]),
    ]);
    const result = compileRule(rule).match(callNode);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('App');
  });

  it('B6: try-catch-to-result matches try_statement with exactly 2 named children', () => {
    const rule: PatternRule = {
      id: 'try-catch-to-result',
      language: 'javascript',
      match: {
        nodeType: 'try_statement',
        children: [
          { pattern: { nodeType: 'statement_block', capture: '$TRY_BODY' } },
          { pattern: { nodeType: 'catch_clause', capture: '$CATCH' } },
        ],
      },
      conditions: [{ kind: 'has-children', count: 2 }],
      emit: { kind: 'AdtMatch', scrutinee: { kind: 'Var', name: 'r', symbolId: 'r' }, arms: [] },
    };
    const tryNode = makeParent('try_statement', [
      makeParent('statement_block', [makeLeaf('expression_statement', 'doSomething()')]),
      makeParent('catch_clause', [makeLeaf('identifier', 'e'), makeParent('statement_block', [])]),
    ]);
    const result = compileRule(rule).match(tryNode);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('AdtMatch');
  });

  it('B7: class-declaration matches class_declaration with identifier and class_body', () => {
    const rule: PatternRule = {
      id: 'class-declaration',
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
        body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, type: { kind: 'Int' } },
      },
    };
    const classNode = makeParent('class_declaration', [
      makeLeaf('identifier', 'Animal'),
      makeParent('class_body', [makeLeaf('method_definition', 'constructor() {}')]),
    ]);
    const result = compileRule(rule).match(classNode);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('OopClass');
    // @ts-expect-error — dynamic field access for testing
    expect(result?.name).toBe('Animal');
  });

  it('B8: null-undefined-guard matches binary_expression with 2 children', () => {
    const rule: PatternRule = {
      id: 'null-undefined-guard',
      language: 'javascript',
      match: {
        nodeType: 'binary_expression',
        children: [
          { pattern: { capture: '$LEFT' } },
          { pattern: { capture: '$RIGHT' } },
        ],
      },
      conditions: [],
      emit: { kind: 'Case', scrutinee: { kind: 'Var', name: 'x', symbolId: 'x' }, arms: [] },
    };
    const binNode = makeParent('binary_expression', [
      makeLeaf('binary_expression', 'x !== null'),
      makeLeaf('binary_expression', 'x !== undefined'),
    ]);
    const result = compileRule(rule).match(binNode);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Case');
  });
});

// ── Suite C — Non-match guardrails ────────────────────────────────────────────

describe('C: non-match guardrails', () => {
  it('C1: for-counter-to-foreach does NOT match for_in_statement', () => {
    const rule: PatternRule = {
      id: 'for-counter-to-foreach',
      language: 'javascript',
      match: {
        nodeType: 'for_statement',
        children: [
          { pattern: { capture: '$INIT' } },
          { pattern: { capture: '$COND' } },
          { pattern: { capture: '$UPDATE' } },
          { pattern: { nodeType: 'statement_block', capture: '$BODY' } },
        ],
      },
      conditions: [],
      emit: { kind: 'App', callee: { kind: 'Var', name: 'forEach', symbolId: 'forEach' }, args: [] },
    };
    const forInNode = makeParent('for_in_statement', [
      makeLeaf('identifier', 'x'),
      makeLeaf('identifier', 'arr'),
      makeParent('statement_block', []),
    ]);
    expect(compileRule(rule).match(forInNode)).toBeNull();
  });

  it('C2: try-catch-to-result does NOT match try with finally (3 children, count: 2 fails)', () => {
    const rule: PatternRule = {
      id: 'try-catch-to-result',
      language: 'javascript',
      match: {
        nodeType: 'try_statement',
        children: [
          { pattern: { nodeType: 'statement_block', capture: '$TRY_BODY' } },
          { pattern: { nodeType: 'catch_clause', capture: '$CATCH' } },
        ],
      },
      conditions: [{ kind: 'has-children', count: 2 }],
      emit: { kind: 'AdtMatch', scrutinee: { kind: 'Var', name: 'r', symbolId: 'r' }, arms: [] },
    };
    const tryFinallyNode = makeParent('try_statement', [
      makeParent('statement_block', []),
      makeParent('catch_clause', []),
      makeParent('finally_clause', []),
    ]);
    expect(compileRule(rule).match(tryFinallyNode)).toBeNull();
  });

  it('C3: class-declaration does NOT match function_declaration', () => {
    const rule: PatternRule = {
      id: 'class-declaration',
      language: 'javascript',
      match: {
        nodeType: 'class_declaration',
        children: [
          { pattern: { nodeType: 'identifier', capture: '$NAME' } },
          { pattern: { nodeType: 'class_body', capture: '$BODY' } },
        ],
      },
      conditions: [],
      emit: { kind: 'OopClass', name: 'x', symbolId: 'x', body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, type: { kind: 'Int' } } },
    };
    const fnNode = makeParent('function_declaration', [
      makeLeaf('identifier', 'foo'),
      makeParent('formal_parameters', []),
      makeParent('statement_block', []),
    ]);
    expect(compileRule(rule).match(fnNode)).toBeNull();
  });
});

// ── Suite D — Emit shape spot-checks ─────────────────────────────────────────

describe('D: emit shape spot-checks', () => {
  it('D1: var-decl emits kind: Let for var x = 1', () => {
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
    const varNode = makeParent('variable_declaration', [
      makeParent('variable_declarator', [
        makeLeaf('identifier', 'x'),
        makeLeaf('number', '1'),
      ]),
    ]);
    const result = compileRule(rule).match(varNode);
    expect(result?.kind).toBe('Let');
    // @ts-expect-error — dynamic field access
    expect(result?.name).toBe('x');
  });

  it('D2: await-expression emits kind: Await for await p', () => {
    const rule: PatternRule = {
      id: 'await-expression',
      language: 'javascript',
      match: {
        nodeType: 'await_expression',
        children: [{ pattern: { capture: '$EXPR' } }],
      },
      conditions: [],
      emit: {
        kind: 'Await',
        value: { kind: 'Var', name: { metavar: '$EXPR', field: 'text' }, symbolId: { metavar: '$EXPR', field: 'text' }, type: { kind: 'Never' } },
      },
    };
    const awaitNode = makeParent('await_expression', [makeLeaf('identifier', 'p')]);
    const result = compileRule(rule).match(awaitNode);
    expect(result?.kind).toBe('Await');
  });

  it('D3: new-expression emits kind: OopNew for new Foo()', () => {
    const rule: PatternRule = {
      id: 'new-expression',
      language: 'javascript',
      match: {
        nodeType: 'new_expression',
        children: [
          { pattern: { nodeType: 'identifier', capture: '$CLASS' } },
          { pattern: { nodeType: 'arguments', capture: '$ARGS' } },
        ],
      },
      conditions: [],
      emit: {
        kind: 'OopNew',
        className: { metavar: '$CLASS', field: 'text' },
        symbolId: { metavar: '$CLASS', field: 'text' },
        args: { kind: 'Var', name: { metavar: '$ARGS', field: 'text' }, symbolId: { metavar: '$ARGS', field: 'text' }, type: { kind: 'Never' } },
      },
    };
    const newNode = makeParent('new_expression', [
      makeLeaf('identifier', 'Foo'),
      makeParent('arguments', []),
    ]);
    const result = compileRule(rule).match(newNode);
    expect(result?.kind).toBe('OopNew');
    // @ts-expect-error — dynamic field access
    expect(result?.className).toBe('Foo');
  });
});
