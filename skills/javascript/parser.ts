import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import type { Span } from '../../src/types.js';
import { wrapNode } from './node-types.js';
import type { JsProgram } from './node-types.js';

type SyntaxNode = Parser.SyntaxNode;
type Tree = Parser.Tree;

/** Result of parsing a JavaScript source string. */
export interface ParseResult {
  readonly filePath: string;
  /** Raw tree-sitter Tree for advanced consumers. */
  readonly tree: Tree;
  /** Typed root wrapper; always present even if the source has errors. */
  readonly root: JsProgram;
  /** True when the tree contains ERROR nodes (error-tolerant parse). */
  readonly hasErrors: boolean;
  /** Convert a SyntaxNode's position to a Span (1-based lines, 0-based columns). */
  toSpan(node: SyntaxNode): Span;
}

// Module-level singleton — safe because Node.js is single-threaded.
let _parser: Parser | null = null;

function getParser(): Parser {
  if (!_parser) {
    _parser = new Parser();
    // JavaScript satisfies Parser.Language structurally; cast required due to differing .d.ts origins
    _parser.setLanguage(JavaScript as unknown as Parser.Language);
  }
  return _parser;
}

/**
 * Parse JavaScript source. Never throws; syntax errors surface via `hasErrors`.
 *
 * @param src - JavaScript source text.
 * @param filePath - Absolute path attached to every Span produced by `toSpan`.
 */
export function parseJavaScript(src: string, filePath: string): ParseResult {
  const p = getParser();
  const tree = p.parse(src);
  const root = wrapNode(tree.rootNode) as JsProgram;

  function toSpan(node: SyntaxNode): Span {
    return {
      file: filePath,
      // tree-sitter uses 0-based rows; Span uses 1-based lines
      startLine: node.startPosition.row + 1,
      startCol: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endCol: node.endPosition.column,
    };
  }

  return {
    filePath,
    tree,
    root,
    hasErrors: tree.rootNode.hasError,
    toSpan,
  };
}
