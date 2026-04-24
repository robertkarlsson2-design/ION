import { Parser, Language, Node } from 'web-tree-sitter';
import { createRequire } from 'module';

import type { JsTypedNode, JsProgramNode } from './node-types.js';

const _require = createRequire(import.meta.url);

// Top-level await: WASM init and language loading happen once at module load.
await Parser.init();
const _jsLanguage = await Language.load(
  _require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
);

const _parser = new Parser();
_parser.setLanguage(_jsLanguage);

const MAX_SOURCE_BYTES = 10 * 1024 * 1024; // 10 MB default

export interface JsParseOptions {
  /** Source file path, used in diagnostics. */
  readonly filepath?: string;
  /** Maximum allowed source size in bytes. Defaults to 10 MB. */
  readonly maxSourceBytes?: number;
}

export interface JsErrorNode {
  readonly type: 'ERROR' | 'MISSING';
  /** 1-based line number. */
  readonly startLine: number;
  /** 0-based column. */
  readonly startCol: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly text: string;
}

export interface JsParseResult {
  /** Typed root node; always has type 'program', even on parse errors. */
  readonly root: JsProgramNode;
  /** True when the tree contains any ERROR or MISSING nodes. */
  readonly hasErrors: boolean;
  readonly errors: readonly JsErrorNode[];
}

function toTypedNode(node: Node): JsTypedNode {
  // Eagerly snapshot children so the result is independent of tree lifetime,
  // which allows tree.delete() immediately after conversion without dangling refs.
  // Using namedChildren for both 'children' and 'namedChildren' avoids the
  // unchecked cast of anonymous nodes (e.g. '(', ')') to JsNamedNodeType.
  const namedChildren: JsTypedNode[] = node.namedChildren
    .filter((c): c is Node => c !== null)
    .map(toTypedNode);

  const fieldCache = new Map<string, JsTypedNode[]>();
  const allChildren = node.children;
  for (let i = 0; i < allChildren.length; i++) {
    const child = allChildren[i];
    if (child === null) continue;
    const fieldName = node.fieldNameForChild(i);
    if (fieldName === null) continue;
    const snapped = toTypedNode(child);
    const existing = fieldCache.get(fieldName);
    if (existing !== undefined) {
      existing.push(snapped);
    } else {
      fieldCache.set(fieldName, [snapped]);
    }
  }

  return {
    type: node.type as JsTypedNode['type'],
    startPosition: { row: node.startPosition.row, column: node.startPosition.column },
    endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    text: node.text,
    hasError: node.hasError,
    isMissing: node.isMissing,
    isNamed: node.isNamed,
    children: namedChildren,
    namedChildren,
    parent: null,
    childForFieldName(name: string): JsTypedNode | null {
      return fieldCache.get(name)?.[0] ?? null;
    },
    childrenForFieldName(name: string): readonly JsTypedNode[] {
      return fieldCache.get(name) ?? [];
    },
  };
}

function collectErrors(node: Node, out: JsErrorNode[]): void {
  if (node.type === 'ERROR' || node.isMissing) {
    out.push({
      type: node.isMissing ? 'MISSING' : 'ERROR',
      startLine: node.startPosition.row + 1,
      startCol: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endCol: node.endPosition.column,
      text: node.text,
    });
  }
  for (const child of node.children) {
    if (child !== null) collectErrors(child, out);
  }
}

/** Parse JavaScript source text into an error-tolerant CST. */
export function parseJavaScript(
  source: string,
  options?: JsParseOptions,
): JsParseResult {
  const limit = options?.maxSourceBytes ?? MAX_SOURCE_BYTES;
  if (source.length > limit) {
    throw new RangeError(`Source exceeds maximum size of ${limit} bytes`);
  }
  const tree = _parser.parse(source);
  const errors: JsErrorNode[] = [];
  collectErrors(tree.rootNode, errors);
  const root = toTypedNode(tree.rootNode) as JsProgramNode;
  tree.delete();
  return { root, hasErrors: errors.length > 0, errors };
}
