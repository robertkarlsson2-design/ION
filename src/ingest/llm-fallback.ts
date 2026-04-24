import Anthropic from '@anthropic-ai/sdk';
import type { LLMFallbackHandler, CSTNode } from './types.js';
import type { IonIRNode } from '../ir/nodes.js';
import { deserializeModule } from '../ir/serde.js';
import { buildIonIRSchema } from '../grammar/ir-schema.js';

/** Minimal Anthropic API surface used by this handler — enables injection in tests. */
export interface AiClient {
  readonly messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;

function buildSystemPrompt(schema: string): string {
  return [
    'You are an expert in the IonIR intermediate representation.',
    'Given a CST node type and surrounding source context, produce a single IonIR JSON node conforming to the schema below.',
    'Output ONLY the raw JSON object — no markdown fences, no explanation.',
    '',
    'IonIR JSON Schema:',
    schema,
  ].join('\n');
}

function buildUserPrompt(nodeType: string, context: string): string {
  return [
    `CST node type: ${nodeType}`,
    '',
    'Surrounding source context (±50 lines):',
    context,
    '',
    'Produce the IonIR JSON node for this construct.',
  ].join('\n');
}

function extractJson(text: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (match !== null) {
    return (match[1] ?? '').trim();
  }
  return text.trim();
}

function wrapNodeJson(nodeJson: string): string {
  const nodeRaw = JSON.parse(nodeJson) as unknown;
  return JSON.stringify({
    ionir: '1.0',
    module: 'llm-tmp',
    version: '0.0.0',
    dialects: ['core'],
    imports: [],
    data: [],
    decls: [nodeRaw],
  });
}

/** Production LLM fallback: translates unmatched CST nodes to IonIR via Anthropic Claude. */
export class AnthropicLLMFallbackHandler implements LLMFallbackHandler {
  private readonly client: AiClient;
  private readonly schema: string;

  /**
   * @param client Optional Anthropic-compatible client. When omitted, constructs one from
   *   `ANTHROPIC_API_KEY`. Inject a mock for testing to avoid network calls.
   */
  constructor(client?: AiClient) {
    // Anthropic satisfies AiClient structurally; cast needed because messages.create is overloaded
    this.client = client ?? (new Anthropic() as unknown as AiClient);
    this.schema = JSON.stringify(buildIonIRSchema());
  }

  /** Translates `node` to an IonIR node using the ±50-line `context` window (never `node.text`). */
  async translate(node: CSTNode, context: string): Promise<IonIRNode | null> {
    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(this.schema),
        messages: [{ role: 'user', content: buildUserPrompt(node.type, context) }],
      });

      const first = response.content[0];
      if (first === undefined || first.type !== 'text' || first.text === undefined) {
        return null;
      }

      const rawJson = extractJson(first.text);
      if (rawJson === '') {
        return null;
      }

      const parsed = deserializeModule(wrapNodeJson(rawJson));
      return parsed.decls[0] ?? null;
    } catch {
      return null;
    }
  }
}
