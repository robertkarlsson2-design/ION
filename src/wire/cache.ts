/** Minimal Anthropic prompt-cache control shape — no SDK dependency required. */
export interface WireCacheControl {
  readonly type: 'ephemeral';
}

export interface WireTextBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: WireCacheControl;
}

/** Low-level result of splitting a wire string at the stable/dynamic boundary. */
export interface WireSplit {
  readonly stablePrefix: string;
  readonly dynamicSuffix: string;
}

/** Thrown when wire text cannot be split (e.g. missing I1 header). */
export class WireCacheError extends Error {
  override readonly name = 'WireCacheError' as const;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Splits a wire-format string into stable prefix (I1+M+S+T+X) and
 * dynamic suffix (D+F). Input must end with '\n'.
 * Throws WireCacheError on malformed input (not starting with "I1").
 */
export function splitWire(wire: string): WireSplit {
  if (!wire.startsWith('I1\n')) {
    throw new WireCacheError(
      `Wire string must start with "I1\\n"; got: ${JSON.stringify(wire.slice(0, 20))}`,
    );
  }

  const lines = wire.split('\n').filter(l => l.length > 0);

  let firstDynamicIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const ch = lines[i]![0];
    if (ch === 'D' || ch === 'F') {
      firstDynamicIdx = i;
      break;
    }
  }

  if (firstDynamicIdx === -1) {
    return { stablePrefix: lines.join('\n') + '\n', dynamicSuffix: '' };
  }

  const stableLines = lines.slice(0, firstDynamicIdx);
  const dynamicLines = lines.slice(firstDynamicIdx);

  return {
    stablePrefix: stableLines.join('\n') + '\n',
    dynamicSuffix: dynamicLines.join('\n') + '\n',
  };
}

/**
 * Returns 1 or 2 Anthropic text content blocks.
 * Block 0: stablePrefix with cache_control: { type: "ephemeral" }.
 * Block 1 (only when dynamicSuffix is non-empty): dynamicSuffix, no cache_control.
 */
export function toCacheBlocks(wire: string): WireTextBlock[] {
  const { stablePrefix, dynamicSuffix } = splitWire(wire);

  const stableBlock: WireTextBlock = {
    type: 'text',
    text: stablePrefix,
    cache_control: { type: 'ephemeral' },
  };

  if (dynamicSuffix === '') {
    return [stableBlock];
  }

  return [stableBlock, { type: 'text', text: dynamicSuffix }];
}
