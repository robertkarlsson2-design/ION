import type { IonIRNode } from '../../src/ir/nodes.js';

// ---------------------------------------------------------------------------
// Attribute string parsing
// ---------------------------------------------------------------------------

/**
 * Parse a space-separated "key=value key=value" attribute string into
 * `key="value"` pairs suitable for HTML.
 *
 * Within a value, use `+` to encode a literal space (e.g. `class=foo+bar`
 * → `class="foo bar"`). This lets the pool encoding stay space-delimited
 * while still allowing multi-word attribute values such as compound CSS
 * class lists or multi-word data attributes.
 */
export function parseAttrString(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\s+/)
    .map(pair => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair; // bare attribute like "disabled"
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1).replace(/\+/g, ' ');
      return `${k}="${v}"`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// Extract attribute string from first arg of an element call
// ---------------------------------------------------------------------------

/** Get the raw attribute string value from the first arg of an HTML App call. */
export function getAttrRaw(node: IonIRNode): string {
  if (node.kind === 'Literal' && node.value.kind === 'Str') {
    return node.value.value;
  }
  if (node.kind === 'Var') {
    // Pool-resolved var whose name IS the attribute string (e.g. "class=container")
    return node.name;
  }
  return '';
}
