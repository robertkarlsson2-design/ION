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

export type ModuleDeclKind =
  | 'fn'
  | 'let'
  | 'letExprBinding'
  | 'data'
  | 'typeAlias'
  | 'extern'
  | 'module'
  | 'fnParam'
  | 'typeParam'
  | 'patternBinding';

export interface SymbolView {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: ModuleDeclKind;
  readonly pub: boolean;
}

export interface PerModuleSymbolTable {
  readonly symbols: ReadonlyMap<SymbolId, SymbolView>;
  readonly exports: ReadonlyMap<string, SymbolId>;
  readonly references: ReadonlyMap<string, SymbolId>;
}

export interface PerModuleResult {
  readonly modulePath: string;
  readonly symbolTable: PerModuleSymbolTable;
}

export interface MultiBindResult {
  readonly modules: readonly PerModuleResult[];
  readonly errors: readonly BindError[];
}

export interface BindResult {
  readonly symbolTable: SymbolTable;
  readonly resolutionMap: ResolutionMap;
  readonly moduleGraph: ModuleGraph;
  readonly errors: BindError[];
  readonly modules: readonly PerModuleResult[];
}

// \0 is guaranteed absent from all OS file paths, making this key unambiguous.
function spanKey(span: Span): string {
  return `${span.file}\0${span.startLine}\0${span.startCol}`;
}

function toDeclKindLower(dk: DeclKind): ModuleDeclKind {
  switch (dk) {
    case 'Fn':             return 'fn';
    case 'Let':            return 'let';
    case 'LetExpr':        return 'letExprBinding';
    case 'Data':           return 'data';
    case 'TypeAlias':      return 'typeAlias';
    case 'Extern':         return 'extern';
    case 'Module':         return 'module';
    case 'Param':          return 'fnParam';
    case 'TypeParam':      return 'typeParam';
    case 'PatternBinding': return 'patternBinding';
  }
}

function topoSort(graph: ModuleGraph, keys: string[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  function visit(node: string): void {
    if (visited.has(node)) return;
    visited.add(node);
    const deps = graph.get(node);
    if (deps !== undefined) {
      for (const dep of deps) visit(dep);
    }
    result.push(node);
  }
  for (const key of keys) visit(key);
  return result;
}

type ImportResolver = (sourcePath: string, name: string) => SymbolId | undefined;

class Binder {
  private readonly symbolTable: SymbolTable = new SymbolTable();
  private readonly resolutionMap: ResolutionMap = new Map();
  private readonly errors: BindError[] = [];
  private counter: number = 0;
  private readonly moduleGraph: ModuleGraph = new Map();
  /** Maps "from→to" edge key to the UseDecl span for cycle reporting. */
  private readonly edgeSpans: Map<string, Span> = new Map();

  constructor(private readonly importResolver: ImportResolver | null = null) {}

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
        name,
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

    const symbols = new Map<SymbolId, SymbolView>();
    const exports = new Map<string, SymbolId>();
    for (const entry of this.symbolTable.all()) {
      symbols.set(entry.id, {
        id: entry.id,
        name: entry.name,
        kind: toDeclKindLower(entry.declKind),
        pub: entry.isPublic,
      });
      if (entry.isPublic) exports.set(entry.name, entry.id);
    }

    const perModule: PerModuleResult = {
      modulePath,
      symbolTable: { symbols, exports, references: this.resolutionMap },
    };

    return {
      symbolTable: this.symbolTable,
      resolutionMap: this.resolutionMap,
      moduleGraph: this.moduleGraph,
      errors: this.errors,
      modules: [perModule],
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
          this.registerDecl(scope, variant.name, 'Data', variant.span, null, decl.pub, modulePath);
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
            if (this.importResolver !== null) {
              const resolvedId = this.importResolver(importedPath, item);
              if (resolvedId !== undefined) {
                scope.define(item, resolvedId);
              } else {
                this.errors.push({
                  kind: 'UndefinedName',
                  name: item,
                  message: `'${item}' is not exported by '${importedPath}'`,
                  span: decl.span,
                });
              }
            } else {
              this.registerDecl(scope, item, 'Module', decl.span, null, false, modulePath);
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
            name: expr.name,
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
        this.registerDecl(letScope, expr.name, 'LetExpr', expr.span, expr.type_, false, modulePath);
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
            name: pattern.tag,
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

/** Bind multiple modules together, resolving cross-module imports in topological order. */
export function bindModules(modules: Map<string, AstModule>): MultiBindResult {
  const graph: ModuleGraph = new Map();
  const edgeSpans = new Map<string, Span>();

  for (const [path, ast] of modules) {
    const local = buildModuleGraph(path, ast.decls);
    for (const [k, v] of local) graph.set(k, new Set(v));
    for (const decl of ast.decls) {
      if (decl.kind === 'UseDecl') {
        edgeSpans.set(`${path}→${decl.path.join('.')}`, decl.span);
      }
    }
  }

  const circularErrors = detectCircularImports(graph, edgeSpans);
  if (circularErrors.length > 0) {
    return { modules: [], errors: circularErrors };
  }

  const sortedPaths = topoSort(graph, [...modules.keys()]);

  const allErrors: BindError[] = [];
  const perModuleResults: PerModuleResult[] = [];
  const exportMaps = new Map<string, ReadonlyMap<string, SymbolId>>();

  for (const modulePath of sortedPaths) {
    const ast = modules.get(modulePath);
    if (ast === undefined) continue;

    const importResolver: ImportResolver = (srcPath, name) =>
      exportMaps.get(srcPath)?.get(name);

    const bindResult = new Binder(importResolver).bind(ast, modulePath);
    allErrors.push(...bindResult.errors);

    // Non-null: bind() always returns exactly one PerModuleResult in modules[0].
    const perModule = bindResult.modules[0]!;
    perModuleResults.push(perModule);
    exportMaps.set(modulePath, perModule.symbolTable.exports);
  }

  return { modules: perModuleResults, errors: allErrors };
}
