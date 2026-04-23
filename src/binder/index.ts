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
import { makeSymbolId, nullSpan } from '../types.js';

import { Scope } from './scope.js';
import { SymbolTableBuilder } from './symbol-table.js';
import type { SymbolKind } from './symbol-table.js';
import type { BindError, UndefinedNameError, DuplicateBindingError } from './errors.js';
import { buildGraph, topoSort } from './graph.js';

export type { BindError, BindErrorKind } from './errors.js';
export type { SymbolKind, SymbolInfo, ModuleSymbolTable } from './symbol-table.js';
export { detectCircularImports } from './module-graph.js';
export type { ModuleGraph } from './module-graph.js';

export interface ModuleBindResult {
  readonly modulePath: string;
  readonly symbolTable: import('./symbol-table.js').ModuleSymbolTable;
}

export interface BindProgramResult {
  readonly modules: readonly ModuleBindResult[];
  readonly errors: readonly BindError[];
}

// \0 is guaranteed absent from all OS file paths, making this key unambiguous.
function spanKey(span: Span): string {
  return `${span.file}\0${span.startLine}\0${span.startCol}`;
}

class Binder {
  private readonly builder: SymbolTableBuilder = new SymbolTableBuilder();
  private readonly errors: BindError[] = [];
  private counter: number = 0;
  private readonly modulePath: string;
  /** Exports from previously-bound modules, keyed by module path. */
  private readonly externalExports: ReadonlyMap<string, ReadonlyMap<string, SymbolId>>;

  constructor(
    modulePath: string,
    externalExports: ReadonlyMap<string, ReadonlyMap<string, SymbolId>>,
  ) {
    this.modulePath = modulePath;
    this.externalExports = externalExports;
  }

  private freshId(idPrefix: string, name: string): SymbolId {
    return makeSymbolId(`${idPrefix}$${name}$${this.counter++}`);
  }

  private registerDecl(
    scope: Scope,
    name: string,
    kind: SymbolKind,
    span: Span,
    typeAnnotation: TypeAnnotation | null | undefined,
    pub: boolean,
    idPrefix: string,
  ): SymbolId {
    if (scope.hasOwn(name)) {
      const existingId = scope.lookup(name) as SymbolId;
      const previousSpan = this.builder.getById(existingId)?.span ?? nullSpan;
      const err: DuplicateBindingError = {
        kind: 'DuplicateBinding',
        name,
        message: `Duplicate binding '${name}'`,
        span,
        previousSpan,
      };
      this.errors.push(err);
      return existingId;
    }
    const id = this.freshId(idPrefix, name);
    scope.define(name, id);
    const info = typeAnnotation !== undefined
      ? { id, name, kind, span, pub, typeAnnotation }
      : { id, name, kind, span, pub };
    this.builder.register(info);
    if (pub) {
      this.builder.addExport(name, id);
    }
    return id;
  }

  bind(module: AstModule): { result: ModuleBindResult; errors: BindError[] } {
    const moduleScope = new Scope(null);
    this.bindDeclList(module.decls, moduleScope, this.modulePath);
    return {
      result: { modulePath: this.modulePath, symbolTable: this.builder.build() },
      errors: this.errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Two-pass declaration list binding (supports mutual recursion / hoisting)
  // ---------------------------------------------------------------------------

  private bindDeclList(
    decls: readonly AstDeclNode[],
    scope: Scope,
    idPrefix: string,
  ): void {
    for (const decl of decls) {
      this.declareTopLevel(decl, scope, idPrefix);
    }
    for (const decl of decls) {
      this.resolveDecl(decl, scope, idPrefix);
    }
  }

  // ---------------------------------------------------------------------------
  // Pass 1: declare
  // ---------------------------------------------------------------------------

  private declareTopLevel(
    decl: AstDeclNode,
    scope: Scope,
    idPrefix: string,
  ): void {
    switch (decl.kind) {
      case 'FnDecl':
        this.registerDecl(scope, decl.name, 'fn', decl.span, decl.returnType, decl.pub, idPrefix);
        break;

      case 'LetDecl':
        this.registerDecl(scope, decl.name, 'let', decl.span, decl.type_, decl.pub, idPrefix);
        break;

      case 'DataDecl': {
        this.registerDecl(scope, decl.name, 'data', decl.span, null, decl.pub, idPrefix);
        for (const variant of decl.variants) {
          this.registerDecl(scope, variant.name, 'data', variant.span, null, decl.pub, idPrefix);
        }
        break;
      }

      case 'TypeAliasDecl':
        this.registerDecl(scope, decl.name, 'typeAlias', decl.span, decl.type_, decl.pub, idPrefix);
        break;

      case 'ExternDecl':
        this.registerDecl(scope, decl.name, 'extern', decl.span, decl.returnType, decl.pub, idPrefix);
        break;

      case 'ModuleDecl':
        this.registerDecl(scope, decl.name, 'module', decl.span, null, decl.pub, idPrefix);
        break;

      case 'UseDecl': {
        if (decl.items === null) {
          // `use a.b.c` — alias is the last path segment
          const alias = decl.path[decl.path.length - 1];
          if (alias !== undefined) {
            this.registerDecl(scope, alias, 'module', decl.span, null, false, idPrefix);
          }
        } else {
          // `use a.b.{x, y}` — resolve named imports against known module exports
          const targetPath = decl.path.join('::');
          const targetExports = this.externalExports.get(targetPath);
          for (const item of decl.items) {
            if (targetExports !== undefined) {
              const extId = targetExports.get(item);
              if (extId !== undefined) {
                // Inject the exporter's SymbolId directly — no new symbol created
                scope.define(item, extId);
              } else {
                const err: UndefinedNameError = {
                  kind: 'UndefinedName',
                  name: item,
                  message: `'${item}' is not exported by module '${targetPath}'`,
                  span: decl.span,
                };
                this.errors.push(err);
                // Register a placeholder to avoid cascade errors on later references
                this.registerDecl(scope, item, 'useImport', decl.span, null, false, idPrefix);
              }
            } else {
              // Unknown/external module — register as opaque, no error
              this.registerDecl(scope, item, 'useImport', decl.span, null, false, idPrefix);
            }
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
    idPrefix: string,
  ): void {
    switch (decl.kind) {
      case 'FnDecl':
        this.resolveFnDecl(decl, scope, idPrefix);
        break;

      case 'LetDecl':
        this.resolveExpr(decl.value, scope, idPrefix);
        break;

      case 'DataDecl':
      case 'TypeAliasDecl':
      case 'ExternDecl':
      case 'UseDecl':
        break;

      case 'ModuleDecl': {
        const nestedPath = `${idPrefix}.${decl.name}`;
        const nestedScope = new Scope(scope);
        this.bindDeclList(decl.decls, nestedScope, nestedPath);
        break;
      }
    }
  }

  private resolveFnDecl(
    decl: AstFnDeclNode,
    outerScope: Scope,
    idPrefix: string,
  ): void {
    const fnScope = new Scope(outerScope);
    for (const tp of decl.typeParams) {
      this.registerDecl(fnScope, tp, 'typeParam', decl.span, null, false, idPrefix);
    }
    for (const param of decl.params) {
      this.registerDecl(fnScope, param.name, 'fnParam', param.span, param.type_, false, idPrefix);
    }
    this.resolveExpr(decl.body, fnScope, idPrefix);
  }

  // ---------------------------------------------------------------------------
  // Expression resolver
  // ---------------------------------------------------------------------------

  private resolveExpr(
    expr: AstExprNode,
    scope: Scope,
    idPrefix: string,
  ): void {
    switch (expr.kind) {
      case 'Ident': {
        const id = scope.lookup(expr.name);
        if (id === undefined) {
          const err: UndefinedNameError = {
            kind: 'UndefinedName',
            name: expr.name,
            message: `Undefined name '${expr.name}'`,
            span: expr.span,
          };
          this.errors.push(err);
        } else {
          this.builder.addReference(spanKey(expr.span), id);
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
            this.resolveExpr(part.expr, scope, idPrefix);
          }
        }
        break;

      case 'BinopExpr':
        this.resolveExpr(expr.left, scope, idPrefix);
        this.resolveExpr(expr.right, scope, idPrefix);
        break;

      case 'UnaryExpr':
        this.resolveExpr(expr.operand, scope, idPrefix);
        break;

      case 'CallExpr':
        this.resolveExpr(expr.callee, scope, idPrefix);
        for (const arg of expr.args) {
          this.resolveExpr(arg.value, scope, idPrefix);
        }
        break;

      case 'LambdaExpr': {
        const lambdaScope = new Scope(scope);
        for (const param of expr.params) {
          this.registerDecl(lambdaScope, param.name, 'fnParam', param.span, param.type_, false, idPrefix);
        }
        this.resolveExpr(expr.body, lambdaScope, idPrefix);
        break;
      }

      case 'PipelineExpr':
        this.resolveExpr(expr.left, scope, idPrefix);
        this.resolveExpr(expr.right, scope, idPrefix);
        break;

      case 'IfElseExpr':
        this.resolveExpr(expr.cond, scope, idPrefix);
        this.resolveExpr(expr.then, scope, idPrefix);
        this.resolveExpr(expr.else_, scope, idPrefix);
        break;

      case 'MatchExpr':
        this.resolveExpr(expr.scrutinee, scope, idPrefix);
        for (const arm of expr.arms) {
          this.resolveMatchArm(arm, scope, idPrefix);
        }
        break;

      case 'LetExpr': {
        this.resolveExpr(expr.value, scope, idPrefix);
        const letScope = new Scope(scope);
        this.registerDecl(letScope, expr.name, 'letExprBinding', expr.span, expr.type_, false, idPrefix);
        this.resolveExpr(expr.body, letScope, idPrefix);
        break;
      }

      case 'AccessorExpr':
        this.resolveExpr(expr.receiver, scope, idPrefix);
        break;

      case 'PropagateExpr':
        this.resolveExpr(expr.inner, scope, idPrefix);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Match arm pattern binding
  // ---------------------------------------------------------------------------

  private resolveMatchArm(
    arm: AstMatchArm,
    outerScope: Scope,
    idPrefix: string,
  ): void {
    const armScope = new Scope(outerScope);
    this.bindPattern(arm.pattern, armScope, outerScope, idPrefix);
    if (arm.guard !== null) {
      this.resolveExpr(arm.guard, armScope, idPrefix);
    }
    this.resolveExpr(arm.body, armScope, idPrefix);
  }

  private bindPattern(
    pattern: AstPatternNode,
    armScope: Scope,
    outerScope: Scope,
    idPrefix: string,
  ): void {
    switch (pattern.kind) {
      case 'WildcardPat':
        break;

      case 'IdentPat':
        this.registerDecl(armScope, pattern.name, 'patternBinding', pattern.span, null, false, idPrefix);
        break;

      case 'ConstructorPat': {
        const id = outerScope.lookup(pattern.tag);
        if (id === undefined) {
          const err: UndefinedNameError = {
            kind: 'UndefinedName',
            name: pattern.tag,
            message: `Undefined constructor '${pattern.tag}'`,
            span: pattern.span,
          };
          this.errors.push(err);
        } else {
          this.builder.addReference(spanKey(pattern.span), id);
        }
        for (const field of pattern.fields) {
          this.bindPattern(field, armScope, outerScope, idPrefix);
        }
        break;
      }

      case 'LiteralPat':
        break;

      case 'TuplePat':
        for (const el of pattern.elements) {
          this.bindPattern(el, armScope, outerScope, idPrefix);
        }
        break;
    }
  }
}

/** Bind multiple modules with cross-module resolution. Processes in topological order (leaves first). */
export function bindModules(modules: Map<string, AstModule>): BindProgramResult {
  const nodes = buildGraph(modules);
  const sorted = topoSort(nodes);

  if ('cycle' in sorted) {
    return {
      modules: [],
      errors: [{
        kind: 'CircularImport',
        cycle: sorted.cycle,
        message: `Circular import detected: ${sorted.cycle.join(' → ')}`,
        span: nullSpan,
      }],
    };
  }

  const moduleResults: ModuleBindResult[] = [];
  const allErrors: BindError[] = [];
  const exportsByModule = new Map<string, ReadonlyMap<string, SymbolId>>();

  for (const moduleName of sorted.order) {
    const ast = modules.get(moduleName);
    if (ast === undefined) continue;

    const binder = new Binder(moduleName, exportsByModule);
    const { result, errors } = binder.bind(ast);
    moduleResults.push(result);
    allErrors.push(...errors);
    exportsByModule.set(moduleName, result.symbolTable.exports);
  }

  return { modules: moduleResults, errors: allErrors };
}

/** Bind a single module. Convenience wrapper around `bindModules`. */
export function bindModule(module: AstModule, modulePath: string): BindProgramResult {
  return bindModules(new Map([[modulePath, module]]));
}
