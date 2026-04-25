import type { IonIRNode } from '../src/ir/nodes.js';

// ---------------------------------------------------------------------------
// Known HTML tag names
// ---------------------------------------------------------------------------

export const HTML_TAGS = new Set([
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'footer', 'main', 'nav', 'section', 'article', 'aside',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'label',
  'a', 'img', 'br', 'hr', 'meta', 'link', 'script', 'style',
  'title', 'head', 'body', 'html',
  'figure', 'figcaption', 'blockquote', 'pre', 'code',
  'em', 'strong', 'small', 'mark', 'sup', 'sub',
  'details', 'summary', 'dialog',
]);

// HTML void (self-closing) elements
export const VOID_ELEMENTS = new Set([
  'input', 'br', 'hr', 'img', 'meta', 'link',
  'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr',
]);

// ---------------------------------------------------------------------------
// isHtmlElement
// ---------------------------------------------------------------------------

/** Returns true if the node is an HTML element App call. */
export function isHtmlElement(node: IonIRNode): boolean {
  return (
    node.kind === 'App' &&
    node.callee.kind === 'Var' &&
    HTML_TAGS.has((node.callee as { kind: 'Var'; name: string }).name)
  );
}

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
