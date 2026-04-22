/** A single item within a GBNF rule body. */
export type GBNFItem =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'ref'; readonly rule: string }
  | { readonly kind: 'charset'; readonly chars: string }
  | { readonly kind: 'optional'; readonly item: GBNFItem }
  | { readonly kind: 'star'; readonly item: GBNFItem }
  | { readonly kind: 'plus'; readonly item: GBNFItem }
  | { readonly kind: 'seq'; readonly items: readonly GBNFItem[] }
  | { readonly kind: 'alt'; readonly items: readonly GBNFItem[] };

/** A GBNF rule: `name ::= alt[0] | alt[1] | …` where each alt is a sequence of items. */
export interface GBNFRule {
  readonly name: string;
  /** Each element is one alternative; each alternative is a sequence of GBNFItems. */
  readonly alts: readonly (readonly GBNFItem[])[];
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Wraps with parens when the item needs grouping as a suffix operand or seq member. */
function atomize(item: GBNFItem): string {
  const s = serializeItem(item);
  return (item.kind === 'seq' || item.kind === 'alt') ? `(${s})` : s;
}

function serializeItem(item: GBNFItem): string {
  switch (item.kind) {
    case 'literal': return `"${escapeText(item.text)}"`;
    case 'ref': return item.rule;
    case 'charset': return `[${item.chars}]`;
    case 'optional': return `${atomize(item.item)}?`;
    case 'star': return `${atomize(item.item)}*`;
    case 'plus': return `${atomize(item.item)}+`;
    case 'seq':
      return item.items.map(i => i.kind === 'alt' ? `(${serializeItem(i)})` : serializeItem(i)).join(' ');
    case 'alt':
      return item.items.map(serializeItem).join(' | ');
  }
}

/**
 * Serializes an array of GBNF rules to llama.cpp-compatible `.gbnf` text.
 * Each rule becomes `name ::= alt1 | alt2 | …`; rules are newline-separated.
 */
export function serializeGBNF(rules: readonly GBNFRule[]): string {
  return rules.map(rule => {
    const body = rule.alts.map(alt => alt.map(serializeItem).join(' ')).join(' | ');
    return `${rule.name} ::= ${body}`;
  }).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

function collectRefs(item: GBNFItem, out: Set<string>): void {
  switch (item.kind) {
    case 'ref': out.add(item.rule); break;
    case 'optional':
    case 'star':
    case 'plus': collectRefs(item.item, out); break;
    case 'seq':
    case 'alt':
      for (const child of item.items) collectRefs(child, out);
      break;
    default: break;
  }
}

/**
 * Returns all rule names referenced within the rule set but not defined in it.
 * An empty result means the grammar is self-contained.
 */
export function validateGBNF(rules: readonly GBNFRule[]): string[] {
  const defined = new Set(rules.map(r => r.name));
  const referenced = new Set<string>();
  for (const rule of rules) {
    for (const alt of rule.alts) {
      for (const item of alt) collectRefs(item, referenced);
    }
  }
  return [...referenced].filter(name => !defined.has(name)).sort();
}
