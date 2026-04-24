// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SourceMapOptions {
  sourceFile: string;
  outputFile: string;
  sourceContent: string;
}

// ---------------------------------------------------------------------------
// Stub implementation
// ---------------------------------------------------------------------------

/**
 * Returns a valid V3 source map with empty mappings.
 * TASK-024 will replace this body with real VLQ encoding via @parcel/source-map.
 */
export function generateSourceMap(opts: SourceMapOptions): string {
  return JSON.stringify({
    version: 3,
    file: opts.outputFile,
    sourceRoot: '',
    sources: [opts.sourceFile],
    sourcesContent: [opts.sourceContent],
    names: [],
    mappings: '',
  });
}
