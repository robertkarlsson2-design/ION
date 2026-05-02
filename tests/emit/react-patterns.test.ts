/**
 * react-patterns.test.ts
 *
 * Coverage tests for common React idioms that Otouren-v2-style components
 * need: useState, controlled forms, conditional render, list render,
 * useEffect with deps. The emitter doesn't need to invent React semantics —
 * it just needs to keep the structure intact so the resulting .tsx is
 * idiomatic and doesn't force the agent to wrap entire bodies in raw().
 *
 * IR-construction style mirrors tests/emit/react.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { emitReact, emitJsxNode, emitTsExprForReact } from '../../emitters/react/emit.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import { makeSymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Shared helpers (same shape as tests/emit/react.test.ts so a future refactor
// can hoist them into a fixtures module if it wants)
// ---------------------------------------------------------------------------

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const SYM = makeSymbolId('');
const UNIT: IonIRNode['type'] = { kind: 'Unit' };

function strLit(value: string): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Str', value }, span: SPAN, type: { kind: 'Str' } };
}
function intLit(value: number): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Int', value }, span: SPAN, type: { kind: 'Int' } };
}
function nullLit(): IonIRNode {
  return { kind: 'Literal', value: { kind: 'Null' }, span: SPAN, type: { kind: 'Null' } };
}
function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}
function rawNode(code: string): IonIRNode {
  return { kind: 'RawInject', code, span: SPAN, type: UNIT };
}
function appNode(tag: string, attrStr: string, ...children: IonIRNode[]): IonIRNode {
  return {
    kind: 'App',
    callee: varNode(tag),
    args: [strLit(attrStr), ...children],
    span: SPAN,
    type: UNIT,
  };
}
function propAppNode(
  tag: string,
  attrStr: string,
  propDict: { key: string; value: IonIRNode }[],
  ...children: IonIRNode[]
): IonIRNode {
  return {
    kind: 'App',
    callee: varNode(tag),
    args: [strLit(attrStr), ...children],
    propDict,
    span: SPAN,
    type: UNIT,
  };
}
function callNode(callee: IonIRNode, ...args: IonIRNode[]): IonIRNode {
  return { kind: 'App', callee, args, span: SPAN, type: UNIT };
}
function accessor(receiver: IonIRNode, member: string): IonIRNode {
  return { kind: 'Accessor', receiver, member, span: SPAN, type: UNIT };
}
function lambda(params: string[], body: IonIRNode): IonIRNode {
  return {
    kind: 'Abs',
    params: params.map(p => ({ name: p, symbolId: SYM, type: UNIT, span: SPAN })),
    body,
    captures: [],
    span: SPAN,
    type: UNIT,
  };
}
function letChain(bindings: { name: string; value: IonIRNode }[], body: IonIRNode): IonIRNode {
  let cur = body;
  for (let i = bindings.length - 1; i >= 0; i--) {
    const b = bindings[i]!;
    cur = {
      kind: 'Let',
      name: b.name,
      symbolId: SYM,
      bindingType: UNIT,
      value: b.value,
      body: cur,
      span: SPAN,
      type: UNIT,
    };
  }
  return cur;
}
function letDecl(name: string, value: IonIRNode): IonIRNode {
  return {
    kind: 'Let',
    name,
    symbolId: SYM,
    bindingType: UNIT,
    value,
    body: intLit(0),
    span: SPAN,
    type: UNIT,
  };
}
function caseTwo(scrutinee: IonIRNode, trueArm: IonIRNode, falseArm: IonIRNode): IonIRNode {
  return {
    kind: 'Case',
    scrutinee,
    arms: [
      { pattern: { kind: 'Literal', value: { kind: 'Bool', value: true }, span: SPAN }, body: trueArm, span: SPAN },
      { pattern: { kind: 'Wildcard', span: SPAN }, body: falseArm, span: SPAN },
    ],
    span: SPAN,
    type: UNIT,
  };
}
function makeModule(decls: IonIRNode[]): IonIRModule {
  return { ionir: '1.0', module: 'test', version: '0.0.1', dialects: [], imports: [], data: [], decls };
}

// ---------------------------------------------------------------------------
// Pattern 1 — useState destructuring (×N) at the top of a component body
// ---------------------------------------------------------------------------

describe('Pattern 1: useState destructuring', () => {
  it('emits multiple useState bindings as const-statements before the JSX return', () => {
    // const LoginForm = () => {
    //   const [email, setEmail] = useState('');
    //   const [password, setPassword] = useState('');
    //   return <div />;
    // }
    const body = letChain(
      [
        { name: '_email', value: rawNode("const [email, setEmail] = useState('')") },
        { name: '_password', value: rawNode("const [password, setPassword] = useState('')") },
        { name: '_error', value: rawNode('const [error, setError] = useState<string | null>(null)') },
      ],
      appNode('div', '')
    );
    const mod = makeModule([letDecl('LoginForm', lambda([], body))]);
    const out = emitReact(mod);

    // Block-form arrow function (not an immediate-return arrow).
    expect(out).toContain('const LoginForm: React.FC = () => {');
    // All three useState calls survived as statements.
    expect(out).toContain("const [email, setEmail] = useState('');");
    expect(out).toContain("const [password, setPassword] = useState('');");
    expect(out).toContain('const [error, setError] = useState<string | null>(null);');
    // Followed by a return that contains the JSX root.
    expect(out).toContain('return');
    expect(out).toContain('<div>');
  });
});

// ---------------------------------------------------------------------------
// Pattern 2 — async submit handler with try/catch/finally
// ---------------------------------------------------------------------------

describe('Pattern 2: async event handler with try/catch/finally', () => {
  it('keeps a raw async handler intact alongside JSX', () => {
    const handler = rawNode(
      [
        'const handleSubmit = async (e: React.FormEvent) => {',
        '    e.preventDefault();',
        '    setError(null);',
        '    setSubmitting(true);',
        '    try {',
        "      const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });",
        '      auth.login(data.token, data.user);',
        "      navigate('/crews', { replace: true });",
        '    } catch (err) {',
        "      setError((err as Error)?.message ?? 'Login failed');",
        '    } finally {',
        '      setSubmitting(false);',
        '    }',
        '  }',
      ].join('\n')
    );
    const body = letChain(
      [{ name: '_handler', value: handler }],
      appNode('form', 'onsubmit=handleSubmit',
        appNode('button', 'type=submit', strLit('Sign in'))
      )
    );
    const mod = makeModule([letDecl('LoginForm', lambda([], body))]);
    const out = emitReact(mod);

    // The whole try/catch/finally block survived as code, untouched.
    expect(out).toContain('const handleSubmit = async');
    expect(out).toContain('try {');
    expect(out).toContain('} catch (err) {');
    expect(out).toContain('} finally {');
    expect(out).toContain('setSubmitting(false);');
    // The form is still emitted as JSX with the handler bound by name.
    expect(out).toContain('<form onSubmit={handleSubmit}>');
    expect(out).toContain('type="submit"');
  });
});

// ---------------------------------------------------------------------------
// Pattern 3 — conditional render: {error && <p>{error}</p>}
// ---------------------------------------------------------------------------

describe('Pattern 3: conditional render with && short-circuit', () => {
  it('emits `cond && (<jsx/>)` when the false arm is null', () => {
    const errPara = appNode('p', 'class=error', varNode('error'));
    const cond = caseTwo(varNode('error'), errPara, nullLit());
    const out = emitJsxNode(cond);
    expect(out).toContain('error && (');
    expect(out).toContain('<p className="error">');
    // No empty parens like `: ()` should ever appear.
    expect(out).not.toMatch(/:\s*\(\s*\)/);
    expect(out).not.toContain(': null'); // && form is preferred
  });

  it('still emits ternary when both arms are JSX', () => {
    const yes = appNode('span', '', strLit('yes'));
    const no = appNode('span', '', strLit('no'));
    const cond = caseTwo(varNode('isActive'), yes, no);
    const out = emitJsxNode(cond);
    expect(out).toContain('isActive ? (');
    expect(out).toContain(') : (');
    expect(out).toContain('"yes"');
    expect(out).toContain('"no"');
  });
});

// ---------------------------------------------------------------------------
// Pattern 4 — controlled form input: value={email} onChange={...}
// ---------------------------------------------------------------------------

describe('Pattern 4: controlled inputs', () => {
  it('emits value={email} (expression) instead of value="email" (string)', () => {
    const node = appNode('input', 'type=email value=email');
    const out = emitJsxNode(node);
    expect(out).toContain('type="email"');
    expect(out).toContain('value={email}');
    expect(out).not.toContain('value="email"');
  });

  it('preserves explicit {expr} brace markers verbatim', () => {
    // value={e.target.value} can be written directly as the attr value when
    // the expression is more complex than a bare identifier.
    const node = appNode('button', 'disabled={submitting}', strLit('Submit'));
    const out = emitJsxNode(node);
    expect(out).toContain('disabled={submitting}');
    expect(out).not.toContain('disabled="{submitting}"');
  });

  it('maps onchange=handler to onChange={handler}', () => {
    const node = appNode('input', 'type=text onchange=onEmailChange');
    const out = emitJsxNode(node);
    expect(out).toContain('onChange={onEmailChange}');
  });
});

// ---------------------------------------------------------------------------
// Pattern 5 — list render with empty-state branch + per-item key
// ---------------------------------------------------------------------------

describe('Pattern 5: list render with empty state', () => {
  it('emits items.map(...) inside JSX braces, with the lambda body as JSX', () => {
    // items.map(item => <li className="row">{item.name}</li>)
    const body = appNode('li', 'class=row', accessor(varNode('item'), 'name'));
    const mapCall = callNode(accessor(varNode('items'), 'map'), lambda(['item'], body));
    const out = emitJsxNode(mapCall);
    expect(out).toContain('{items.map((item) =>');
    expect(out).toContain('<li className="row">');
    expect(out).toContain('item.name');
  });

  it('combines length===0 ternary with map() for "empty state"', () => {
    // {items.length === 0 ? <p>No items</p> : items.map(...)}
    const empty = appNode('p', '', strLit('No items'));
    const filled = callNode(
      accessor(varNode('items'), 'map'),
      lambda(['item'], appNode('li', '', accessor(varNode('item'), 'name')))
    );
    // Build a ternary as a Case where the scrutinee is a raw boolean.
    const cond = caseTwo(rawNode('items.length === 0'), empty, filled);
    const out = emitJsxNode(cond);
    expect(out).toContain('items.length === 0 ? (');
    expect(out).toContain('No items');
    expect(out).toContain('items.map((item) =>');
  });

  it('list render with explicit key={item.id} via propDict emits <Card key={...} item={...} />', () => {
    // items.map(item => <Card key={item.id} item={item} />)
    const cardNode = propAppNode('Card', '', [
      { key: 'key', value: accessor(varNode('item'), 'id') },
      { key: 'item', value: varNode('item') },
    ]);
    const mapCall = callNode(accessor(varNode('items'), 'map'), lambda(['item'], cardNode));
    const out = emitJsxNode(mapCall);
    expect(out).toContain('items.map((item) =>');
    expect(out).toContain('<Card');
    expect(out).toContain('key={item.id}');
    expect(out).toContain('item={item}');
  });

  it('propDict-only component (no attr string) emits only propDict attrs', () => {
    const node = propAppNode('Card', '', [{ key: 'item', value: varNode('selected') }]);
    const out = emitJsxNode(node);
    expect(out).toContain('<Card item={selected} />');
    expect(out).not.toContain('""');
  });

  it('propDict + attr string on HTML element emits both', () => {
    const node = propAppNode('div', 'class=container', [{ key: 'id', value: strLit('root') }]);
    const out = emitJsxNode(node);
    expect(out).toContain('className="container"');
    expect(out).toContain('id={"root"}');
  });
});

// ---------------------------------------------------------------------------
// Pattern 6 — useEffect with dependency array
// ---------------------------------------------------------------------------

describe('Pattern 6: useEffect with deps', () => {
  it('passes a useEffect raw block through verbatim before the JSX return', () => {
    const effect = rawNode(
      [
        'React.useEffect(() => {',
        '    let cancelled = false;',
        '    fetchData(crewId).then((d) => {',
        '      if (!cancelled) setItems(d);',
        '    });',
        '    return () => { cancelled = true; };',
        '  }, [crewId])',
      ].join('\n')
    );
    const body = letChain(
      [
        { name: '_state', value: rawNode('const [items, setItems] = useState<Item[]>([])') },
        { name: '_effect', value: effect },
      ],
      appNode('ul', '')
    );
    const mod = makeModule([letDecl('CrewView', lambda([], body))]);
    const out = emitReact(mod);
    expect(out).toContain('React.useEffect(() => {');
    expect(out).toContain('return () => { cancelled = true; };');
    expect(out).toContain('}, [crewId])');
    expect(out).toContain('<ul>');
  });
});

// ---------------------------------------------------------------------------
// Bonus / regression coverage for the supporting fixes
// ---------------------------------------------------------------------------

describe('Supporting fixes', () => {
  it('renders a non-Var App callee (e.g. obj.method(...)) as a TS expression in JSX braces', () => {
    // Before the fix: any non-Var callee silently emitted `{/* app */}`.
    const callExpr = callNode(accessor(varNode('user'), 'fullName'));
    const out = emitJsxNode(callExpr);
    expect(out).toContain('{user.fullName()}');
    expect(out).not.toContain('/* app */');
  });

  it('renders a capitalised tag as a JSX component reference', () => {
    // <Card item={x} /> when written in Ion as Card("item={x}")
    const card = appNode('Card', 'item={selected}');
    const out = emitJsxNode(card);
    expect(out).toContain('<Card item={selected} />');
  });

  it('top-level Abs with non-Let JSX body still uses arrow-with-paren form (existing path)', () => {
    const mod = makeModule([letDecl('Hello', lambda([], appNode('div', '', strLit('hi'))))]);
    const out = emitReact(mod);
    expect(out).toContain('const Hello: React.FC');
    // Backwards-compat: when there are no statements, no need to switch to block form.
    expect(out).toContain('=> (');
    expect(out).toContain('<div>');
  });

  it('emitTsExprForReact routes an HTML-element App through emitJsxNode', () => {
    // Lambda body is JSX: items.map(item => <li>{item}</li>)
    const out = emitTsExprForReact(lambda(['item'], appNode('li', '', varNode('item'))));
    expect(out).toContain('(item) => (');
    expect(out).toContain('<li>');
  });
});
