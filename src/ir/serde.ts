import { makeSymbolId } from '../types.js';
import type { Span } from '../types.js';
import type { EffectTag } from '../ast/types.js';
import type {
  IonIRModule,
  IonIRNode,
  IonIRDialect,
  ModuleRefNode,
  AdtDeclNode,
  AdtVariant,
  AdtArm,
  AdtMatchNode,
  Param,
  CasePattern,
  CaseArm,
  LiteralValue,
  ForeignSignature,
  OopMethod,
  OopMember,
  OopClassNode,
  OopInterfaceNode,
  OopNewNode,
  OopVirtualCallNode,
  OopThisNode,
  EffectOp,
  EffectHandler,
  EffectDeclNode,
  PerformNode,
  HandleNode,
  ResumeNode,
  VarNode,
  LiteralNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  ConstructorNode,
  AccessorNode,
  ForeignRefNode,
  EffectNode,
  AsyncBlockNode,
  AwaitNode,
} from './nodes.js';
import type { IonType, EffectSet } from './types.js';

export class IonIRSerdeError extends Error {
  public readonly path: string;

  constructor(message: string, path: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'IonIRSerdeError';
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function setReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) {
    return [...(value as Set<unknown>)].sort();
  }
  return value;
}

/** Serializes an IonIRModule to a formatted JSON string. EffectSet is sorted for determinism. */
export function serializeModule(module: IonIRModule): string {
  return JSON.stringify(module, setReplacer, 2);
}

// ---------------------------------------------------------------------------
// Deserializer helpers
// ---------------------------------------------------------------------------

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IonIRSerdeError('expected an object', path);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new IonIRSerdeError('expected a string', path);
  return value;
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== 'number') throw new IonIRSerdeError('expected a number', path);
  return value;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new IonIRSerdeError('expected a boolean', path);
  return value;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new IonIRSerdeError('expected an array', path);
  return value;
}

function parseSpan(raw: unknown, path: string): Span {
  const r = assertRecord(raw, path);
  return {
    file: assertString(r['file'], `${path}.file`),
    startLine: assertNumber(r['startLine'], `${path}.startLine`),
    startCol: assertNumber(r['startCol'], `${path}.startCol`),
    endLine: assertNumber(r['endLine'], `${path}.endLine`),
    endCol: assertNumber(r['endCol'], `${path}.endCol`),
  };
}

function parseEffectSet(raw: unknown, path: string): EffectSet {
  const arr = assertArray(raw, path);
  return new Set(arr.map((t, i) => assertString(t, `${path}[${i}]`) as EffectTag));
}

function parseType(raw: unknown, path: string): IonType {
  const r = assertRecord(raw, path);
  const kind = assertString(r['kind'], `${path}.kind`);
  switch (kind) {
    case 'Int': return { kind: 'Int' };
    case 'Float': return { kind: 'Float' };
    case 'Str': return { kind: 'Str' };
    case 'Bool': return { kind: 'Bool' };
    case 'Null': return { kind: 'Null' };
    case 'Unit': return { kind: 'Unit' };
    case 'Never': return { kind: 'Never' };
    case 'TypeVar': return { kind: 'TypeVar', id: assertString(r['id'], `${path}.id`) };
    case 'List': return { kind: 'List', elem: parseType(r['elem'], `${path}.elem`) };
    case 'Option': return { kind: 'Option', inner: parseType(r['inner'], `${path}.inner`) };
    case 'Map': return {
      kind: 'Map',
      key: parseType(r['key'], `${path}.key`),
      value: parseType(r['value'], `${path}.value`),
    };
    case 'Result': return {
      kind: 'Result',
      ok: parseType(r['ok'], `${path}.ok`),
      err: parseType(r['err'], `${path}.err`),
    };
    case 'Fn': return {
      kind: 'Fn',
      params: assertArray(r['params'], `${path}.params`).map((p, i) => parseType(p, `${path}.params[${i}]`)),
      ret: parseType(r['ret'], `${path}.ret`),
      effects: parseEffectSet(r['effects'], `${path}.effects`),
    };
    case 'User': return {
      kind: 'User',
      name: assertString(r['name'], `${path}.name`),
      symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
      args: assertArray(r['args'], `${path}.args`).map((a, i) => parseType(a, `${path}.args[${i}]`)),
    };
    default:
      throw new IonIRSerdeError(`unknown type kind '${kind}'`, `${path}.kind`);
  }
}

function parseLiteralValue(raw: unknown, path: string): LiteralValue {
  const r = assertRecord(raw, path);
  const kind = assertString(r['kind'], `${path}.kind`);
  switch (kind) {
    case 'Int': return { kind: 'Int', value: assertNumber(r['value'], `${path}.value`) };
    case 'Float': return { kind: 'Float', value: assertNumber(r['value'], `${path}.value`) };
    case 'Str': return { kind: 'Str', value: assertString(r['value'], `${path}.value`) };
    case 'Bool': return { kind: 'Bool', value: assertBoolean(r['value'], `${path}.value`) };
    case 'Null': return { kind: 'Null' };
    default:
      throw new IonIRSerdeError(`unknown literal kind '${kind}'`, `${path}.kind`);
  }
}

function parseParam(raw: unknown, path: string): Param {
  const r = assertRecord(raw, path);
  return {
    name: assertString(r['name'], `${path}.name`),
    symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
    type: parseType(r['type'], `${path}.type`),
    span: parseSpan(r['span'], `${path}.span`),
  };
}

function parseCasePattern(raw: unknown, path: string): CasePattern {
  const r = assertRecord(raw, path);
  const kind = assertString(r['kind'], `${path}.kind`);
  switch (kind) {
    case 'Wildcard':
      return { kind: 'Wildcard', span: parseSpan(r['span'], `${path}.span`) };
    case 'Var':
      return {
        kind: 'Var',
        name: assertString(r['name'], `${path}.name`),
        symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
        span: parseSpan(r['span'], `${path}.span`),
      };
    case 'Constructor':
      return {
        kind: 'Constructor',
        ctorName: assertString(r['ctorName'], `${path}.ctorName`),
        symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
        fields: assertArray(r['fields'], `${path}.fields`).map((f, i) => parseCasePattern(f, `${path}.fields[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
      };
    case 'Literal':
      return {
        kind: 'Literal',
        value: parseLiteralValue(r['value'], `${path}.value`),
        span: parseSpan(r['span'], `${path}.span`),
      };
    default:
      throw new IonIRSerdeError(`unknown pattern kind '${kind}'`, `${path}.kind`);
  }
}

function parseCaseArm(raw: unknown, path: string): CaseArm {
  const r = assertRecord(raw, path);
  const base = {
    pattern: parseCasePattern(r['pattern'], `${path}.pattern`),
    body: parseNode(r['body'], `${path}.body`),
    span: parseSpan(r['span'], `${path}.span`),
  };
  if ('guard' in r) {
    return { ...base, guard: parseNode(r['guard'], `${path}.guard`) };
  }
  return base;
}

function parseForeignSig(raw: unknown, path: string): ForeignSignature {
  const r = assertRecord(raw, path);
  return {
    params: assertArray(r['params'], `${path}.params`).map((p, i) => parseType(p, `${path}.params[${i}]`)),
    ret: parseType(r['ret'], `${path}.ret`),
    template: assertString(r['template'], `${path}.template`),
  };
}

function parseOopMethod(raw: unknown, path: string): OopMethod {
  const r = assertRecord(raw, path);
  const base = {
    name: assertString(r['name'], `${path}.name`),
    symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
    params: assertArray(r['params'], `${path}.params`).map((p, i) => parseParam(p, `${path}.params[${i}]`)),
    retType: parseType(r['retType'], `${path}.retType`),
    isAbstract: assertBoolean(r['isAbstract'], `${path}.isAbstract`),
    isStatic: assertBoolean(r['isStatic'], `${path}.isStatic`),
    span: parseSpan(r['span'], `${path}.span`),
  };
  if ('body' in r) {
    return { ...base, body: parseNode(r['body'], `${path}.body`) };
  }
  return base;
}

function parseOopMember(raw: unknown, path: string): OopMember {
  const r = assertRecord(raw, path);
  return {
    name: assertString(r['name'], `${path}.name`),
    symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
    type: parseType(r['type'], `${path}.type`),
    span: parseSpan(r['span'], `${path}.span`),
  };
}

function parseEffectOp(raw: unknown, path: string): EffectOp {
  const r = assertRecord(raw, path);
  return {
    name: assertString(r['name'], `${path}.name`),
    params: assertArray(r['params'], `${path}.params`).map((p, i) => parseParam(p, `${path}.params[${i}]`)),
    retType: parseType(r['retType'], `${path}.retType`),
    span: parseSpan(r['span'], `${path}.span`),
  };
}

function parseEffectHandler(raw: unknown, path: string): EffectHandler {
  const r = assertRecord(raw, path);
  return {
    operation: assertString(r['operation'], `${path}.operation`),
    params: assertArray(r['params'], `${path}.params`).map((p, i) => parseParam(p, `${path}.params[${i}]`)),
    body: parseNode(r['body'], `${path}.body`),
    span: parseSpan(r['span'], `${path}.span`),
  };
}

function parseAdtVariant(raw: unknown, path: string): AdtVariant {
  const r = assertRecord(raw, path);
  return {
    tag: assertString(r['tag'], `${path}.tag`),
    symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
    fields: assertArray(r['fields'], `${path}.fields`).map((f, i) => parseParam(f, `${path}.fields[${i}]`)),
    span: parseSpan(r['span'], `${path}.span`),
  };
}

function parseAdtArm(raw: unknown, path: string): AdtArm {
  const r = assertRecord(raw, path);
  return {
    tag: assertString(r['tag'], `${path}.tag`),
    bindings: assertArray(r['bindings'], `${path}.bindings`).map((b, i) => parseParam(b, `${path}.bindings[${i}]`)),
    body: parseNode(r['body'], `${path}.body`),
    span: parseSpan(r['span'], `${path}.span`),
  };
}

// Exported for use by parseModule (validates kind === 'AdtDecl')
function parseAdtDeclNode(raw: unknown, path: string): AdtDeclNode {
  const r = assertRecord(raw, path);
  if (r['kind'] !== 'AdtDecl') {
    throw new IonIRSerdeError(`expected kind 'AdtDecl', got '${String(r['kind'])}'`, `${path}.kind`);
  }
  return {
    kind: 'AdtDecl',
    name: assertString(r['name'], `${path}.name`),
    symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
    variants: assertArray(r['variants'], `${path}.variants`).map((v, i) => parseAdtVariant(v, `${path}.variants[${i}]`)),
    span: parseSpan(r['span'], `${path}.span`),
    type: parseType(r['type'], `${path}.type`),
  };
}

// Exported for use by parseModule (validates kind === 'ModuleRef')
function parseModuleRefNode(raw: unknown, path: string): ModuleRefNode {
  const r = assertRecord(raw, path);
  if (r['kind'] !== 'ModuleRef') {
    throw new IonIRSerdeError(`expected kind 'ModuleRef', got '${String(r['kind'])}'`, `${path}.kind`);
  }
  return {
    kind: 'ModuleRef',
    modulePath: assertArray(r['modulePath'], `${path}.modulePath`).map((s, i) => assertString(s, `${path}.modulePath[${i}]`)),
    symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
    span: parseSpan(r['span'], `${path}.span`),
    type: parseType(r['type'], `${path}.type`),
  };
}

// ---------------------------------------------------------------------------
// Node dispatcher
// ---------------------------------------------------------------------------

function parseNode(raw: unknown, path: string): IonIRNode {
  const r = assertRecord(raw, path);
  const kind = assertString(r['kind'], `${path}.kind`);

  switch (kind) {
    // Core
    case 'Var': {
      const node: VarNode = {
        kind: 'Var',
        name: assertString(r['name'], `${path}.name`),
        symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Literal': {
      const node: LiteralNode = {
        kind: 'Literal',
        value: parseLiteralValue(r['value'], `${path}.value`),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'App': {
      const node: AppNode = {
        kind: 'App',
        callee: parseNode(r['callee'], `${path}.callee`),
        args: assertArray(r['args'], `${path}.args`).map((a, i) => parseNode(a, `${path}.args[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Abs': {
      const node: AbsNode = {
        kind: 'Abs',
        params: assertArray(r['params'], `${path}.params`).map((p, i) => parseParam(p, `${path}.params[${i}]`)),
        body: parseNode(r['body'], `${path}.body`),
        captures: assertArray(r['captures'], `${path}.captures`).map((c, i) => makeSymbolId(assertString(c, `${path}.captures[${i}]`))),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Let': {
      const node: LetNode = {
        kind: 'Let',
        name: assertString(r['name'], `${path}.name`),
        symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
        bindingType: parseType(r['bindingType'], `${path}.bindingType`),
        value: parseNode(r['value'], `${path}.value`),
        body: parseNode(r['body'], `${path}.body`),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Case': {
      const node: CaseNode = {
        kind: 'Case',
        scrutinee: parseNode(r['scrutinee'], `${path}.scrutinee`),
        arms: assertArray(r['arms'], `${path}.arms`).map((a, i) => parseCaseArm(a, `${path}.arms[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Constructor': {
      const node: ConstructorNode = {
        kind: 'Constructor',
        ctorName: assertString(r['ctorName'], `${path}.ctorName`),
        symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
        args: assertArray(r['args'], `${path}.args`).map((a, i) => parseNode(a, `${path}.args[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Accessor': {
      const node: AccessorNode = {
        kind: 'Accessor',
        receiver: parseNode(r['receiver'], `${path}.receiver`),
        member: assertString(r['member'], `${path}.member`),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'ModuleRef':
      return parseModuleRefNode(raw, path);
    case 'ForeignRef': {
      const node: ForeignRefNode = {
        kind: 'ForeignRef',
        target: assertString(r['target'], `${path}.target`),
        module: assertString(r['module'], `${path}.module`),
        symbol: assertString(r['symbol'], `${path}.symbol`),
        sig: parseForeignSig(r['sig'], `${path}.sig`),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Effect': {
      const node: EffectNode = {
        kind: 'Effect',
        effectTag: assertString(r['effectTag'], `${path}.effectTag`) as EffectTag,
        body: parseNode(r['body'], `${path}.body`),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    // OOP
    case 'OopClass': {
      const base = {
        kind: 'OopClass' as const,
        name: assertString(r['name'], `${path}.name`),
        symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
        interfaces: assertArray(r['interfaces'], `${path}.interfaces`).map((s, i) => makeSymbolId(assertString(s, `${path}.interfaces[${i}]`))),
        fields: assertArray(r['fields'], `${path}.fields`).map((f, i) => parseParam(f, `${path}.fields[${i}]`)),
        methods: assertArray(r['methods'], `${path}.methods`).map((m, i) => parseOopMethod(m, `${path}.methods[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      if ('superClass' in r) {
        const node: OopClassNode = { ...base, superClass: makeSymbolId(assertString(r['superClass'], `${path}.superClass`)) };
        return node;
      }
      return base;
    }
    case 'OopInterface': {
      const node: OopInterfaceNode = {
        kind: 'OopInterface',
        name: assertString(r['name'], `${path}.name`),
        symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
        members: assertArray(r['members'], `${path}.members`).map((m, i) => parseOopMember(m, `${path}.members[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'OopNew': {
      const node: OopNewNode = {
        kind: 'OopNew',
        ctorSymbolId: makeSymbolId(assertString(r['ctorSymbolId'], `${path}.ctorSymbolId`)),
        args: assertArray(r['args'], `${path}.args`).map((a, i) => parseNode(a, `${path}.args[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'OopVirtualCall': {
      const node: OopVirtualCallNode = {
        kind: 'OopVirtualCall',
        receiver: parseNode(r['receiver'], `${path}.receiver`),
        method: assertString(r['method'], `${path}.method`),
        args: assertArray(r['args'], `${path}.args`).map((a, i) => parseNode(a, `${path}.args[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'OopThis': {
      const node: OopThisNode = {
        kind: 'OopThis',
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    // Async
    case 'AsyncBlock': {
      const node: AsyncBlockNode = {
        kind: 'AsyncBlock',
        body: parseNode(r['body'], `${path}.body`),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Await': {
      const node: AwaitNode = {
        kind: 'Await',
        expr: parseNode(r['expr'], `${path}.expr`),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    // ADT
    case 'AdtDecl':
      return parseAdtDeclNode(raw, path);
    case 'AdtMatch': {
      const node: AdtMatchNode = {
        kind: 'AdtMatch',
        scrutinee: parseNode(r['scrutinee'], `${path}.scrutinee`),
        arms: assertArray(r['arms'], `${path}.arms`).map((a, i) => parseAdtArm(a, `${path}.arms[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    // Effects
    case 'EffectDecl': {
      const node: EffectDeclNode = {
        kind: 'EffectDecl',
        name: assertString(r['name'], `${path}.name`),
        symbolId: makeSymbolId(assertString(r['symbolId'], `${path}.symbolId`)),
        operations: assertArray(r['operations'], `${path}.operations`).map((o, i) => parseEffectOp(o, `${path}.operations[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Perform': {
      const node: PerformNode = {
        kind: 'Perform',
        effectSymbolId: makeSymbolId(assertString(r['effectSymbolId'], `${path}.effectSymbolId`)),
        operation: assertString(r['operation'], `${path}.operation`),
        args: assertArray(r['args'], `${path}.args`).map((a, i) => parseNode(a, `${path}.args[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    case 'Handle': {
      const base = {
        kind: 'Handle' as const,
        body: parseNode(r['body'], `${path}.body`),
        handlers: assertArray(r['handlers'], `${path}.handlers`).map((h, i) => parseEffectHandler(h, `${path}.handlers[${i}]`)),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      if ('returnClause' in r) {
        const node: HandleNode = { ...base, returnClause: parseNode(r['returnClause'], `${path}.returnClause`) };
        return node;
      }
      return base;
    }
    case 'Resume': {
      const node: ResumeNode = {
        kind: 'Resume',
        value: parseNode(r['value'], `${path}.value`),
        span: parseSpan(r['span'], `${path}.span`),
        type: parseType(r['type'], `${path}.type`),
      };
      return node;
    }
    default:
      throw new IonIRSerdeError(`unknown node kind '${kind}'`, `${path}.kind`);
  }
}

// ---------------------------------------------------------------------------
// Module parser
// ---------------------------------------------------------------------------

const VALID_DIALECTS = new Set<string>(['core', 'ion-oop', 'ion-async', 'ion-adt', 'ion-effects']);

function parseDialect(raw: unknown, path: string): IonIRDialect {
  const s = assertString(raw, path);
  if (!VALID_DIALECTS.has(s)) throw new IonIRSerdeError(`unknown dialect '${s}'`, path);
  return s as IonIRDialect;
}

function parseModule(raw: unknown): IonIRModule {
  const r = assertRecord(raw, '');
  const ionir = assertString(r['ionir'], 'ionir');
  if (ionir !== '1.0') {
    throw new IonIRSerdeError(`expected '1.0', got '${ionir}'`, 'ionir');
  }
  return {
    ionir: '1.0',
    module: assertString(r['module'], 'module'),
    version: assertString(r['version'], 'version'),
    dialects: assertArray(r['dialects'], 'dialects').map((d, i) => parseDialect(d, `dialects[${i}]`)),
    imports: assertArray(r['imports'], 'imports').map((imp, i) => parseModuleRefNode(imp, `imports[${i}]`)),
    data: assertArray(r['data'], 'data').map((d, i) => parseAdtDeclNode(d, `data[${i}]`)),
    decls: assertArray(r['decls'], 'decls').map((d, i) => parseNode(d, `decls[${i}]`)),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Deserializes an IonIRModule from a JSON string, throwing IonIRSerdeError on structural violations. */
export function deserializeModule(json: string): IonIRModule {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new IonIRSerdeError('invalid JSON', '');
  }
  return parseModule(raw);
}
