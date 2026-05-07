import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IonConfig {
  version: '1';
  target: string;
  outDir: string;
  rootDir: string;
  wireFormat?: boolean;
  plugins?: string[];
  include?: string[];
  exclude?: string[];
  sourceMap?: boolean;
  reactNative?: { entryComponent?: string | null };
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

/**
 * Read and validate an ion.config.json file.
 * Returns the parsed config or { error } on any failure.
 * Does NOT resolve paths — callers resolve rootDir/outDir relative to configPath's directory.
 */
export async function loadConfig(configPath: string): Promise<IonConfig | { error: string }> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `cannot read config file '${configPath}': ${msg}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `invalid JSON in '${configPath}': ${msg}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: `'${configPath}' must be a JSON object` };
  }

  const obj = parsed as Record<string, unknown>;

  if (obj['version'] !== '1') {
    return { error: `'${configPath}': "version" must be "1"` };
  }
  if (typeof obj['target'] !== 'string' || obj['target'].length === 0) {
    return { error: `'${configPath}': missing or empty required field "target"` };
  }
  if (typeof obj['outDir'] !== 'string' || obj['outDir'].length === 0) {
    return { error: `'${configPath}': missing or empty required field "outDir"` };
  }
  if (typeof obj['rootDir'] !== 'string' || obj['rootDir'].length === 0) {
    return { error: `'${configPath}': missing or empty required field "rootDir"` };
  }

  const config: IonConfig = {
    version: '1',
    target: obj['target'],
    outDir: obj['outDir'],
    rootDir: obj['rootDir'],
  };

  if (obj['wireFormat'] !== undefined) {
    if (typeof obj['wireFormat'] !== 'boolean') {
      return { error: `'${configPath}': "wireFormat" must be a boolean` };
    }
    config.wireFormat = obj['wireFormat'];
  }

  if (obj['plugins'] !== undefined) {
    if (!Array.isArray(obj['plugins']) || obj['plugins'].some(p => typeof p !== 'string')) {
      return { error: `'${configPath}': "plugins" must be an array of strings` };
    }
    config.plugins = obj['plugins'] as string[];
  }

  if (obj['include'] !== undefined) {
    if (!Array.isArray(obj['include']) || obj['include'].some(p => typeof p !== 'string')) {
      return { error: `'${configPath}': "include" must be an array of strings` };
    }
    config.include = obj['include'] as string[];
  }

  if (obj['exclude'] !== undefined) {
    if (!Array.isArray(obj['exclude']) || obj['exclude'].some(p => typeof p !== 'string')) {
      return { error: `'${configPath}': "exclude" must be an array of strings` };
    }
    config.exclude = obj['exclude'] as string[];
  }

  if (obj['sourceMap'] !== undefined) {
    if (typeof obj['sourceMap'] !== 'boolean') {
      return { error: `'${configPath}': "sourceMap" must be a boolean` };
    }
    config.sourceMap = obj['sourceMap'];
  }

  if (obj['reactNative'] !== undefined) {
    if (typeof obj['reactNative'] !== 'object' || obj['reactNative'] === null || Array.isArray(obj['reactNative'])) {
      return { error: `'${configPath}': "reactNative" must be an object` };
    }
    const rn = obj['reactNative'] as Record<string, unknown>;
    if (rn['entryComponent'] !== undefined) {
      if (typeof rn['entryComponent'] !== 'string' && rn['entryComponent'] !== null) {
        return { error: `'${configPath}': "reactNative.entryComponent" must be a string or null` };
      }
      config.reactNative = { entryComponent: rn['entryComponent'] as string | null };
    } else {
      config.reactNative = {};
    }
  }

  return config;
}
