import type {
  IonIRModule,
  IonIRNode,
  LiteralNode,
  AbsNode,
  AppNode,
  LetNode,
  CaseNode,
  ForeignRefNode,
  AccessorNode,
  OopClassNode,
  OopNewNode,
  OopVirtualCallNode,
  AsyncBlockNode,
  AwaitNode,
  AdtDeclNode,
  AdtMatchNode,
  PerformNode,
  HandleNode,
  ResumeNode,
  ConstructorNode,
  ModuleRefNode,
  EffectDeclNode,
  OopInterfaceNode,
  ListLitIRNode,
  VarNode,
  CasePattern,
  AdtVariant,
} from '../../src/ir/nodes.js';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';
import { SourceMapBuilder } from '../../src/emit/sourcemap.js';
import { shakePreludeDecls } from '../../src/prelude/dce.js';
import type {
  JsNode,
  JsModule,
  JsConst,
  JsClass,
  JsMethod,
} from './js-ast.js';
import { printJsModule, printJsExpr, printJsModuleWithMappings } from './printer.js';

interface BuildCtx {
  readonly helpers: Map<string, JsNode>;
  /** Maps each ADT constructor tag to its ordered IonIR field names (e.g. "_0","_1" for tuples). */
  readonly ctorFields: Map<string, string[]>;
}

const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Maps builtin operator names (from desugar) to their JS operator strings. */
const BUILTIN_BINARY_OPS: Record<string, string> = {
  __add__: '+', __sub__: '-', __mul__: '*', __div__: '/', __mod__: '%',
  __eq__: '===', __ne__: '!==', __lt__: '<', __gt__: '>', __le__: '<=', __ge__: '>=',
  __and__: '&&', __or__: '||',
};
const BUILTIN_UNARY_OPS: Record<string, string> = { __neg__: '-', __not__: '!' };

function assertSafeJsIdentifier(name: string, context: string): void {
  if (!JS_IDENTIFIER_RE.test(name)) {
    throw new Error(`EmitError: "${name}" is not a valid JavaScript identifier (${context})`);
  }
}

/**
 * Emit an IonIRModule as a JavaScript source string.
 */
export function emitJS(module: IonIRModule): string {
  return printJsModule(buildJsModule(shakePreludeDecls(module)));
}

export { buildJsModule };

/**
 * Emit an IonIRModule as JavaScript with an inlined ECMA Source Map v3.
 * @param ionSourceFile - Absolute path to the originating .ion file.
 * @param ionSourceText - Raw text of the .ion file (embedded in sourcesContent).
 */
export function emitJSWithSourceMap(
  module: IonIRModule,
  ionSourceFile: string,
  ionSourceText: string,
): { source: string; map: string } {
  const jsModule = buildJsModule(module);
  const { source, mappings } = printJsModuleWithMappings(jsModule, ionSourceFile);
  const builder = new SourceMapBuilder();
  for (const m of mappings) {
    builder.addMapping(m);
  }
  const outputFile = ionSourceFile.replace(/\.ion$/, '.js');
  const map = builder.toJSON({
    file: outputFile,
    sourceContents: new Map([[ionSourceFile, ionSourceText]]),
  });
  return { source, map };
}

function buildJsModule(module: IonIRModule): JsModule {
  const ctorFields = new Map<string, string[]>();
  for (const d of module.data) {
    for (const v of d.variants) {
      ctorFields.set(v.tag, v.fields.map((f: AdtVariant['fields'][number]) => f.name));
    }
  }
  const ctx: BuildCtx = { helpers: new Map(), ctorFields };
  const dataDecls = module.data.flatMap(d => buildAdtDecl(d, ctx));
  const bodyDecls = module.decls.flatMap(d => buildTopLevelDecl(d, ctx));
  const helpers = [...ctx.helpers.values()];
  return { kind: 'JsModule', helpers, dataDecls, bodyDecls };
}

function buildTopLevelDecl(node: IonIRNode, ctx: BuildCtx): JsNode[] {
  switch (node.kind) {
    case 'Let': return [buildLetTopLevel(node, ctx)];
    case 'OopClass': return [buildOopClass(node, ctx)];
    case 'AdtDecl': return buildAdtDecl(node, ctx);
    case 'EffectDecl': return buildEffectDecl(node);
    case 'OopInterface': return buildOopInterface(node);
    default: {
      const expr = buildExpr(node, ctx);
      return [{ kind: 'JsRaw', code: `${nodeToRawStr(expr)};` }];
    }
  }
}

/** Flatten a simple JsNode to a raw string for the rare default-decl case. */
function nodeToRawStr(node: JsNode): string {
  if (node.kind === 'JsRaw') return node.code;
  if (node.kind === 'JsIdent') return node.name;
  return 'undefined';
}

function buildLetTopLevel(node: LetNode, ctx: BuildCtx): JsConst {
  return { kind: 'JsConst', name: node.name, value: buildExpr(node.value, ctx), ionSpan: node.span };
}

function buildExpr(node: IonIRNode, ctx: BuildCtx): JsNode {
  switch (node.kind) {
    case 'Literal': return buildLiteral(node);
    case 'Var': return { kind: 'JsIdent', name: node.name, ionSpan: node.span };
    case 'Abs': return buildAbs(node, ctx);
    case 'App': return buildApp(node, ctx);
    case 'Let': return buildLetExpr(node, ctx);
    case 'Case': return buildCase(node, ctx);
    case 'ForeignRef': return buildForeignRef(node);
    case 'Accessor': return buildAccessor(node, ctx);
    case 'Constructor': return buildConstructor(node, ctx);
    case 'ModuleRef': return { kind: 'JsRaw', code: node.modulePath.join('.'), ionSpan: node.span };
    case 'OopNew': return buildOopNew(node, ctx);
    case 'OopVirtualCall': return buildOopVirtualCall(node, ctx);
    case 'OopThis': return { kind: 'JsIdent', name: 'this', ionSpan: node.span };
    case 'AsyncBlock': return buildAsyncBlock(node, ctx);
    case 'Await': return buildAwait(node, ctx);
    case 'AdtMatch': return buildAdtMatch(node, ctx);
    case 'Perform': return buildPerform(node, ctx);
    case 'Handle': return buildHandle(node, ctx);
    case 'Resume': return buildResume(node, ctx);
    case 'Effect': return buildExpr(node.body, ctx);
    case 'ListLit':
      return { kind: 'JsArray', elems: node.elements.map(e => buildExpr(e, ctx)), ionSpan: node.span };
    case 'MapLit':
      return {
        kind: 'JsNew',
        className: 'Map',
        args: [{ kind: 'JsArray', elems: node.entries.map(e => ({ kind: 'JsArray' as const, elems: [buildExpr(e.key, ctx), buildExpr(e.value, ctx)] })) }],
        ionSpan: node.span,
      };
    case 'OopClass':
    case 'OopInterface':
    case 'AdtDecl':
    case 'EffectDecl':
      // Declaration nodes appearing in expression position are no-ops at runtime.
      return { kind: 'JsIdent', name: 'undefined' };
    case 'RawInject':
      return { kind: 'JsRaw', code: node.code, ionSpan: node.span };
  }
}

function buildLiteral(node: LiteralNode): JsNode {
  const v = node.value;
  switch (v.kind) {
    case 'Int': return { kind: 'JsNumber', value: v.value, ionSpan: node.span };
    case 'Float': return { kind: 'JsNumber', value: v.value, ionSpan: node.span };
    case 'Bool': return { kind: 'JsBool', value: v.value, ionSpan: node.span };
    case 'Null': return { kind: 'JsNull', ionSpan: node.span };
    case 'Str': return { kind: 'JsString', value: v.value, ionSpan: node.span };
  }
}

function buildAbs(node: AbsNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsArrow',
    params: node.params.map(p => p.name),
    body: buildExpr(node.body, ctx),
    ionSpan: node.span,
  };
}

function buildApp(node: AppNode, ctx: BuildCtx): JsNode {
  if (node.callee.kind === 'Var') {
    const binaryOp = BUILTIN_BINARY_OPS[(node.callee as VarNode).name];
    if (binaryOp !== undefined && node.args.length === 2) {
      return { kind: 'JsBinary', op: binaryOp, left: buildExpr(node.args[0], ctx), right: buildExpr(node.args[1], ctx), ionSpan: node.span };
    }
    const unaryOp = BUILTIN_UNARY_OPS[(node.callee as VarNode).name];
    if (unaryOp !== undefined && node.args.length === 1) {
      return { kind: 'JsRaw', code: `${unaryOp}${printJsExpr(buildExpr(node.args[0], ctx))}`, ionSpan: node.span };
    }
  }
  return {
    kind: 'JsCall',
    callee: buildExpr(node.callee, ctx),
    args: node.args.map(a => buildExpr(a, ctx)),
    ionSpan: node.span,
  };
}

function buildLetExpr(node: LetNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsIife',
    body: [
      { kind: 'JsConst', name: node.name, value: buildExpr(node.value, ctx) },
      { kind: 'JsReturn', value: buildExpr(node.body, ctx) },
    ],
    ionSpan: node.span,
  };
}

/** Build const bindings for constructor pattern fields using the correct IonIR field names. */
function buildCtorBindings(pat: CasePattern, scrutineeNode: JsNode, ctx: BuildCtx): JsConst[] {
  if (pat.kind === 'Tuple') {
    const result: JsConst[] = [];
    for (let fi = 0; fi < pat.fields.length; fi++) {
      const f = pat.fields[fi];
      if (f.kind !== 'Var') continue;
      result.push({
        kind: 'JsConst',
        name: f.name,
        value: { kind: 'JsSubscript', receiver: scrutineeNode, index: { kind: 'JsNumber', value: fi } },
      });
    }
    return result;
  }
  if (pat.kind !== 'Constructor') return [];
  const fieldNames = ctx.ctorFields.get(pat.ctorName) ?? [];
  const result: JsConst[] = [];
  for (let fi = 0; fi < pat.fields.length; fi++) {
    const f = pat.fields[fi];
    if (f.kind !== 'Var') continue;
    // Use the IonIR field name (e.g. "_0" for tuples) as the property key,
    // not the user's VarPattern binding name, to match the emitted constructor object shape.
    const member = fieldNames[fi] ?? `_${fi}`;
    const memberExpr: JsNode = { kind: 'JsMember', receiver: scrutineeNode, member };
    result.push({ kind: 'JsConst', name: f.name, value: memberExpr });
  }
  return result;
}

function buildCase(node: CaseNode, ctx: BuildCtx): JsNode {
  if (node.arms.length === 0) return { kind: 'JsIdent', name: 'undefined' };

  if (node.arms.length === 1 && node.arms[0].pattern.kind === 'Wildcard') {
    return buildExpr(node.arms[0].body, ctx);
  }

  // Optimization: if-else desugared from `if cond then a else b`
  // Shape: 2 arms, first is Literal(Bool=true), second is Wildcard
  if (
    node.arms.length === 2 &&
    node.arms[0].pattern.kind === 'Literal' &&
    node.arms[0].pattern.value.kind === 'Bool' &&
    node.arms[0].pattern.value.value === true &&
    node.arms[0].guard === undefined &&
    node.arms[1].pattern.kind === 'Wildcard'
  ) {
    return {
      kind: 'JsRaw',
      code: `${printJsExpr(buildExpr(node.scrutinee, ctx))} ? ${printJsExpr(buildExpr(node.arms[0].body, ctx))} : ${printJsExpr(buildExpr(node.arms[1].body, ctx))}`,
      ionSpan: node.span,
    };
  }

  const scrutineeNode = buildExpr(node.scrutinee, ctx);
  const hasGuards = node.arms.some(a => a.guard !== undefined);

  if (hasGuards) {
    // Flat-if approach: each arm is an independent `if` block so that a guard
    // failure can fall through to subsequent arms rather than short-circuiting
    // an if-else chain.  Guards are evaluated AFTER constructor bindings are
    // declared to avoid TDZ ReferenceErrors.
    const stmts: JsNode[] = [];
    for (let i = 0; i < node.arms.length; i++) {
      const arm = node.arms[i];
      const isLast = i === node.arms.length - 1;
      const bodyNode = buildExpr(arm.body, ctx);
      const pat = arm.pattern;

      if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
        if (pat.kind === 'Var') stmts.push({ kind: 'JsConst', name: pat.name, value: scrutineeNode });
        stmts.push({ kind: 'JsReturn', value: bodyNode });
        break;
      }

      const varBinding: JsNode[] = pat.kind === 'Var'
        ? [{ kind: 'JsConst', name: pat.name, value: scrutineeNode }]
        : [];
      const ctorBindings = buildCtorBindings(pat, scrutineeNode, ctx);
      const patternCond = buildPatternCond(pat, scrutineeNode);
      const innerStmts: JsNode[] = [...varBinding, ...ctorBindings];

      if (arm.guard !== undefined) {
        // Declare bindings first, then check guard — prevents TDZ.
        innerStmts.push({
          kind: 'JsIfElse',
          branches: [{ cond: buildExpr(arm.guard, ctx), body: [{ kind: 'JsReturn', value: bodyNode }] }],
        });
      } else {
        innerStmts.push({ kind: 'JsReturn', value: bodyNode });
      }

      stmts.push({ kind: 'JsIfElse', branches: [{ cond: patternCond, body: innerStmts }] });
    }
    return { kind: 'JsIife', body: stmts, ionSpan: node.span };
  }

  // No guards: existing if-else-if chain (preserves output for the common case).
  const branches: Array<{ readonly cond: JsNode; readonly body: readonly JsNode[] }> = [];
  let elseBranch: readonly JsNode[] | undefined;

  for (let i = 0; i < node.arms.length; i++) {
    const arm = node.arms[i];
    const isLast = i === node.arms.length - 1;
    const bodyNode = buildExpr(arm.body, ctx);
    const pat = arm.pattern;

    const varBinding: JsNode[] = pat.kind === 'Var'
      ? [{ kind: 'JsConst', name: pat.name, value: scrutineeNode }]
      : [];
    const ctorBindings = buildCtorBindings(pat, scrutineeNode, ctx);

    if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
      elseBranch = [...varBinding, { kind: 'JsReturn', value: bodyNode }];
    } else {
      branches.push({
        cond: buildPatternCond(pat, scrutineeNode),
        body: [...varBinding, ...ctorBindings, { kind: 'JsReturn', value: bodyNode }],
      });
    }
  }

  return {
    kind: 'JsIife',
    body: [{ kind: 'JsIfElse', branches, ...(elseBranch !== undefined ? { elseBranch } : {}) }],
    ionSpan: node.span,
  };
}

function buildPatternCond(pat: CasePattern, scrutinee: JsNode): JsNode {
  if (pat.kind === 'Wildcard' || pat.kind === 'Var') {
    return { kind: 'JsBool', value: true };
  }
  if (pat.kind === 'Constructor') {
    assertSafeJsIdentifier(pat.ctorName, 'Constructor pattern tag');
    return {
      kind: 'JsBinary', op: '===',
      left: { kind: 'JsMember', receiver: scrutinee, member: '_tag' },
      right: { kind: 'JsString', value: pat.ctorName },
    };
  }
  if (pat.kind === 'Tuple') {
    return {
      kind: 'JsBinary', op: '===',
      left: { kind: 'JsMember', receiver: scrutinee, member: 'length' },
      right: { kind: 'JsNumber', value: pat.fields.length },
    };
  }
  const v = pat.value;
  if (v.kind === 'Bool') return { kind: 'JsBinary', op: '===', left: scrutinee, right: { kind: 'JsBool', value: v.value } };
  if (v.kind === 'Null') return { kind: 'JsBinary', op: '===', left: scrutinee, right: { kind: 'JsNull' } };
  if (v.kind === 'Str') return { kind: 'JsBinary', op: '===', left: scrutinee, right: { kind: 'JsString', value: v.value } };
  return { kind: 'JsBinary', op: '===', left: scrutinee, right: { kind: 'JsNumber', value: v.value } };
}

function buildForeignRef(node: ForeignRefNode): JsNode {
  const arity = node.sig.params.length;
  if (arity === 0) {
    return { kind: 'JsRaw', code: expandTemplate(node.sig.template, []), ionSpan: node.span };
  }
  const paramNames = Array.from({ length: arity }, (_, i) => node.sig.paramNames?.[i] ?? `_p${i + 1}`);
  const emittedArgs = paramNames.map(p => wrapEmitted(p));
  const callCode = expandTemplate(node.sig.template, emittedArgs);
  return {
    kind: 'JsArrow',
    params: paramNames,
    body: { kind: 'JsRaw', code: callCode },
    ionSpan: node.span,
  };
}

function buildAccessor(node: AccessorNode, ctx: BuildCtx): JsNode {
  return { kind: 'JsMember', receiver: buildExpr(node.receiver, ctx), member: node.member, ionSpan: node.span };
}

function buildConstructor(node: ConstructorNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsCall',
    callee: { kind: 'JsIdent', name: node.ctorName },
    args: node.args.map(a => buildExpr(a, ctx)),
    ionSpan: node.span,
  };
}

function buildOopNew(node: OopNewNode, ctx: BuildCtx): JsNode {
  const className = node.type.kind === 'User' ? node.type.name : String(node.ctorSymbolId);
  return {
    kind: 'JsNew',
    className,
    args: node.args.map(a => buildExpr(a, ctx)),
    ionSpan: node.span,
  };
}

function buildOopVirtualCall(node: OopVirtualCallNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsCall',
    callee: { kind: 'JsMember', receiver: buildExpr(node.receiver, ctx), member: node.method },
    args: node.args.map(a => buildExpr(a, ctx)),
    ionSpan: node.span,
  };
}

function buildAsyncBlock(node: AsyncBlockNode, ctx: BuildCtx): JsNode {
  // async () => { return body; }  — emit as JsRaw to preserve async keyword
  const bodyNode = buildExpr(node.body, ctx);
  return { kind: 'JsRaw', code: `async () => {\n  return ${printJsExpr(bodyNode)};\n}`, ionSpan: node.span };
}

function buildAwait(node: AwaitNode, ctx: BuildCtx): JsNode {
  return { kind: 'JsRaw', code: `await ${printJsExpr(buildExpr(node.expr, ctx))}`, ionSpan: node.span };
}

function buildAdtDecl(node: AdtDeclNode, _ctx: BuildCtx): JsNode[] {
  const nodes: JsNode[] = [{ kind: 'JsLineComment', text: `ADT: ${node.name}` }];
  for (const variant of node.variants) {
    assertSafeJsIdentifier(variant.tag, 'ADT variant tag');
    if (variant.fields.length === 0) {
      nodes.push({
        kind: 'JsConst',
        name: variant.tag,
        value: {
          kind: 'JsObject',
          props: [{ kind: 'JsObjectProp', key: '_tag', value: { kind: 'JsString', value: variant.tag }, shorthand: false }],
        },
      });
    } else {
      const params = variant.fields.map(f => f.name).join(', ');
      const fields = variant.fields.map(f => f.name).join(', ');
      nodes.push({
        kind: 'JsConst',
        name: variant.tag,
        value: { kind: 'JsRaw', code: `(${params}) => ({ _tag: "${variant.tag}", ${fields} })` },
      });
    }
  }
  return nodes;
}

function buildAdtMatch(node: AdtMatchNode, ctx: BuildCtx): JsNode {
  const scrutineeNode = buildExpr(node.scrutinee, ctx);
  const cases = node.arms.map(arm => {
    assertSafeJsIdentifier(arm.tag, 'ADT match arm tag');
    const bindings: JsNode[] = arm.bindings.map(b => ({
      kind: 'JsConst' as const,
      name: b.name,
      value: { kind: 'JsMember' as const, receiver: { kind: 'JsIdent' as const, name: '_s' }, member: b.name },
    }));
    return {
      kind: 'JsSwitchCase' as const,
      label: arm.tag,
      body: [...bindings, { kind: 'JsReturn' as const, value: buildExpr(arm.body, ctx) }],
    };
  });

  return {
    kind: 'JsIife',
    body: [
      { kind: 'JsConst', name: '_s', value: scrutineeNode },
      {
        kind: 'JsSwitch',
        expr: { kind: 'JsMember', receiver: { kind: 'JsIdent', name: '_s' }, member: '_tag' },
        cases,
      },
    ],
    ionSpan: node.span,
  };
}

function buildPerform(node: PerformNode, ctx: BuildCtx): JsNode {
  ensureEffectPerformHelper(ctx);
  assertSafeJsIdentifier(node.operation, 'Perform operation name');
  const argNodes = node.args.map(a => buildExpr(a, ctx));
  return {
    kind: 'JsIife',
    body: [
      {
        kind: 'JsThrow',
        value: {
          kind: 'JsNew',
          className: 'EffectPerform',
          args: [{ kind: 'JsString', value: node.operation }, { kind: 'JsArray', elems: argNodes }],
        },
      },
    ],
    ionSpan: node.span,
  };
}

function buildHandle(node: HandleNode, ctx: BuildCtx): JsNode {
  ensureEffectPerformHelper(ctx);

  const bodyNode = buildExpr(node.body, ctx);
  const retStmt: JsNode = node.returnClause !== undefined
    ? { kind: 'JsReturn', value: buildExpr(node.returnClause, ctx) }
    : { kind: 'JsReturn', value: { kind: 'JsIdent', name: '_result' } };

  const handlerIfs: JsNode[] = node.handlers.map(h => {
    assertSafeJsIdentifier(h.operation, 'Handle operation name');
    const bindings: JsNode[] = h.params.map((p, i) => ({
      kind: 'JsConst' as const,
      name: p.name,
      value: {
        kind: 'JsSubscript' as const,
        receiver: { kind: 'JsMember' as const, receiver: { kind: 'JsIdent' as const, name: '_e' }, member: 'payload' },
        index: { kind: 'JsNumber' as const, value: i },
      },
    }));
    return {
      kind: 'JsIfElse' as const,
      branches: [{
        cond: {
          kind: 'JsBinary' as const, op: '===',
          left: { kind: 'JsMember' as const, receiver: { kind: 'JsIdent' as const, name: '_e' }, member: 'operation' },
          right: { kind: 'JsString' as const, value: h.operation },
        },
        body: [...bindings, { kind: 'JsReturn' as const, value: buildExpr(h.body, ctx) }],
      }],
    };
  });

  return {
    kind: 'JsIife',
    body: [
      {
        kind: 'JsTryCatch',
        tryBody: [
          { kind: 'JsConst', name: '_result', value: bodyNode },
          retStmt,
        ],
        catchParam: '_e',
        catchBody: [
          {
            kind: 'JsIfElse',
            branches: [{
              cond: { kind: 'JsInstanceof', expr: { kind: 'JsIdent', name: '_e' }, className: 'EffectPerform' },
              body: handlerIfs,
            }],
          },
          { kind: 'JsThrow', value: { kind: 'JsIdent', name: '_e' } },
        ],
      },
    ],
    ionSpan: node.span,
  };
}

function buildResume(node: ResumeNode, ctx: BuildCtx): JsNode {
  // Resume passes the value back as the result of the effect perform.
  // In our CPS-via-throw model the resumed value is simply the expression itself.
  return buildExpr(node.value, ctx);
}

function ensureEffectPerformHelper(ctx: BuildCtx): void {
  if (!ctx.helpers.has('EffectPerform')) {
    const helper: JsClass = {
      kind: 'JsClass',
      name: 'EffectPerform',
      superClass: 'Error',
      ctor: {
        kind: 'JsMethod',
        name: 'constructor',
        params: ['operation', 'payload'],
        isStatic: false,
        body: [
          { kind: 'JsRaw', code: 'super(`Effect: ${operation}`)' },
          {
            kind: 'JsAssign',
            lhs: { kind: 'JsMember', receiver: { kind: 'JsIdent', name: 'this' }, member: 'operation' },
            rhs: { kind: 'JsIdent', name: 'operation' },
          },
          {
            kind: 'JsAssign',
            lhs: { kind: 'JsMember', receiver: { kind: 'JsIdent', name: 'this' }, member: 'payload' },
            rhs: { kind: 'JsIdent', name: 'payload' },
          },
        ],
      },
      methods: [],
    };
    ctx.helpers.set('EffectPerform', helper);
  }
}

/** Emit a JS decorator line, e.g. `@log` or `@decorator(arg1, arg2)`. */
function emitJsAnnotation(a: import('../../src/ir/nodes.js').OopAnnotation): string {
  return '@' + a.name + (a.args.length > 0 ? '(' + a.args.join(', ') + ')' : '');
}

/**
 * Build the JS name for a field or method, applying the private-fields `#` prefix
 * for `visibility === 'private'`. JS has no `protected` syntax; we emit a JSDoc
 * comment for that instead.
 */
function jsPrivateName(name: string, visibility: string | undefined): string {
  return visibility === 'private' ? `#${name}` : name;
}

function buildOopClass(node: OopClassNode, ctx: BuildCtx): JsNode {
  const hasNewFeatures =
    node.annotations !== undefined ||
    node.constructors !== undefined ||
    node.fields.some(f => f.visibility !== undefined || f.isStatic || f.isReadonly) ||
    node.methods.some(m => m.annotations !== undefined || m.visibility !== undefined || m.accessorKind !== undefined);

  if (!hasNewFeatures) {
    // Fast path — use the structured JsClass AST (printer handles it)
    const ctorBody: JsNode[] = node.fields.map(f => ({
      kind: 'JsAssign' as const,
      lhs: { kind: 'JsMember' as const, receiver: { kind: 'JsIdent' as const, name: 'this' }, member: f.name },
      rhs: { kind: 'JsIdent' as const, name: f.name },
    }));

    const ctor: JsMethod = {
      kind: 'JsMethod',
      name: 'constructor',
      params: node.fields.map(f => f.name),
      isStatic: false,
      body: ctorBody,
    };

    const methods: JsMethod[] = node.methods.map(m => ({
      kind: 'JsMethod' as const,
      name: m.name,
      params: m.params.map(p => p.name),
      isStatic: m.isStatic,
      body: m.body !== undefined
        ? [{ kind: 'JsReturn' as const, value: buildExpr(m.body, ctx) }]
        : [],
    }));

    return {
      kind: 'JsClass' as const,
      name: node.name,
      ...(node.superClass !== undefined ? { superClass: String(node.superClass) } : {}),
      ctor,
      methods,
      ionSpan: node.span,
    };
  }

  // Slow path — emit raw code to handle private fields, accessors, annotations, constructors
  const lines: string[] = [];

  // Class-level annotations
  for (const a of node.annotations ?? []) {
    lines.push(emitJsAnnotation(a));
  }

  const superStr = node.superClass !== undefined ? ` extends ${String(node.superClass)}` : '';
  lines.push(`class ${node.name}${superStr} {`);

  // Field declarations (only private and static are syntactically significant in JS)
  for (const f of node.fields) {
    if (f.visibility === 'protected') {
      lines.push(`  /** @protected */`);
    }
    const staticPrefix = f.isStatic ? 'static ' : '';
    const fieldName = jsPrivateName(f.name, f.visibility);
    lines.push(`  ${staticPrefix}${fieldName};`);
  }

  // Explicit constructors
  if (node.constructors && node.constructors.length > 0) {
    for (const ctor of node.constructors) {
      if (ctor.visibility === 'protected') {
        lines.push(`  /** @protected */`);
      }
      const ctorParams = ctor.params.map(p => p.name).join(', ');
      if (ctor.body !== undefined) {
        const bodyExpr = printJsExpr(buildExpr(ctor.body, ctx));
        lines.push(`  constructor(${ctorParams}) {`);
        lines.push(`    return ${bodyExpr};`);
        lines.push('  }');
      } else {
        // Auto-assign fields from params
        const assignments = node.fields.map(f => {
          const fieldName = jsPrivateName(f.name, f.visibility);
          return `    this.${fieldName} = ${f.name};`;
        }).join('\n');
        lines.push(`  constructor(${ctorParams}) {`);
        if (assignments) lines.push(assignments);
        lines.push('  }');
      }
    }
  } else if (node.fields.length > 0) {
    // Auto-generate constructor from fields
    const ctorParams = node.fields.map(f => f.name).join(', ');
    const assignments = node.fields.map(f => {
      const fieldName = jsPrivateName(f.name, f.visibility);
      return `    this.${fieldName} = ${f.name};`;
    }).join('\n');
    lines.push(`  constructor(${ctorParams}) {`);
    lines.push(assignments);
    lines.push('  }');
  }

  // Methods
  for (const m of node.methods) {
    // Method-level annotations
    for (const a of m.annotations ?? []) {
      lines.push(`  ${emitJsAnnotation(a)}`);
    }
    if (m.visibility === 'protected') {
      lines.push(`  /** @protected */`);
    }

    const params = m.params.map(p => p.name).join(', ');
    const staticPrefix = m.isStatic ? 'static ' : '';
    const accessorPrefix = m.accessorKind === 'get' ? 'get '
      : m.accessorKind === 'set' ? 'set '
      : '';
    const methodName = jsPrivateName(m.name, m.visibility);

    if (m.body !== undefined) {
      const bodyExpr = printJsExpr(buildExpr(m.body, ctx));
      lines.push(`  ${staticPrefix}${accessorPrefix}${methodName}(${params}) {`);
      lines.push(`    return ${bodyExpr};`);
      lines.push('  }');
    } else {
      lines.push(`  ${staticPrefix}${accessorPrefix}${methodName}(${params}) {}`);
    }
  }

  lines.push('}');
  return { kind: 'JsRaw', code: lines.join('\n'), ionSpan: node.span };
}

/**
 * Emit an OopInterface as a JSDoc block comment describing its shape.
 *
 * JavaScript has no native interface construct, so we emit:
 *   - A JSDoc `@interface` block listing each member as a `@property` tag.
 *   - No runtime value is produced; the comment is purely for tooling.
 *
 * Example output for `interface Shape { area: number; perimeter: number }`:
 *   /**
 *    * @interface Shape
 *    * @property {*} area
 *    * @property {*} perimeter
 *    *\/
 */
function buildOopInterface(node: OopInterfaceNode): JsNode[] {
  const lines: string[] = [
    `/**`,
    ` * @interface ${node.name}`,
  ];
  // Emit annotations as @decorator tags inside the JSDoc block
  for (const a of node.annotations ?? []) {
    const argsStr = a.args.length > 0 ? '(' + a.args.join(', ') + ')' : '';
    lines.push(` * @decorator ${a.name}${argsStr}`);
  }
  for (const member of node.members) {
    lines.push(` * @property {*} ${member.name}`);
  }
  lines.push(` */`);
  return [{ kind: 'JsRaw', code: lines.join('\n') }];
}

/**
 * Emit an EffectDecl as:
 *   1. A line comment identifying the effect (for readability).
 *   2. A `const <Name>_EFFECT = Symbol("<Name>");` declaration giving the
 *      effect a stable runtime identity that handlers can test against.
 *
 * Example for `effect Console { log: (Str) -> Unit }`:
 *   // effect Console
 *   const Console_EFFECT = Symbol("Console");
 */
function buildEffectDecl(node: EffectDeclNode): JsNode[] {
  assertSafeJsIdentifier(node.name, 'EffectDecl name');
  const symbolName = `${node.name}_EFFECT`;
  return [
    { kind: 'JsLineComment', text: `effect ${node.name}` },
    {
      kind: 'JsConst',
      name: symbolName,
      value: {
        kind: 'JsCall',
        callee: { kind: 'JsIdent', name: 'Symbol' },
        args: [{ kind: 'JsString', value: node.name }],
      },
    },
  ];
}
