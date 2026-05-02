import { describe, it, expect } from 'vitest';
import { emitTS, ionTypeToTs } from '../../emitters/typescript/emit.js';
import type { IonIRModule, IonIRNode } from '../../src/ir/nodes.js';
import type { IonType } from '../../src/ir/types.js';
import { makeSymbolId } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPAN = { file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
const SYM = makeSymbolId('');
const UNIT: IonType = { kind: 'Unit' };

function makeModule(decls: IonIRNode[]): IonIRModule {
  return {
    ionir: '1.0',
    module: 'test',
    version: '0.0.1',
    dialects: [],
    imports: [],
    data: [],
    decls,
  };
}

function userType(name: string, args: IonType[] = []): IonType {
  return { kind: 'User', name, symbolId: SYM, args };
}

function foreignRefNode(
  symbol: string,
  params: { name: string; type: IonType }[],
  ret: IonType,
  template: string,
): IonIRNode {
  return {
    kind: 'ForeignRef',
    target: '',
    module: '',
    symbol,
    sig: {
      params: params.map(p => p.type),
      ret,
      template,
      paramNames: params.map(p => p.name),
    },
    span: SPAN,
    type: UNIT,
  };
}

function letNode(name: string, value: IonIRNode, bindingType: IonType = UNIT): IonIRNode {
  return {
    kind: 'Let',
    name,
    symbolId: SYM,
    bindingType,
    value,
    body: { kind: 'Literal', value: { kind: 'Int', value: 0 }, span: SPAN, type: { kind: 'Int' } },
    span: SPAN,
    type: UNIT,
  };
}

function varNode(name: string): IonIRNode {
  return { kind: 'Var', name, symbolId: SYM, span: SPAN, type: UNIT };
}

// Wraps a ForeignRef Let with a second decl referencing it by name,
// so shakePreludeDecls (DCE) keeps the ForeignRef declaration.
function makeModuleWithForeignRef(name: string, fr: IonIRNode): IonIRModule {
  const foreignLet = letNode(name, fr);
  const usageLet = letNode(`_ref_${name}`, varNode(name));
  return makeModule([foreignLet, usageLet]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ionTypeToTs — opaque FFI types', () => {
  it('User{Request} → "Request"', () => {
    expect(ionTypeToTs(userType('Request'))).toBe('Request');
  });

  it('User{Response} → "Response"', () => {
    expect(ionTypeToTs(userType('Response'))).toBe('Response');
  });

  it('User{Pool} → "Pool"', () => {
    expect(ionTypeToTs(userType('Pool'))).toBe('Pool');
  });

  it('User{Buffer} → "Buffer"', () => {
    expect(ionTypeToTs(userType('Buffer'))).toBe('Buffer');
  });

  it('User{NextFunction} → "NextFunction"', () => {
    expect(ionTypeToTs(userType('NextFunction'))).toBe('NextFunction');
  });
});

describe('ionTypeToTs — generic FFI types', () => {
  it('User{Promise, [Int]} → "Promise<number>"', () => {
    expect(ionTypeToTs(userType('Promise', [{ kind: 'Int' }]))).toBe('Promise<number>');
  });

  it('User{QueryResult, [TypeVar b]} → "QueryResult<unknown>"', () => {
    expect(ionTypeToTs(userType('QueryResult', [{ kind: 'TypeVar', id: 'b' }]))).toBe('QueryResult<unknown>');
  });

  it('User{Observable, [Str]} → "Observable<string>"', () => {
    expect(ionTypeToTs(userType('Observable', [{ kind: 'Str' }]))).toBe('Observable<string>');
  });
});

describe('emitTS — Express middleware integration', () => {
  it('emits ForeignRef wrapped in Let as an arrow function', () => {
    const fr = foreignRefNode(
      'handle',
      [
        { name: 'req', type: userType('Request') },
        { name: 'res', type: userType('Response') },
        { name: 'next', type: userType('NextFunction') },
      ],
      UNIT,
      'middleware($1,$2,$3)',
    );
    const out = emitTS(makeModuleWithForeignRef('handle', fr));
    expect(out).toContain('const handle');
    expect(out).toContain('req: Request');
    expect(out).toContain('res: Response');
    expect(out).toContain('next: NextFunction');
  });

  it('emits ForeignRef with Pool return type correctly', () => {
    const fr = foreignRefNode(
      'getPool',
      [],
      userType('Pool'),
      'new Pool(config)',
    );
    const out = emitTS(makeModuleWithForeignRef('getPool', fr));
    expect(out).toContain('const getPool');
    expect(out).toContain('Pool');
  });

  it('emits ForeignRef with generic QueryResult return type', () => {
    const fr = foreignRefNode(
      'runQuery',
      [{ name: 'sql', type: { kind: 'Str' } }],
      userType('QueryResult', [{ kind: 'TypeVar', id: 'row' }]),
      'pool.query($1)',
    );
    const out = emitTS(makeModuleWithForeignRef('runQuery', fr));
    expect(out).toContain('const runQuery');
    expect(out).toContain('sql: string');
    expect(out).toContain('QueryResult<unknown>');
  });
});
