import type * as vscode from 'vscode';
import { startLspClient, stopLspClient } from './lsp-client';
import { registerCommands } from './commands';
import { registerStatusBar } from './status-bar';

/** Called by VS Code when the extension activates on an Ion file. */
export function activate(context: vscode.ExtensionContext): void {
  startLspClient(context);
  registerCommands(context);
  registerStatusBar(context);
}

/** Called by VS Code on extension deactivation; stops the LSP client. */
export function deactivate(): Promise<void> | undefined {
  return stopLspClient();
}
