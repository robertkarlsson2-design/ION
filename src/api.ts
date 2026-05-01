import { lex } from './lexer/index.js';
import { parseModule, ParseError } from './parser/declarations.js';
import { buildModule } from './ast/builder.js';
import { bindModule } from './binder/index.js';
import { checkModule } from './checker/index.js';
import { desugarModule } from './desugar/index.js';
import { decodeModule } from './wire/decoder.js';
import { deserializeModule, IonIRSerdeError } from './ir/serde.js';
import { getPreludeDecls } from './prelude/index.js';
import type { Span } from './types.js';
import type { IonIRModule } from './ir/nodes.js';

export type EmitFn = (module: IonIRModule) => string;

export interface CompileError {
  code: string;
  message: string;
  span: Span;
  suggestion: string | null;
}

export type CompileSourceResult =
  | { ok: true; output: string }
  | { ok: false; errors: CompileError[] };

function detectFormat(src: string): 'source' | 'wire' | 'json' {
  if (src.startsWith('I1\n') || src === 'I1') return 'wire';
  if (src.trimStart().startsWith('{') && src.includes('"ionir":')) return 'json';
  return 'source';
}

function nullSpan(ionPath: string): Span {
  return { file: ionPath, startLine: 1, startCol: 0, endLine: 1, endCol: 0 };
}

export function compileIonSource(
  src: string,
  ionPath: string,
  emit: EmitFn,
): CompileSourceResult {
  const fmt = detectFormat(src);

  if (fmt === 'wire') {
    const result = decodeModule(src);
    if ('error' in result) {
      return {
        ok: false,
        errors: [{
          code: 'BD006',
          message: `wire decode error: ${result.error}`,
          span: nullSpan(ionPath),
          suggestion: 'check that the file is a valid wire-format IonIR module',
        }],
      };
    }
    try {
      const output = emit(result);
      return { ok: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        errors: [{ code: 'BD005', message: `emit error: ${message}`, span: nullSpan(ionPath), suggestion: null }],
      };
    }
  }

  if (fmt === 'json') {
    let ir: IonIRModule;
    try {
      ir = deserializeModule(src);
    } catch (err) {
      const message = err instanceof IonIRSerdeError || err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        errors: [{
          code: 'BD006',
          message: `IR deserialize error: ${message}`,
          span: nullSpan(ionPath),
          suggestion: 'check that the file contains a valid IonIR JSON module',
        }],
      };
    }
    try {
      const output = emit(ir);
      return { ok: true, output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        errors: [{ code: 'BD005', message: `emit error: ${message}`, span: nullSpan(ionPath), suggestion: null }],
      };
    }
  }

  // Source format
  const tokens = lex(src, ionPath);

  let cst;
  try {
    cst = parseModule(tokens);
  } catch (err) {
    if (err instanceof ParseError) {
      return {
        ok: false,
        errors: [{
          code: 'BD002',
          message: err.message,
          span: err.span,
          suggestion: err.suggestion,
        }],
      };
    }
    throw err;
  }

  const rawAst = buildModule(cst);
  const ast = { ...rawAst, decls: [...getPreludeDecls(), ...rawAst.decls] };

  const bindResult = bindModule(ast, ionPath);
  const errors: CompileError[] = bindResult.errors.map(e => {
    if (e.kind === 'UndefinedName') {
      return { code: 'BD003', message: e.message, span: e.span, suggestion: 'check the spelling or add a declaration' };
    }
    if (e.kind === 'DuplicateBinding') {
      return { code: 'BD003', message: e.message, span: e.span, suggestion: 'rename one of the conflicting bindings' };
    }
    return { code: 'BD003', message: e.message, span: e.span, suggestion: 'break the import cycle by extracting shared code into a common module' };
  });

  const checkResult = checkModule(ast, bindResult, ionPath);
  for (const e of checkResult.errors) {
    errors.push({ code: 'BD004', message: e.message, span: e.span, suggestion: e.suggestion });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  try {
    const ir = desugarModule(ast, bindResult, checkResult, ionPath, '0.0.0');
    const output = emit(ir);
    return { ok: true, output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [{ code: 'BD005', message: `emit error: ${message}`, span: nullSpan(ionPath), suggestion: null }],
    };
  }
}
