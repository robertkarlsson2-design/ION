import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { resolveServerPath } from './server-path';

let client: LanguageClient | undefined;

/** Starts the Ion LSP client and registers it with the extension context. */
export function startLspClient(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('ion');
  const override = config.get<string>('serverPath', '');
  const serverPath = resolveServerPath(context.extensionPath, override);

  const serverOptions: ServerOptions = {
    run: { module: serverPath, transport: TransportKind.stdio },
    debug: { module: serverPath, transport: TransportKind.stdio },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'ion' }],
  };

  client = new LanguageClient('ion', 'Ion Language Server', serverOptions, clientOptions);
  context.subscriptions.push(client);
  void client.start();
}

/** Stops the LSP client gracefully. Called on extension deactivation. */
export function stopLspClient(): Promise<void> | undefined {
  if (client !== undefined) {
    return client.stop();
  }
  return undefined;
}
