import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveServerPath } from '../../server-path';

describe('resolveServerPath', () => {
  it('returns default path one level above extension root', () => {
    const extensionPath = '/home/user/.vscode/extensions/ion-lang.ion-vscode-0.1.0';
    const result = resolveServerPath(extensionPath);
    expect(result).toBe(path.join(extensionPath, '..', 'dist', 'lsp', 'server.js'));
  });

  it('returns trimmed override when provided', () => {
    const override = '/custom/path/to/server.js';
    const result = resolveServerPath('/ext/path', override);
    expect(result).toBe(override);
  });

  it('ignores whitespace-only override', () => {
    const extensionPath = '/ext/path';
    const result = resolveServerPath(extensionPath, '   ');
    expect(result).toBe(path.join(extensionPath, '..', 'dist', 'lsp', 'server.js'));
  });

  it('ignores empty-string override', () => {
    const extensionPath = '/ext/path';
    const result = resolveServerPath(extensionPath, '');
    expect(result).toBe(path.join(extensionPath, '..', 'dist', 'lsp', 'server.js'));
  });

  it('trims leading/trailing whitespace from non-empty override', () => {
    const result = resolveServerPath('/ext/path', '  /trimmed/server.js  ');
    expect(result).toBe('/trimmed/server.js');
  });
});
