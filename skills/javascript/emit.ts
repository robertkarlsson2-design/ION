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
import type { EmittedExpr } from '../../src/emit/template.js';

interface EmitCtx {
  readonly indent: number;
  readonly helpers: Map<string, string>;
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
  const ctx: EmitCtx = { indent: 0, helpers: new Map() };

  const adtLines = module.data.map(d => emitAdtDecl(d, ctx));
  const declLines = module.decls.map(d => emitTopLevelDecl(d, ctx));

  const parts: string[] = ['"use strict";'];
  const helpersStr = [...ctx.helpers.values()].join('\n');
  if (helpersStr) parts.push(helpersStr);
  if (adtLines.length > 0) parts.push(adtLines.join('\n'));
  if (declLines.length > 0) parts.push(declLines.join('\n'));

  return parts.join('\n') + '\n';
}

function indentStr(ctx: EmitCtx): string {
  return '  '.repeat(ctx.indent);
}

function nest(ctx: EmitCtx): EmitCtx {
  return { indent: ctx.indent + 1, helpers: ctx.helpers };
}

function emitTopLevelDecl(node: IonIRNode, ctx: EmitCtx): string {
  switch (node.kind) {
    case 'Let': return emitLetTopLevel(node, ctx);
    case 'OopClass': return emitOopClass(node, ctx);
    case 'AdtDecl': return emitAdtDecl(node, ctx);
    case 'EffectDecl': return emitEffectDecl(node);
    case 'OopInterface': return `// interface ${node.name}`;
    default: return `${emitExpr(node, ctx)};`;
  }
}

function emitLetTopLevel(node: LetNode, ctx: EmitCtx): string {
  const value = emitExpr(node.value, ctx);
  return `${indentStr(ctx)}const ${node.name} = ${value};`;
}

function emitExpr(node: IonIRNode, ctx: EmitCtx): EmittedExpr {
  switch (node.kind) {
    case 'Literal': return emitLiteral(node);
    case 'Var': return wrapEmitted(node.name);
    case 'Abs': return emitAbs(node, ctx);
    case 'App': return emitApp(node, ctx);
    case 'Let': return emitLetExpr(node, ctx);
    case 'Case': return emitCase(node, ctx);
    case 'ForeignRef': return emitForeignRef(node);
    case 'Accessor': return emitAccessor(node, ctx);
    case 'Constructor': return emitConstructor(node, ctx);
    case 'ModuleRef': return emitModuleRef(node);
    case 'OopNew': return emitOopNew(node, ctx);
    case 'OopVirtualCall': return emitOopVirtualCall(node, ctx);
    case 'OopThis': return wrapEmitted('this');
    case 'AsyncBlock': return emitAsyncBlock(node, ctx);
    case 'Await': return emitAwait(node, ctx);
    case 'AdtMatch': return emitAdtMatch(node, ctx);
    case 'Perform': return emitPerform(node, ctx);
    case 'Handle': return emitHandle(node, ctx);
    case 'Resume': return emitResume(node, ctx);
    case 'Effect': return emitExpr(node.body, ctx);
    case 'OopClass':
    case 'OopInterface':
    case 'AdtDecl':
    case 'EffectDecl':
      return wrapEmitted('undefined');
  }
}

function emitLiteral(node: LiteralNode): EmittedExpr {
  const v = node.value;
  switch (v.kind) {
    case 'Int': return wrapEmitted(String(v.value));
    case 'Float': return wrapEmitted(String(v.value));
    case 'Bool': return wrapEmitted(v.value ? 'true' : 'false');
    case 'Null': return wrapEmitted('null');
    case 'Str': {
      const escaped = v.value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
      return wrapEmitted(`"${escaped}"`);
    }
  }
}

function emitAbs(node: AbsNode, ctx: EmitCtx): EmittedExpr {
  const body = emitExpr(node.body, ctx);
  if (node.params.length === 0) {
    return wrapEmitted(`() => ${body}`);
  }
  if (node.params.length === 1) {
    return wrapEmitted(`${node.params[0].name} => ${body}`);
  }
  const params = node.params.map(p => p.name).join(', ');
  return wrapEmitted(`(${params}) => ${body}`);
}

function emitApp(node: AppNode, ctx: EmitCtx): EmittedExpr {
  const calleeExpr = emitExpr(node.callee, ctx);
  const callee = node.callee.kind === 'Abs' ? `(${calleeExpr})` : calleeExpr;
  const args = node.args.map(a => emitExpr(a, ctx)).join(', ');
  return wrapEmitted(`${callee}(${args})`);
}

function emitLetExpr(node: LetNode, ctx: EmitCtx): EmittedExpr {
  const inner = nest(ctx);
  const ind = indentStr(ctx);
  const ind1 = indentStr(inner);
  const value = emitExpr(node.value, ctx);
  const body = emitExpr(node.body, inner);
  return wrapEmitted(`(() => {\n${ind1}const ${node.name} = ${value};\n${ind1}return ${body};\n${ind}})()`);
}

function emitCase(node: CaseNode, ctx: EmitCtx): EmittedExpr {
  if (node.arms.length === 0) return wrapEmitted('undefined');

  // Single wildcard arm simplifies to just the body
  if (node.arms.length === 1 && node.arms[0].pattern.kind === 'Wildcard') {
    return emitExpr(node.arms[0].body, ctx);
  }

  const scrutinee = emitExpr(node.scrutinee, ctx);
  const inner = nest(ctx);
  const inner2 = nest(inner);
  const ind = indentStr(ctx);
  const ind1 = indentStr(inner);
  const ind2 = indentStr(inner2);

  const clauses: string[] = [];

  for (let i = 0; i < node.arms.length; i++) {
    const arm = node.arms[i];
    const isLast = i === node.arms.length - 1;
    const body = emitExpr(arm.body, inner2);
    const pat = arm.pattern;
    const varBinding = pat.kind === 'Var' ? `${ind2}const ${pat.name} = ${scrutinee};\n` : '';
    const ctorFieldBindings = pat.kind === 'Constructor'
      ? pat.fields
          .filter(f => f.kind === 'Var')
          .map(f => (f.kind === 'Var' ? `${ind2}const ${f.name} = ${scrutinee}.${f.name};\n` : ''))
          .join('')
      : '';

    if (isLast && (pat.kind === 'Wildcard' || pat.kind === 'Var')) {
      const prefix = clauses.length === 0 ? '' : ' else ';
      clauses.push(`${prefix}{\n${varBinding}${ind2}return ${body};\n${ind1}}`);
    } else {
      const cond = emitPatternCond(pat, scrutinee);
      const guard = arm.guard !== undefined ? ` && ${emitExpr(arm.guard, inner2)}` : '';
      const kw = clauses.length === 0 ? 'if ' : ' else if ';
      clauses.push(`${kw}(${cond}${guard}) {\n${varBinding}${ctorFieldBindings}${ind2}return ${body};\n${ind1}}`);
    }
  }

  return wrapEmitted(`(() => {\n${ind1}${clauses.join('')}\n${ind}})()`);
}

function emitPatternCond(pat: CasePattern, scrutinee: string): string {
  if (pat.kind === 'Wildcard' || pat.kind === 'Var') return 'true';
  if (pat.kind === 'Constructor') {
    assertSafeJsIdentifier(pat.ctorName, 'Constructor pattern tag');
    return `${scrutinee}._tag === "${pat.ctorName}"`;
  }
  const v = pat.value;
  if (v.kind === 'Bool') return `${scrutinee} === ${v.value}`;
  if (v.kind === 'Null') return `${scrutinee} === null`;
  if (v.kind === 'Str') {
    const escaped = v.value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `${scrutinee} === "${escaped}"`;
  }
  return `${scrutinee} === ${v.value}`;
}

function emitForeignRef(node: ForeignRefNode): EmittedExpr {
  const arity = node.sig.params.length;
  if (arity === 0) {
    return wrapEmitted(expandTemplate(node.sig.template, []));
  }
  const paramNames = Array.from({ length: arity }, (_, i) => `_p${i + 1}`);
  const emittedArgs = paramNames.map(p => wrapEmitted(p));
  const call = expandTemplate(node.sig.template, emittedArgs);
  if (arity === 1) {
    return wrapEmitted(`${paramNames[0]} => ${call}`);
  }
  return wrapEmitted(`(${paramNames.join(', ')}) => ${call}`);
}

function emitAccessor(node: AccessorNode, ctx: EmitCtx): EmittedExpr {
  const recv = emitExpr(node.receiver, ctx);
  return wrapEmitted(`${recv}.${node.member}`);
}

function emitConstructor(node: ConstructorNode, ctx: EmitCtx): EmittedExpr {
  const args = node.args.map(a => emitExpr(a, ctx)).join(', ');
  return wrapEmitted(`${node.ctorName}(${args})`);
}

function emitModuleRef(node: ModuleRefNode): EmittedExpr {
  return wrapEmitted(node.modulePath.join('.'));
}

function emitOopNew(node: OopNewNode, ctx: EmitCtx): EmittedExpr {
  const className = node.type.kind === 'User' ? node.type.name : String(node.ctorSymbolId);
  const args = node.args.map(a => emitExpr(a, ctx)).join(', ');
  return wrapEmitted(`new ${className}(${args})`);
}

function emitOopVirtualCall(node: OopVirtualCallNode, ctx: EmitCtx): EmittedExpr {
  const recv = emitExpr(node.receiver, ctx);
  const args = node.args.map(a => emitExpr(a, ctx)).join(', ');
  return wrapEmitted(`${recv}.${node.method}(${args})`);
}

function emitAsyncBlock(node: AsyncBlockNode, ctx: EmitCtx): EmittedExpr {
  const inner = nest(ctx);
  const ind = indentStr(ctx);
  const ind1 = indentStr(inner);
  const body = emitExpr(node.body, inner);
  return wrapEmitted(`async () => {\n${ind1}return ${body};\n${ind}}`);
}

function emitAwait(node: AwaitNode, ctx: EmitCtx): EmittedExpr {
  const expr = emitExpr(node.expr, ctx);
  return wrapEmitted(`await ${expr}`);
}

function emitAdtDecl(node: AdtDeclNode, ctx: EmitCtx): string {
  const ind = indentStr(ctx);
  const lines: string[] = [`// ADT: ${node.name}`];
  for (const variant of node.variants) {
    assertSafeJsIdentifier(variant.tag, 'ADT variant tag');
    if (variant.fields.length === 0) {
      lines.push(`${ind}const ${variant.tag} = { _tag: "${variant.tag}" };`);
    } else {
      const params = variant.fields.map(f => f.name).join(', ');
      const fields = variant.fields.map(f => f.name).join(', ');
      lines.push(`${ind}const ${variant.tag} = (${params}) => ({ _tag: "${variant.tag}", ${fields} });`);
    }
  }
  return lines.join('\n');
}

function emitAdtMatch(node: AdtMatchNode, ctx: EmitCtx): EmittedExpr {
  const scrutineeStr = emitExpr(node.scrutinee, ctx);
  const inner = nest(ctx);
  const inner2 = nest(inner);
  const ind = indentStr(ctx);
  const ind1 = indentStr(inner);
  const ind2 = indentStr(inner2);

  const cases = node.arms.map(arm => {
    assertSafeJsIdentifier(arm.tag, 'ADT match arm tag');
    const bindings = arm.bindings
      .map(b => `${ind2}const ${b.name} = _s.${b.name};`)
      .join('\n');
    const body = emitExpr(arm.body, inner2);
    const stmts = bindings ? `${bindings}\n${ind2}return ${body};` : `${ind2}return ${body};`;
    return `${ind1}case "${arm.tag}": {\n${stmts}\n${ind1}}`;
  });

  return wrapEmitted(
    `(() => {\n${ind1}const _s = ${scrutineeStr};\n${ind1}switch (_s._tag) {\n${cases.join('\n')}\n${ind1}}\n${ind}})()`,
  );
}

function emitPerform(node: PerformNode, ctx: EmitCtx): EmittedExpr {
  ensureEffectPerformHelper(ctx);
  assertSafeJsIdentifier(node.operation, 'Perform operation name');
  const args = node.args.map(a => emitExpr(a, ctx)).join(', ');
  const payload = `[${args}]`;
  return wrapEmitted(`(() => { throw new EffectPerform("${node.operation}", ${payload}); })()`);
}

function emitHandle(node: HandleNode, ctx: EmitCtx): EmittedExpr {
  ensureEffectPerformHelper(ctx);
  const inner = nest(ctx);
  const inner2 = nest(inner);
  const ind = indentStr(ctx);
  const ind1 = indentStr(inner);
  const ind2 = indentStr(inner2);
  const body = emitExpr(node.body, inner);

  const handlerClauses = node.handlers.map(h => {
    assertSafeJsIdentifier(h.operation, 'Handle operation name');
    const bindings = h.params
      .map((p, i) => `${ind2}  const ${p.name} = _e.payload[${i}];`)
      .join('\n');
    const hBody = emitExpr(h.body, { indent: inner2.indent + 1, helpers: ctx.helpers });
    const ind3 = indentStr({ indent: inner2.indent + 1, helpers: ctx.helpers });
    const content = bindings
      ? `${bindings}\n${ind3}return ${hBody};`
      : `${ind3}return ${hBody};`;
    return `${ind2}if (_e.operation === "${h.operation}") {\n${content}\n${ind2}}`;
  });

  const retStmt = node.returnClause !== undefined
    ? `${ind2}return ${emitExpr(node.returnClause, inner2)};`
    : `${ind2}return _result;`;

  return wrapEmitted(
    `(() => {\n${ind1}try {\n${ind2}const _result = ${body};\n${retStmt}\n${ind1}} catch (_e) {\n${ind2}if (_e instanceof EffectPerform) {\n${handlerClauses.join('\n')}\n${ind2}}\n${ind2}throw _e;\n${ind1}}\n${ind}})()`,
  );
}

function emitResume(node: ResumeNode, ctx: EmitCtx): EmittedExpr {
  const val = emitExpr(node.value, ctx);
  return wrapEmitted(`/* resume */ ${val}`);
}

function ensureEffectPerformHelper(ctx: EmitCtx): void {
  if (!ctx.helpers.has('EffectPerform')) {
    ctx.helpers.set(
      'EffectPerform',
      [
        'class EffectPerform extends Error {',
        '  constructor(operation, payload) {',
        '    super(`Effect: ${operation}`);',
        '    this.operation = operation;',
        '    this.payload = payload;',
        '  }',
        '}',
      ].join('\n'),
    );
  }
}

function emitOopClass(node: OopClassNode, ctx: EmitCtx): string {
  const inner = nest(ctx);
  const inner2 = nest(inner);
  const ind = indentStr(ctx);
  const ind1 = indentStr(inner);
  const ind2 = indentStr(inner2);

  const ctorParams = node.fields.map(f => f.name).join(', ');
  const ctorAssignments = node.fields.map(f => `${ind2}this.${f.name} = ${f.name};`).join('\n');
  const ctor = ctorAssignments
    ? `${ind1}constructor(${ctorParams}) {\n${ctorAssignments}\n${ind1}}`
    : `${ind1}constructor(${ctorParams}) {}`;

  const methods = node.methods.map(m => {
    const mParams = m.params.map(p => p.name).join(', ');
    const prefix = m.isStatic ? 'static ' : '';
    if (m.body === undefined) {
      return `${ind1}${prefix}${m.name}(${mParams}) {}`;
    }
    const mBody = emitExpr(m.body, inner2);
    return `${ind1}${prefix}${m.name}(${mParams}) {\n${ind2}return ${mBody};\n${ind1}}`;
  });

  const extendsStr = node.superClass !== undefined ? ` extends ${String(node.superClass)}` : '';
  const classBody = [ctor, ...methods].join('\n\n');
  return `${ind}class ${node.name}${extendsStr} {\n${classBody}\n${ind}}`;
}

function emitEffectDecl(node: EffectDeclNode): string {
  return `// effect ${node.name}`;
}
