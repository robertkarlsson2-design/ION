import { Parser } from 'web-tree-sitter';

let initPromise: Promise<void> | null = null;

/** Call Parser.init() exactly once across all skill parsers. */
export function ensureParserInit(): Promise<void> {
  if (initPromise === null) {
    initPromise = Parser.init();
  }
  return initPromise;
}
