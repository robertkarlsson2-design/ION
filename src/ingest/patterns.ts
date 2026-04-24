/**
 * Pattern matching engine for the ION ingestion pipeline.
 *
 * Loads YAML rule files from a skill plugin's `patterns/` subdirectory and
 * compiles them into PatternMatcher objects for use in runPipeline().
 *
 * ## YAML rule schema
 *
 * ```yaml
 * id: const-decl                         # unique rule id (used in SymbolId generation)
 * language: javascript                   # target language tag (informational)
 * match:
 *   nodeType: lexical_declaration        # tree-sitter node.type to match
 *   children:
 *     - pattern:
 *         nodeType: variable_declarator
 *         children:
 *           - pattern:
 *               nodeType: identifier
 *               capture: $NAME           # $VAR — binds single node
 *           - pattern:
 *               capture: $VALUE          # matches any node
 * conditions:
 *   - kind: has-children
 *     count: 1
 * emit:
 *   kind: Let
 *   name:    { metavar: $NAME, field: text }
 *   symbolId: { metavar: $NAME, field: text }
 *   bindingType: null
 *   value:
 *     kind: Var
 *     name: { metavar: $VALUE, field: text }
 *     symbolId: { metavar: $VALUE, field: text }
 *     type: { kind: Never }
 *   body: { kind: Literal, value: { kind: Int, value: 0 }, type: { kind: Int } }
 * ```
 *
 * Metavar references in emit use `{ metavar: "$NAME", field: "text"|"type"|"span" }`.
 * $$$BODY-style captures bind a sequence of remaining named siblings.
 * $TYPE is syntactically identical to $VAR at match time; semantic distinction is
 * left to conditions and later compiler stages.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { IonIRNode } from '../ir/nodes.js';
import { VALID_IR_KINDS } from '../ir/nodes.js';
import type { IonType } from '../ir/types.js';
import type { Span, SymbolId } from '../types.js';
import { makeSymbolId } from '../types.js';
import type { CSTNode, PatternMatcher } from './types.js';

// ── Public types ─────────────────────────────────────────────────────────────

/** Structural CST node matcher — mirrors ast-grep's rule schema. */
export type NodePattern =
  | { readonly nodeType: string; readonly children?: readonly ChildPattern[]; readonly capture?: string }
  | { readonly capture: string }
  | { readonly text: string };

/** Positional child pattern (index-based or $$$BODY sequence). */
export interface ChildPattern {
  readonly pattern: NodePattern;
  /** true when metavar is $$$BODY-style (greedy sequence capture). */
  readonly isSequence?: boolean;
}

/** Guard conditions on captured bindings. */
export type Condition =
  | { readonly kind: 'has-children'; readonly count: number }
  | { readonly kind: 'is-type'; readonly var: string; readonly type: string }
  | { readonly kind: 'not-mutated-in'; readonly var: string; readonly scope: string }
  | { readonly kind: 'text-equals'; readonly var: string; readonly value: string }
  | { readonly kind: 'node-text-contains'; readonly text: string };

/** Emit spec mirrors IonIR node shape with metavar references. */
export type EmitSpec = Record<string, unknown>;

/** Bound captures: $VAR → single CSTNode, $$$BODY → CSTNode[]. */
export type Bindings = ReadonlyMap<string, CSTNode | readonly CSTNode[]>;

/** Parsed representation of one YAML rule file. */
export interface PatternRule {
  readonly id: string;
  readonly language: string;
  readonly match: NodePattern;
  readonly conditions: readonly Condition[];
  readonly emit: EmitSpec;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load all *.yaml rules from `skillDir/patterns/` and compile to PatternMatcher[].
 * Returns [] if the directory is missing or contains no .yaml files.
 * Skips malformed YAML files with a stderr warning.
 */
export async function loadPatterns(skillDir: string): Promise<PatternMatcher[]> {
  const patternsDir = join(skillDir, 'patterns');

  let entries: string[];
  try {
    entries = await readdir(patternsDir);
  } catch {
    return [];
  }

  const yamlFiles = entries.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (yamlFiles.length === 0) return [];

  const matchers: PatternMatcher[] = [];

  for (const file of yamlFiles) {
    const filePath = join(patternsDir, file);
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed: unknown = parseYaml(raw);
      const rule = validateRule(parsed, filePath);
      matchers.push(compileRule(rule));
    } catch (err) {
      process.stderr.write(`[patterns] skipping ${filePath}: ${String(err)}\n`);
    }
  }

  return matchers;
}

/** Compile a single parsed PatternRule into a PatternMatcher (exposed for unit tests). */
export function compileRule(rule: PatternRule): PatternMatcher {
  return {
    ruleId: rule.id,
    match(node: CSTNode): IonIRNode | null {
      try {
        const bindings = new Map<string, CSTNode | CSTNode[]>();
        if (!matchPattern(rule.match, node, bindings)) return null;
        if (!evaluateConditions(rule.conditions, bindings, node)) return null;
        return buildEmit(rule.emit, bindings, node, '', rule.id);
      } catch {
        return null;
      }
    },
  };
}

// ── Internal: validation ──────────────────────────────────────────────────────

function validateRule(raw: unknown, filePath: string): PatternRule {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`expected object at top level in ${filePath}`);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj['id'] !== 'string') throw new Error(`missing string 'id' in ${filePath}`);
  if (typeof obj['language'] !== 'string') throw new Error(`missing string 'language' in ${filePath}`);
  if (obj['match'] === null || typeof obj['match'] !== 'object') {
    throw new Error(`missing object 'match' in ${filePath}`);
  }
  if (typeof obj['emit'] !== 'object' || obj['emit'] === null) {
    throw new Error(`missing object 'emit' in ${filePath}`);
  }

  const conditions: Condition[] = [];
  if (Array.isArray(obj['conditions'])) {
    for (const c of obj['conditions'] as unknown[]) {
      conditions.push(parseCondition(c));
    }
  }

  return {
    id: obj['id'] as string,
    language: obj['language'] as string,
    match: parseNodePattern(obj['match'] as Record<string, unknown>),
    conditions,
    emit: obj['emit'] as EmitSpec,
  };
}

function parseNodePattern(raw: Record<string, unknown>): NodePattern {
  if (typeof raw['capture'] === 'string' && !('nodeType' in raw) && !('text' in raw)) {
    return { capture: raw['capture'] as string };
  }
  if (typeof raw['text'] === 'string') {
    return { text: raw['text'] as string };
  }
  if (typeof raw['nodeType'] === 'string') {
    const np: { nodeType: string; capture?: string; children?: readonly ChildPattern[] } = {
      nodeType: raw['nodeType'] as string,
    };
    if (typeof raw['capture'] === 'string') np.capture = raw['capture'] as string;
    if (Array.isArray(raw['children'])) {
      np.children = (raw['children'] as unknown[]).map(c => parseChildPattern(c as Record<string, unknown>));
    }
    return np;
  }
  throw new Error(`unrecognised node pattern: ${JSON.stringify(raw)}`);
}

function parseChildPattern(raw: Record<string, unknown>): ChildPattern {
  if (typeof raw['pattern'] !== 'object' || raw['pattern'] === null) {
    throw new Error(`child pattern missing 'pattern' field: ${JSON.stringify(raw)}`);
  }
  const pattern = parseNodePattern(raw['pattern'] as Record<string, unknown>);
  const isSequence = raw['isSequence'] === true;
  return isSequence ? { pattern, isSequence: true } : { pattern };
}

function parseCondition(raw: unknown): Condition {
  if (raw === null || typeof raw !== 'object') throw new Error('condition must be an object');
  const c = raw as Record<string, unknown>;
  const kind = c['kind'];
  if (kind === 'has-children') {
    if (typeof c['count'] !== 'number') throw new Error("has-children condition requires numeric 'count'");
    return { kind: 'has-children', count: c['count'] as number };
  }
  if (kind === 'is-type') {
    if (typeof c['var'] !== 'string' || typeof c['type'] !== 'string') {
      throw new Error("is-type condition requires string 'var' and 'type'");
    }
    return { kind: 'is-type', var: c['var'] as string, type: c['type'] as string };
  }
  if (kind === 'not-mutated-in') {
    if (typeof c['var'] !== 'string' || typeof c['scope'] !== 'string') {
      throw new Error("not-mutated-in condition requires string 'var' and 'scope'");
    }
    return { kind: 'not-mutated-in', var: c['var'] as string, scope: c['scope'] as string };
  }
<<<<<<< HEAD
  if (kind === 'text-equals') {
    if (typeof c['var'] !== 'string' || typeof c['value'] !== 'string') {
      throw new Error("text-equals condition requires string 'var' and 'value'");
    }
    return { kind: 'text-equals', var: c['var'] as string, value: c['value'] as string };
=======
  if (kind === 'node-text-contains') {
    if (typeof c['text'] !== 'string') throw new Error("node-text-contains condition requires string 'text'");
    return { kind: 'node-text-contains', text: c['text'] as string };
>>>>>>> 73bed2c (WIP: fixing complete [3ae83b9d-4666-4b78-932c-3d0afb87c669])
  }
  throw new Error(`unknown condition kind: ${String(kind)}`);
}

// ── Internal: matching ────────────────────────────────────────────────────────

function matchPattern(
  pattern: NodePattern,
  node: CSTNode,
  bindings: Map<string, CSTNode | CSTNode[]>,
): boolean {
  if ('text' in pattern) {
    return node.text === pattern.text;
  }

  if (!('nodeType' in pattern)) {
    // Pure capture (no nodeType constraint) — binds any node
    if (pattern.capture) bindings.set(pattern.capture, node);
    return true;
  }

  // nodeType-constrained pattern
  if (node.type !== pattern.nodeType) return false;
  if (pattern.capture) bindings.set(pattern.capture, node);

  if (pattern.children && pattern.children.length > 0) {
    const namedChildren = node.children.filter(c => c.isNamed);
    if (!matchChildren(pattern.children, namedChildren, bindings)) return false;
  }

  return true;
}

function matchChildren(
  childPatterns: readonly ChildPattern[],
  children: readonly CSTNode[],
  bindings: Map<string, CSTNode | CSTNode[]>,
): boolean {
  const seqIndex = childPatterns.findIndex(cp => cp.isSequence === true);

  if (seqIndex === -1) {
    // No sequence pattern — must match exactly
    if (childPatterns.length !== children.length) return false;
    for (let i = 0; i < childPatterns.length; i++) {
      const saved = snapshotBindings(bindings);
      // childPatterns[i] is guaranteed defined because i < childPatterns.length
      const cp = childPatterns[i]!;
      const child = children[i]!;
      if (!matchPattern(cp.pattern, child, bindings)) {
        restoreBindings(bindings, saved);
        return false;
      }
    }
    return true;
  }

  // Sequence ($$$BODY) present — prefix and suffix must match exactly
  const prefixPatterns = childPatterns.slice(0, seqIndex);
  const suffixPatterns = childPatterns.slice(seqIndex + 1);

  if (children.length < prefixPatterns.length + suffixPatterns.length) return false;

  // Match prefix
  for (let i = 0; i < prefixPatterns.length; i++) {
    const cp = prefixPatterns[i]!;
    const child = children[i]!;
    if (!matchPattern(cp.pattern, child, bindings)) return false;
  }

  // Match suffix
  const suffixStart = children.length - suffixPatterns.length;
  for (let i = 0; i < suffixPatterns.length; i++) {
    const cp = suffixPatterns[i]!;
    const child = children[suffixStart + i]!;
    if (!matchPattern(cp.pattern, child, bindings)) return false;
  }

  // Capture the sequence
  const seqNodes = children.slice(prefixPatterns.length, suffixStart < prefixPatterns.length ? prefixPatterns.length : suffixStart);
  const seqCp = childPatterns[seqIndex]!;
  const seqCapture = extractCapture(seqCp.pattern);
  if (seqCapture) bindings.set(seqCapture, seqNodes);

  return true;
}

function extractCapture(pattern: NodePattern): string | undefined {
  if ('capture' in pattern) return pattern.capture;
  if ('nodeType' in pattern) return pattern.capture;
  return undefined;
}

function snapshotBindings(bindings: Map<string, CSTNode | CSTNode[]>): Map<string, CSTNode | CSTNode[]> {
  return new Map(bindings);
}

function restoreBindings(
  bindings: Map<string, CSTNode | CSTNode[]>,
  saved: Map<string, CSTNode | CSTNode[]>,
): void {
  bindings.clear();
  for (const [k, v] of saved) bindings.set(k, v);
}

// ── Internal: conditions ──────────────────────────────────────────────────────

function evaluateConditions(
  conditions: readonly Condition[],
  bindings: Bindings,
  node: CSTNode,
): boolean {
  for (const cond of conditions) {
    if (!evaluateCondition(cond, bindings, node)) return false;
  }
  return true;
}

function evaluateCondition(cond: Condition, bindings: Bindings, node: CSTNode): boolean {
  switch (cond.kind) {
    case 'has-children': {
      const namedChildren = node.children.filter(c => c.isNamed);
      return namedChildren.length === cond.count;
    }
    case 'is-type': {
      const bound = bindings.get(cond.var);
      if (!bound) return false;
      const target = Array.isArray(bound) ? null : (bound as CSTNode);
      return target !== null && target.type === cond.type;
    }
    case 'not-mutated-in': {
      // Requires binder-level data-flow analysis (ION-30).
      // Stubbed as always-true until binder integration is complete.
      return true;
    }
<<<<<<< HEAD
    case 'text-equals': {
      const bound = bindings.get(cond.var);
      if (!bound || Array.isArray(bound)) return false;
      return (bound as CSTNode).text === cond.value;
=======
    case 'node-text-contains': {
      return node.text.includes(cond.text);
>>>>>>> 73bed2c (WIP: fixing complete [3ae83b9d-4666-4b78-932c-3d0afb87c669])
    }
  }
}

// ── Internal: emit ────────────────────────────────────────────────────────────

const NEVER_TYPE: IonType = { kind: 'Never' };

function cstSpan(node: CSTNode, file: string): Span {
  return {
    file,
    startLine: node.startPosition.row + 1,
    startCol: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endCol: node.endPosition.column,
  };
}

function resolveMetavar(
  ref: Record<string, unknown>,
  bindings: Bindings,
  rootSpan: Span,
  _ruleId: string,
): unknown {
  const metavar = ref['metavar'];
  const field = ref['field'];
  if (typeof metavar !== 'string') return undefined;

  const bound = bindings.get(metavar);
  if (bound === undefined) return undefined;

  if (Array.isArray(bound)) {
    // $$$BODY — return the array; callers decide how to use it
    return bound;
  }

  const n = bound as CSTNode;
  if (field === 'text') return n.text;
  if (field === 'span') return cstSpan(n, rootSpan.file);
  if (field === 'type') return NEVER_TYPE;
  // Default to text for unknown field refs
  return n.text;
}

function buildValue(
  spec: unknown,
  bindings: Bindings,
  rootSpan: Span,
  ruleId: string,
): unknown {
  if (Array.isArray(spec)) return spec.map(item => buildValue(item, bindings, rootSpan, ruleId));
  if (spec === null || typeof spec !== 'object') return spec;

  if (Array.isArray(spec))
    return (spec as unknown[]).map(item => buildValue(item, bindings, rootSpan, ruleId));

  const obj = spec as Record<string, unknown>;

  // Metavar reference
  if (typeof obj['metavar'] === 'string') {
    return resolveMetavar(obj, bindings, rootSpan, ruleId);
  }

  // Recursively build object
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = buildValue(val, bindings, rootSpan, ruleId);
  }
  return result;
}

function buildEmit(
  spec: EmitSpec,
  bindings: Bindings,
  node: CSTNode,
  file: string,
  ruleId: string,
): IonIRNode | null {
  const rootSpan = cstSpan(node, file);

  const built: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(spec)) {
    built[key] = buildValue(val, bindings, rootSpan, ruleId);
  }

  // Ensure required IonIR fields are present
  if (typeof built['kind'] !== 'string') return null;
  if (!VALID_IR_KINDS.has(built['kind'] as string)) return null;
  if (!built['span']) built['span'] = rootSpan;
  if (!built['type']) built['type'] = NEVER_TYPE;

  // Derive symbolId when missing but name is available
  if (!built['symbolId'] && typeof built['name'] === 'string') {
    built['symbolId'] = makeSymbolId('pattern:' + ruleId + ':' + (built['name'] as string)) as SymbolId;
  }

  return built as unknown as IonIRNode;
}
