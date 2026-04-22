import { makeSymbolId } from '../types.js';
import type { Span, SymbolId } from '../types.js';
import type { TypeAnnotation } from '../ast/types.js';
import type {
  AstModule,
  AstDeclNode,
  AstExprNode,
  AstPatternNode,
  AstMatchArm,
} from '../ast/nodes.js';
import { Scope } from './scope.js';
import { buildGraph, topoSort } from './graph.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Kind of declaration a symbol comes from. */
export type SymbolKind =
  | 'fn' | 'let' | 'data' | 'typeAlias' | 'extern' | 'module'
  | 'fnParam' | 'typeParam' | 'letExprBinding' | 'patternBinding';

export interface SymbolInfo {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly declSpan: Span;
  readonly pub: boolean;
  /** Surface type annotation; null if absent or inferred. The checker fills in the resolved type. */
  readonly typeAnnotation: TypeAnnotation | null;
}

export interface SymbolTable {
  /** All symbols defined in this module, keyed by SymbolId. */
  readonly symbols: ReadonlyMap<SymbolId, SymbolInfo>;
  /** Maps each resolved use-site (`${file}:${startLine}:${startCol}`) to its SymbolId. */
  readonly references: ReadonlyMap<string, SymbolId>;
  /** Top-level public exports: name → SymbolId. */
  readonly exports: ReadonlyMap<string, SymbolId>;
}

export type BindError =
  | { readonly kind: 'UndefinedName'; readonly name: string; readonly span: Span }
  | { readonly kind: 'DuplicateBinding'; readonly name: string; readonly firstSpan: Span; readonly span: Span }
  | { readonly kind: 'CircularImport'; readonly cycle: readonly string[] };

export interface BoundModule {
  readonly modulePath: string;
  readonly ast: AstModule;
  readonly symbolTable: SymbolTable;
}

export interface BinderResult {
  /** Modules in topological dependency order (leaves first). */
  readonly modules: readonly BoundModule[];
  readonly errors: readonly BindError[];
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface BinderState {
  readonly symbols: Map<SymbolId, SymbolInfo>;
  readonly references: Map<string, SymbolId>;
  readonly exports: Map<string, SymbolId>;
  readonly errors: BindError[];
  readonly filePath: string;
}

function makeRefKey(span: Span): string {
  return `${span.file}:${span.startLine}:${span.startCol}`;
}

function makeSymId(filePath: string, name: string, span: Span): SymbolId {
  return makeSymbolId(`${filePath}#${name}@${span.startLine}:${span.startCol}`);
}

/**
 * Tries to define `name` in `scope`, recording the symbol and optionally exporting it.
 * Emits `DuplicateBinding` when `name` is already defined; the first binding wins.
 */
function tryDefine(
  scope: Scope,
  state: BinderState,
  name: string,
  kind: SymbolKind,
  span: Span,
  pub: boolean,
  typeAnnotation: TypeAnnotation | null,
  isTopLevel: boolean,
): SymbolId {
  const id = makeSymId(state.filePath, name, span);
  const existing = scope.define(name, { id, declSpan: span });
  if (existing !== null) {
    state.errors.push({ kind: 'DuplicateBinding', name, firstSpan: existing.declSpan, span });
    return id;
  }
  state.symbols.set(id, { id, name, kind, declSpan: span, pub, typeAnnotation });
  if (isTopLevel && pub) {
    state.exports.set(name, id);
  }
  return id;
}

/**
 * Defines a local (non-exported) symbol in `scope`.
 * Emits `DuplicateBinding` when `name` is already defined in this scope; the first binding wins.
 */
function defineLocal(
  scope: Scope,
  state: BinderState,
  name: string,
  kind: SymbolKind,
  span: Span,
  typeAnnotation: TypeAnnotation | null,
): SymbolId {
  const id = makeSymId(state.filePath, name, span);
  const existing = scope.define(name, { id, declSpan: span });
  if (existing !== null) {
    state.errors.push({ kind: 'DuplicateBinding', name, firstSpan: existing.declSpan, span });
    return id;
  }
  state.symbols.set(id, { id, name, kind, declSpan: span, pub: false, typeAnnotation });
  return id;
}

// ---------------------------------------------------------------------------
// Pattern binding
// ---------------------------------------------------------------------------

function bindPatternIntoScope(pattern: AstPatternNode, scope: Scope, state: BinderState): void {
  switch (pattern.kind) {
    case 'WildcardPat':
      return;
    case 'IdentPat':
      defineLocal(scope, state, pattern.name, 'patternBinding', pattern.span, null);
      return;
    case 'ConstructorPat':
      for (const field of pattern.fields) {
        bindPatternIntoScope(field, scope, state);
      }
      return;
    case 'LiteralPat':
      return;
    case 'TuplePat':
      for (const elem of pattern.elements) {
        bindPatternIntoScope(elem, scope, state);
      }
      return;
  }
}

// ---------------------------------------------------------------------------
// Expression resolution
// ---------------------------------------------------------------------------

function resolveExpr(expr: AstExprNode, scope: Scope, state: BinderState): void {
  switch (expr.kind) {
    case 'LiteralInt':
    case 'LiteralFloat':
    case 'LiteralBool':
    case 'LiteralNull':
      return;

    case 'StringLit':
      for (const part of expr.parts) {
        if (part.kind === 'InterpPart') {
          resolveExpr(part.expr, scope, state);
        }
      }
      return;

    case 'Ident': {
      const entry = scope.lookup(expr.name);
      if (entry === undefined) {
        state.errors.push({ kind: 'UndefinedName', name: expr.name, span: expr.span });
      } else {
        state.references.set(makeRefKey(expr.span), entry.id);
      }
      return;
    }

    case 'BinopExpr':
      resolveExpr(expr.left, scope, state);
      resolveExpr(expr.right, scope, state);
      return;

    case 'UnaryExpr':
      resolveExpr(expr.operand, scope, state);
      return;

    case 'CallExpr':
      resolveExpr(expr.callee, scope, state);
      for (const arg of expr.args) {
        resolveExpr(arg.value, scope, state);
      }
      return;

    case 'LambdaExpr': {
      const lambdaScope = new Scope(scope);
      for (const param of expr.params) {
        defineLocal(lambdaScope, state, param.name, 'fnParam', param.span, param.type_);
      }
      resolveExpr(expr.body, lambdaScope, state);
      return;
    }

    case 'PipelineExpr':
      resolveExpr(expr.left, scope, state);
      resolveExpr(expr.right, scope, state);
      return;

    case 'IfElseExpr':
      resolveExpr(expr.cond, scope, state);
      resolveExpr(expr.then, scope, state);
      resolveExpr(expr.else_, scope, state);
      return;

    case 'MatchExpr':
      resolveExpr(expr.scrutinee, scope, state);
      for (const arm of expr.arms) {
        resolveMatchArm(arm, scope, state);
      }
      return;

    case 'LetExpr': {
      resolveExpr(expr.value, scope, state);
      const letScope = new Scope(scope);
      const id = makeSymId(state.filePath, expr.name, expr.span);
      // LetExpr binding is not subject to scope collision checks — sequential, not hoisted.
      letScope.define(expr.name, { id, declSpan: expr.span });
      state.symbols.set(id, {
        id,
        name: expr.name,
        kind: 'letExprBinding',
        declSpan: expr.span,
        pub: false,
        typeAnnotation: expr.type_,
      });
      resolveExpr(expr.body, letScope, state);
      return;
    }

    case 'AccessorExpr':
      resolveExpr(expr.receiver, scope, state);
      return;

    case 'PropagateExpr':
      resolveExpr(expr.inner, scope, state);
      return;
  }
}

function resolveMatchArm(arm: AstMatchArm, scope: Scope, state: BinderState): void {
  const armScope = new Scope(scope);
  bindPatternIntoScope(arm.pattern, armScope, state);
  if (arm.guard !== null) {
    resolveExpr(arm.guard, armScope, state);
  }
  resolveExpr(arm.body, armScope, state);
}

// ---------------------------------------------------------------------------
// Declaration hoisting (pass 1) and resolution (pass 2)
// ---------------------------------------------------------------------------

function hoistDecl(decl: AstDeclNode, scope: Scope, state: BinderState, isTopLevel: boolean): void {
  switch (decl.kind) {
    case 'FnDecl':
      tryDefine(scope, state, decl.name, 'fn', decl.span, decl.pub, decl.returnType, isTopLevel);
      return;
    case 'LetDecl':
      tryDefine(scope, state, decl.name, 'let', decl.span, decl.pub, decl.type_, isTopLevel);
      return;
    case 'DataDecl':
      tryDefine(scope, state, decl.name, 'data', decl.span, decl.pub, null, isTopLevel);
      return;
    case 'TypeAliasDecl':
      tryDefine(scope, state, decl.name, 'typeAlias', decl.span, decl.pub, decl.type_, isTopLevel);
      return;
    case 'ExternDecl':
      tryDefine(scope, state, decl.name, 'extern', decl.span, decl.pub, decl.returnType, isTopLevel);
      return;
    case 'ModuleDecl':
      tryDefine(scope, state, decl.name, 'module', decl.span, decl.pub, null, isTopLevel);
      return;
    case 'UseDecl':
      return;
  }
}

function resolveDecl(decl: AstDeclNode, scope: Scope, state: BinderState): void {
  switch (decl.kind) {
    case 'FnDecl': {
      let bodyScope = scope;
      if (decl.typeParams.length > 0) {
        const typeScope = new Scope(scope);
        for (const tp of decl.typeParams) {
          defineLocal(typeScope, state, tp, 'typeParam', decl.span, null);
        }
        bodyScope = typeScope;
      }
      const paramScope = new Scope(bodyScope);
      for (const param of decl.params) {
        defineLocal(paramScope, state, param.name, 'fnParam', param.span, param.type_);
      }
      resolveExpr(decl.body, paramScope, state);
      return;
    }

    case 'LetDecl':
      resolveExpr(decl.value, scope, state);
      return;

    case 'DataDecl':
      if (decl.typeParams.length > 0) {
        const typeScope = new Scope(scope);
        for (const tp of decl.typeParams) {
          defineLocal(typeScope, state, tp, 'typeParam', decl.span, null);
        }
      }
      return;

    case 'TypeAliasDecl':
      if (decl.typeParams.length > 0) {
        const typeScope = new Scope(scope);
        for (const tp of decl.typeParams) {
          defineLocal(typeScope, state, tp, 'typeParam', decl.span, null);
        }
      }
      return;

    case 'UseDecl':
      return;

    case 'ExternDecl': {
      const paramScope = new Scope(scope);
      for (const param of decl.params) {
        defineLocal(paramScope, state, param.name, 'fnParam', param.span, param.type_);
      }
      return;
    }

    case 'ModuleDecl': {
      const moduleScope = new Scope(scope);
      bindDeclsInScope(decl.decls, moduleScope, state, false);
      return;
    }
  }
}

function bindDeclsInScope(
  decls: readonly AstDeclNode[],
  scope: Scope,
  state: BinderState,
  isTopLevel: boolean,
): void {
  for (const decl of decls) {
    hoistDecl(decl, scope, state, isTopLevel);
  }
  for (const decl of decls) {
    resolveDecl(decl, scope, state);
  }
}

// ---------------------------------------------------------------------------
// Core binding
// ---------------------------------------------------------------------------

function bindModuleInternal(
  ast: AstModule,
  modulePath: string,
  parentScope: Scope,
): { module: BoundModule; errors: BindError[] } {
  const state: BinderState = {
    symbols: new Map(),
    references: new Map(),
    exports: new Map(),
    errors: [],
    filePath: modulePath,
  };

  const topScope = new Scope(parentScope);
  bindDeclsInScope(ast.decls, topScope, state, true);

  const symbolTable: SymbolTable = {
    symbols: state.symbols,
    references: state.references,
    exports: state.exports,
  };

  return { module: { modulePath, ast, symbolTable }, errors: state.errors };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Bind a single, self-contained module. UseDecl targets are recorded but not resolved. */
export function bindModule(ast: AstModule, filePath: string): BinderResult {
  const { module, errors } = bindModuleInternal(ast, filePath, new Scope(null));
  return { modules: [module], errors };
}

/** Bind a set of named modules together, resolving cross-module imports in topological order. */
export function bindModules(modules: Map<string, AstModule>): BinderResult {
  const nodes = buildGraph(modules);
  const sortResult = topoSort(nodes);

  if ('cycle' in sortResult) {
    return { modules: [], errors: [{ kind: 'CircularImport', cycle: sortResult.cycle }] };
  }

  const { order } = sortResult;
  const allModules: BoundModule[] = [];
  const boundByPath = new Map<string, BoundModule>();
  const allErrors: BindError[] = [];

  for (const modulePath of order) {
    const ast = modules.get(modulePath);
    if (ast === undefined) continue;

    // Populate an import scope from this module's UseDecl nodes using already-bound exports.
    const importScope = new Scope(null);
    for (const decl of ast.decls) {
      if (decl.kind !== 'UseDecl') continue;
      const targetPath = decl.path.join('::');
      const targetBound = boundByPath.get(targetPath);

      if (decl.items === null) {
        // Import the module itself as a namespace via the last path segment.
        if (targetBound !== undefined) {
          const lastSegment = decl.path[decl.path.length - 1];
          if (lastSegment !== undefined) {
            const moduleId = makeSymbolId(`${targetPath}#(module)@0:0`);
            importScope.define(lastSegment, { id: moduleId, declSpan: decl.span });
          }
        }
      } else {
        for (const itemName of decl.items) {
          if (targetBound === undefined) continue;
          const id = targetBound.symbolTable.exports.get(itemName);
          if (id !== undefined) {
            importScope.define(itemName, { id, declSpan: decl.span });
          } else {
            allErrors.push({ kind: 'UndefinedName', name: itemName, span: decl.span });
          }
        }
      }
    }

    const { module, errors } = bindModuleInternal(ast, modulePath, importScope);
    allModules.push(module);
    boundByPath.set(modulePath, module);
    allErrors.push(...errors);
  }

  return { modules: allModules, errors: allErrors };
}
