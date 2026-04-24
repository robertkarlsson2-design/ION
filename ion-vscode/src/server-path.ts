import path from 'node:path';

/**
 * Resolves the absolute path to the Ion LSP server JS module.
 * @param extensionPath Absolute path to the extension root directory.
 * @param override Optional user-configured server path override.
 */
export function resolveServerPath(extensionPath: string, override?: string): string {
  if (override !== undefined && override.trim() !== '') {
    return override.trim();
  }
  return path.join(extensionPath, '..', 'dist', 'lsp', 'server.js');
}
