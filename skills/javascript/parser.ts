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

export interface JsParseOptions {
  /** Source file path, used in diagnostics. */
  readonly filepath?: string;
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
  return {
    type: node.type as JsTypedNode['type'],
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    text: node.text,
    hasError: node.hasError,
    isMissing: node.isMissing,
    isNamed: node.isNamed,
    get children(): readonly JsTypedNode[] {
      return node.children
        .filter((c): c is Node => c !== null)
        .map(toTypedNode);
    },
    get namedChildren(): readonly JsTypedNode[] {
      return node.namedChildren
        .filter((c): c is Node => c !== null)
        .map(toTypedNode);
    },
    get parent(): JsTypedNode | null {
      return node.parent !== null ? toTypedNode(node.parent) : null;
    },
    childForFieldName(name: string): JsTypedNode | null {
      const child = node.childForFieldName(name);
      return child !== null ? toTypedNode(child) : null;
    },
    childrenForFieldName(name: string): readonly JsTypedNode[] {
      return node.childrenForFieldName(name)
        .filter((c): c is Node => c !== null)
        .map(toTypedNode);
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
  _options?: JsParseOptions,
): JsParseResult {
  const tree = _parser.parse(source);
  const errors: JsErrorNode[] = [];
  collectErrors(tree.rootNode, errors);
  return {
    root: toTypedNode(tree.rootNode) as JsProgramNode,
    hasErrors: errors.length > 0,
    errors,
  };
}
