import type {
  IonIRNode,
  IonIRModule,
  VarNode,
  LiteralNode,
  AppNode,
  AbsNode,
  LetNode,
  CaseNode,
  CaseArm,
  CasePattern,
  ConstructorNode,
  AccessorNode,
  ForeignRefNode,
  ModuleRefNode,
  EffectNode,
  AsyncBlockNode,
  AwaitNode,
  ForeignSignature,
} from '../../src/ir/nodes.js';
import type { SymbolId } from '../../src/types.js';
import { expandTemplate, wrapEmitted } from '../../src/emit/template.js';
import {
  jsIdent,
  jsNumLit,
  jsStrLit,
  jsBoolLit,
  jsNullLit,
  jsCall,
  jsMember,
  jsConst,
  jsArrow,
  jsRaw,
  jsIIFE,
  type JsProgram,
  type JsStatement,
  type JsExpression,
  type JsVariableDeclaration,
  type JsIdentifier,
  type JsLiteral,
  type JsCallExpression,
  type JsArrowFunctionExpression,
  type JsMemberExpression,
  type JsObjectExpression,
  type JsConditionalExpression,
  type JsAwaitExpression,
  type JsRawExpression,
  type JsBlockStatement,
  type JsIfStatement,
  type JsReturnStatement,
} from './js-ast.js';

export interface JsEmitOptions {
  /** Mangle symbol IDs into names to avoid collisions. Default: true. */
  mangleSymbols?: boolean;
}

/** Emit an IonIRModule as a JS Program (ES2022 module). */
export function emitModule(module: IonIRModule, opts?: JsEmitOptions): JsProgram {
  const emitter = new JsEmitter(opts ?? {});
  const body = emitter.emitDecls(module.decls);
  return { type: 'Program', sourceType: 'module', body };
}

// ---------------------------------------------------------------------------
// Internal emitter class
// ---------------------------------------------------------------------------

class JsEmitter {
  private readonly mangle: boolean;
  /** ForeignRef templates keyed by symbolId for inline expansion at call sites. */
  private readonly foreignMap: Map<SymbolId, ForeignSignature> = new Map();

  constructor(opts: JsEmitOptions) {
    this.mangle = opts.mangleSymbols !== false;
  }

  // -------------------------------------------------------------------------
  // Top-level declaration list
  // -------------------------------------------------------------------------

  /**
   * Unroll a chain of top-level LetNodes into flat `const` declarations.
   * Each Let's body is the next declaration in the chain.
   */
  emitDecls(decls: readonly IonIRNode[]): JsStatement[] {
    const stmts: JsStatement[] = [];
    for (const node of decls) {
      this.unrollTopLevelLet(node, stmts);
    }
    return stmts;
  }

  private unrollTopLevelLet(node: IonIRNode, out: JsStatement[]): void {
    if (node.kind !== 'Let') {
      // Non-let top-level expression (rare); wrap as expression statement
      out.push({ type: 'ExpressionStatement', expression: this.emitNode(node) });
      return;
    }

    const letNode = node as LetNode;
    const boundName = this.mangledName(letNode.name, letNode.symbolId);

    if (letNode.value.kind === 'ForeignRef') {
      // Record the foreign signature for use at call sites; emit no JS
      const foreign = letNode.value as ForeignRefNode;
      this.foreignMap.set(letNode.symbolId, foreign.sig);
    } else {
      const init = this.emitNode(letNode.value);
      out.push(jsConst(boundName, init));
    }

    // Recurse into body (the rest of the module)
    this.unrollTopLevelLet(letNode.body, out);
  }

  // -------------------------------------------------------------------------
  // Expression dispatch
  // -------------------------------------------------------------------------

  emitNode(node: IonIRNode): JsExpression {
    switch (node.kind) {
      case 'Var':         return this.emitVar(node);
      case 'Literal':     return this.emitLiteral(node);
      case 'App':         return this.emitApp(node);
      case 'Abs':         return this.emitAbs(node);
      case 'Let':         return this.emitLetExpr(node);
      case 'Case':        return this.emitCase(node);
      case 'Constructor': return this.emitConstructor(node);
      case 'Accessor':    return this.emitAccessor(node);
      case 'ForeignRef':  return this.emitForeignRef(node);
      case 'ModuleRef':   return this.emitModuleRef(node);
      case 'Effect':      return this.emitEffect(node);
      case 'AsyncBlock':  return this.emitAsyncBlock(node);
      case 'Await':       return this.emitAwait(node);

      // OOP dialect — out of scope for Core emitter
      case 'OopClass':
      case 'OopInterface':
      case 'OopNew':
      case 'OopVirtualCall':
      case 'OopThis':
        throw new Error(`dialect not supported: OOP (kind: ${node.kind})`);

      // ADT dialect — out of scope for Core emitter
      case 'AdtDecl':
      case 'AdtMatch':
        throw new Error(`dialect not supported: ADT (kind: ${node.kind})`);

      // Effects dialect — out of scope for Core emitter
      case 'EffectDecl':
      case 'Perform':
      case 'Handle':
      case 'Resume':
        throw new Error(`dialect not supported: Effects (kind: ${node.kind})`);
    }
  }

  // -------------------------------------------------------------------------
  // Core node emitters
  // -------------------------------------------------------------------------

  emitVar(node: VarNode): JsIdentifier {
    return jsIdent(this.mangledName(node.name, node.symbolId));
  }

  emitLiteral(node: LiteralNode): JsLiteral {
    const v = node.value;
    switch (v.kind) {
      case 'Int':   return jsNumLit(v.value);
      case 'Float': return jsNumLit(v.value);
      case 'Str':   return jsStrLit(v.value);
      case 'Bool':  return jsBoolLit(v.value);
      case 'Null':  return jsNullLit();
    }
  }

  emitApp(node: AppNode): JsCallExpression | JsRawExpression {
    // If callee is a Var bound to a ForeignRef, expand the template inline
    if (node.callee.kind === 'Var') {
      const callee = node.callee as VarNode;
      const sig = this.foreignMap.get(callee.symbolId);
      if (sig !== undefined) {
        const emittedArgs = node.args.map(a => wrapEmitted(this.renderExpr(this.emitNode(a))));
        return jsRaw(expandTemplate(sig.template, emittedArgs));
      }
    }
    return jsCall(this.emitNode(node.callee), node.args.map(a => this.emitNode(a)));
  }

  emitAbs(node: AbsNode): JsArrowFunctionExpression {
    const params = node.params.map(p => jsIdent(this.mangledName(p.name, p.symbolId)));
    return jsArrow(params, this.emitNode(node.body));
  }

  /** Emit a LetNode that appears in expression context (IIFE). */
  emitLetExpr(node: LetNode): JsCallExpression {
    const param = jsIdent(this.mangledName(node.name, node.symbolId));
    const value = this.emitNode(node.value);
    const body = this.emitNode(node.body);
    return jsIIFE([param], body, [value]);
  }

  emitCase(node: CaseNode): JsConditionalExpression | JsCallExpression {
    const scrutinee = this.emitNode(node.scrutinee);

    // Two arms, no guards, wildcard/var patterns → ternary chain
    if (this.isTernaryEligible(node.arms)) {
      return this.buildTernaryChain(scrutinee, node.arms);
    }

    // Otherwise: IIFE with if-else chain
    return this.buildCaseIIFE(scrutinee, node.arms);
  }

  emitAccessor(node: AccessorNode): JsMemberExpression {
    return jsMember(this.emitNode(node.receiver), node.member);
  }

  emitForeignRef(node: ForeignRefNode): JsIdentifier {
    // Standalone ForeignRef — record template; return placeholder
    // This should only occur as the value in a Let binding (caught by unrollTopLevelLet).
    // Emit `undefined` so it is a valid expression in nested contexts.
    this.foreignMap.set(
      // Use a synthetic symbolId based on module+symbol to allow lookup later
      `${node.module}:${node.symbol}:0` as SymbolId,
      node.sig,
    );
    return jsIdent('undefined');
  }

  emitConstructor(node: ConstructorNode): JsObjectExpression {
    const tagProp = {
      type: 'Property' as const,
      key: jsIdent('_tag'),
      value: jsStrLit(node.ctorName),
    };
    const fieldProps = node.args.map((arg, i) => ({
      type: 'Property' as const,
      key: jsIdent(`field${i}`),
      value: this.emitNode(arg),
    }));
    return { type: 'ObjectExpression', properties: [tagProp, ...fieldProps] };
  }

  emitModuleRef(node: ModuleRefNode): JsMemberExpression | JsIdentifier {
    if (node.modulePath.length === 0) return jsIdent('undefined');
    if (node.modulePath.length === 1) return jsIdent(node.modulePath[0]);
    // Build left-associative member chain: a.b.c
    let expr: JsExpression = jsIdent(node.modulePath[0]);
    for (let i = 1; i < node.modulePath.length; i++) {
      expr = jsMember(expr, node.modulePath[i]);
    }
    return expr as JsMemberExpression;
  }

  emitEffect(node: EffectNode): JsExpression {
    // Effects are erased in the JS target; emit body directly
    return this.emitNode(node.body);
  }

  emitAsyncBlock(node: AsyncBlockNode): JsCallExpression {
    const arrow = jsArrow([], this.emitNode(node.body), true);
    return jsCall(arrow, []);
  }

  emitAwait(node: AwaitNode): JsAwaitExpression {
    return { type: 'AwaitExpression', argument: this.emitNode(node.expr) };
  }

  // -------------------------------------------------------------------------
  // Case helpers
  // -------------------------------------------------------------------------

  private isTernaryEligible(arms: readonly CaseArm[]): boolean {
    if (arms.length < 2) return false;
    for (const arm of arms) {
      if (arm.guard !== undefined) return false;
      if (arm.pattern.kind === 'Constructor') return false;
    }
    return true;
  }

  private buildTernaryChain(
    scrutinee: JsExpression,
    arms: readonly CaseArm[],
  ): JsConditionalExpression {
    // Build right-to-left ternary: cond1 ? body1 : (cond2 ? body2 : bodyN)
    const reversed = [...arms].reverse();

    // The last arm is the default (wildcard/var binds scrutinee)
    let result: JsExpression = this.emitNode(reversed[0].body);

    for (let i = 1; i < reversed.length; i++) {
      const arm = reversed[i];
      const test = this.patternTest(scrutinee, arm.pattern);
      const consequent = this.emitPatternBody(scrutinee, arm);
      result = {
        type: 'ConditionalExpression',
        test,
        consequent,
        alternate: result,
      };
    }

    // Guaranteed non-null: arms.length >= 2 so we built at least one ternary
    return result as JsConditionalExpression;
  }

  private buildCaseIIFE(scrutinee: JsExpression, arms: readonly CaseArm[]): JsCallExpression {
    const scrutParam = jsIdent('_s');
    const stmts: JsStatement[] = [];

    for (const arm of arms) {
      const test = this.patternTest(scrutParam, arm.pattern);
      const guardTest = arm.guard !== undefined ? this.emitNode(arm.guard) : null;

      // Bind pattern variables for use in body
      const bodyStmts: JsStatement[] = [
        ...this.patternBindings(scrutParam, arm.pattern),
        { type: 'ReturnStatement', argument: this.emitNode(arm.body) } satisfies JsReturnStatement,
      ];
      const block: JsBlockStatement = { type: 'BlockStatement', body: bodyStmts };

      // Combine pattern test and optional guard
      const fullTest = guardTest !== null
        ? jsCall(jsIdent('Boolean'), [
            { type: 'SequenceExpression', expressions: [test, guardTest] },
          ])
        : test;

      if (arm.pattern.kind === 'Wildcard' || arm.pattern.kind === 'Var') {
        // Wildcard/var always match — just emit the body directly (no if wrapper)
        stmts.push(...bodyStmts.slice(0, -1));
        stmts.push(bodyStmts[bodyStmts.length - 1]);
      } else {
        stmts.push({
          type: 'IfStatement',
          test: guardTest !== null ? this.andExpr(test, guardTest) : test,
          consequent: block,
          alternate: null,
        } satisfies JsIfStatement);
      }
    }

    // Non-exhaustive fallback
    const throwStmt: JsStatement = {
      type: 'ExpressionStatement',
      expression: jsCall(
        { type: 'MemberExpression', object: jsIdent('Error'), property: jsIdent('prototype'), computed: false },
        [],
      ),
    };
    // Replace throwStmt with a real throw — use RawExpression for the throw statement
    const throwRaw: JsStatement = {
      type: 'ExpressionStatement',
      expression: jsRaw(`(() => { throw new Error('non-exhaustive match') })()`),
    };
    stmts.push(throwRaw);

    const body: JsBlockStatement = { type: 'BlockStatement', body: stmts };
    return jsIIFE([scrutParam], body, [scrutinee]);
  }

  private andExpr(left: JsExpression, right: JsExpression): JsRawExpression {
    return jsRaw(`(${this.renderExpr(left)} && ${this.renderExpr(right)})`);
  }

  /** Build a boolean test expression for a pattern against a scrutinee. */
  private patternTest(scrutinee: JsExpression, pattern: CasePattern): JsExpression {
    switch (pattern.kind) {
      case 'Wildcard':
      case 'Var':
        // Always match
        return jsBoolLit(true);

      case 'Literal': {
        const lv = pattern.value;
        const rhs: JsExpression = (() => {
          switch (lv.kind) {
            case 'Int':
            case 'Float': return jsNumLit(lv.value);
            case 'Str':   return jsStrLit(lv.value);
            case 'Bool':  return jsBoolLit(lv.value);
            case 'Null':  return jsNullLit();
          }
        })();
        return jsRaw(`${this.renderExpr(scrutinee)} === ${this.renderExpr(rhs)}`);
      }

      case 'Constructor':
        return jsRaw(
          `${this.renderExpr(scrutinee)}._tag === ${JSON.stringify(pattern.ctorName)}`,
        );
    }
  }

  /** Build binding statements for pattern variables. */
  private patternBindings(scrutinee: JsExpression, pattern: CasePattern): JsStatement[] {
    switch (pattern.kind) {
      case 'Wildcard':
        return [];

      case 'Var': {
        const name = this.mangledName(pattern.name, pattern.symbolId);
        return [jsConst(name, scrutinee)];
      }

      case 'Constructor': {
        return pattern.fields.flatMap((field, i) => {
          if (field.kind === 'Wildcard') return [] as JsStatement[];
          if (field.kind === 'Var') {
            const name = this.mangledName(field.name, field.symbolId);
            return [jsConst(name, jsMember(scrutinee, `field${i}`))];
          }
          return [] as JsStatement[];
        });
      }

      case 'Literal':
        return [];
    }
  }

  private emitPatternBody(scrutinee: JsExpression, arm: CaseArm): JsExpression {
    // For var patterns, wrap in IIFE to bind the scrutinee to the var name
    if (arm.pattern.kind === 'Var') {
      const name = this.mangledName(arm.pattern.name, arm.pattern.symbolId);
      return jsIIFE([jsIdent(name)], this.emitNode(arm.body), [scrutinee]);
    }
    return this.emitNode(arm.body);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private mangledName(name: string, symbolId: SymbolId): string {
    if (!this.mangle) return name;
    const safe = symbolId.replace(/[^a-zA-Z0-9]/g, '_');
    return `${name}_${safe}`;
  }

  /**
   * Render a JsExpression to a raw JS string for use in RawExpression contexts
   * (pattern tests, template expansion args).
   * This is a minimal inline serializer — the real pretty-printer is ION-23.
   */
  private renderExpr(expr: JsExpression): string {
    switch (expr.type) {
      case 'Identifier':   return expr.name;
      case 'Literal':      return expr.raw ?? JSON.stringify(expr.value);
      case 'RawExpression': return expr.raw;

      case 'MemberExpression':
        return `${this.renderExpr(expr.object)}.${expr.property.name}`;

      case 'CallExpression': {
        const callee = this.renderExpr(expr.callee);
        const args = expr.arguments.map(a => this.renderExpr(a)).join(', ');
        return `${callee}(${args})`;
      }

      case 'ArrowFunctionExpression': {
        const params = expr.params.map(p => p.name).join(', ');
        const prefix = expr.async ? 'async ' : '';
        if (expr.body.type === 'BlockStatement') {
          const body = this.renderBlock(expr.body);
          return `${prefix}(${params}) => ${body}`;
        }
        return `${prefix}(${params}) => ${this.renderExpr(expr.body)}`;
      }

      case 'ObjectExpression': {
        const props = expr.properties
          .map(p => `${p.key.name}: ${this.renderExpr(p.value)}`)
          .join(', ');
        return `{ ${props} }`;
      }

      case 'ArrayExpression':
        return `[${expr.elements.map(e => this.renderExpr(e)).join(', ')}]`;

      case 'ConditionalExpression':
        return `(${this.renderExpr(expr.test)} ? ${this.renderExpr(expr.consequent)} : ${this.renderExpr(expr.alternate)})`;

      case 'SequenceExpression':
        return `(${expr.expressions.map(e => this.renderExpr(e)).join(', ')})`;

      case 'AwaitExpression':
        return `await ${this.renderExpr(expr.argument)}`;

      case 'TemplateLiteral': {
        let s = '`';
        for (let i = 0; i < expr.quasis.length; i++) {
          s += expr.quasis[i].value;
          if (!expr.quasis[i].tail) {
            s += `\${${this.renderExpr(expr.expressions[i])}}`;
          }
        }
        s += '`';
        return s;
      }
    }
  }

  private renderBlock(block: JsBlockStatement): string {
    const stmts = block.body.map(s => this.renderStmt(s)).join(' ');
    return `{ ${stmts} }`;
  }

  private renderStmt(stmt: JsStatement): string {
    switch (stmt.type) {
      case 'ExpressionStatement':
        return `${this.renderExpr(stmt.expression)};`;
      case 'ReturnStatement':
        return stmt.argument ? `return ${this.renderExpr(stmt.argument)};` : 'return;';
      case 'VariableDeclaration': {
        const d = stmt.declarations[0];
        return `${stmt.kind} ${d.id.name} = ${this.renderExpr(d.init)};`;
      }
      case 'IfStatement': {
        const cons = stmt.consequent.type === 'BlockStatement'
          ? this.renderBlock(stmt.consequent)
          : this.renderStmt(stmt.consequent);
        if (stmt.alternate !== null) {
          const alt = stmt.alternate.type === 'BlockStatement'
            ? this.renderBlock(stmt.alternate)
            : this.renderStmt(stmt.alternate);
          return `if (${this.renderExpr(stmt.test)}) ${cons} else ${alt}`;
        }
        return `if (${this.renderExpr(stmt.test)}) ${cons}`;
      }
      case 'BlockStatement':
        return this.renderBlock(stmt);
      case 'FunctionDeclaration': {
        const params = stmt.params.map(p => p.name).join(', ');
        return `function ${stmt.id.name}(${params}) ${this.renderBlock(stmt.body)}`;
      }
      case 'ExportNamedDeclaration':
        return `export ${this.renderStmt(stmt.declaration)}`;
    }
  }
}
