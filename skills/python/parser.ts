import { Parser, Language, Node } from 'web-tree-sitter';
import { createRequire } from 'module';
import { ensureParserInit } from '../../src/ingest/parser-init.js';
import type { CSTNode } from '../../src/ingest/types.js';

const _require = createRequire(import.meta.url);

await ensureParserInit();
const _pyLanguage = await Language.load(
  _require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
);

const _parser = new Parser();
_parser.setLanguage(_pyLanguage);

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export interface PyParseResult {
  readonly root: CSTNode;
  readonly hasErrors: boolean;
  readonly errors: readonly PyErrorNode[];
}

export interface PyErrorNode {
  readonly type: 'ERROR' | 'MISSING';
  readonly startLine: number;
  readonly startCol: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly text: string;
}

function toCSTNode(node: Node): CSTNode {
  const namedChildren: CSTNode[] = node.namedChildren
    .filter((c): c is Node => c !== null)
    .map(toCSTNode);
  return {
    type: node.type,
    text: node.text,
    isNamed: node.isNamed,
    startPosition: { row: node.startPosition.row, column: node.startPosition.column },
    endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    children: namedChildren,
  };
}

function collectErrors(node: Node, out: PyErrorNode[]): void {
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

export function parsePython(source: string, maxSourceBytes = MAX_SOURCE_BYTES): PyParseResult {
  if (source.length > maxSourceBytes) {
    throw new RangeError(`Source exceeds maximum size of ${maxSourceBytes} bytes`);
  }
  const tree = _parser.parse(source);
  if (tree === null) throw new Error('tree-sitter parse returned null unexpectedly');
  const errors: PyErrorNode[] = [];
  collectErrors(tree.rootNode, errors);
  const root = toCSTNode(tree.rootNode);
  tree.delete();
  return { root, hasErrors: errors.length > 0, errors };
}
