import type { AstModule } from '../ast/nodes.js';
import { makeSymbolId } from '../types.js';
import type { Span, SymbolId } from '../types.js';
import type { SymbolInfo, BinderError, ModuleBindResult, ProgramBindResult } from './types.js';
import { visitModule } from './visitor.js';
import { buildGraph, topoSort } from './graph.js';

export type { SymbolKind, SymbolInfo, BinderError, ModuleBindResult, ProgramBindResult } from './types.js';

/** Resolves all names in a single module AST, returning the full bind result. */
export function bindModule(ast: AstModule, filePath: string): ModuleBindResult {
  const symbols = new Map<SymbolId, SymbolInfo>();
  const resolution = new Map<string, SymbolId>();
  const exports = new Map<string, SymbolId>();
  const errors: BinderError[] = [];
  const importedPaths: string[] = [];
  let counter = 0;

  visitModule(ast, {
    defineSymbol(info: SymbolInfo): void {
      symbols.set(info.id, info);
      if (info.pub) exports.set(info.name, info.id);
    },
    resolveIdent(span: Span, id: SymbolId): void {
      resolution.set(`${span.file}:${span.startLine}:${span.startCol}`, id);
    },
    recordError(err: BinderError): void {
      errors.push(err);
    },
    recordImport(path: string): void {
      importedPaths.push(path);
    },
    nextId(): SymbolId {
      return makeSymbolId(`${filePath}#${counter++}`);
    },
  });

  return { symbols, resolution, exports, importedPaths, errors };
}

/**
 * Binds all modules in a program, building the dependency graph and computing
 * the topological compilation order.
 */
export function bindProgram(
  modules: ReadonlyMap<string, AstModule>,
): ProgramBindResult {
  const moduleResults = new Map<string, ModuleBindResult>();
  for (const [filePath, ast] of modules) {
    moduleResults.set(filePath, bindModule(ast, filePath));
  }

  const graph = buildGraph(moduleResults);
  const { order, cycles } = topoSort(graph);

  const programErrors: BinderError[] = [];
  for (const cycleGroup of cycles) {
    for (const filePath of cycleGroup) {
      // Non-null: filePath comes from graph keys which are keys of modules
      const ast = modules.get(filePath)!;
      programErrors.push({
        kind: 'CircularImport',
        message: `Circular import detected involving module '${filePath}'`,
        span: ast.span,
      });
    }
  }

  return { modules: moduleResults, order, errors: programErrors };
}
