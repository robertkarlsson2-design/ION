import * as vscode from 'vscode';
import { readTargetFromConfig } from './config-reader';

let statusBarItem: vscode.StatusBarItem | undefined;

async function updateStatusBar(): Promise<void> {
  if (statusBarItem === undefined) return;

  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || !editor.document.fileName.endsWith('.ion')) {
    statusBarItem.hide();
    return;
  }

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root === undefined) {
    statusBarItem.hide();
    return;
  }

  const target = await readTargetFromConfig(root);
  if (target !== null) {
    // Strip VS Code icon sequences ($(...)) to prevent icon injection from untrusted workspace config.
    const safeTarget = target.replace(/\$\([^)]*\)/g, '');
    statusBarItem.text = `Ion: ${safeTarget}`;
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

/** Creates the Ion target status bar item and wires up update triggers. */
export function registerStatusBar(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  void updateStatusBar();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => void updateStatusBar()),
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/ion.config.json');
  context.subscriptions.push(watcher);
  watcher.onDidChange(() => void updateStatusBar());
  watcher.onDidCreate(() => void updateStatusBar());
  watcher.onDidDelete(() => void updateStatusBar());
}
