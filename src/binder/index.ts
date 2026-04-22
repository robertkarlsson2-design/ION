import type {
  AstModule,
  AstDeclNode,
  AstExprNode,
  AstPatternNode,
  AstIdentNode,
  AstFnDeclNode,
} from '../ast/nodes.js';
import type { TypeAnnotation } from '../ast/types.js';
import type { Span, SymbolId } from '../types.js';
import type {
  BindResult,
  BindError,
  DeclKind,
  ModuleEdge,
} from './types.js';
import { ScopeChain } from './scope.js';

// ---- Internal per-module state ----------------------------------------------

interface BindState {
  readonly moduleId: string;
  readonly scope: ScopeChain;
  readonly resolutions: Map<AstIdentNode, SymbolId>;
  readonly errors: BindError[];
  readonly edges: ModuleEdge[];
}

// ---- Pass 1: hoist declarations ---------------------------------------------

function hoistDecls(decls: readonly AstDeclNode[], state: BindState): void {
  for (const decl of decls) {
    switch (decl.kind) {
      case 'FnDecl':
        defTop(decl.name, 'fn', decl.span, decl.returnType ?? null, state);
        break;
      case 'LetDecl':
        defTop(decl.name, 'let', decl.span, decl.type_ ?? null, state);
        break;
      case 'DataDecl':
        defTop(decl.name, 'data', decl.span, null, state);
        break;
      case 'TypeAliasDecl':
        defTop(decl.name, 'typeAlias', decl.span, decl.type_, state);
        break;
      case 'ExternDecl':
        defTop(decl.name, 'extern', decl.span, decl.returnType ?? null, state);
        break;
      case 'ModuleDecl':
        defTop(decl.name, 'module', decl.span, null, state);
        break;
      case 'UseDecl':
        state.edges.push({
          fromModuleId: state.moduleId,
          toModuleId: decl.path.join('.'),
          alias: null,
          importedNames: decl.items,
          span: decl.span,
        });
        break;
    }
  }
}

function defTop(
  name: string,
  declKind: DeclKind,
  span: Span,
  typeStub: TypeAnnotation | null,
  state: BindState,
): void {
  const result = state.scope.define({ name, declKind, span, typeStub, moduleId: state.moduleId });
  if ('duplicate' in result) {
    state.errors.push({
      kind: 'DuplicateBinding',
      code: 'E0302',
      name,
      span,
      previousSpan: result.duplicate.span,
      message: `duplicate binding '${name}'`,
    });
  }
}

// ---- Pass 2: walk expression bodies -----------------------------------------

function walkDecls(decls: readonly AstDeclNode[], state: BindState): void {
  for (const decl of decls) {
    walkDecl(decl, state);
  }
}

function walkDecl(decl: AstDeclNode, state: BindState): void {
  switch (decl.kind) {
    case 'FnDecl':
      walkFn(decl, state);
      break;
    case 'LetDecl':
      walkExpr(decl.value, state);
      break;
    case 'ModuleDecl':
      state.scope.pushScope();
      hoistDecls(decl.decls, state);
      walkDecls(decl.decls, state);
      state.scope.popScope();
      break;
    case 'DataDecl':
    case 'TypeAliasDecl':
    case 'ExternDecl':
    case 'UseDecl':
      break;
  }
}

function walkFn(decl: AstFnDeclNode, state: BindState): void {
  state.scope.pushScope();

  // Type params as phantom symbols — available inside but not outside
  for (const tp of decl.typeParams) {
    state.scope.define({
      name: tp,
      declKind: 'param',
      span: decl.span,
      typeStub: null,
      moduleId: state.moduleId,
    });
  }

  for (const param of decl.params) {
    const r = state.scope.define({
      name: param.name,
      declKind: 'param',
      span: param.span,
      typeStub: param.type_ ?? null,
      moduleId: state.moduleId,
    });
    if ('duplicate' in r) {
      state.errors.push({
        kind: 'DuplicateBinding',
        code: 'E0302',
        name: param.name,
        span: param.span,
        previousSpan: r.duplicate.span,
        message: `duplicate parameter '${param.name}'`,
      });
    }
  }

  walkExpr(decl.body, state);
  state.scope.popScope();
}

function walkExpr(expr: AstExprNode, state: BindState): void {
  switch (expr.kind) {
    case 'Ident': {
      const id = state.scope.resolve(expr.name);
      if (id !== undefined) {
        state.resolutions.set(expr, id);
      } else {
        state.errors.push({
          kind: 'UndefinedName',
          code: 'E0301',
          name: expr.name,
          span: expr.span,
          message: `undefined name '${expr.name}'`,
        });
      }
      break;
    }
    case 'LambdaExpr': {
      state.scope.pushScope();
      for (const p of expr.params) {
        const r = state.scope.define({
          name: p.name,
          declKind: 'param',
          span: p.span,
          typeStub: p.type_ ?? null,
          moduleId: state.moduleId,
        });
        if ('duplicate' in r) {
          state.errors.push({
            kind: 'DuplicateBinding',
            code: 'E0302',
            name: p.name,
            span: p.span,
            previousSpan: r.duplicate.span,
            message: `duplicate lambda parameter '${p.name}'`,
          });
        }
      }
      walkExpr(expr.body, state);
      state.scope.popScope();
      break;
    }
    case 'LetExpr': {
      walkExpr(expr.value, state);
      state.scope.pushScope();
      const r = state.scope.define({
        name: expr.name,
        declKind: 'letBound',
        span: expr.span,
        typeStub: expr.type_ ?? null,
        moduleId: state.moduleId,
      });
      if ('duplicate' in r) {
        state.errors.push({
          kind: 'DuplicateBinding',
          code: 'E0302',
          name: expr.name,
          span: expr.span,
          previousSpan: r.duplicate.span,
          message: `duplicate let binding '${expr.name}'`,
        });
      }
      walkExpr(expr.body, state);
      state.scope.popScope();
      break;
    }
    case 'MatchExpr': {
      walkExpr(expr.scrutinee, state);
      for (const arm of expr.arms) {
        state.scope.pushScope();
        bindPattern(arm.pattern, state);
        if (arm.guard !== null) walkExpr(arm.guard, state);
        walkExpr(arm.body, state);
        state.scope.popScope();
      }
      break;
    }
    case 'BinopExpr':
      walkExpr(expr.left, state);
      walkExpr(expr.right, state);
      break;
    case 'UnaryExpr':
      walkExpr(expr.operand, state);
      break;
    case 'CallExpr':
      walkExpr(expr.callee, state);
      for (const arg of expr.args) walkExpr(arg.value, state);
      break;
    case 'PipelineExpr':
      walkExpr(expr.left, state);
      walkExpr(expr.right, state);
      break;
    case 'IfElseExpr':
      walkExpr(expr.cond, state);
      walkExpr(expr.then, state);
      walkExpr(expr.else_, state);
      break;
    case 'AccessorExpr':
      walkExpr(expr.receiver, state);
      break;
    case 'PropagateExpr':
      walkExpr(expr.inner, state);
      break;
    case 'StringLit':
      for (const part of expr.parts) {
        if (part.kind === 'InterpPart') walkExpr(part.expr, state);
      }
      break;
    case 'LiteralInt':
    case 'LiteralFloat':
    case 'LiteralBool':
    case 'LiteralNull':
      break;
  }
}

function bindPattern(pat: AstPatternNode, state: BindState): void {
  switch (pat.kind) {
    case 'WildcardPat':
    case 'LiteralPat':
      break;
    case 'IdentPat': {
      const r = state.scope.define({
        name: pat.name,
        declKind: 'patternBound',
        span: pat.span,
        typeStub: null,
        moduleId: state.moduleId,
      });
      if ('duplicate' in r) {
        state.errors.push({
          kind: 'DuplicateBinding',
          code: 'E0302',
          name: pat.name,
          span: pat.span,
          previousSpan: r.duplicate.span,
          message: `duplicate pattern binding '${pat.name}'`,
        });
      }
      break;
    }
    case 'ConstructorPat':
      for (const f of pat.fields) bindPattern(f, state);
      break;
    case 'TuplePat':
      for (const e of pat.elements) bindPattern(e, state);
      break;
  }
}

// ---- Cycle detection --------------------------------------------------------

function findOneCycle(
  start: string,
  deps: Map<string, Set<string>>,
  candidates: Set<string>,
): string[] {
  const path: string[] = [];
  const onPath = new Set<string>();
  let found: string[] | null = null;

  function dfs(id: string): boolean {
    if (found !== null) return true;
    if (onPath.has(id)) {
      found = path.slice(path.indexOf(id));
      return true;
    }
    if (!candidates.has(id)) return false;

    onPath.add(id);
    path.push(id);

    for (const dep of (deps.get(id) ?? [])) {
      if (dfs(dep)) break;
    }

    if (found === null) {
      path.pop();
      onPath.delete(id);
    }
    return found !== null;
  }

  dfs(start);
  return found ?? [start];
}

// ---- Public API -------------------------------------------------------------

/**
 * Bind a single parsed module.
 * `moduleId` is an opaque key (typically file path).
 * `importedModules` provides already-bound dependency results for cross-module context;
 * symbol resolution across modules is the type checker's responsibility.
 */
export function bindModule(
  ast: AstModule,
  moduleId: string,
  importedModules?: ReadonlyMap<string, BindResult>,
): BindResult {
  void importedModules;

  const scope = new ScopeChain();
  const resolutions = new Map<AstIdentNode, SymbolId>();
  const errors: BindError[] = [];
  const edges: ModuleEdge[] = [];
  const state: BindState = { moduleId, scope, resolutions, errors, edges };

  hoistDecls(ast.decls, state);
  walkDecls(ast.decls, state);

  return {
    symbolTable: scope.snapshot(),
    moduleGraph: { edges, topologicalOrder: [moduleId] },
    resolutions,
    errors,
  };
}

/**
 * Bind multiple modules at once, in dependency order.
 * Detects circular imports before attempting to bind.
 */
export function bindProgram(
  modules: ReadonlyMap<string, AstModule>,
): ReadonlyMap<string, BindResult> {
  // Build dependency graph: moduleId → set of dependency moduleIds it imports
  const deps = new Map<string, Set<string>>();
  for (const [id, ast] of modules) {
    const myDeps = new Set<string>();
    deps.set(id, myDeps);
    for (const decl of ast.decls) {
      if (decl.kind === 'UseDecl') {
        const depId = decl.path.join('.');
        if (modules.has(depId)) myDeps.add(depId);
      }
    }
  }

  // Build reverse adjacency list and in-degrees for Kahn's algorithm
  const adj = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();
  for (const id of modules.keys()) {
    adj.set(id, new Set());
    inDeg.set(id, 0);
  }
  for (const [id, myDeps] of deps) {
    for (const dep of myDeps) {
      adj.get(dep)!.add(id);
      inDeg.set(id, (inDeg.get(id) ?? 0) + 1);
    }
  }

  // Kahn's topological sort
  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }
  const topOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topOrder.push(id);
    for (const dep of (adj.get(id) ?? [])) {
      const newDeg = (inDeg.get(dep) ?? 1) - 1;
      inDeg.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  // Detect cycles: remaining nodes with inDeg > 0
  const inCycle = new Set<string>();
  for (const [id, deg] of inDeg) {
    if (deg > 0) inCycle.add(id);
  }

  const circularErrors: BindError[] = [];
  if (inCycle.size > 0) {
    const visited = new Set<string>();
    for (const startId of inCycle) {
      if (visited.has(startId)) continue;
      const cycle = findOneCycle(startId, deps, inCycle);
      for (const id of cycle) visited.add(id);

      // Find a span from the first use decl that creates the cycle edge
      const firstId = cycle[0]!;
      const nextId = cycle.length > 1 ? cycle[1]! : cycle[0]!;
      const ast = modules.get(firstId);
      let cycleSpan: Span = { file: firstId, startLine: 1, startCol: 0, endLine: 1, endCol: 0 };
      if (ast !== undefined) {
        cycleSpan = ast.span;
        for (const decl of ast.decls) {
          if (decl.kind === 'UseDecl' && decl.path.join('.') === nextId) {
            cycleSpan = decl.span;
            break;
          }
        }
      }

      circularErrors.push({
        kind: 'CircularImport',
        code: 'E0303',
        cycle,
        span: cycleSpan,
        message: `circular import: ${cycle.join(' → ')} → ${cycle[0]}`,
      });
    }
  }

  // Bind modules in topological order, then cyclic ones
  const resultMap = new Map<string, BindResult>();
  const allEdges: ModuleEdge[] = [];

  for (const id of topOrder) {
    const result = bindModule(modules.get(id)!, id, resultMap);
    allEdges.push(...result.moduleGraph.edges);
    resultMap.set(id, result);
  }
  for (const id of inCycle) {
    const result = bindModule(modules.get(id)!, id, resultMap);
    allEdges.push(...result.moduleGraph.edges);
    resultMap.set(id, result);
  }

  // Produce final results with full graph info
  const finalResults = new Map<string, BindResult>();
  for (const [id, result] of resultMap) {
    const moduleErrors: readonly BindError[] = inCycle.has(id)
      ? [...result.errors, ...circularErrors]
      : result.errors;
    finalResults.set(id, {
      ...result,
      moduleGraph: { edges: allEdges, topologicalOrder: topOrder },
      errors: moduleErrors,
    });
  }
  return finalResults;
}
