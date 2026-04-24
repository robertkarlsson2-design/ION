import { fileURLToPath } from 'node:url';
import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeResult,
} from 'vscode-languageserver/node.js';
import { TextDocuments } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { compileDocument, type CompiledDoc } from './pipeline.js';
import { findTokenAtPosition, ionSpanToLocation, ionSpanToRange } from './span-utils.js';
import { formatIonType } from './type-format.js';
import { spanKey } from '../checker/index.js';
import { TokenKind } from '../lexer/index.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const cache = new Map<string, CompiledDoc>();

function recompile(uri: string, text: string): void {
  const filePath = fileURLToPath(uri);
  const doc = compileDocument(filePath, text);
  cache.set(uri, doc);
  connection.sendDiagnostics({ uri, diagnostics: doc.diagnostics });
}

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    hoverProvider: true,
    definitionProvider: true,
  },
}));

documents.onDidOpen(e => recompile(e.document.uri, e.document.getText()));
documents.onDidChangeContent(e => recompile(e.document.uri, e.document.getText()));
documents.onDidClose(e => {
  cache.delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

connection.onHover(params => {
  const uri = params.textDocument.uri;
  const filePath = fileURLToPath(uri);
  const doc = cache.get(uri);
  if (doc === undefined) return null;

  const tok = findTokenAtPosition(doc.tokens, filePath, params.position);
  if (tok === null) return null;

  if (doc.checkResult !== null) {
    const key = spanKey(tok.span);
    const type = doc.checkResult.typeMap.get(key);
    if (type !== undefined) {
      return {
        contents: { kind: 'markdown', value: `\`${formatIonType(type)}\`` },
        range: ionSpanToRange(tok.span),
      };
    }
  }

  return null;
});

connection.onDefinition(params => {
  const uri = params.textDocument.uri;
  const filePath = fileURLToPath(uri);
  const doc = cache.get(uri);
  if (doc === undefined || doc.bindResult === null) return null;

  const tok = findTokenAtPosition(doc.tokens, filePath, params.position);
  if (tok === null || tok.kind !== TokenKind.IDENT) return null;

  const key = spanKey(tok.span);
  const symbolId = doc.bindResult.resolutionMap.get(key);
  if (symbolId === undefined) return null;

  const info = doc.bindResult.symbolTable.symbols.get(symbolId);
  if (info === undefined) return null;

  return ionSpanToLocation(info.span);
});

documents.listen(connection);
connection.listen();
