import type { IonIRNode } from '../../src/ir/nodes.js';

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
