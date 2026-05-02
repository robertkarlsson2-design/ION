import type {
  JsNode,
  JsModule,
  JsConst,
  JsClass,
  JsMethod,
  JsArrow,
  JsCall,
  JsNew,
  JsIdent,
  JsNumber,
  JsString,
  JsBool,
  JsMember,
  JsSubscript,
  JsObject,
  JsArray,
  JsIife,
  JsIfElse,
  JsReturn,
  JsSwitch,
  JsSwitchCase,
  JsThrow,
  JsTryCatch,
  JsBlock,
  JsAssign,
  JsLineComment,
  JsTemplateLit,
  JsBinary,
  JsInstanceof,
  JsRaw,
} from './js-ast.js';
import type { Span } from '../../src/types.js';
import type { SourceMapping } from '../../src/emit/sourcemap.js';

interface PrintCtx {
  readonly indent: number;
}

function ind(ctx: PrintCtx): string {
  return '  '.repeat(ctx.indent);
}

function nest(ctx: PrintCtx): PrintCtx {
  return { indent: ctx.indent + 1 };
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Print a JsModule to an ES2022 source string. */
/** Print a single JsNode expression to a string (for use in raw-code contexts). */
export function printJsExpr(node: JsNode): string {
  return printExpr(node, { indent: 0 });
}

export function printJsModule(mod: JsModule): string {
  const ctx: PrintCtx = { indent: 0 };
  const parts: string[] = [];
  for (const imp of mod.imports ?? []) {
    parts.push(`import { ${imp.symbols.join(', ')} } from '${imp.from}';`);
  }
  parts.push('"use strict";');

  const helpersStr = mod.helpers.map(h => printNode(h, ctx)).join('\n');
  if (helpersStr) parts.push(helpersStr);

  if (mod.dataDecls.length > 0) {
    parts.push(mod.dataDecls.map(d => printNode(d, ctx)).join('\n'));
  }

  if (mod.bodyDecls.length > 0) {
    parts.push(mod.bodyDecls.map(d => printNode(d, ctx)).join('\n'));
  }

  return parts.join('\n') + '\n';
}

/** Print a single node as a top-level statement (with semicolon if expression). */
function printNode(node: JsNode, ctx: PrintCtx): string {
  switch (node.kind) {
    case 'JsModule': return printJsModule(node);
    case 'JsConst': return printConst(node, ctx);
    case 'JsClass': return printClass(node, ctx);
    case 'JsMethod': return printMethod(node, ctx);
    case 'JsArrow': return printArrow(node, ctx);
    case 'JsCall': return printCall(node, ctx);
    case 'JsNew': return printNew(node, ctx);
    case 'JsIdent': return (node as JsIdent).name;
    case 'JsNumber': return String((node as JsNumber).value);
    case 'JsString': return `"${escapeString((node as JsString).value)}"`;
    case 'JsBool': return (node as JsBool).value ? 'true' : 'false';
    case 'JsNull': return 'null';
    case 'JsMember': return printMember(node, ctx);
    case 'JsSubscript': return printSubscript(node, ctx);
    case 'JsObject': return printObject(node, ctx);
    case 'JsObjectProp': {
      const p = node;
      if (p.shorthand) return p.key;
      return `${p.key}: ${printExpr(p.value, ctx)}`;
    }
    case 'JsArray': return printArray(node, ctx);
    case 'JsIife': return printIife(node, ctx);
    case 'JsIfElse': return printIfElse(node, ctx);
    case 'JsReturn': return `${ind(ctx)}return ${printExpr((node as JsReturn).value, ctx)};`;
    case 'JsSwitch': return printSwitch(node, ctx);
    case 'JsSwitchCase': return printSwitchCase(node, ctx);
    case 'JsThrow': return `${ind(ctx)}throw ${printExpr((node as JsThrow).value, ctx)};`;
    case 'JsTryCatch': return printTryCatch(node, ctx);
    case 'JsBlock': return printBlock(node, ctx);
    case 'JsAssign': return `${ind(ctx)}${printExpr((node as JsAssign).lhs, ctx)} = ${printExpr((node as JsAssign).rhs, ctx)};`;
    case 'JsLineComment': return `${ind(ctx)}// ${(node as JsLineComment).text}`;
    case 'JsTemplateLit': return printTemplateLit(node, ctx);
    case 'JsBinary': return printBinary(node, ctx);
    case 'JsInstanceof': return `${printExpr((node as JsInstanceof).expr, ctx)} instanceof ${(node as JsInstanceof).className}`;
    case 'JsRaw': return (node as JsRaw).code;
  }
}

/** Print a node as an expression (no leading indent, no trailing semicolon). */
function printExpr(node: JsNode, ctx: PrintCtx): string {
  switch (node.kind) {
    case 'JsConst': return printConst(node, ctx);
    case 'JsClass': return printClass(node, ctx);
    case 'JsArrow': return printArrow(node, ctx);
    case 'JsCall': return printCall(node, ctx);
    case 'JsNew': return printNew(node, ctx);
    case 'JsIdent': return (node as JsIdent).name;
    case 'JsNumber': return String((node as JsNumber).value);
    case 'JsString': return `"${escapeString((node as JsString).value)}"`;
    case 'JsBool': return (node as JsBool).value ? 'true' : 'false';
    case 'JsNull': return 'null';
    case 'JsMember': return printMember(node, ctx);
    case 'JsSubscript': return printSubscript(node, ctx);
    case 'JsObject': return printObject(node, ctx);
    case 'JsObjectProp': {
      const p = node;
      if (p.shorthand) return p.key;
      return `${p.key}: ${printExpr(p.value, ctx)}`;
    }
    case 'JsArray': return printArray(node, ctx);
    case 'JsIife': return printIife(node, ctx);
    case 'JsIfElse': return printIfElse(node, ctx);
    case 'JsReturn': return `return ${printExpr((node as JsReturn).value, ctx)};`;
    case 'JsSwitch': return printSwitch(node, ctx);
    case 'JsSwitchCase': return printSwitchCase(node, ctx);
    case 'JsThrow': return `throw ${printExpr((node as JsThrow).value, ctx)};`;
    case 'JsTryCatch': return printTryCatch(node, ctx);
    case 'JsBlock': return printBlock(node, ctx);
    case 'JsAssign': return `${printExpr((node as JsAssign).lhs, ctx)} = ${printExpr((node as JsAssign).rhs, ctx)}`;
    case 'JsLineComment': return `// ${(node as JsLineComment).text}`;
    case 'JsTemplateLit': return printTemplateLit(node, ctx);
    case 'JsBinary': return printBinary(node, ctx);
    case 'JsInstanceof': return `${printExpr((node as JsInstanceof).expr, ctx)} instanceof ${(node as JsInstanceof).className}`;
    case 'JsRaw': return (node as JsRaw).code;
    default: return printNode(node, ctx);
  }
}

function printConst(node: JsConst, ctx: PrintCtx): string {
  return `${ind(ctx)}const ${node.name} = ${printExpr(node.value, ctx)};`;
}

function printClass(node: JsClass, ctx: PrintCtx): string {
  const inner = nest(ctx);
  const extendsStr = node.superClass !== undefined ? ` extends ${node.superClass}` : '';
  const ctor = printMethod(node.ctor, inner);
  const methods = node.methods.map(m => printMethod(m, inner));
  const classBody = [ctor, ...methods].join('\n\n');
  return `${ind(ctx)}class ${node.name}${extendsStr} {\n${classBody}\n${ind(ctx)}}`;
}

function printMethod(node: JsMethod, ctx: PrintCtx): string {
  const inner = nest(ctx);
  const prefix = node.isStatic ? 'static ' : '';
  const params = node.params.join(', ');
  if (node.body.length === 0) {
    return `${ind(ctx)}${prefix}${node.name}(${params}) {}`;
  }
  const stmts = node.body.map(s => printStmt(s, inner)).join('\n');
  return `${ind(ctx)}${prefix}${node.name}(${params}) {\n${stmts}\n${ind(ctx)}}`;
}

function printStmt(node: JsNode, ctx: PrintCtx): string {
  switch (node.kind) {
    case 'JsConst': return printConst(node, ctx);
    case 'JsReturn': return `${ind(ctx)}return ${printExpr(node.value, ctx)};`;
    case 'JsThrow': return `${ind(ctx)}throw ${printExpr(node.value, ctx)};`;
    case 'JsAssign': return `${ind(ctx)}${printExpr(node.lhs, ctx)} = ${printExpr(node.rhs, ctx)};`;
    case 'JsLineComment': return `${ind(ctx)}// ${node.text}`;
    case 'JsIfElse': return printIfElse(node, ctx);
    case 'JsTryCatch': return printTryCatch(node, ctx);
    case 'JsSwitch': return printSwitch(node, ctx);
    case 'JsBlock': return printBlock(node, ctx);
    default: return `${ind(ctx)}${printExpr(node, ctx)};`;
  }
}

function printArrow(node: JsArrow, ctx: PrintCtx): string {
  const bodyStr = printExpr(node.body, ctx);
  // Object literal bodies must be wrapped in parens to avoid parsing as a block
  const body = node.body.kind === 'JsObject' ? `(${bodyStr})` : bodyStr;
  if (node.params.length === 0) return `() => ${body}`;
  if (node.params.length === 1) return `${node.params[0]} => ${body}`;
  return `(${node.params.join(', ')}) => ${body}`;
}

function printCall(node: JsCall, ctx: PrintCtx): string {
  const calleeStr = node.callee.kind === 'JsArrow'
    ? `(${printExpr(node.callee, ctx)})`
    : printExpr(node.callee, ctx);
  const args = node.args.map(a => printExpr(a, ctx)).join(', ');
  return `${calleeStr}(${args})`;
}

function printNew(node: JsNew, ctx: PrintCtx): string {
  const args = node.args.map(a => printExpr(a, ctx)).join(', ');
  return `new ${node.className}(${args})`;
}

function printMember(node: JsMember, ctx: PrintCtx): string {
  return `${printExpr(node.receiver, ctx)}.${node.member}`;
}

function printSubscript(node: JsSubscript, ctx: PrintCtx): string {
  return `${printExpr(node.receiver, ctx)}[${printExpr(node.index, ctx)}]`;
}

function printObject(node: JsObject, ctx: PrintCtx): string {
  if (node.props.length === 0) return '{}';
  const props = node.props.map(p => {
    if (p.shorthand) return p.key;
    return `${p.key}: ${printExpr(p.value, ctx)}`;
  }).join(', ');
  return `{ ${props} }`;
}

function printArray(node: JsArray, ctx: PrintCtx): string {
  const elems = node.elems.map(e => printExpr(e, ctx)).join(', ');
  return `[${elems}]`;
}

function printIife(node: JsIife, ctx: PrintCtx): string {
  const inner = nest(ctx);
  const stmts = node.body.map(s => printStmt(s, inner)).join('\n');
  return `(() => {\n${stmts}\n${ind(ctx)}})()`;
}

function printIfElse(node: JsIfElse, ctx: PrintCtx): string {
  const inner = nest(ctx);
  const parts: string[] = [];
  for (let i = 0; i < node.branches.length; i++) {
    const branch = node.branches[i];
    const stmts = branch.body.map(s => printStmt(s, inner)).join('\n');
    const kw = i === 0 ? `${ind(ctx)}if ` : ` else if `;
    parts.push(`${kw}(${printExpr(branch.cond, ctx)}) {\n${stmts}\n${ind(ctx)}}`);
  }
  if (node.elseBranch !== undefined) {
    const stmts = node.elseBranch.map(s => printStmt(s, inner)).join('\n');
    parts.push(` else {\n${stmts}\n${ind(ctx)}}`);
  }
  return parts.join('');
}

function printSwitch(node: JsSwitch, ctx: PrintCtx): string {
  const inner = nest(ctx);
  const cases = node.cases.map(c => printSwitchCase(c, inner)).join('\n');
  return `${ind(ctx)}switch (${printExpr(node.expr, ctx)}) {\n${cases}\n${ind(ctx)}}`;
}

function printSwitchCase(node: JsSwitchCase, ctx: PrintCtx): string {
  const inner = nest(ctx);
  const stmts = node.body.map(s => printStmt(s, inner)).join('\n');
  return `${ind(ctx)}case "${node.label}": {\n${stmts}\n${ind(ctx)}}`;
}

function printTryCatch(node: JsTryCatch, ctx: PrintCtx): string {
  const inner = nest(ctx);
  const tryStmts = node.tryBody.map(s => printStmt(s, inner)).join('\n');
  const catchStmts = node.catchBody.map(s => printStmt(s, inner)).join('\n');
  return `${ind(ctx)}try {\n${tryStmts}\n${ind(ctx)}} catch (${node.catchParam}) {\n${catchStmts}\n${ind(ctx)}}`;
}

function printBlock(node: JsBlock & { kind: 'JsBlock' }, ctx: PrintCtx): string {
  const inner = nest(ctx);
  const stmts = node.stmts.map(s => printStmt(s, inner)).join('\n');
  return `${ind(ctx)}{\n${stmts}\n${ind(ctx)}}`;
}

function printTemplateLit(node: JsTemplateLit, ctx: PrintCtx): string {
  const body = node.parts.map(p => {
    if (typeof p === 'string') return p.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    return `\${${printExpr(p, ctx)}}`;
  }).join('');
  return `\`${body}\``;
}

function printBinary(node: JsBinary, ctx: PrintCtx): string {
  return `${printExpr(node.left, ctx)} ${node.op} ${printExpr(node.right, ctx)}`;
}

// ---------------------------------------------------------------------------
// Source-map-aware printer (writer-based)
// ---------------------------------------------------------------------------

/** Mutable output buffer that tracks current line/col and collects SourceMappings. */
class WriterImpl {
  private _buf = '';
  line = 0;
  col = 0;
  readonly mappings: SourceMapping[] = [];

  write(text: string): void {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        this.line++;
        this.col = 0;
      } else {
        this.col++;
      }
    }
    this._buf += text;
  }

  /** Record a mapping at the current position if span is present. */
  recordSpan(span: Span | undefined, sourceFile: string): void {
    if (span === undefined) return;
    this.mappings.push({
      generatedLine: this.line,
      generatedCol: this.col,
      sourceFile,
      sourceLine: span.startLine - 1,
      sourceCol: span.startCol,
    });
  }

  toString(): string {
    return this._buf;
  }
}

interface TrackCtx {
  readonly indent: number;
  readonly sourceFile: string;
  readonly w: WriterImpl;
}

function tInd(ctx: TrackCtx): string {
  return '  '.repeat(ctx.indent);
}

function tNest(ctx: TrackCtx): TrackCtx {
  return { indent: ctx.indent + 1, sourceFile: ctx.sourceFile, w: ctx.w };
}

function wrtConst(node: JsConst, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  ctx.w.write(tInd(ctx));
  ctx.w.write('const ');
  ctx.w.write(node.name);
  ctx.w.write(' = ');
  wrtExpr(node.value, ctx);
  ctx.w.write(';');
}

function wrtClass(node: JsClass, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  const inner = tNest(ctx);
  ctx.w.write(tInd(ctx));
  ctx.w.write('class ');
  ctx.w.write(node.name);
  if (node.superClass !== undefined) {
    ctx.w.write(' extends ');
    ctx.w.write(node.superClass);
  }
  ctx.w.write(' {\n');
  wrtMethod(node.ctor, inner);
  for (const m of node.methods) {
    ctx.w.write('\n\n');
    wrtMethod(m, inner);
  }
  ctx.w.write('\n');
  ctx.w.write(tInd(ctx));
  ctx.w.write('}');
}

function wrtMethod(node: JsMethod, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  const inner = tNest(ctx);
  ctx.w.write(tInd(ctx));
  if (node.isStatic) ctx.w.write('static ');
  ctx.w.write(node.name);
  ctx.w.write('(');
  ctx.w.write(node.params.join(', '));
  ctx.w.write(')');
  if (node.body.length === 0) {
    ctx.w.write(' {}');
  } else {
    ctx.w.write(' {\n');
    for (let i = 0; i < node.body.length; i++) {
      if (i > 0) ctx.w.write('\n');
      wrtStmt(node.body[i], inner);
    }
    ctx.w.write('\n');
    ctx.w.write(tInd(ctx));
    ctx.w.write('}');
  }
}

function wrtArrow(node: JsArrow, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  if (node.params.length === 0) {
    ctx.w.write('() => ');
  } else if (node.params.length === 1) {
    ctx.w.write(node.params[0]);
    ctx.w.write(' => ');
  } else {
    ctx.w.write('(');
    ctx.w.write(node.params.join(', '));
    ctx.w.write(') => ');
  }
  if (node.body.kind === 'JsObject') {
    ctx.w.write('(');
    wrtExpr(node.body, ctx);
    ctx.w.write(')');
  } else {
    wrtExpr(node.body, ctx);
  }
}

function wrtCall(node: JsCall, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  if (node.callee.kind === 'JsArrow') {
    ctx.w.write('(');
    wrtExpr(node.callee, ctx);
    ctx.w.write(')');
  } else {
    wrtExpr(node.callee, ctx);
  }
  ctx.w.write('(');
  for (let i = 0; i < node.args.length; i++) {
    if (i > 0) ctx.w.write(', ');
    wrtExpr(node.args[i], ctx);
  }
  ctx.w.write(')');
}

function wrtNew(node: JsNew, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  ctx.w.write('new ');
  ctx.w.write(node.className);
  ctx.w.write('(');
  for (let i = 0; i < node.args.length; i++) {
    if (i > 0) ctx.w.write(', ');
    wrtExpr(node.args[i], ctx);
  }
  ctx.w.write(')');
}

function wrtMember(node: JsMember, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  wrtExpr(node.receiver, ctx);
  ctx.w.write('.');
  ctx.w.write(node.member);
}

function wrtSubscript(node: JsSubscript, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  wrtExpr(node.receiver, ctx);
  ctx.w.write('[');
  wrtExpr(node.index, ctx);
  ctx.w.write(']');
}

function wrtObject(node: JsObject, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  if (node.props.length === 0) {
    ctx.w.write('{}');
    return;
  }
  ctx.w.write('{ ');
  for (let i = 0; i < node.props.length; i++) {
    if (i > 0) ctx.w.write(', ');
    const p = node.props[i];
    if (p.shorthand) {
      ctx.w.write(p.key);
    } else {
      ctx.w.write(p.key);
      ctx.w.write(': ');
      wrtExpr(p.value, ctx);
    }
  }
  ctx.w.write(' }');
}

function wrtArray(node: JsArray, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  ctx.w.write('[');
  for (let i = 0; i < node.elems.length; i++) {
    if (i > 0) ctx.w.write(', ');
    wrtExpr(node.elems[i], ctx);
  }
  ctx.w.write(']');
}

function wrtIife(node: JsIife, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  const inner = tNest(ctx);
  ctx.w.write('(() => {\n');
  for (let i = 0; i < node.body.length; i++) {
    if (i > 0) ctx.w.write('\n');
    wrtStmt(node.body[i], inner);
  }
  ctx.w.write('\n');
  ctx.w.write(tInd(ctx));
  ctx.w.write('})()');
}

function wrtIfElse(node: JsIfElse, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  const inner = tNest(ctx);
  for (let i = 0; i < node.branches.length; i++) {
    const branch = node.branches[i];
    if (i === 0) {
      ctx.w.write(tInd(ctx));
      ctx.w.write('if (');
    } else {
      ctx.w.write(' else if (');
    }
    wrtExpr(branch.cond, ctx);
    ctx.w.write(') {\n');
    for (let j = 0; j < branch.body.length; j++) {
      if (j > 0) ctx.w.write('\n');
      wrtStmt(branch.body[j], inner);
    }
    ctx.w.write('\n');
    ctx.w.write(tInd(ctx));
    ctx.w.write('}');
  }
  if (node.elseBranch !== undefined) {
    ctx.w.write(' else {\n');
    for (let j = 0; j < node.elseBranch.length; j++) {
      if (j > 0) ctx.w.write('\n');
      wrtStmt(node.elseBranch[j], inner);
    }
    ctx.w.write('\n');
    ctx.w.write(tInd(ctx));
    ctx.w.write('}');
  }
}

function wrtSwitch(node: JsSwitch, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  const inner = tNest(ctx);
  ctx.w.write(tInd(ctx));
  ctx.w.write('switch (');
  wrtExpr(node.expr, ctx);
  ctx.w.write(') {\n');
  for (let i = 0; i < node.cases.length; i++) {
    if (i > 0) ctx.w.write('\n');
    wrtSwitchCase(node.cases[i], inner);
  }
  ctx.w.write('\n');
  ctx.w.write(tInd(ctx));
  ctx.w.write('}');
}

function wrtSwitchCase(node: JsSwitchCase, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  const inner = tNest(ctx);
  ctx.w.write(tInd(ctx));
  ctx.w.write('case "');
  ctx.w.write(node.label);
  ctx.w.write('": {\n');
  for (let i = 0; i < node.body.length; i++) {
    if (i > 0) ctx.w.write('\n');
    wrtStmt(node.body[i], inner);
  }
  ctx.w.write('\n');
  ctx.w.write(tInd(ctx));
  ctx.w.write('}');
}

function wrtTryCatch(node: JsTryCatch, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  const inner = tNest(ctx);
  ctx.w.write(tInd(ctx));
  ctx.w.write('try {\n');
  for (let i = 0; i < node.tryBody.length; i++) {
    if (i > 0) ctx.w.write('\n');
    wrtStmt(node.tryBody[i], inner);
  }
  ctx.w.write('\n');
  ctx.w.write(tInd(ctx));
  ctx.w.write('} catch (');
  ctx.w.write(node.catchParam);
  ctx.w.write(') {\n');
  for (let i = 0; i < node.catchBody.length; i++) {
    if (i > 0) ctx.w.write('\n');
    wrtStmt(node.catchBody[i], inner);
  }
  ctx.w.write('\n');
  ctx.w.write(tInd(ctx));
  ctx.w.write('}');
}

function wrtBlock(node: JsBlock, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  const inner = tNest(ctx);
  ctx.w.write(tInd(ctx));
  ctx.w.write('{\n');
  for (let i = 0; i < node.stmts.length; i++) {
    if (i > 0) ctx.w.write('\n');
    wrtStmt(node.stmts[i], inner);
  }
  ctx.w.write('\n');
  ctx.w.write(tInd(ctx));
  ctx.w.write('}');
}

function wrtTemplateLit(node: JsTemplateLit, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  ctx.w.write('`');
  for (const part of node.parts) {
    if (typeof part === 'string') {
      ctx.w.write(part.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'));
    } else {
      ctx.w.write('${');
      wrtExpr(part, ctx);
      ctx.w.write('}');
    }
  }
  ctx.w.write('`');
}

function wrtBinary(node: JsBinary, ctx: TrackCtx): void {
  ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
  wrtExpr(node.left, ctx);
  ctx.w.write(' ');
  ctx.w.write(node.op);
  ctx.w.write(' ');
  wrtExpr(node.right, ctx);
}

/** Write a JsNode as a statement (with leading indent for statement forms). */
function wrtStmt(node: JsNode, ctx: TrackCtx): void {
  switch (node.kind) {
    case 'JsConst': wrtConst(node, ctx); break;
    case 'JsReturn': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(tInd(ctx));
      ctx.w.write('return ');
      wrtExpr(node.value, ctx);
      ctx.w.write(';');
      break;
    }
    case 'JsThrow': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(tInd(ctx));
      ctx.w.write('throw ');
      wrtExpr(node.value, ctx);
      ctx.w.write(';');
      break;
    }
    case 'JsAssign': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(tInd(ctx));
      wrtExpr(node.lhs, ctx);
      ctx.w.write(' = ');
      wrtExpr(node.rhs, ctx);
      ctx.w.write(';');
      break;
    }
    case 'JsLineComment': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(tInd(ctx));
      ctx.w.write('// ');
      ctx.w.write(node.text);
      break;
    }
    case 'JsIfElse': wrtIfElse(node, ctx); break;
    case 'JsTryCatch': wrtTryCatch(node, ctx); break;
    case 'JsSwitch': wrtSwitch(node, ctx); break;
    case 'JsBlock': wrtBlock(node, ctx); break;
    default: {
      ctx.w.write(tInd(ctx));
      wrtExpr(node, ctx);
      ctx.w.write(';');
    }
  }
}

/** Write a JsNode as a pure expression (no leading indent). */
function wrtExpr(node: JsNode, ctx: TrackCtx): void {
  switch (node.kind) {
    case 'JsConst': wrtConst(node, ctx); break;
    case 'JsClass': wrtClass(node, ctx); break;
    case 'JsArrow': wrtArrow(node, ctx); break;
    case 'JsCall': wrtCall(node, ctx); break;
    case 'JsNew': wrtNew(node, ctx); break;
    case 'JsIdent': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(node.name);
      break;
    }
    case 'JsNumber': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(String(node.value));
      break;
    }
    case 'JsString': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write('"');
      ctx.w.write(escapeString(node.value));
      ctx.w.write('"');
      break;
    }
    case 'JsBool': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(node.value ? 'true' : 'false');
      break;
    }
    case 'JsNull': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write('null');
      break;
    }
    case 'JsMember': wrtMember(node, ctx); break;
    case 'JsSubscript': wrtSubscript(node, ctx); break;
    case 'JsObject': wrtObject(node, ctx); break;
    case 'JsObjectProp': {
      if (node.shorthand) {
        ctx.w.write(node.key);
      } else {
        ctx.w.write(node.key);
        ctx.w.write(': ');
        wrtExpr(node.value, ctx);
      }
      break;
    }
    case 'JsArray': wrtArray(node, ctx); break;
    case 'JsIife': wrtIife(node, ctx); break;
    case 'JsIfElse': wrtIfElse(node, ctx); break;
    case 'JsReturn': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write('return ');
      wrtExpr(node.value, ctx);
      ctx.w.write(';');
      break;
    }
    case 'JsSwitch': wrtSwitch(node, ctx); break;
    case 'JsSwitchCase': wrtSwitchCase(node, ctx); break;
    case 'JsThrow': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write('throw ');
      wrtExpr(node.value, ctx);
      ctx.w.write(';');
      break;
    }
    case 'JsTryCatch': wrtTryCatch(node, ctx); break;
    case 'JsBlock': wrtBlock(node, ctx); break;
    case 'JsAssign': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      wrtExpr(node.lhs, ctx);
      ctx.w.write(' = ');
      wrtExpr(node.rhs, ctx);
      break;
    }
    case 'JsLineComment': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write('// ');
      ctx.w.write(node.text);
      break;
    }
    case 'JsTemplateLit': wrtTemplateLit(node, ctx); break;
    case 'JsBinary': wrtBinary(node, ctx); break;
    case 'JsInstanceof': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      wrtExpr(node.expr, ctx);
      ctx.w.write(' instanceof ');
      ctx.w.write(node.className);
      break;
    }
    case 'JsRaw': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(node.code);
      break;
    }
    default: wrtNode(node, ctx); break;
  }
}

/** Write a JsNode as a top-level declaration. */
function wrtNode(node: JsNode, ctx: TrackCtx): void {
  switch (node.kind) {
    case 'JsConst': wrtConst(node, ctx); break;
    case 'JsClass': wrtClass(node, ctx); break;
    case 'JsMethod': wrtMethod(node, ctx); break;
    case 'JsArrow': wrtArrow(node, ctx); break;
    case 'JsCall': wrtCall(node, ctx); break;
    case 'JsNew': wrtNew(node, ctx); break;
    case 'JsIdent': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(node.name);
      break;
    }
    case 'JsNumber': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(String(node.value));
      break;
    }
    case 'JsString': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write('"');
      ctx.w.write(escapeString(node.value));
      ctx.w.write('"');
      break;
    }
    case 'JsBool': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(node.value ? 'true' : 'false');
      break;
    }
    case 'JsNull': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write('null');
      break;
    }
    case 'JsMember': wrtMember(node, ctx); break;
    case 'JsSubscript': wrtSubscript(node, ctx); break;
    case 'JsObject': wrtObject(node, ctx); break;
    case 'JsObjectProp': {
      if (node.shorthand) {
        ctx.w.write(node.key);
      } else {
        ctx.w.write(node.key);
        ctx.w.write(': ');
        wrtExpr(node.value, ctx);
      }
      break;
    }
    case 'JsArray': wrtArray(node, ctx); break;
    case 'JsIife': wrtIife(node, ctx); break;
    case 'JsIfElse': wrtIfElse(node, ctx); break;
    case 'JsReturn': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(tInd(ctx));
      ctx.w.write('return ');
      wrtExpr(node.value, ctx);
      ctx.w.write(';');
      break;
    }
    case 'JsSwitch': wrtSwitch(node, ctx); break;
    case 'JsSwitchCase': wrtSwitchCase(node, ctx); break;
    case 'JsThrow': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(tInd(ctx));
      ctx.w.write('throw ');
      wrtExpr(node.value, ctx);
      ctx.w.write(';');
      break;
    }
    case 'JsTryCatch': wrtTryCatch(node, ctx); break;
    case 'JsBlock': wrtBlock(node, ctx); break;
    case 'JsAssign': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(tInd(ctx));
      wrtExpr(node.lhs, ctx);
      ctx.w.write(' = ');
      wrtExpr(node.rhs, ctx);
      ctx.w.write(';');
      break;
    }
    case 'JsLineComment': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(tInd(ctx));
      ctx.w.write('// ');
      ctx.w.write(node.text);
      break;
    }
    case 'JsTemplateLit': wrtTemplateLit(node, ctx); break;
    case 'JsBinary': wrtBinary(node, ctx); break;
    case 'JsInstanceof': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      wrtExpr(node.expr, ctx);
      ctx.w.write(' instanceof ');
      ctx.w.write(node.className);
      break;
    }
    case 'JsRaw': {
      ctx.w.recordSpan(node.ionSpan, ctx.sourceFile);
      ctx.w.write(node.code);
      break;
    }
    case 'JsModule': {
      // Nested module — write recursively (rare in practice).
      ctx.w.write('"use strict";\n');
      for (const n of [...node.helpers, ...node.dataDecls, ...node.bodyDecls]) {
        wrtNode(n, ctx);
        ctx.w.write('\n');
      }
      break;
    }
  }
}

/**
 * Print a JsModule to source string while collecting SourceMappings for each
 * node whose ionSpan is set.
 *
 * The returned `source` is identical to `printJsModule(mod)`.
 */
export function printJsModuleWithMappings(
  mod: JsModule,
  ionSourceFile: string,
): { source: string; mappings: SourceMapping[] } {
  const w = new WriterImpl();
  const ctx: TrackCtx = { indent: 0, sourceFile: ionSourceFile, w };

  for (const imp of mod.imports ?? []) {
    w.write(`import { ${imp.symbols.join(', ')} } from '${imp.from}';\n`);
  }
  w.write('"use strict";');

  if (mod.helpers.length > 0) {
    w.write('\n');
    for (let i = 0; i < mod.helpers.length; i++) {
      if (i > 0) w.write('\n');
      wrtNode(mod.helpers[i], ctx);
    }
  }

  if (mod.dataDecls.length > 0) {
    w.write('\n');
    for (let i = 0; i < mod.dataDecls.length; i++) {
      if (i > 0) w.write('\n');
      wrtNode(mod.dataDecls[i], ctx);
    }
  }

  if (mod.bodyDecls.length > 0) {
    w.write('\n');
    for (let i = 0; i < mod.bodyDecls.length; i++) {
      if (i > 0) w.write('\n');
      wrtNode(mod.bodyDecls[i], ctx);
    }
  }

  w.write('\n');

  return { source: w.toString(), mappings: w.mappings };
}
