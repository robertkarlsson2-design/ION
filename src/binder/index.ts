import type {
  AstModule,
  AstDeclNode,
  AstExprNode,
  AstPatternNode,
  AstMatchArm,
  AstFnDeclNode,
} from '../ast/nodes.js';
import type { TypeAnnotation } from '../ast/types.js';
import type { Span, SymbolId } from '../types.js';
import { makeSymbolId } from '../types.js';

import { Scope } from './scope.js';
import { SymbolTable } from './symbol-table.js';
import type { DeclKind, SymbolEntry } from './symbol-table.js';
import type { BindError } from './errors.js';
import { buildModuleGraph, detectCircularImports } from './module-graph.js';
import type { ModuleGraph } from './module-graph.js';

export type { BindError, BindErrorKind } from './errors.js';
export type { SymbolTable, SymbolEntry, DeclKind } from './symbol-table.js';
export type { ModuleGraph } from './module-graph.js';
export { detectCircularImports } from './module-graph.js';

/** Maps spanKey(span) → SymbolId for every resolved name reference. */
export type ResolutionMap = Map<string, SymbolId>;

export interface BindResult {
  readonly symbolTable: SymbolTable;
  readonly resolutionMap: ResolutionMap;
  readonly moduleGraph: ModuleGraph;
  readonly errors: BindError[];
}

// \0 is guaranteed absent from all OS file paths, making this key unambiguous.
function spanKey(span: Span): string {
  return `${span.file}\0${span.startLine}\0${span.startCol}`;
}

class Binder {
  private readonly symbolTable: SymbolTable = new SymbolTable();
  private readonly resolutionMap: ResolutionMap = new Map();
  private readonly errors: BindError[] = [];
  private counter: number = 0;
  private readonly moduleGraph: ModuleGraph = new Map();
  /** Maps "from→to" edge key to the UseDecl span for cycle reporting. */
  private readonly edgeSpans: Map<string, Span> = new Map();

  private freshId(modulePath: string, name: string): SymbolId {
    return makeSymbolId(`${modulePath}$${name}$${this.counter++}`);
  }

  private registerDecl(
    scope: Scope,
    name: string,
    declKind: DeclKind,
    span: Span,
    typeAnnotation: TypeAnnotation | null,
    isPublic: boolean,
    modulePath: string,
  ): SymbolId {
    if (scope.hasOwn(name)) {
      this.errors.push({
        kind: 'DuplicateBinding',
        message: `Duplicate binding '${name}'`,
        span,
      });
      // Return the existing id rather than creating a new one.
      // Non-null: hasOwn() guarantees lookup succeeds at this scope level.
      return scope.lookup(name) as SymbolId;
    }
    const id = this.freshId(modulePath, name);
    scope.define(name, id);
    const entry: SymbolEntry = { id, name, declKind, span, typeAnnotation, isPublic };
    this.symbolTable.register(entry);
    return id;
  }

  // ---------------------------------------------------------------------------
  // Top-level entry
  // ---------------------------------------------------------------------------

  bind(module: AstModule, modulePath: string): BindResult {
    const moduleScope = new Scope(null);
    this.bindDeclList(module.decls, moduleScope, modulePath);

    // Merge the local module graph into the accumulated graph.
    const localGraph = buildModuleGraph(modulePath, module.decls);
    for (const [k, v] of localGraph) {
      const existing = this.moduleGraph.get(k);
      if (existing === undefined) {
        this.moduleGraph.set(k, new Set(v));
      } else {
        for (const dep of v) existing.add(dep);
      }
    }

    const circularErrors = detectCircularImports(this.moduleGraph, this.edgeSpans);
    this.errors.push(...circularErrors);

    return {
      symbolTable: this.symbolTable,
      resolutionMap: this.resolutionMap,
      moduleGraph: this.moduleGraph,
      errors: this.errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Two-pass declaration list binding (supports mutual recursion)
  // ---------------------------------------------------------------------------

  private bindDeclList(
    decls: readonly AstDeclNode[],
    scope: Scope,
    modulePath: string,
  ): void {
    // Pass 1: declare all names (including use-imports) into scope.
    for (const decl of decls) {
      this.declareTopLevel(decl, scope, modulePath);
    }
    // Pass 2: resolve bodies and sub-declarations.
    for (const decl of decls) {
      this.resolveDecl(decl, scope, modulePath);
    }
  }

  // ---------------------------------------------------------------------------
  // Pass 1: declare
  // ---------------------------------------------------------------------------

  private declareTopLevel(
    decl: AstDeclNode,
    scope: Scope,
    modulePath: string,
  ): void {
    switch (decl.kind) {
      case 'FnDecl':
        this.registerDecl(scope, decl.name, 'Fn', decl.span, decl.returnType, decl.pub, modulePath);
        break;

      case 'LetDecl':
        this.registerDecl(scope, decl.name, 'Let', decl.span, decl.type_, decl.pub, modulePath);
        break;

      case 'DataDecl': {
        this.registerDecl(scope, decl.name, 'Data', decl.span, null, decl.pub, modulePath);
        for (const variant of decl.variants) {
          if (!scope.hasOwn(variant.name)) {
            this.registerDecl(scope, variant.name, 'Data', variant.span, null, decl.pub, modulePath);
          }
        }
        break;
      }

      case 'TypeAliasDecl':
        this.registerDecl(scope, decl.name, 'TypeAlias', decl.span, decl.type_, decl.pub, modulePath);
        break;

      case 'ExternDecl':
        this.registerDecl(scope, decl.name, 'Extern', decl.span, decl.returnType, decl.pub, modulePath);
        break;

      case 'ModuleDecl':
        this.registerDecl(scope, decl.name, 'Module', decl.span, null, decl.pub, modulePath);
        break;

      case 'UseDecl': {
        // Processed in pass 1 so imported aliases are in scope before bodies resolve.
        const importedPath = decl.path.join('.');
        const edgeKey = `${modulePath}→${importedPath}`;
        this.edgeSpans.set(edgeKey, decl.span);

        if (decl.items === null) {
          // `use a.b.c` — alias is the last path segment.
          const alias = decl.path[decl.path.length - 1];
          if (alias !== undefined) {
            this.registerDecl(scope, alias, 'Module', decl.span, null, false, modulePath);
          }
        } else {
          // `use a.b.{x, y}` — each item imported by name.
          for (const item of decl.items) {
            this.registerDecl(scope, item, 'Module', decl.span, null, false, modulePath);
          }
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pass 2: resolve bodies
  // ---------------------------------------------------------------------------

  private resolveDecl(
    decl: AstDeclNode,
    scope: Scope,
    modulePath: string,
  ): void {
    switch (decl.kind) {
      case 'FnDecl':
        this.resolveFnDecl(decl, scope, modulePath);
        break;

      case 'LetDecl':
        this.resolveExpr(decl.value, scope, modulePath);
        break;

      case 'DataDecl':
      case 'TypeAliasDecl':
      case 'ExternDecl':
      case 'UseDecl':
        // No expressions to resolve.
        break;

      case 'ModuleDecl': {
        const nestedPath = `${modulePath}.${decl.name}`;
        const nestedScope = new Scope(scope);
        this.bindDeclList(decl.decls, nestedScope, nestedPath);
        break;
      }
    }
  }

  private resolveFnDecl(
    decl: AstFnDeclNode,
    outerScope: Scope,
    modulePath: string,
  ): void {
    const fnScope = new Scope(outerScope);
    for (const tp of decl.typeParams) {
      this.registerDecl(fnScope, tp, 'TypeParam', decl.span, null, false, modulePath);
    }
    for (const param of decl.params) {
      this.registerDecl(fnScope, param.name, 'Param', param.span, param.type_, false, modulePath);
    }
    this.resolveExpr(decl.body, fnScope, modulePath);
  }

  // ---------------------------------------------------------------------------
  // Expression resolver
  // ---------------------------------------------------------------------------

  private resolveExpr(
    expr: AstExprNode,
    scope: Scope,
    modulePath: string,
  ): void {
    switch (expr.kind) {
      case 'Ident': {
        const id = scope.lookup(expr.name);
        if (id === undefined) {
          this.errors.push({
            kind: 'UndefinedName',
            message: `Undefined name '${expr.name}'`,
            span: expr.span,
          });
        } else {
          this.resolutionMap.set(spanKey(expr.span), id);
        }
        break;
      }

      case 'LiteralInt':
      case 'LiteralFloat':
      case 'LiteralBool':
      case 'LiteralNull':
        break;

      case 'StringLit':
        for (const part of expr.parts) {
          if (part.kind === 'InterpPart') {
            this.resolveExpr(part.expr, scope, modulePath);
          }
        }
        break;

      case 'BinopExpr':
        this.resolveExpr(expr.left, scope, modulePath);
        this.resolveExpr(expr.right, scope, modulePath);
        break;

      case 'UnaryExpr':
        this.resolveExpr(expr.operand, scope, modulePath);
        break;

      case 'CallExpr':
        this.resolveExpr(expr.callee, scope, modulePath);
        for (const arg of expr.args) {
          this.resolveExpr(arg.value, scope, modulePath);
        }
        break;

      case 'LambdaExpr': {
        const lambdaScope = new Scope(scope);
        for (const param of expr.params) {
          this.registerDecl(lambdaScope, param.name, 'Param', param.span, param.type_, false, modulePath);
        }
        this.resolveExpr(expr.body, lambdaScope, modulePath);
        break;
      }

      case 'PipelineExpr':
        this.resolveExpr(expr.left, scope, modulePath);
        this.resolveExpr(expr.right, scope, modulePath);
        break;

      case 'IfElseExpr':
        this.resolveExpr(expr.cond, scope, modulePath);
        this.resolveExpr(expr.then, scope, modulePath);
        this.resolveExpr(expr.else_, scope, modulePath);
        break;

      case 'MatchExpr': {
        this.resolveExpr(expr.scrutinee, scope, modulePath);
        for (const arm of expr.arms) {
          this.resolveMatchArm(arm, scope, modulePath);
        }
        break;
      }

      case 'LetExpr': {
        // Value is evaluated in the outer scope; body sees the new binding.
        this.resolveExpr(expr.value, scope, modulePath);
        const letScope = new Scope(scope);
        this.registerDecl(letScope, expr.name, 'Let', expr.span, expr.type_, false, modulePath);
        this.resolveExpr(expr.body, letScope, modulePath);
        break;
      }

      case 'AccessorExpr':
        this.resolveExpr(expr.receiver, scope, modulePath);
        break;

      case 'PropagateExpr':
        this.resolveExpr(expr.inner, scope, modulePath);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Match arm pattern binding
  // ---------------------------------------------------------------------------

  private resolveMatchArm(
    arm: AstMatchArm,
    outerScope: Scope,
    modulePath: string,
  ): void {
    const armScope = new Scope(outerScope);
    this.bindPattern(arm.pattern, armScope, outerScope, modulePath);
    if (arm.guard !== null) {
      this.resolveExpr(arm.guard, armScope, modulePath);
    }
    this.resolveExpr(arm.body, armScope, modulePath);
  }

  private bindPattern(
    pattern: AstPatternNode,
    armScope: Scope,
    outerScope: Scope,
    modulePath: string,
  ): void {
    switch (pattern.kind) {
      case 'WildcardPat':
        break;

      case 'IdentPat':
        this.registerDecl(armScope, pattern.name, 'PatternBinding', pattern.span, null, false, modulePath);
        break;

      case 'ConstructorPat': {
        // Tag must be a known Data variant in the outer scope.
        const id = outerScope.lookup(pattern.tag);
        if (id === undefined) {
          this.errors.push({
            kind: 'UndefinedName',
            message: `Undefined constructor '${pattern.tag}'`,
            span: pattern.span,
          });
        } else {
          this.resolutionMap.set(spanKey(pattern.span), id);
        }
        for (const field of pattern.fields) {
          this.bindPattern(field, armScope, outerScope, modulePath);
        }
        break;
      }

      case 'LiteralPat':
        break;

      case 'TuplePat':
        for (const el of pattern.elements) {
          this.bindPattern(el, armScope, outerScope, modulePath);
        }
        break;
    }
  }
}

/** Bind a single module, resolving names and building the symbol table. */
export function bindModule(module: AstModule, modulePath: string): BindResult {
  return new Binder().bind(module, modulePath);
}
