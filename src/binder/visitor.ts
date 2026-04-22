import type {
  AstModule,
  AstDeclNode,
  AstExprNode,
  AstPatternNode,
  AstMatchArm,
} from '../ast/nodes.js';
import type { Span, SymbolId } from '../types.js';
import type { SymbolInfo, BinderError } from './types.js';
import { Scope } from './scope.js';

/** Callbacks the visitor fires as it walks the AST. Internal to the binder. */
export interface EmitCallbacks {
  defineSymbol(info: SymbolInfo): void;
  resolveIdent(span: Span, id: SymbolId): void;
  recordError(err: BinderError): void;
  recordImport(path: string): void;
  nextId(): SymbolId;
}

/** Visits a module AST, firing callbacks for every symbol definition and ident resolution. */
export function visitModule(ast: AstModule, emit: EmitCallbacks): void {
  const moduleScope = new Scope(null);
  hoistDecls(ast.decls, moduleScope, emit);
  for (const decl of ast.decls) {
    resolveDecl(decl, moduleScope, emit);
  }
}

// ---------------------------------------------------------------------------
// Hoist pass — registers top-level names before visiting bodies
// ---------------------------------------------------------------------------

function hoistDecls(decls: readonly AstDeclNode[], scope: Scope, emit: EmitCallbacks): void {
  for (const decl of decls) {
    hoistDecl(decl, scope, emit);
  }
}

function hoistDecl(decl: AstDeclNode, scope: Scope, emit: EmitCallbacks): void {
  switch (decl.kind) {
    case 'FnDecl': {
      const id = emit.nextId();
      const err = scope.define(decl.name, id, decl.span);
      if (err !== null) { emit.recordError(err); return; }
      emit.defineSymbol({
        id,
        name: decl.name,
        kind: 'fn',
        declSpan: decl.span,
        typeAnnotation: decl.returnType,
        pub: decl.pub,
      });
      break;
    }
    case 'LetDecl': {
      const id = emit.nextId();
      const err = scope.define(decl.name, id, decl.span);
      if (err !== null) { emit.recordError(err); return; }
      emit.defineSymbol({
        id,
        name: decl.name,
        kind: 'let',
        declSpan: decl.span,
        typeAnnotation: decl.type_,
        pub: decl.pub,
      });
      break;
    }
    case 'DataDecl': {
      const id = emit.nextId();
      const err = scope.define(decl.name, id, decl.span);
      if (err !== null) { emit.recordError(err); return; }
      emit.defineSymbol({
        id,
        name: decl.name,
        kind: 'data',
        declSpan: decl.span,
        typeAnnotation: null,
        pub: decl.pub,
      });
      for (const variant of decl.variants) {
        const vid = emit.nextId();
        const verr = scope.define(variant.name, vid, variant.span);
        if (verr !== null) { emit.recordError(verr); continue; }
        emit.defineSymbol({
          id: vid,
          name: variant.name,
          kind: 'data',
          declSpan: variant.span,
          typeAnnotation: null,
          pub: decl.pub,
        });
      }
      break;
    }
    case 'TypeAliasDecl': {
      const id = emit.nextId();
      const err = scope.define(decl.name, id, decl.span);
      if (err !== null) { emit.recordError(err); return; }
      emit.defineSymbol({
        id,
        name: decl.name,
        kind: 'type-alias',
        declSpan: decl.span,
        typeAnnotation: decl.type_,
        pub: decl.pub,
      });
      break;
    }
    case 'ExternDecl': {
      const id = emit.nextId();
      const err = scope.define(decl.name, id, decl.span);
      if (err !== null) { emit.recordError(err); return; }
      emit.defineSymbol({
        id,
        name: decl.name,
        kind: 'extern',
        declSpan: decl.span,
        typeAnnotation: decl.returnType,
        pub: decl.pub,
      });
      break;
    }
    case 'ModuleDecl': {
      const id = emit.nextId();
      const err = scope.define(decl.name, id, decl.span);
      if (err !== null) { emit.recordError(err); return; }
      emit.defineSymbol({
        id,
        name: decl.name,
        kind: 'module',
        declSpan: decl.span,
        typeAnnotation: null,
        pub: decl.pub,
      });
      break;
    }
    case 'UseDecl':
      // UseDecl is processed in the resolve pass, not the hoist pass
      break;
  }
}

// ---------------------------------------------------------------------------
// Resolve pass — walks declaration bodies and expression trees
// ---------------------------------------------------------------------------

function resolveDecl(decl: AstDeclNode, scope: Scope, emit: EmitCallbacks): void {
  switch (decl.kind) {
    case 'FnDecl': {
      const fnScope = scope.child();
      for (const tp of decl.typeParams) {
        const id = emit.nextId();
        const err = fnScope.define(tp, id, decl.span);
        if (err !== null) { emit.recordError(err); continue; }
        emit.defineSymbol({ id, name: tp, kind: 'type-param', declSpan: decl.span, typeAnnotation: null, pub: false });
      }
      for (const param of decl.params) {
        const id = emit.nextId();
        const err = fnScope.define(param.name, id, param.span);
        if (err !== null) { emit.recordError(err); continue; }
        emit.defineSymbol({ id, name: param.name, kind: 'param', declSpan: param.span, typeAnnotation: param.type_, pub: false });
      }
      resolveExpr(decl.body, fnScope, emit);
      break;
    }
    case 'LetDecl':
      resolveExpr(decl.value, scope, emit);
      break;

    case 'DataDecl':
    case 'TypeAliasDecl':
    case 'ExternDecl':
      // No expression body to resolve
      break;

    case 'ModuleDecl': {
      const innerScope = scope.child();
      hoistDecls(decl.decls, innerScope, emit);
      for (const inner of decl.decls) {
        resolveDecl(inner, innerScope, emit);
      }
      break;
    }
    case 'UseDecl': {
      const importedPath = decl.path.join('.');
      emit.recordImport(importedPath);
      if (decl.items !== null) {
        for (const item of decl.items) {
          const id = emit.nextId();
          const err = scope.define(item, id, decl.span);
          if (err !== null) { emit.recordError(err); continue; }
          emit.defineSymbol({ id, name: item, kind: 'import', declSpan: decl.span, typeAnnotation: null, pub: false });
        }
      } else {
        const alias = decl.path[decl.path.length - 1];
        if (alias !== undefined) {
          const id = emit.nextId();
          const err = scope.define(alias, id, decl.span);
          if (err !== null) { emit.recordError(err); }
          else emit.defineSymbol({ id, name: alias, kind: 'import', declSpan: decl.span, typeAnnotation: null, pub: false });
        }
      }
      break;
    }
  }
}

function resolveExpr(expr: AstExprNode, scope: Scope, emit: EmitCallbacks): void {
  switch (expr.kind) {
    case 'LiteralInt':
    case 'LiteralFloat':
    case 'LiteralBool':
    case 'LiteralNull':
      break;

    case 'StringLit':
      for (const part of expr.parts) {
        if (part.kind === 'InterpPart') resolveExpr(part.expr, scope, emit);
      }
      break;

    case 'Ident': {
      const id = scope.lookup(expr.name);
      if (id === null) {
        emit.recordError({ kind: 'UndefinedName', message: `'${expr.name}' is not defined`, span: expr.span });
      } else {
        emit.resolveIdent(expr.span, id);
      }
      break;
    }

    case 'BinopExpr':
      resolveExpr(expr.left, scope, emit);
      resolveExpr(expr.right, scope, emit);
      break;

    case 'UnaryExpr':
      resolveExpr(expr.operand, scope, emit);
      break;

    case 'CallExpr':
      resolveExpr(expr.callee, scope, emit);
      for (const arg of expr.args) resolveExpr(arg.value, scope, emit);
      break;

    case 'LambdaExpr': {
      const lambdaScope = scope.child();
      for (const param of expr.params) {
        const id = emit.nextId();
        const err = lambdaScope.define(param.name, id, param.span);
        if (err !== null) { emit.recordError(err); continue; }
        emit.defineSymbol({ id, name: param.name, kind: 'param', declSpan: param.span, typeAnnotation: param.type_, pub: false });
      }
      resolveExpr(expr.body, lambdaScope, emit);
      break;
    }

    case 'PipelineExpr':
      resolveExpr(expr.left, scope, emit);
      resolveExpr(expr.right, scope, emit);
      break;

    case 'IfElseExpr':
      resolveExpr(expr.cond, scope, emit);
      resolveExpr(expr.then, scope, emit);
      resolveExpr(expr.else_, scope, emit);
      break;

    case 'MatchExpr':
      resolveExpr(expr.scrutinee, scope, emit);
      for (const arm of expr.arms) resolveArm(arm, scope, emit);
      break;

    case 'LetExpr': {
      resolveExpr(expr.value, scope, emit);
      const letScope = scope.child();
      const id = emit.nextId();
      const err = letScope.define(expr.name, id, expr.span);
      if (err !== null) { emit.recordError(err); }
      else emit.defineSymbol({ id, name: expr.name, kind: 'let', declSpan: expr.span, typeAnnotation: expr.type_, pub: false });
      resolveExpr(expr.body, letScope, emit);
      break;
    }

    case 'AccessorExpr':
      resolveExpr(expr.receiver, scope, emit);
      break;

    case 'PropagateExpr':
      resolveExpr(expr.inner, scope, emit);
      break;
  }
}

function resolveArm(arm: AstMatchArm, scope: Scope, emit: EmitCallbacks): void {
  const armScope = scope.child();
  bindPattern(arm.pattern, armScope, emit);
  if (arm.guard !== null) resolveExpr(arm.guard, armScope, emit);
  resolveExpr(arm.body, armScope, emit);
}

function bindPattern(pat: AstPatternNode, scope: Scope, emit: EmitCallbacks): void {
  switch (pat.kind) {
    case 'WildcardPat':
    case 'LiteralPat':
      break;

    case 'IdentPat': {
      const id = emit.nextId();
      const err = scope.define(pat.name, id, pat.span);
      if (err !== null) { emit.recordError(err); return; }
      emit.defineSymbol({ id, name: pat.name, kind: 'pattern-var', declSpan: pat.span, typeAnnotation: null, pub: false });
      break;
    }

    case 'ConstructorPat': {
      // Resolve the constructor tag as a value in the current scope (walks parent chain)
      const id = scope.lookup(pat.tag);
      if (id === null) {
        emit.recordError({ kind: 'UndefinedName', message: `Constructor '${pat.tag}' is not defined`, span: pat.span });
      }
      for (const field of pat.fields) bindPattern(field, scope, emit);
      break;
    }

    case 'TuplePat':
      for (const elem of pat.elements) bindPattern(elem, scope, emit);
      break;
  }
}
