import {
  type Diagnostic,
  DiagnosticSeverity,
  DiagnosticRelatedInformation,
} from 'vscode-languageserver';
import { lex, type Token } from '../lexer/index.js';
import { parseModule } from '../parser/declarations.js';
import { ParseError } from '../parser/errors.js';
import { buildModule } from '../ast/builder.js';
import { bindModule, type BindResult, type BindError } from '../binder/index.js';
import { checkModule, type CheckResult, type CheckError, spanKey } from '../checker/index.js';
import { ionSpanToRange, ionSpanToLocation } from './span-utils.js';
import type { Span } from '../types.js';

export interface CompiledDoc {
  readonly tokens: Token[];
  readonly bindResult: BindResult | null;
  readonly checkResult: CheckResult | null;
  readonly diagnostics: Diagnostic[];
}

function bindErrorCode(e: BindError): string {
  switch (e.kind) {
    case 'UndefinedName': return 'B0001';
    case 'DuplicateBinding': return 'B0002';
    case 'CircularImport': return 'B0003';
  }
}

function spanToDiagnostic(
  message: string,
  code: string,
  span: Span,
  relatedMessage?: string,
  relatedSpan?: Span,
): Diagnostic {
  const diag: Diagnostic = {
    severity: DiagnosticSeverity.Error,
    range: ionSpanToRange(span),
    message,
    code,
    source: 'ion',
  };
  if (relatedMessage !== undefined && relatedSpan !== undefined) {
    const info: DiagnosticRelatedInformation = {
      location: ionSpanToLocation(relatedSpan),
      message: relatedMessage,
    };
    diag.relatedInformation = [info];
  }
  return diag;
}

function bindErrorToDiagnostic(e: BindError): Diagnostic {
  if (e.kind === 'DuplicateBinding') {
    return spanToDiagnostic(
      e.message,
      bindErrorCode(e),
      e.span,
      'Previous declaration here',
      e.previousSpan,
    );
  }
  return spanToDiagnostic(e.message, bindErrorCode(e), e.span);
}

function checkErrorToDiagnostic(e: CheckError): Diagnostic {
  const suggestion = e.suggestion;
  return spanToDiagnostic(
    e.message,
    e.code,
    e.span,
    suggestion.length > 0 ? suggestion : undefined,
    suggestion.length > 0 ? e.span : undefined,
  );
}

/** Run the full ION compile pipeline and return diagnostics + analysis results. */
export function compileDocument(filePath: string, source: string): CompiledDoc {
  const tokens = lex(source, filePath);

  let cst;
  try {
    cst = parseModule(tokens);
  } catch (err) {
    if (err instanceof ParseError) {
      const diag = spanToDiagnostic(
        err.message,
        err.code,
        err.span,
        err.suggestion.length > 0 ? err.suggestion : undefined,
        err.suggestion.length > 0 ? err.span : undefined,
      );
      return { tokens, bindResult: null, checkResult: null, diagnostics: [diag] };
    }
    throw err;
  }

  const ast = buildModule(cst);
  const bindResult = bindModule(ast, filePath);
  const checkResult = checkModule(ast, bindResult, filePath);

  const diagnostics: Diagnostic[] = [
    ...bindResult.errors.map(bindErrorToDiagnostic),
    ...checkResult.errors.map(checkErrorToDiagnostic),
  ];

  return { tokens, bindResult, checkResult, diagnostics };
}
