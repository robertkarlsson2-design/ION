import { makeSymbolId } from '../types.js';
import type { Span } from '../types.js';
import type { EffectTag } from '../ast/types.js';
import type {
  IonIRModule,
  IonIRNode,
  IonIRDialect,
  LiteralValue,
  Param,
  CasePattern,
  CaseArm,
  ForeignSignature,
  OopMethod,
  OopMember,
  AdtVariant,
  AdtArm,
  EffectOp,
  EffectHandler,
  ModuleRefNode,
  AdtDeclNode,
} from './nodes.js';
import type { IonType, EffectSet } from './types.js';

/** Thrown when serialization input is malformed or version-incompatible. */
export class IonIRSerdeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IonIRSerdeError';
  }
}

const MAX_DEPTH = 64;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Serialize an IonIRModule to a compact, deterministic JSON string. */
export function serialize(module: IonIRModule): string {
  return JSON.stringify(moduleToJson(module));
}

/** Deserialize a JSON string to an IonIRModule. Throws IonIRSerdeError on invalid input. */
export function deserialize(json: string): IonIRModule {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new IonIRSerdeError('Invalid JSON: parse failed');
  }
  return moduleFromJson(raw);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertObj(val: unknown, ctx: string): Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    throw new IonIRSerdeError(`Expected object at ${ctx}, got ${Array.isArray(val) ? 'array' : typeof val}`);
  }
  return val as Record<string, unknown>;
}

function assertStr(val: unknown, ctx: string): string {
  if (typeof val !== 'string') {
    throw new IonIRSerdeError(`Expected string at ${ctx}, got ${typeof val}`);
  }
  return val;
}

function assertNum(val: unknown, ctx: string): number {
  if (typeof val !== 'number') {
    throw new IonIRSerdeError(`Expected number at ${ctx}, got ${typeof val}`);
  }
  return val;
}

function assertBool(val: unknown, ctx: string): boolean {
  if (typeof val !== 'boolean') {
    throw new IonIRSerdeError(`Expected boolean at ${ctx}, got ${typeof val}`);
  }
  return val;
}

function assertArr(val: unknown, ctx: string): unknown[] {
  if (!Array.isArray(val)) {
    throw new IonIRSerdeError(`Expected array at ${ctx}, got ${typeof val}`);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Span
// ---------------------------------------------------------------------------

function spanToJson(s: Span): unknown {
  return {
    file: s.file,
    startLine: s.startLine,
    startCol: s.startCol,
    endLine: s.endLine,
    endCol: s.endCol,
  };
}

function spanFromJson(raw: unknown, ctx: string): Span {
  const obj = assertObj(raw, ctx);
  return {
    file: assertStr(obj['file'], `${ctx}.file`),
    startLine: assertNum(obj['startLine'], `${ctx}.startLine`),
    startCol: assertNum(obj['startCol'], `${ctx}.startCol`),
    endLine: assertNum(obj['endLine'], `${ctx}.endLine`),
    endCol: assertNum(obj['endCol'], `${ctx}.endCol`),
  };
}

// ---------------------------------------------------------------------------
// IonType
// ---------------------------------------------------------------------------

function typeToJson(t: IonType): unknown {
  switch (t.kind) {
    case 'Int': return { kind: 'Int' };
    case 'Float': return { kind: 'Float' };
    case 'Str': return { kind: 'Str' };
    case 'Bool': return { kind: 'Bool' };
    case 'Null': return { kind: 'Null' };
    case 'Unit': return { kind: 'Unit' };
    case 'Never': return { kind: 'Never' };
    case 'List': return { kind: 'List', elem: typeToJson(t.elem) };
    case 'Map': return { kind: 'Map', key: typeToJson(t.key), value: typeToJson(t.value) };
    case 'Option': return { kind: 'Option', inner: typeToJson(t.inner) };
    case 'Result': return { kind: 'Result', ok: typeToJson(t.ok), err: typeToJson(t.err) };
    case 'Fn':
      return {
        kind: 'Fn',
        params: t.params.map(typeToJson),
        ret: typeToJson(t.ret),
        effects: [...t.effects].sort(),
      };
    case 'User':
      return {
        kind: 'User',
        name: t.name,
        symbolId: t.symbolId,
        args: t.args.map(typeToJson),
      };
    case 'TypeVar': return { kind: 'TypeVar', id: t.id };
  }
}

function typeFromJson(raw: unknown, ctx: string, depth: number): IonType {
  if (depth <= 0) throw new IonIRSerdeError('Input exceeds maximum nesting depth');
  const obj = assertObj(raw, ctx);
  const kind = assertStr(obj['kind'], `${ctx}.kind`);
  const d = depth - 1;
  switch (kind) {
    case 'Int': return { kind: 'Int' };
    case 'Float': return { kind: 'Float' };
    case 'Str': return { kind: 'Str' };
    case 'Bool': return { kind: 'Bool' };
    case 'Null': return { kind: 'Null' };
    case 'Unit': return { kind: 'Unit' };
    case 'Never': return { kind: 'Never' };
    case 'List': return { kind: 'List', elem: typeFromJson(obj['elem'], `${ctx}.elem`, d) };
    case 'Map':
      return {
        kind: 'Map',
        key: typeFromJson(obj['key'], `${ctx}.key`, d),
        value: typeFromJson(obj['value'], `${ctx}.value`, d),
      };
    case 'Option': return { kind: 'Option', inner: typeFromJson(obj['inner'], `${ctx}.inner`, d) };
    case 'Result':
      return {
        kind: 'Result',
        ok: typeFromJson(obj['ok'], `${ctx}.ok`, d),
        err: typeFromJson(obj['err'], `${ctx}.err`, d),
      };
    case 'Fn': {
      const paramsArr = assertArr(obj['params'], `${ctx}.params`);
      const effectsArr = assertArr(obj['effects'], `${ctx}.effects`);
      return {
        kind: 'Fn',
        params: paramsArr.map((p, i) => typeFromJson(p, `${ctx}.params[${i}]`, d)),
        ret: typeFromJson(obj['ret'], `${ctx}.ret`, d),
        effects: new Set(
          effectsArr.map((e, i) => assertStr(e, `${ctx}.effects[${i}]`) as EffectTag),
        ) as EffectSet,
      };
    }
    case 'User': {
      const argsArr = assertArr(obj['args'], `${ctx}.args`);
      return {
        kind: 'User',
        name: assertStr(obj['name'], `${ctx}.name`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        args: argsArr.map((a, i) => typeFromJson(a, `${ctx}.args[${i}]`, d)),
      };
    }
    case 'TypeVar':
      return { kind: 'TypeVar', id: assertStr(obj['id'], `${ctx}.id`) };
    default:
      throw new IonIRSerdeError(`Unknown type kind: "${kind}" at ${ctx}`);
  }
}

// ---------------------------------------------------------------------------
// LiteralValue
// ---------------------------------------------------------------------------

function literalValueToJson(v: LiteralValue): unknown {
  return v;
}

function literalValueFromJson(raw: unknown, ctx: string): LiteralValue {
  const obj = assertObj(raw, ctx);
  const kind = assertStr(obj['kind'], `${ctx}.kind`);
  switch (kind) {
    case 'Int': return { kind: 'Int', value: assertNum(obj['value'], `${ctx}.value`) };
    case 'Float': return { kind: 'Float', value: assertNum(obj['value'], `${ctx}.value`) };
    case 'Str': return { kind: 'Str', value: assertStr(obj['value'], `${ctx}.value`) };
    case 'Bool': return { kind: 'Bool', value: assertBool(obj['value'], `${ctx}.value`) };
    case 'Null': return { kind: 'Null' };
    default: throw new IonIRSerdeError(`Unknown literal kind: "${kind}" at ${ctx}`);
  }
}

// ---------------------------------------------------------------------------
// Param
// ---------------------------------------------------------------------------

function paramToJson(p: Param): unknown {
  return {
    name: p.name,
    symbolId: p.symbolId,
    type: typeToJson(p.type),
    span: spanToJson(p.span),
  };
}

function paramFromJson(raw: unknown, ctx: string, depth: number): Param {
  const obj = assertObj(raw, ctx);
  return {
    name: assertStr(obj['name'], `${ctx}.name`),
    symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
    type: typeFromJson(obj['type'], `${ctx}.type`, depth),
    span: spanFromJson(obj['span'], `${ctx}.span`),
  };
}

// ---------------------------------------------------------------------------
// CasePattern
// ---------------------------------------------------------------------------

function casePatternToJson(p: CasePattern): unknown {
  switch (p.kind) {
    case 'Wildcard': return { kind: 'Wildcard', span: spanToJson(p.span) };
    case 'Var':
      return { kind: 'Var', name: p.name, symbolId: p.symbolId, span: spanToJson(p.span) };
    case 'Constructor':
      return {
        kind: 'Constructor',
        ctorName: p.ctorName,
        symbolId: p.symbolId,
        fields: p.fields.map(casePatternToJson),
        span: spanToJson(p.span),
      };
    case 'Literal':
      return { kind: 'Literal', value: literalValueToJson(p.value), span: spanToJson(p.span) };
  }
}

function casePatternFromJson(raw: unknown, ctx: string, depth: number): CasePattern {
  if (depth <= 0) throw new IonIRSerdeError('Input exceeds maximum nesting depth');
  const obj = assertObj(raw, ctx);
  const kind = assertStr(obj['kind'], `${ctx}.kind`);
  const span = spanFromJson(obj['span'], `${ctx}.span`);
  const d = depth - 1;
  switch (kind) {
    case 'Wildcard': return { kind: 'Wildcard', span };
    case 'Var':
      return {
        kind: 'Var',
        name: assertStr(obj['name'], `${ctx}.name`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        span,
      };
    case 'Constructor': {
      const fields = assertArr(obj['fields'], `${ctx}.fields`);
      return {
        kind: 'Constructor',
        ctorName: assertStr(obj['ctorName'], `${ctx}.ctorName`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        fields: fields.map((f, i) => casePatternFromJson(f, `${ctx}.fields[${i}]`, d)),
        span,
      };
    }
    case 'Literal':
      return { kind: 'Literal', value: literalValueFromJson(obj['value'], `${ctx}.value`), span };
    default:
      throw new IonIRSerdeError(`Unknown pattern kind: "${kind}" at ${ctx}`);
  }
}

// ---------------------------------------------------------------------------
// CaseArm
// ---------------------------------------------------------------------------

function caseArmToJson(arm: CaseArm): unknown {
  return {
    pattern: casePatternToJson(arm.pattern),
    ...(arm.guard !== undefined ? { guard: nodeToJson(arm.guard) } : {}),
    body: nodeToJson(arm.body),
    span: spanToJson(arm.span),
  };
}

function caseArmFromJson(raw: unknown, ctx: string, depth: number): CaseArm {
  const obj = assertObj(raw, ctx);
  const guardRaw = obj['guard'];
  return {
    pattern: casePatternFromJson(obj['pattern'], `${ctx}.pattern`, depth),
    ...(guardRaw !== undefined ? { guard: nodeFromJson(guardRaw, `${ctx}.guard`, depth) } : {}),
    body: nodeFromJson(obj['body'], `${ctx}.body`, depth),
    span: spanFromJson(obj['span'], `${ctx}.span`),
  };
}

// ---------------------------------------------------------------------------
// ForeignSignature
// ---------------------------------------------------------------------------

function foreignSigToJson(sig: ForeignSignature): unknown {
  return {
    params: sig.params.map(typeToJson),
    ret: typeToJson(sig.ret),
    template: sig.template,
  };
}

function foreignSigFromJson(raw: unknown, ctx: string, depth: number): ForeignSignature {
  const obj = assertObj(raw, ctx);
  const params = assertArr(obj['params'], `${ctx}.params`);
  return {
    params: params.map((p, i) => typeFromJson(p, `${ctx}.params[${i}]`, depth)),
    ret: typeFromJson(obj['ret'], `${ctx}.ret`, depth),
    template: assertStr(obj['template'], `${ctx}.template`),
  };
}

// ---------------------------------------------------------------------------
// OopMethod / OopMember
// ---------------------------------------------------------------------------

function oopMethodToJson(m: OopMethod): unknown {
  return {
    name: m.name,
    symbolId: m.symbolId,
    params: m.params.map(paramToJson),
    retType: typeToJson(m.retType),
    ...(m.body !== undefined ? { body: nodeToJson(m.body) } : {}),
    isAbstract: m.isAbstract,
    isStatic: m.isStatic,
    span: spanToJson(m.span),
  };
}

function oopMethodFromJson(raw: unknown, ctx: string, depth: number): OopMethod {
  const obj = assertObj(raw, ctx);
  const params = assertArr(obj['params'], `${ctx}.params`);
  const bodyRaw = obj['body'];
  return {
    name: assertStr(obj['name'], `${ctx}.name`),
    symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
    params: params.map((p, i) => paramFromJson(p, `${ctx}.params[${i}]`, depth)),
    retType: typeFromJson(obj['retType'], `${ctx}.retType`, depth),
    ...(bodyRaw !== undefined ? { body: nodeFromJson(bodyRaw, `${ctx}.body`, depth) } : {}),
    isAbstract: assertBool(obj['isAbstract'], `${ctx}.isAbstract`),
    isStatic: assertBool(obj['isStatic'], `${ctx}.isStatic`),
    span: spanFromJson(obj['span'], `${ctx}.span`),
  };
}

function oopMemberToJson(m: OopMember): unknown {
  return {
    name: m.name,
    symbolId: m.symbolId,
    type: typeToJson(m.type),
    span: spanToJson(m.span),
  };
}

function oopMemberFromJson(raw: unknown, ctx: string, depth: number): OopMember {
  const obj = assertObj(raw, ctx);
  return {
    name: assertStr(obj['name'], `${ctx}.name`),
    symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
    type: typeFromJson(obj['type'], `${ctx}.type`, depth),
    span: spanFromJson(obj['span'], `${ctx}.span`),
  };
}

// ---------------------------------------------------------------------------
// ADT helpers
// ---------------------------------------------------------------------------

function adtVariantToJson(v: AdtVariant): unknown {
  return {
    tag: v.tag,
    symbolId: v.symbolId,
    fields: v.fields.map(paramToJson),
    span: spanToJson(v.span),
  };
}

function adtVariantFromJson(raw: unknown, ctx: string, depth: number): AdtVariant {
  const obj = assertObj(raw, ctx);
  const fields = assertArr(obj['fields'], `${ctx}.fields`);
  return {
    tag: assertStr(obj['tag'], `${ctx}.tag`),
    symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
    fields: fields.map((f, i) => paramFromJson(f, `${ctx}.fields[${i}]`, depth)),
    span: spanFromJson(obj['span'], `${ctx}.span`),
  };
}

function adtArmToJson(arm: AdtArm): unknown {
  return {
    tag: arm.tag,
    bindings: arm.bindings.map(paramToJson),
    body: nodeToJson(arm.body),
    span: spanToJson(arm.span),
  };
}

function adtArmFromJson(raw: unknown, ctx: string, depth: number): AdtArm {
  const obj = assertObj(raw, ctx);
  const bindings = assertArr(obj['bindings'], `${ctx}.bindings`);
  return {
    tag: assertStr(obj['tag'], `${ctx}.tag`),
    bindings: bindings.map((b, i) => paramFromJson(b, `${ctx}.bindings[${i}]`, depth)),
    body: nodeFromJson(obj['body'], `${ctx}.body`, depth),
    span: spanFromJson(obj['span'], `${ctx}.span`),
  };
}

// ---------------------------------------------------------------------------
// Effects helpers
// ---------------------------------------------------------------------------

function effectOpToJson(op: EffectOp): unknown {
  return {
    name: op.name,
    params: op.params.map(paramToJson),
    retType: typeToJson(op.retType),
    span: spanToJson(op.span),
  };
}

function effectOpFromJson(raw: unknown, ctx: string, depth: number): EffectOp {
  const obj = assertObj(raw, ctx);
  const params = assertArr(obj['params'], `${ctx}.params`);
  return {
    name: assertStr(obj['name'], `${ctx}.name`),
    params: params.map((p, i) => paramFromJson(p, `${ctx}.params[${i}]`, depth)),
    retType: typeFromJson(obj['retType'], `${ctx}.retType`, depth),
    span: spanFromJson(obj['span'], `${ctx}.span`),
  };
}

function effectHandlerToJson(h: EffectHandler): unknown {
  return {
    operation: h.operation,
    params: h.params.map(paramToJson),
    body: nodeToJson(h.body),
    span: spanToJson(h.span),
  };
}

function effectHandlerFromJson(raw: unknown, ctx: string, depth: number): EffectHandler {
  const obj = assertObj(raw, ctx);
  const params = assertArr(obj['params'], `${ctx}.params`);
  return {
    operation: assertStr(obj['operation'], `${ctx}.operation`),
    params: params.map((p, i) => paramFromJson(p, `${ctx}.params[${i}]`, depth)),
    body: nodeFromJson(obj['body'], `${ctx}.body`, depth),
    span: spanFromJson(obj['span'], `${ctx}.span`),
  };
}

// ---------------------------------------------------------------------------
// IonIRNode — nodeToJson
// ---------------------------------------------------------------------------

function nodeToJson(n: IonIRNode): unknown {
  const span = spanToJson(n.span);
  const type = typeToJson(n.type);
  switch (n.kind) {
    case 'Var':
      return { kind: 'Var', name: n.name, symbolId: n.symbolId, span, type };
    case 'Literal':
      return { kind: 'Literal', value: literalValueToJson(n.value), span, type };
    case 'App':
      return { kind: 'App', callee: nodeToJson(n.callee), args: n.args.map(nodeToJson), span, type };
    case 'Abs':
      return {
        kind: 'Abs',
        params: n.params.map(paramToJson),
        body: nodeToJson(n.body),
        captures: [...n.captures],
        span,
        type,
      };
    case 'Let':
      return {
        kind: 'Let',
        name: n.name,
        symbolId: n.symbolId,
        bindingType: typeToJson(n.bindingType),
        value: nodeToJson(n.value),
        body: nodeToJson(n.body),
        span,
        type,
      };
    case 'Case':
      return {
        kind: 'Case',
        scrutinee: nodeToJson(n.scrutinee),
        arms: n.arms.map(caseArmToJson),
        span,
        type,
      };
    case 'Constructor':
      return {
        kind: 'Constructor',
        ctorName: n.ctorName,
        symbolId: n.symbolId,
        args: n.args.map(nodeToJson),
        span,
        type,
      };
    case 'Accessor':
      return { kind: 'Accessor', receiver: nodeToJson(n.receiver), member: n.member, span, type };
    case 'ModuleRef':
      return {
        kind: 'ModuleRef',
        modulePath: [...n.modulePath],
        symbolId: n.symbolId,
        span,
        type,
      };
    case 'ForeignRef':
      return {
        kind: 'ForeignRef',
        target: n.target,
        module: n.module,
        symbol: n.symbol,
        sig: foreignSigToJson(n.sig),
        span,
        type,
      };
    case 'Effect':
      return { kind: 'Effect', effectTag: n.effectTag, body: nodeToJson(n.body), span, type };
    case 'OopClass':
      return {
        kind: 'OopClass',
        name: n.name,
        symbolId: n.symbolId,
        ...(n.superClass !== undefined ? { superClass: n.superClass } : {}),
        interfaces: [...n.interfaces],
        fields: n.fields.map(paramToJson),
        methods: n.methods.map(oopMethodToJson),
        span,
        type,
      };
    case 'OopInterface':
      return {
        kind: 'OopInterface',
        name: n.name,
        symbolId: n.symbolId,
        members: n.members.map(oopMemberToJson),
        span,
        type,
      };
    case 'OopNew':
      return {
        kind: 'OopNew',
        ctorSymbolId: n.ctorSymbolId,
        args: n.args.map(nodeToJson),
        span,
        type,
      };
    case 'OopVirtualCall':
      return {
        kind: 'OopVirtualCall',
        receiver: nodeToJson(n.receiver),
        method: n.method,
        args: n.args.map(nodeToJson),
        span,
        type,
      };
    case 'OopThis':
      return { kind: 'OopThis', span, type };
    case 'AsyncBlock':
      return { kind: 'AsyncBlock', body: nodeToJson(n.body), span, type };
    case 'Await':
      return { kind: 'Await', expr: nodeToJson(n.expr), span, type };
    case 'AdtDecl':
      return {
        kind: 'AdtDecl',
        name: n.name,
        symbolId: n.symbolId,
        variants: n.variants.map(adtVariantToJson),
        span,
        type,
      };
    case 'AdtMatch':
      return {
        kind: 'AdtMatch',
        scrutinee: nodeToJson(n.scrutinee),
        arms: n.arms.map(adtArmToJson),
        span,
        type,
      };
    case 'EffectDecl':
      return {
        kind: 'EffectDecl',
        name: n.name,
        symbolId: n.symbolId,
        operations: n.operations.map(effectOpToJson),
        span,
        type,
      };
    case 'Perform':
      return {
        kind: 'Perform',
        effectSymbolId: n.effectSymbolId,
        operation: n.operation,
        args: n.args.map(nodeToJson),
        span,
        type,
      };
    case 'Handle':
      return {
        kind: 'Handle',
        body: nodeToJson(n.body),
        handlers: n.handlers.map(effectHandlerToJson),
        ...(n.returnClause !== undefined ? { returnClause: nodeToJson(n.returnClause) } : {}),
        span,
        type,
      };
    case 'Resume':
      return { kind: 'Resume', value: nodeToJson(n.value), span, type };
  }
}

// ---------------------------------------------------------------------------
// IonIRNode — nodeFromJson
// ---------------------------------------------------------------------------

function nodeFromJson(raw: unknown, ctx: string, depth: number): IonIRNode {
  if (depth <= 0) throw new IonIRSerdeError('Input exceeds maximum nesting depth');
  const obj = assertObj(raw, ctx);
  const kind = assertStr(obj['kind'], `${ctx}.kind`);
  const span = spanFromJson(obj['span'], `${ctx}.span`);
  const type = typeFromJson(obj['type'], `${ctx}.type`, depth);
  const d = depth - 1;

  switch (kind) {
    case 'Var':
      return {
        kind: 'Var',
        name: assertStr(obj['name'], `${ctx}.name`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        span,
        type,
      };
    case 'Literal':
      return {
        kind: 'Literal',
        value: literalValueFromJson(obj['value'], `${ctx}.value`),
        span,
        type,
      };
    case 'App': {
      const args = assertArr(obj['args'], `${ctx}.args`);
      return {
        kind: 'App',
        callee: nodeFromJson(obj['callee'], `${ctx}.callee`, d),
        args: args.map((a, i) => nodeFromJson(a, `${ctx}.args[${i}]`, d)),
        span,
        type,
      };
    }
    case 'Abs': {
      const params = assertArr(obj['params'], `${ctx}.params`);
      const captures = assertArr(obj['captures'], `${ctx}.captures`);
      return {
        kind: 'Abs',
        params: params.map((p, i) => paramFromJson(p, `${ctx}.params[${i}]`, d)),
        body: nodeFromJson(obj['body'], `${ctx}.body`, d),
        captures: captures.map((c, i) => makeSymbolId(assertStr(c, `${ctx}.captures[${i}]`))),
        span,
        type,
      };
    }
    case 'Let':
      return {
        kind: 'Let',
        name: assertStr(obj['name'], `${ctx}.name`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        bindingType: typeFromJson(obj['bindingType'], `${ctx}.bindingType`, d),
        value: nodeFromJson(obj['value'], `${ctx}.value`, d),
        body: nodeFromJson(obj['body'], `${ctx}.body`, d),
        span,
        type,
      };
    case 'Case': {
      const arms = assertArr(obj['arms'], `${ctx}.arms`);
      return {
        kind: 'Case',
        scrutinee: nodeFromJson(obj['scrutinee'], `${ctx}.scrutinee`, d),
        arms: arms.map((a, i) => caseArmFromJson(a, `${ctx}.arms[${i}]`, d)),
        span,
        type,
      };
    }
    case 'Constructor': {
      const args = assertArr(obj['args'], `${ctx}.args`);
      return {
        kind: 'Constructor',
        ctorName: assertStr(obj['ctorName'], `${ctx}.ctorName`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        args: args.map((a, i) => nodeFromJson(a, `${ctx}.args[${i}]`, d)),
        span,
        type,
      };
    }
    case 'Accessor':
      return {
        kind: 'Accessor',
        receiver: nodeFromJson(obj['receiver'], `${ctx}.receiver`, d),
        member: assertStr(obj['member'], `${ctx}.member`),
        span,
        type,
      };
    case 'ModuleRef': {
      const modulePath = assertArr(obj['modulePath'], `${ctx}.modulePath`);
      return {
        kind: 'ModuleRef',
        modulePath: modulePath.map((p, i) => assertStr(p, `${ctx}.modulePath[${i}]`)),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        span,
        type,
      };
    }
    case 'ForeignRef':
      return {
        kind: 'ForeignRef',
        target: assertStr(obj['target'], `${ctx}.target`),
        module: assertStr(obj['module'], `${ctx}.module`),
        symbol: assertStr(obj['symbol'], `${ctx}.symbol`),
        sig: foreignSigFromJson(obj['sig'], `${ctx}.sig`, d),
        span,
        type,
      };
    case 'Effect':
      return {
        kind: 'Effect',
        effectTag: assertStr(obj['effectTag'], `${ctx}.effectTag`) as EffectTag,
        body: nodeFromJson(obj['body'], `${ctx}.body`, d),
        span,
        type,
      };
    case 'OopClass': {
      const superClassRaw = obj['superClass'];
      const interfaces = assertArr(obj['interfaces'], `${ctx}.interfaces`);
      const fields = assertArr(obj['fields'], `${ctx}.fields`);
      const methods = assertArr(obj['methods'], `${ctx}.methods`);
      return {
        kind: 'OopClass',
        name: assertStr(obj['name'], `${ctx}.name`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        ...(superClassRaw !== undefined
          ? { superClass: makeSymbolId(assertStr(superClassRaw, `${ctx}.superClass`)) }
          : {}),
        interfaces: interfaces.map((s, i) => makeSymbolId(assertStr(s, `${ctx}.interfaces[${i}]`))),
        fields: fields.map((f, i) => paramFromJson(f, `${ctx}.fields[${i}]`, d)),
        methods: methods.map((m, i) => oopMethodFromJson(m, `${ctx}.methods[${i}]`, d)),
        span,
        type,
      };
    }
    case 'OopInterface': {
      const members = assertArr(obj['members'], `${ctx}.members`);
      return {
        kind: 'OopInterface',
        name: assertStr(obj['name'], `${ctx}.name`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        members: members.map((m, i) => oopMemberFromJson(m, `${ctx}.members[${i}]`, d)),
        span,
        type,
      };
    }
    case 'OopNew': {
      const args = assertArr(obj['args'], `${ctx}.args`);
      return {
        kind: 'OopNew',
        ctorSymbolId: makeSymbolId(assertStr(obj['ctorSymbolId'], `${ctx}.ctorSymbolId`)),
        args: args.map((a, i) => nodeFromJson(a, `${ctx}.args[${i}]`, d)),
        span,
        type,
      };
    }
    case 'OopVirtualCall': {
      const args = assertArr(obj['args'], `${ctx}.args`);
      return {
        kind: 'OopVirtualCall',
        receiver: nodeFromJson(obj['receiver'], `${ctx}.receiver`, d),
        method: assertStr(obj['method'], `${ctx}.method`),
        args: args.map((a, i) => nodeFromJson(a, `${ctx}.args[${i}]`, d)),
        span,
        type,
      };
    }
    case 'OopThis':
      return { kind: 'OopThis', span, type };
    case 'AsyncBlock':
      return { kind: 'AsyncBlock', body: nodeFromJson(obj['body'], `${ctx}.body`, d), span, type };
    case 'Await':
      return { kind: 'Await', expr: nodeFromJson(obj['expr'], `${ctx}.expr`, d), span, type };
    case 'AdtDecl': {
      const variants = assertArr(obj['variants'], `${ctx}.variants`);
      return {
        kind: 'AdtDecl',
        name: assertStr(obj['name'], `${ctx}.name`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        variants: variants.map((v, i) => adtVariantFromJson(v, `${ctx}.variants[${i}]`, d)),
        span,
        type,
      };
    }
    case 'AdtMatch': {
      const arms = assertArr(obj['arms'], `${ctx}.arms`);
      return {
        kind: 'AdtMatch',
        scrutinee: nodeFromJson(obj['scrutinee'], `${ctx}.scrutinee`, d),
        arms: arms.map((a, i) => adtArmFromJson(a, `${ctx}.arms[${i}]`, d)),
        span,
        type,
      };
    }
    case 'EffectDecl': {
      const operations = assertArr(obj['operations'], `${ctx}.operations`);
      return {
        kind: 'EffectDecl',
        name: assertStr(obj['name'], `${ctx}.name`),
        symbolId: makeSymbolId(assertStr(obj['symbolId'], `${ctx}.symbolId`)),
        operations: operations.map((op, i) => effectOpFromJson(op, `${ctx}.operations[${i}]`, d)),
        span,
        type,
      };
    }
    case 'Perform': {
      const args = assertArr(obj['args'], `${ctx}.args`);
      return {
        kind: 'Perform',
        effectSymbolId: makeSymbolId(assertStr(obj['effectSymbolId'], `${ctx}.effectSymbolId`)),
        operation: assertStr(obj['operation'], `${ctx}.operation`),
        args: args.map((a, i) => nodeFromJson(a, `${ctx}.args[${i}]`, d)),
        span,
        type,
      };
    }
    case 'Handle': {
      const handlers = assertArr(obj['handlers'], `${ctx}.handlers`);
      const returnClauseRaw = obj['returnClause'];
      return {
        kind: 'Handle',
        body: nodeFromJson(obj['body'], `${ctx}.body`, d),
        handlers: handlers.map((h, i) => effectHandlerFromJson(h, `${ctx}.handlers[${i}]`, d)),
        ...(returnClauseRaw !== undefined
          ? { returnClause: nodeFromJson(returnClauseRaw, `${ctx}.returnClause`, d) }
          : {}),
        span,
        type,
      };
    }
    case 'Resume':
      return {
        kind: 'Resume',
        value: nodeFromJson(obj['value'], `${ctx}.value`, d),
        span,
        type,
      };
    default:
      throw new IonIRSerdeError(`Unknown node kind: "${kind}" at ${ctx}`);
  }
}

// ---------------------------------------------------------------------------
// IonIRModule
// ---------------------------------------------------------------------------

const VALID_DIALECTS: ReadonlySet<string> = new Set([
  'core', 'ion-oop', 'ion-async', 'ion-adt', 'ion-effects',
]);

function moduleToJson(module: IonIRModule): unknown {
  return {
    ionir: module.ionir,
    module: module.module,
    version: module.version,
    dialects: [...module.dialects],
    imports: module.imports.map(nodeToJson),
    data: module.data.map(nodeToJson),
    decls: module.decls.map(nodeToJson),
  };
}

function moduleFromJson(raw: unknown): IonIRModule {
  const obj = assertObj(raw, 'IonIRModule');
  const ionir = assertStr(obj['ionir'], 'IonIRModule.ionir');
  if (ionir !== '1.0') {
    throw new IonIRSerdeError(`Unsupported IonIR version: "${ionir}" (expected "1.0")`);
  }
  const dialectsArr = assertArr(obj['dialects'], 'IonIRModule.dialects');
  const importsArr = assertArr(obj['imports'], 'IonIRModule.imports');
  const dataArr = assertArr(obj['data'], 'IonIRModule.data');
  const declsArr = assertArr(obj['decls'], 'IonIRModule.decls');

  return {
    ionir: '1.0',
    module: assertStr(obj['module'], 'IonIRModule.module'),
    version: assertStr(obj['version'], 'IonIRModule.version'),
    dialects: dialectsArr.map((d, i) => {
      const s = assertStr(d, `IonIRModule.dialects[${i}]`);
      if (!VALID_DIALECTS.has(s)) {
        throw new IonIRSerdeError(`Unknown dialect: "${s}" at IonIRModule.dialects[${i}]`);
      }
      return s as IonIRDialect;
    }),
    imports: importsArr.map((n, i) => {
      const node = nodeFromJson(n, `IonIRModule.imports[${i}]`, MAX_DEPTH);
      if (node.kind !== 'ModuleRef') {
        throw new IonIRSerdeError(
          `IonIRModule.imports[${i}] must be a ModuleRef node, got "${node.kind}"`,
        );
      }
      return node as ModuleRefNode;
    }),
    data: dataArr.map((n, i) => {
      const node = nodeFromJson(n, `IonIRModule.data[${i}]`, MAX_DEPTH);
      if (node.kind !== 'AdtDecl') {
        throw new IonIRSerdeError(
          `IonIRModule.data[${i}] must be an AdtDecl node, got "${node.kind}"`,
        );
      }
      return node as AdtDeclNode;
    }),
    decls: declsArr.map((n, i) => nodeFromJson(n, `IonIRModule.decls[${i}]`, MAX_DEPTH)),
  };
}
