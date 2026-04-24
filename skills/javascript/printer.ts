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
  JsAssign,
  JsLineComment,
  JsTemplateLit,
  JsBinary,
  JsInstanceof,
  JsRaw,
} from './js-ast.js';

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
  const parts: string[] = ['"use strict";'];

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
