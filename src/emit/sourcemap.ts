/** One token-level mapping from generated output back to an Ion source location. */
export interface SourceMapping {
  /** 0-based line in the generated output file. */
  generatedLine: number;
  /** 0-based column in the generated output file. */
  generatedCol: number;
  /** Absolute path to the originating .ion source file. */
  sourceFile: string;
  /** 0-based source line (ECMA v3 uses 0-based; Span.startLine is 1-based). */
  sourceLine: number;
  /** 0-based source column. */
  sourceCol: number;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode a signed integer as a Base64 VLQ string (ECMA Source Map v3 format). */
function encodeVlq(n: number): string {
  let vlq = n < 0 ? ((-n) << 1) | 1 : n << 1;
  let result = '';
  do {
    let digit = vlq & 0x1f;
    vlq >>>= 5;
    if (vlq > 0) digit |= 0x20;
    result += BASE64[digit];
  } while (vlq > 0);
  return result;
}

/** Accumulates source mappings and serialises to an ECMA Source Map v3 JSON string. */
export class SourceMapBuilder {
  private readonly _mappings: SourceMapping[] = [];

  /** Record one mapping segment. */
  addMapping(m: SourceMapping): void {
    this._mappings.push(m);
  }

  /**
   * Produce an ECMA Source Map v3 JSON string.
   * @param opts.file - The output file name (e.g. "users.js").
   * @param opts.sourceContents - Map from ion file path to raw source text, for inline sourcesContent.
   */
  toJSON(opts: { file: string; sourceContents: Map<string, string> }): string {
    // Collect unique source files in first-seen order.
    const sourceIndex = new Map<string, number>();
    for (const m of this._mappings) {
      if (!sourceIndex.has(m.sourceFile)) {
        sourceIndex.set(m.sourceFile, sourceIndex.size);
      }
    }

    // Group mappings by generated line, sorted by column.
    const byLine = new Map<number, SourceMapping[]>();
    for (const m of this._mappings) {
      let bucket = byLine.get(m.generatedLine);
      if (bucket === undefined) {
        bucket = [];
        byLine.set(m.generatedLine, bucket);
      }
      bucket.push(m);
    }
    for (const segs of byLine.values()) {
      segs.sort((a, b) => a.generatedCol - b.generatedCol);
    }

    const maxLine = this._mappings.reduce((max, m) => Math.max(max, m.generatedLine), -1);

    // Build VLQ-encoded mappings string with running delta state.
    let prevSrcIdx = 0;
    let prevSrcLine = 0;
    let prevSrcCol = 0;
    const lineStrings: string[] = [];

    for (let line = 0; line <= maxLine; line++) {
      const segs = byLine.get(line) ?? [];
      let prevGenCol = 0;
      const segStrings: string[] = [];

      for (const seg of segs) {
        const si = sourceIndex.get(seg.sourceFile) ?? 0;
        const encoded =
          encodeVlq(seg.generatedCol - prevGenCol) +
          encodeVlq(si - prevSrcIdx) +
          encodeVlq(seg.sourceLine - prevSrcLine) +
          encodeVlq(seg.sourceCol - prevSrcCol);
        prevGenCol = seg.generatedCol;
        prevSrcIdx = si;
        prevSrcLine = seg.sourceLine;
        prevSrcCol = seg.sourceCol;
        segStrings.push(encoded);
      }

      lineStrings.push(segStrings.join(','));
    }

    const sources = [...sourceIndex.keys()];
    const sourcesContent: (string | null)[] = sources.map(s => {
      const text = opts.sourceContents.get(s);
      return text !== undefined ? text : null;
    });

    return JSON.stringify({
      version: 3,
      file: opts.file,
      sources,
      sourcesContent,
      names: [],
      mappings: lineStrings.join(';'),
    });
  }
}
