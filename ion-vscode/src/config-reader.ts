import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Reads the `target` field from `ion.config.json` in the given workspace root.
 * Returns the target string, or null if the file is missing or malformed.
 */
export async function readTargetFromConfig(workspaceRoot: string): Promise<string | null> {
  try {
    const configPath = path.join(workspaceRoot, 'ion.config.json');
    const raw = await readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'target' in parsed &&
      typeof (parsed as Record<string, unknown>)['target'] === 'string'
    ) {
      return (parsed as Record<string, unknown>)['target'] as string;
    }
    return null;
  } catch {
    return null;
  }
}
