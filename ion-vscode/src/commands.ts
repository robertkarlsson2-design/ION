import * as vscode from 'vscode';

/** Escapes a file path for safe embedding in a POSIX shell command. */
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function activeFilePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath;
}

/** Registers all Ion command palette commands on the extension context. */
export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ion.build', () => {
      const root = workspaceRoot();
      if (root === undefined) return;
      const terminal = vscode.window.createTerminal({ name: 'Ion Build', cwd: root });
      terminal.show();
      terminal.sendText('npx ion build');
    }),

    vscode.commands.registerCommand('ion.check', () => {
      const root = workspaceRoot();
      if (root === undefined) return;
      const file = activeFilePath();
      const terminal = vscode.window.createTerminal({ name: 'Ion Check', cwd: root });
      terminal.show();
      if (file !== undefined && file.endsWith('.ion')) {
        terminal.sendText(`npx ion check ${shellQuote(file)}`);
      } else {
        terminal.sendText('npx ion check --all');
      }
    }),

    vscode.commands.registerCommand('ion.format', () => {
      const root = workspaceRoot();
      if (root === undefined) return;
      const file = activeFilePath();
      if (file === undefined) return;
      const flag = file.endsWith('.ionw') ? '--wire' : '--pretty';
      const terminal = vscode.window.createTerminal({ name: 'Ion Format', cwd: root });
      terminal.show();
      terminal.sendText(`npx ion fmt ${flag} ${shellQuote(file)}`);
    }),

    vscode.commands.registerCommand('ion.ingest', async () => {
      const root = workspaceRoot();
      if (root === undefined) return;
      const file = activeFilePath();
      if (file === undefined) return;

      const skill = await vscode.window.showQuickPick(
        ['javascript', 'typescript', 'java', 'rust'],
        { placeHolder: 'Select target skill (default: javascript)' },
      );
      if (skill === undefined) return;
      const selectedSkill = skill;

      const terminal = vscode.window.createTerminal({ name: 'Ion Ingest', cwd: root });
      terminal.show();
      terminal.sendText(`npx ion ingest ${shellQuote(file)} --skill ${selectedSkill}`);
    }),
  );
}
