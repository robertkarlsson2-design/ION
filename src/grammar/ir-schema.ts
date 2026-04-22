// ---------------------------------------------------------------------------
// JSON Schema draft-07 types (subset sufficient for IonIR)
// ---------------------------------------------------------------------------

type Primitive = string | number | boolean | null;

/** A JSON Schema draft-07 value — boolean shorthand or a schema node. */
export type JSONSchemaValue = boolean | SchemaNode;

interface SchemaNode {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JSONSchemaValue>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: JSONSchemaValue;
  readonly enum?: readonly Primitive[];
  readonly oneOf?: readonly JSONSchemaValue[];
  readonly anyOf?: readonly JSONSchemaValue[];
  readonly uniqueItems?: boolean;
}

/** The top-level JSON Schema document returned by buildIonIRSchema(). */
export interface JSONSchemaObject {
  readonly $schema: string;
  readonly $defs: Readonly<Record<string, JSONSchemaValue>>;
  readonly $ref: string;
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

const STR: JSONSchemaValue = { type: 'string' };
const NUM: JSONSchemaValue = { type: 'number' };
const BOOL: JSONSchemaValue = { type: 'boolean' };

function spanRef(): JSONSchemaValue { return { $ref: '#/$defs/Span' }; }
function typeRef(): JSONSchemaValue { return { $ref: '#/$defs/IonType' }; }
function nodeRef(): JSONSchemaValue { return { $ref: '#/$defs/IonIRNode' }; }
function arrOf(item: JSONSchemaValue): JSONSchemaValue { return { type: 'array', items: item }; }
function enumOf(...values: string[]): JSONSchemaValue { return { enum: values }; }

/** Object schema for a node variant with kind, span, type plus extra props. */
function nodeSchema(
  kind: string,
  extra: Readonly<Record<string, JSONSchemaValue>>,
  extraRequired: readonly string[],
): JSONSchemaValue {
  return {
    type: 'object',
    required: ['kind', 'span', 'type', ...extraRequired] as readonly string[],
    additionalProperties: false,
    properties: {
      kind: enumOf(kind),
      span: spanRef(),
      type: typeRef(),
      ...extra,
    },
  };
}

/** Object schema with explicit properties list. */
function obj(
  required: readonly string[],
  properties: Readonly<Record<string, JSONSchemaValue>>,
): JSONSchemaValue {
  return { type: 'object', required, additionalProperties: false, properties };
}

// ---------------------------------------------------------------------------
// IonType variants
// ---------------------------------------------------------------------------

const ionTypeVariants: JSONSchemaValue[] = [
  obj(['kind'], { kind: enumOf('Int') }),
  obj(['kind'], { kind: enumOf('Float') }),
  obj(['kind'], { kind: enumOf('Str') }),
  obj(['kind'], { kind: enumOf('Bool') }),
  obj(['kind'], { kind: enumOf('Null') }),
  obj(['kind'], { kind: enumOf('Unit') }),
  obj(['kind'], { kind: enumOf('Never') }),
  obj(['kind', 'id'], { kind: enumOf('TypeVar'), id: STR }),
  obj(['kind', 'elem'], { kind: enumOf('List'), elem: { $ref: '#/$defs/IonType' } }),
  obj(['kind', 'key', 'value'], { kind: enumOf('Map'), key: { $ref: '#/$defs/IonType' }, value: { $ref: '#/$defs/IonType' } }),
  obj(['kind', 'inner'], { kind: enumOf('Option'), inner: { $ref: '#/$defs/IonType' } }),
  obj(['kind', 'ok', 'err'], { kind: enumOf('Result'), ok: { $ref: '#/$defs/IonType' }, err: { $ref: '#/$defs/IonType' } }),
  obj(['kind', 'params', 'ret', 'effects'], {
    kind: enumOf('Fn'),
    params: arrOf({ $ref: '#/$defs/IonType' }),
    ret: { $ref: '#/$defs/IonType' },
    effects: { $ref: '#/$defs/EffectSet' },
  }),
  obj(['kind', 'name', 'symbolId', 'args'], {
    kind: enumOf('User'),
    name: STR,
    symbolId: STR,
    args: arrOf({ $ref: '#/$defs/IonType' }),
  }),
];

// ---------------------------------------------------------------------------
// CasePattern variants
// ---------------------------------------------------------------------------

const casePatternVariants: JSONSchemaValue[] = [
  obj(['kind', 'span'], { kind: enumOf('Wildcard'), span: spanRef() }),
  obj(['kind', 'name', 'symbolId', 'span'], { kind: enumOf('Var'), name: STR, symbolId: STR, span: spanRef() }),
  obj(['kind', 'ctorName', 'symbolId', 'fields', 'span'], {
    kind: enumOf('Constructor'),
    ctorName: STR,
    symbolId: STR,
    fields: arrOf({ $ref: '#/$defs/CasePattern' }),
    span: spanRef(),
  }),
  obj(['kind', 'value', 'span'], { kind: enumOf('Literal'), value: { $ref: '#/$defs/LiteralValue' }, span: spanRef() }),
];

// ---------------------------------------------------------------------------
// IonIRNode variants (24 total)
// ---------------------------------------------------------------------------

const ionIRNodeVariants: JSONSchemaValue[] = [
  // Core
  nodeSchema('Var', { name: STR, symbolId: STR }, ['name', 'symbolId']),
  nodeSchema('Literal', { value: { $ref: '#/$defs/LiteralValue' } }, ['value']),
  nodeSchema('App', { callee: nodeRef(), args: arrOf(nodeRef()) }, ['callee', 'args']),
  nodeSchema('Abs', {
    params: arrOf({ $ref: '#/$defs/Param' }),
    body: nodeRef(),
    captures: arrOf(STR),
  }, ['params', 'body', 'captures']),
  nodeSchema('Let', {
    name: STR,
    symbolId: STR,
    bindingType: typeRef(),
    value: nodeRef(),
    body: nodeRef(),
  }, ['name', 'symbolId', 'bindingType', 'value', 'body']),
  nodeSchema('Case', {
    scrutinee: nodeRef(),
    arms: arrOf({ $ref: '#/$defs/CaseArm' }),
  }, ['scrutinee', 'arms']),
  nodeSchema('Constructor', { ctorName: STR, symbolId: STR, args: arrOf(nodeRef()) }, ['ctorName', 'symbolId', 'args']),
  nodeSchema('Accessor', { receiver: nodeRef(), member: STR }, ['receiver', 'member']),
  nodeSchema('ModuleRef', { modulePath: arrOf(STR), symbolId: STR }, ['modulePath', 'symbolId']),
  nodeSchema('ForeignRef', {
    target: STR,
    module: STR,
    symbol: STR,
    sig: { $ref: '#/$defs/ForeignSignature' },
  }, ['target', 'module', 'symbol', 'sig']),
  nodeSchema('Effect', { effectTag: STR, body: nodeRef() }, ['effectTag', 'body']),
  // OOP
  {
    type: 'object',
    required: ['kind', 'name', 'symbolId', 'interfaces', 'fields', 'methods', 'span', 'type'] as readonly string[],
    additionalProperties: false,
    properties: {
      kind: enumOf('OopClass'),
      name: STR,
      symbolId: STR,
      superClass: STR,
      interfaces: arrOf(STR),
      fields: arrOf({ $ref: '#/$defs/Param' }),
      methods: arrOf({ $ref: '#/$defs/OopMethod' }),
      span: spanRef(),
      type: typeRef(),
    },
  },
  nodeSchema('OopInterface', {
    name: STR,
    symbolId: STR,
    members: arrOf({ $ref: '#/$defs/OopMember' }),
  }, ['name', 'symbolId', 'members']),
  nodeSchema('OopNew', { ctorSymbolId: STR, args: arrOf(nodeRef()) }, ['ctorSymbolId', 'args']),
  nodeSchema('OopVirtualCall', { receiver: nodeRef(), method: STR, args: arrOf(nodeRef()) }, ['receiver', 'method', 'args']),
  nodeSchema('OopThis', {}, []),
  // Async
  nodeSchema('AsyncBlock', { body: nodeRef() }, ['body']),
  nodeSchema('Await', { expr: nodeRef() }, ['expr']),
  // ADT
  nodeSchema('AdtDecl', {
    name: STR,
    symbolId: STR,
    variants: arrOf({ $ref: '#/$defs/AdtVariant' }),
  }, ['name', 'symbolId', 'variants']),
  nodeSchema('AdtMatch', {
    scrutinee: nodeRef(),
    arms: arrOf({ $ref: '#/$defs/AdtArm' }),
  }, ['scrutinee', 'arms']),
  // Effects
  nodeSchema('EffectDecl', {
    name: STR,
    symbolId: STR,
    operations: arrOf({ $ref: '#/$defs/EffectOp' }),
  }, ['name', 'symbolId', 'operations']),
  nodeSchema('Perform', {
    effectSymbolId: STR,
    operation: STR,
    args: arrOf(nodeRef()),
  }, ['effectSymbolId', 'operation', 'args']),
  {
    type: 'object',
    required: ['kind', 'body', 'handlers', 'span', 'type'] as readonly string[],
    additionalProperties: false,
    properties: {
      kind: enumOf('Handle'),
      body: nodeRef(),
      handlers: arrOf({ $ref: '#/$defs/EffectHandler' }),
      returnClause: nodeRef(),
      span: spanRef(),
      type: typeRef(),
    },
  },
  nodeSchema('Resume', { value: nodeRef() }, ['value']),
];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Builds a JSON Schema draft-07 object that validates any IonIRModule. */
export function buildIonIRSchema(): JSONSchemaObject {
  const defs: Record<string, JSONSchemaValue> = {
    Span: obj(
      ['file', 'startLine', 'startCol', 'endLine', 'endCol'],
      { file: STR, startLine: NUM, startCol: NUM, endLine: NUM, endCol: NUM },
    ),
    EffectSet: { type: 'array', items: STR, uniqueItems: true },
    LiteralValue: {
      oneOf: [
        obj(['kind', 'value'], { kind: enumOf('Int'), value: NUM }),
        obj(['kind', 'value'], { kind: enumOf('Float'), value: NUM }),
        obj(['kind', 'value'], { kind: enumOf('Str'), value: STR }),
        obj(['kind', 'value'], { kind: enumOf('Bool'), value: BOOL }),
        obj(['kind'], { kind: enumOf('Null') }),
      ],
    },
    IonType: { oneOf: ionTypeVariants },
    CasePattern: { oneOf: casePatternVariants },
    Param: obj(
      ['name', 'symbolId', 'type', 'span'],
      { name: STR, symbolId: STR, type: typeRef(), span: spanRef() },
    ),
    CaseArm: {
      type: 'object',
      required: ['pattern', 'body', 'span'] as readonly string[],
      additionalProperties: false,
      properties: {
        pattern: { $ref: '#/$defs/CasePattern' },
        guard: nodeRef(),
        body: nodeRef(),
        span: spanRef(),
      },
    },
    ForeignSignature: obj(
      ['params', 'ret', 'template'],
      { params: arrOf(typeRef()), ret: typeRef(), template: STR },
    ),
    AdtVariant: obj(
      ['tag', 'symbolId', 'fields', 'span'],
      { tag: STR, symbolId: STR, fields: arrOf({ $ref: '#/$defs/Param' }), span: spanRef() },
    ),
    AdtArm: obj(
      ['tag', 'bindings', 'body', 'span'],
      { tag: STR, bindings: arrOf({ $ref: '#/$defs/Param' }), body: nodeRef(), span: spanRef() },
    ),
    OopMethod: {
      type: 'object',
      required: ['name', 'symbolId', 'params', 'retType', 'isAbstract', 'isStatic', 'span'] as readonly string[],
      additionalProperties: false,
      properties: {
        name: STR,
        symbolId: STR,
        params: arrOf({ $ref: '#/$defs/Param' }),
        retType: typeRef(),
        body: nodeRef(),
        isAbstract: BOOL,
        isStatic: BOOL,
        span: spanRef(),
      },
    },
    OopMember: obj(
      ['name', 'symbolId', 'type', 'span'],
      { name: STR, symbolId: STR, type: typeRef(), span: spanRef() },
    ),
    EffectOp: obj(
      ['name', 'params', 'retType', 'span'],
      { name: STR, params: arrOf({ $ref: '#/$defs/Param' }), retType: typeRef(), span: spanRef() },
    ),
    EffectHandler: obj(
      ['operation', 'params', 'body', 'span'],
      { operation: STR, params: arrOf({ $ref: '#/$defs/Param' }), body: nodeRef(), span: spanRef() },
    ),
    IonIRDialect: enumOf('core', 'ion-oop', 'ion-async', 'ion-adt', 'ion-effects'),
    IonIRNode: { oneOf: ionIRNodeVariants },
    // AdtDeclNode extracted as its own def (used both in IonIRNode and IonIRModule.data)
    AdtDeclNode: nodeSchema('AdtDecl', {
      name: STR,
      symbolId: STR,
      variants: arrOf({ $ref: '#/$defs/AdtVariant' }),
    }, ['name', 'symbolId', 'variants']),
    ModuleRefNode: nodeSchema('ModuleRef', {
      modulePath: arrOf(STR),
      symbolId: STR,
    }, ['modulePath', 'symbolId']),
    IonIRModule: obj(
      ['ionir', 'module', 'version', 'dialects', 'imports', 'data', 'decls'],
      {
        ionir: { type: 'string', enum: ['1.0'] },
        module: STR,
        version: STR,
        dialects: arrOf({ $ref: '#/$defs/IonIRDialect' }),
        imports: arrOf({ $ref: '#/$defs/ModuleRefNode' }),
        data: arrOf({ $ref: '#/$defs/AdtDeclNode' }),
        decls: arrOf(nodeRef()),
      },
    ),
  };

  return {
    $schema: 'http://json-schema.org/draft-07/schema',
    $defs: defs,
    $ref: '#/$defs/IonIRModule',
  };
}
