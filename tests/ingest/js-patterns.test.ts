import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  loadPatterns,
  compileRule,
  type PatternRule,
  type Condition,
} from '../../src/ingest/patterns.js';
import type { CSTNode, PatternMatcher } from '../../src/ingest/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const JS_PATTERNS_DIR = resolve(__dirname, '../../skills/javascript/patterns');
const JS_SKILL_DIR = resolve(__dirname, '../../skills/javascript');

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

async function writeTempPatterns(files: Record<string, string>): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'ion-js-patterns-test-'));
  const patternsDir = join(base, 'patterns');
  await mkdir(patternsDir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(patternsDir, name), content, 'utf8');
  }
  return base;
}

async function loadOne(fileName: string): Promise<PatternMatcher> {
  const content = await readFile(join(JS_PATTERNS_DIR, fileName), 'utf8');
  const skillDir = await writeTempPatterns({ [fileName]: content });
  const matchers = await loadPatterns(skillDir);
  if (matchers.length !== 1) throw new Error(`Expected 1 matcher for ${fileName}, got ${matchers.length}`);
  return matchers[0]!;
}

function firstMatch(matchers: PatternMatcher[], node: CSTNode) {
  for (const m of matchers) {
    const r = m.match(node);
    if (r !== null) return r;
  }
  return null;
}

// ── Suite: text-equals condition ──────────────────────────────────────────────

describe('text-equals condition', () => {
  function makeTextEqualsRule(value: string): PatternRule {
    const cond: Condition = { kind: 'text-equals', var: '$KW', value };
    return {
      id: 'test',
      language: 'test',
      match: { nodeType: 'keyword', capture: '$KW' },
      conditions: [cond],
      emit: { kind: 'Var', name: 'x', symbolId: 'x' },
    };
  }

  it('C6: passes when captured node text equals condition value', () => {
    const node = makeLeaf('keyword', 'of');
    const matcher = compileRule(makeTextEqualsRule('of'));
    expect(matcher.match(node)).not.toBeNull();
  });

  it('C7: returns null when captured node text does not match', () => {
    const node = makeLeaf('keyword', 'in');
    const matcher = compileRule(makeTextEqualsRule('of'));
    expect(matcher.match(node)).toBeNull();
  });

  it('C8: returns null for sequence captures ($$$BODY)', () => {
    const children = [makeLeaf('a', 'a'), makeLeaf('b', 'b')];
    const parent = makeParent('block', children);
    const cond: Condition = { kind: 'text-equals', var: '$$$BODY', value: 'ab' };
    const rule: PatternRule = {
      id: 'test',
      language: 'test',
      match: {
        nodeType: 'block',
        children: [{ pattern: { capture: '$$$BODY' }, isSequence: true }],
      },
      conditions: [cond],
      emit: { kind: 'Var', name: 'x', symbolId: 'x' },
    };
    expect(compileRule(rule).match(parent)).toBeNull();
  });

  it('C9: is parsed from YAML and works end-to-end via loadPatterns', async () => {
    const yaml = `
id: kw-rule
language: test
match:
  nodeType: kw_node
  capture: $KW
conditions:
  - kind: text-equals
    var: $KW
    value: "async"
emit:
  kind: Var
  name: x
  symbolId: x
`;
    const skillDir = await writeTempPatterns({ 'kw-rule.yaml': yaml });
    const matchers = await loadPatterns(skillDir);
    expect(matchers).toHaveLength(1);
    expect(matchers[0]!.match(makeLeaf('kw_node', 'async'))).not.toBeNull();
    expect(matchers[0]!.match(makeLeaf('kw_node', 'function'))).toBeNull();
  });
});

// ── Suite: node-text-contains condition ──────────────────────────────────────

describe('node-text-contains condition', () => {
  function makeNodeTextContainsRule(text: string): PatternRule {
    const cond: Condition = { kind: 'node-text-contains', text };
    return {
      id: 'test',
      language: 'test',
      match: { nodeType: 'call_expression', capture: '$CALL' },
      conditions: [cond],
      emit: { kind: 'Var', name: 'x', symbolId: 'x' },
    };
  }

  it('C-NT-1: passes when node text includes the target string', () => {
    const node = makeLeaf('call_expression', 'forEach(callback)');
    const matcher = compileRule(makeNodeTextContainsRule('forEach'));
    expect(matcher.match(node)).not.toBeNull();
  });

  it('C-NT-2: returns null when node text does not include the target string', () => {
    const node = makeLeaf('call_expression', 'map(fn)');
    const matcher = compileRule(makeNodeTextContainsRule('forEach'));
    expect(matcher.match(node)).toBeNull();
  });

  it('C-NT-3: is parsed from YAML and works end-to-end via loadPatterns', async () => {
    const yaml = `
id: ntc-rule
language: test
match:
  nodeType: call_expression
  capture: $CALL
conditions:
  - kind: node-text-contains
    text: "forEach"
emit:
  kind: Var
  name: x
  symbolId: x
`;
    const skillDir = await writeTempPatterns({ 'ntc-rule.yaml': yaml });
    const matchers = await loadPatterns(skillDir);
    expect(matchers).toHaveLength(1);
    expect(matchers[0]!.match(makeLeaf('call_expression', 'arr.forEach(fn)'))).not.toBeNull();
    expect(matchers[0]!.match(makeLeaf('call_expression', 'arr.map(fn)'))).toBeNull();
  });
});

// ── Suite: all 71 patterns load ───────────────────────────────────────────────

describe('full pattern set loads without errors', () => {
  it('skills/javascript/patterns/ loads exactly 71 matchers', async () => {
    const matchers = await loadPatterns(JS_SKILL_DIR);
    expect(matchers).toHaveLength(71);
    expect(matchers.every(m => typeof m.match === 'function')).toBe(true);
  }, 30000);
});

// ── Suite: Group 1 — Variable declarations ────────────────────────────────────

describe('Group 1: variable declarations', () => {
  it('let-decl matches variable_declaration with one declarator', async () => {
    const matcher = await loadOne('let-decl.yaml');
    const name = makeLeaf('identifier', 'x');
    const value = makeLeaf('number', '42');
    const declarator = makeParent('variable_declarator', [name, value]);
    const decl = makeParent('variable_declaration', [declarator]);
    const result = matcher.match(decl);
    expect(result?.kind).toBe('Let');
    // @ts-expect-error — dynamic field access for testing
    expect(result?.name).toBe('x');
  });

  it('let-decl rejects variable_declaration with two declarators (has-children: 1)', async () => {
    const matcher = await loadOne('let-decl.yaml');
    const makeDeclarator = (n: string) =>
      makeParent('variable_declarator', [makeLeaf('identifier', n), makeLeaf('number', '0')]);
    const decl = makeParent('variable_declaration', [makeDeclarator('a'), makeDeclarator('b')]);
    expect(matcher.match(decl)).toBeNull();
  });

  it('const-obj-destructure matches lexical_declaration with object_pattern binding', async () => {
    const matcher = await loadOne('const-obj-destructure.yaml');
    const pattern = makeLeaf('object_pattern', '{x}');
    const value = makeLeaf('identifier', 'obj');
    const declarator = makeParent('variable_declarator', [pattern, value]);
    const decl = makeParent('lexical_declaration', [declarator]);
    const result = matcher.match(decl);
    expect(result?.kind).toBe('Let');
  });

  it('const-obj-destructure does not match regular const (identifier binding)', async () => {
    const matcher = await loadOne('const-obj-destructure.yaml');
    const name = makeLeaf('identifier', 'x');
    const value = makeLeaf('number', '1');
    const declarator = makeParent('variable_declarator', [name, value]);
    const decl = makeParent('lexical_declaration', [declarator]);
    expect(matcher.match(decl)).toBeNull();
  });
});

// ── Suite: Group 2 — Function expressions ────────────────────────────────────

describe('Group 2: function expressions', () => {
  it('arrow-fn-block matches arrow_function with statement_block body', async () => {
    const matcher = await loadOne('arrow-fn-block.yaml');
    const params = makeParent('formal_parameters', [makeLeaf('identifier', 'x')]);
    const body = makeParent('statement_block', [makeLeaf('return_statement', 'return x')]);
    const arrow = makeParent('arrow_function', [params, body]);
    const result = matcher.match(arrow);
    expect(result?.kind).toBe('Abs');
  });

  it('arrow-fn-block rejects arrow_function with expression body', async () => {
    const matcher = await loadOne('arrow-fn-block.yaml');
    const params = makeParent('formal_parameters', []);
    const body = makeLeaf('binary_expression', 'x + 1');
    const arrow = makeParent('arrow_function', [params, body]);
    expect(matcher.match(arrow)).toBeNull();
  });

  it('arrow-fn-expr matches arrow_function with non-block body', async () => {
    const matcher = await loadOne('arrow-fn-expr.yaml');
    const params = makeParent('formal_parameters', []);
    const body = makeLeaf('binary_expression', 'x + 1');
    const arrow = makeParent('arrow_function', [params, body]);
    const result = matcher.match(arrow);
    expect(result?.kind).toBe('Abs');
  });

  it('function-decl matches function_declaration with 3 children', async () => {
    const matcher = await loadOne('function-decl.yaml');
    const name = makeLeaf('identifier', 'foo');
    const params = makeParent('formal_parameters', []);
    const body = makeParent('statement_block', []);
    const fn = makeParent('function_declaration', [name, params, body]);
    const result = matcher.match(fn);
    expect(result?.kind).toBe('Let');
    // @ts-expect-error — dynamic field access
    expect(result?.name).toBe('foo');
  });

  it('async-function-decl matches function_declaration with "async" first child', async () => {
    const matcher = await loadOne('async-function-decl.yaml');
    const asyncKw = makeLeaf('identifier', 'async');
    const name = makeLeaf('identifier', 'fetchData');
    const params = makeParent('formal_parameters', []);
    const body = makeParent('statement_block', []);
    const fn = makeParent('function_declaration', [asyncKw, name, params, body]);
    const result = matcher.match(fn);
    expect(result?.kind).toBe('Let');
    // @ts-expect-error — dynamic field access
    expect(result?.name).toBe('fetchData');
  });

  it('async-function-decl rejects when first child is not "async"', async () => {
    const matcher = await loadOne('async-function-decl.yaml');
    const notAsync = makeLeaf('identifier', 'function');
    const name = makeLeaf('identifier', 'foo');
    const params = makeParent('formal_parameters', []);
    const body = makeParent('statement_block', []);
    const fn = makeParent('function_declaration', [notAsync, name, params, body]);
    expect(matcher.match(fn)).toBeNull();
  });
});

// ── Suite: Group 3 — For-loop → functional iteration ─────────────────────────

describe('Group 3: for-loop → functional iteration', () => {
  function makeForInNode(keyword: string): CSTNode {
    const kw = makeLeaf('identifier', keyword);
    const variable = makeLeaf('identifier', 'item');
    const iterable = makeLeaf('identifier', 'arr');
    const body = makeParent('statement_block', []);
    return makeParent('for_in_statement', [kw, variable, iterable, body]);
  }

  it('for-of-loop matches for_in_statement with "of" keyword, emits App', async () => {
    const matcher = await loadOne('for-of-loop.yaml');
    const result = matcher.match(makeForInNode('of'));
    expect(result?.kind).toBe('App');
  });

  it('for-of-loop rejects for_in_statement with "in" keyword', async () => {
    const matcher = await loadOne('for-of-loop.yaml');
    expect(matcher.match(makeForInNode('in'))).toBeNull();
  });

  it('for-in-loop matches for_in_statement with "in" keyword, emits App', async () => {
    const matcher = await loadOne('for-in-loop.yaml');
    const result = matcher.match(makeForInNode('in'));
    expect(result?.kind).toBe('App');
  });

  it('for-in-loop rejects for_in_statement with "of" keyword', async () => {
    const matcher = await loadOne('for-in-loop.yaml');
    expect(matcher.match(makeForInNode('of'))).toBeNull();
  });

  it('while-loop matches while_statement, emits App', async () => {
    const matcher = await loadOne('while-loop.yaml');
    const cond = makeLeaf('identifier', 'running');
    const body = makeParent('statement_block', []);
    const node = makeParent('while_statement', [cond, body]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });
});

// ── Suite: Group 4 — Null / undefined checks → Option ────────────────────────

describe('Group 4: null/undefined checks → Option', () => {
  function makeBinary(leftText: string, opText: string, rightType: string, rightText: string): CSTNode {
    const left = makeLeaf('identifier', leftText);
    const op = makeLeaf('binary_operator', opText);
    const right = makeLeaf(rightType, rightText);
    return makeParent('binary_expression', [left, op, right]);
  }

  it('null-check-strict-eq matches === null, emits App(isNone)', async () => {
    const matcher = await loadOne('null-check-strict-eq.yaml');
    const node = makeBinary('x', '===', 'null', 'null');
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });

  it('null-check-strict-eq rejects !== null', async () => {
    const matcher = await loadOne('null-check-strict-eq.yaml');
    expect(matcher.match(makeBinary('x', '!==', 'null', 'null'))).toBeNull();
  });

  it('null-check-strict-neq matches !== null, emits App(isSome)', async () => {
    const matcher = await loadOne('null-check-strict-neq.yaml');
    const node = makeBinary('x', '!==', 'null', 'null');
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });

  it('undefined-check-strict-eq matches === undefined, emits App(isNone)', async () => {
    const matcher = await loadOne('undefined-check-strict-eq.yaml');
    const node = makeBinary('x', '===', 'identifier', 'undefined');
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });

  it('undefined-check-strict-eq rejects x === "notUndefined"', async () => {
    const matcher = await loadOne('undefined-check-strict-eq.yaml');
    expect(matcher.match(makeBinary('x', '===', 'identifier', 'notUndefined'))).toBeNull();
  });

  it('nullish-coalesce matches ?? binary expression, emits App(getOrElse)', async () => {
    const matcher = await loadOne('nullish-coalesce.yaml');
    const node = makeBinary('x', '??', 'identifier', 'defaultVal');
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });

  it('nullish-coalesce rejects || operator', async () => {
    const matcher = await loadOne('nullish-coalesce.yaml');
    expect(matcher.match(makeBinary('x', '||', 'identifier', 'defaultVal'))).toBeNull();
  });

  it('optional-chain-member matches member_expression with optional_chain child, emits App', async () => {
    const matcher = await loadOne('optional-chain-member.yaml');
    const obj = makeLeaf('identifier', 'user');
    const chain = makeLeaf('optional_chain', '?.');
    const member = makeLeaf('property_identifier', 'name');
    const node = makeParent('member_expression', [obj, chain, member]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });
});

// ── Suite: Group 5 — Promise / async-await ───────────────────────────────────

describe('Group 5: Promise / async-await', () => {
  it('await-expr matches await_expression, emits Await', async () => {
    const matcher = await loadOne('await-expr.yaml');
    const expr = makeLeaf('call_expression', 'fetchData()');
    const node = makeParent('await_expression', [expr]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('Await');
  });

  it('promise-then matches .then(fn) call, emits AsyncBlock', async () => {
    const matcher = await loadOne('promise-then.yaml');
    const obj = makeLeaf('identifier', 'promise');
    const method = makeLeaf('property_identifier', 'then');
    const callee = makeParent('member_expression', [obj, method]);
    const fn = makeLeaf('identifier', 'handler');
    const args = makeParent('arguments', [fn]);
    const node = makeParent('call_expression', [callee, args]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('AsyncBlock');
  });

  it('promise-then rejects .map(fn) call', async () => {
    const matcher = await loadOne('promise-then.yaml');
    const obj = makeLeaf('identifier', 'arr');
    const method = makeLeaf('property_identifier', 'map');
    const callee = makeParent('member_expression', [obj, method]);
    const fn = makeLeaf('identifier', 'handler');
    const args = makeParent('arguments', [fn]);
    const node = makeParent('call_expression', [callee, args]);
    expect(matcher.match(node)).toBeNull();
  });

  it('promise-catch matches .catch(fn) call, emits App', async () => {
    const matcher = await loadOne('promise-catch.yaml');
    const obj = makeLeaf('identifier', 'promise');
    const method = makeLeaf('property_identifier', 'catch');
    const callee = makeParent('member_expression', [obj, method]);
    const fn = makeLeaf('identifier', 'errHandler');
    const args = makeParent('arguments', [fn]);
    const node = makeParent('call_expression', [callee, args]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });
});

// ── Suite: Group 6 — Try / catch → Result ────────────────────────────────────

describe('Group 6: try/catch → Result', () => {
  it('try-catch matches try_statement with 2 children, emits App', async () => {
    const matcher = await loadOne('try-catch.yaml');
    const body = makeParent('statement_block', []);
    const catchClause = makeParent('catch_clause', []);
    const node = makeParent('try_statement', [body, catchClause]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });

  it('try-catch rejects try_statement with 3 children (finally present)', async () => {
    const matcher = await loadOne('try-catch.yaml');
    const body = makeParent('statement_block', []);
    const catchClause = makeParent('catch_clause', []);
    const finallyClause = makeParent('finally_clause', []);
    const node = makeParent('try_statement', [body, catchClause, finallyClause]);
    expect(matcher.match(node)).toBeNull();
  });

  it('try-catch-finally matches try_statement with 3 children, emits App', async () => {
    const matcher = await loadOne('try-catch-finally.yaml');
    const body = makeParent('statement_block', []);
    const catchClause = makeParent('catch_clause', []);
    const finallyClause = makeParent('finally_clause', []);
    const node = makeParent('try_statement', [body, catchClause, finallyClause]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });

  it('throw-stmt matches throw_statement, emits Perform', async () => {
    const matcher = await loadOne('throw-stmt.yaml');
    const expr = makeLeaf('identifier', 'err');
    const node = makeParent('throw_statement', [expr]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('Perform');
  });
});

// ── Suite: Group 7 — Class → OOP dialect ─────────────────────────────────────

describe('Group 7: class → OOP dialect', () => {
  it('class-decl matches class_declaration with 2 children (no extends), emits OopClass', async () => {
    const matcher = await loadOne('class-decl.yaml');
    const name = makeLeaf('identifier', 'Animal');
    const body = makeParent('class_body', []);
    const node = makeParent('class_declaration', [name, body]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('OopClass');
    // @ts-expect-error — dynamic field access
    expect(result?.name).toBe('Animal');
  });

  it('class-decl rejects class_declaration with 3 children (extends present)', async () => {
    const matcher = await loadOne('class-decl.yaml');
    const name = makeLeaf('identifier', 'Dog');
    const heritage = makeParent('class_heritage', [makeLeaf('identifier', 'Animal')]);
    const body = makeParent('class_body', []);
    const node = makeParent('class_declaration', [name, heritage, body]);
    expect(matcher.match(node)).toBeNull();
  });

  it('class-extends matches class_declaration with 3 children, emits OopClass', async () => {
    const matcher = await loadOne('class-extends.yaml');
    const name = makeLeaf('identifier', 'Dog');
    const heritage = makeParent('class_heritage', [makeLeaf('identifier', 'Animal')]);
    const body = makeParent('class_body', []);
    const node = makeParent('class_declaration', [name, heritage, body]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('OopClass');
  });

  it('new-expr matches new_expression, emits OopNew', async () => {
    const matcher = await loadOne('new-expr.yaml');
    const ctor = makeLeaf('identifier', 'MyClass');
    const args = makeParent('arguments', []);
    const node = makeParent('new_expression', [ctor, args]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('OopNew');
  });

  it('method-call matches generic call_expression, emits OopVirtualCall', async () => {
    const matcher = await loadOne('method-call.yaml');
    const obj = makeLeaf('identifier', 'obj');
    const method = makeLeaf('property_identifier', 'doSomething');
    const callee = makeParent('member_expression', [obj, method]);
    const args = makeParent('arguments', []);
    const node = makeParent('call_expression', [callee, args]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('OopVirtualCall');
    // @ts-expect-error — dynamic field access
    expect(result?.method).toBe('doSomething');
  });
});

// ── Suite: Group 8 — Array functional methods ─────────────────────────────────

describe('Group 8: array functional methods', () => {
  function makeCallExpr(objText: string, methodText: string, argNodes: CSTNode[]): CSTNode {
    const obj = makeLeaf('identifier', objText);
    const method = makeLeaf('property_identifier', methodText);
    const callee = makeParent('member_expression', [obj, method]);
    const args = makeParent('arguments', argNodes);
    return makeParent('call_expression', [callee, args]);
  }

  it('array-map matches .map(fn), emits App', async () => {
    const matcher = await loadOne('array-map.yaml');
    const fn = makeLeaf('identifier', 'transform');
    const result = matcher.match(makeCallExpr('arr', 'map', [fn]));
    expect(result?.kind).toBe('App');
  });

  it('array-map rejects .filter(fn)', async () => {
    const matcher = await loadOne('array-map.yaml');
    const fn = makeLeaf('identifier', 'pred');
    expect(matcher.match(makeCallExpr('arr', 'filter', [fn]))).toBeNull();
  });

  it('array-filter matches .filter(fn), emits App', async () => {
    const matcher = await loadOne('array-filter.yaml');
    const fn = makeLeaf('identifier', 'pred');
    const result = matcher.match(makeCallExpr('arr', 'filter', [fn]));
    expect(result?.kind).toBe('App');
  });

  it('array-reduce matches .reduce(fn, init) with 2 args, emits App', async () => {
    const matcher = await loadOne('array-reduce.yaml');
    const fn = makeLeaf('identifier', 'reducer');
    const init = makeLeaf('number', '0');
    const result = matcher.match(makeCallExpr('arr', 'reduce', [fn, init]));
    expect(result?.kind).toBe('App');
  });

  it('array-find-option matches .find(fn), emits App(fromNullable)', async () => {
    const matcher = await loadOne('array-find-option.yaml');
    const fn = makeLeaf('identifier', 'pred');
    const result = matcher.match(makeCallExpr('arr', 'find', [fn]));
    expect(result?.kind).toBe('App');
  });

  it('array-find-option rejects .map(fn)', async () => {
    const matcher = await loadOne('array-find-option.yaml');
    const fn = makeLeaf('identifier', 'fn');
    expect(matcher.match(makeCallExpr('arr', 'map', [fn]))).toBeNull();
  });
});

// ── Suite: Group 9 — String / template ───────────────────────────────────────

describe('Group 9: template literal', () => {
  it('template-literal matches template_string, emits App', async () => {
    const matcher = await loadOne('template-literal.yaml');
    const part = makeLeaf('template_chars', 'Hello world');
    const node = makeParent('template_string', [part]);
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });

  it('template-literal matches empty template string', async () => {
    const matcher = await loadOne('template-literal.yaml');
    const node = makeParent('template_string', []);
    const result = matcher.match(node);
    expect(result?.kind).toBe('App');
  });
});
