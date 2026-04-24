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
  CasePattern,
} from '../../src/ir/nodes.js';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';
import { SourceMapBuilder } from '../../src/emit/sourcemap.js';
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
}

const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function assertSafeJsIdentifier(name: string, context: string): void {
  if (!JS_IDENTIFIER_RE.test(name)) {
    throw new Error(`EmitError: "${name}" is not a valid JavaScript identifier (${context})`);
  }
}

/**
 * Emit an IonIRModule as a JavaScript source string.
 */
export function emitJS(module: IonIRModule): string {
  return printJsModule(buildJsModule(module));
}

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
  const ctx: BuildCtx = { helpers: new Map() };
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
    case 'EffectDecl': return [buildEffectDecl(node)];
    case 'OopInterface': return [{ kind: 'JsLineComment', text: `interface ${node.name}` }];
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
  return { kind: 'JsConst', name: node.name, value: buildExpr(node.value, ctx) };
}

function buildExpr(node: IonIRNode, ctx: BuildCtx): JsNode {
  switch (node.kind) {
    case 'Literal': return buildLiteral(node);
    case 'Var': return { kind: 'JsIdent', name: node.name };
    case 'Abs': return buildAbs(node, ctx);
    case 'App': return buildApp(node, ctx);
    case 'Let': return buildLetExpr(node, ctx);
    case 'Case': return buildCase(node, ctx);
    case 'ForeignRef': return buildForeignRef(node);
    case 'Accessor': return buildAccessor(node, ctx);
    case 'Constructor': return buildConstructor(node, ctx);
    case 'ModuleRef': return { kind: 'JsRaw', code: node.modulePath.join('.') };
    case 'OopNew': return buildOopNew(node, ctx);
    case 'OopVirtualCall': return buildOopVirtualCall(node, ctx);
    case 'OopThis': return { kind: 'JsIdent', name: 'this' };
    case 'AsyncBlock': return buildAsyncBlock(node, ctx);
    case 'Await': return buildAwait(node, ctx);
    case 'AdtMatch': return buildAdtMatch(node, ctx);
    case 'Perform': return buildPerform(node, ctx);
    case 'Handle': return buildHandle(node, ctx);
    case 'Resume': return buildResume(node, ctx);
    case 'Effect': return buildExpr(node.body, ctx);
    case 'OopClass':
    case 'OopInterface':
    case 'AdtDecl':
    case 'EffectDecl':
      return { kind: 'JsIdent', name: 'undefined' };
  }
}

function buildLiteral(node: LiteralNode): JsNode {
  const v = node.value;
  switch (v.kind) {
    case 'Int': return { kind: 'JsNumber', value: v.value };
    case 'Float': return { kind: 'JsNumber', value: v.value };
    case 'Bool': return { kind: 'JsBool', value: v.value };
    case 'Null': return { kind: 'JsNull' };
    case 'Str': return { kind: 'JsString', value: v.value };
  }
}

function buildAbs(node: AbsNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsArrow',
    params: node.params.map(p => p.name),
    body: buildExpr(node.body, ctx),
  };
}

function buildApp(node: AppNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsCall',
    callee: buildExpr(node.callee, ctx),
    args: node.args.map(a => buildExpr(a, ctx)),
  };
}

function buildLetExpr(node: LetNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsIife',
    body: [
      { kind: 'JsConst', name: node.name, value: buildExpr(node.value, ctx) },
      { kind: 'JsReturn', value: buildExpr(node.body, ctx) },
    ],
  };
}

function buildCase(node: CaseNode, ctx: BuildCtx): JsNode {
  if (node.arms.length === 0) return { kind: 'JsIdent', name: 'undefined' };

  if (node.arms.length === 1 && node.arms[0].pattern.kind === 'Wildcard') {
    return buildExpr(node.arms[0].body, ctx);
  }

  const scrutineeNode = buildExpr(node.scrutinee, ctx);
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

    const ctorBindings: JsNode[] = pat.kind === 'Constructor'
      ? pat.fields
          .filter(f => f.kind === 'Var')
          .map(f => {
            if (f.kind !== 'Var') return null;
            const c: JsConst = {
              kind: 'JsConst',
              name: f.name,
              value: { kind: 'JsMember', receiver: scrutineeNode, member: f.name },
            };
            return c;
          })
          .filter((x): x is JsConst => x !== null)
      : [];

    if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
      elseBranch = [...varBinding, { kind: 'JsReturn', value: bodyNode }];
    } else {
      let condNode = buildPatternCond(pat, scrutineeNode);
      if (arm.guard !== undefined) {
        condNode = { kind: 'JsBinary', op: '&&', left: condNode, right: buildExpr(arm.guard, ctx) };
      }
      branches.push({
        cond: condNode,
        body: [...varBinding, ...ctorBindings, { kind: 'JsReturn', value: bodyNode }],
      });
    }
  }

  return {
    kind: 'JsIife',
    body: [{ kind: 'JsIfElse', branches, ...(elseBranch !== undefined ? { elseBranch } : {}) }],
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
  const v = pat.value;
  if (v.kind === 'Bool') return { kind: 'JsBinary', op: '===', left: scrutinee, right: { kind: 'JsBool', value: v.value } };
  if (v.kind === 'Null') return { kind: 'JsBinary', op: '===', left: scrutinee, right: { kind: 'JsNull' } };
  if (v.kind === 'Str') return { kind: 'JsBinary', op: '===', left: scrutinee, right: { kind: 'JsString', value: v.value } };
  return { kind: 'JsBinary', op: '===', left: scrutinee, right: { kind: 'JsNumber', value: v.value } };
}

function buildForeignRef(node: ForeignRefNode): JsNode {
  const arity = node.sig.params.length;
  if (arity === 0) {
    return { kind: 'JsRaw', code: expandTemplate(node.sig.template, []) };
  }
  const paramNames = Array.from({ length: arity }, (_, i) => `_p${i + 1}`);
  const emittedArgs = paramNames.map(p => wrapEmitted(p));
  const callCode = expandTemplate(node.sig.template, emittedArgs);
  return {
    kind: 'JsArrow',
    params: paramNames,
    body: { kind: 'JsRaw', code: callCode },
  };
}

function buildAccessor(node: AccessorNode, ctx: BuildCtx): JsNode {
  return { kind: 'JsMember', receiver: buildExpr(node.receiver, ctx), member: node.member };
}

function buildConstructor(node: ConstructorNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsCall',
    callee: { kind: 'JsIdent', name: node.ctorName },
    args: node.args.map(a => buildExpr(a, ctx)),
  };
}

function buildOopNew(node: OopNewNode, ctx: BuildCtx): JsNode {
  const className = node.type.kind === 'User' ? node.type.name : String(node.ctorSymbolId);
  return {
    kind: 'JsNew',
    className,
    args: node.args.map(a => buildExpr(a, ctx)),
  };
}

function buildOopVirtualCall(node: OopVirtualCallNode, ctx: BuildCtx): JsNode {
  return {
    kind: 'JsCall',
    callee: { kind: 'JsMember', receiver: buildExpr(node.receiver, ctx), member: node.method },
    args: node.args.map(a => buildExpr(a, ctx)),
  };
}

function buildAsyncBlock(node: AsyncBlockNode, ctx: BuildCtx): JsNode {
  // async () => { return body; }  — emit as JsRaw to preserve async keyword
  const bodyNode = buildExpr(node.body, ctx);
  return { kind: 'JsRaw', code: `async () => {\n  return ${printJsExpr(bodyNode)};\n}` };
}

function buildAwait(node: AwaitNode, ctx: BuildCtx): JsNode {
  return { kind: 'JsRaw', code: `await ${printJsExpr(buildExpr(node.expr, ctx))}` };
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
  };
}

function buildResume(node: ResumeNode, ctx: BuildCtx): JsNode {
  return { kind: 'JsRaw', code: `/* resume */ ${printJsExpr(buildExpr(node.value, ctx))}` };
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

function buildOopClass(node: OopClassNode, ctx: BuildCtx): JsClass {
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
    kind: 'JsClass',
    name: node.name,
    ...(node.superClass !== undefined ? { superClass: String(node.superClass) } : {}),
    ctor,
    methods,
  };
}

function buildEffectDecl(node: EffectDeclNode): JsNode {
  return { kind: 'JsLineComment', text: `effect ${node.name}` };
}
