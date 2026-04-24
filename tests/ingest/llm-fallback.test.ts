import { describe, it, expect } from 'vitest';
import { AnthropicLLMFallbackHandler, type AiClient } from '../../src/ingest/llm-fallback.js';
import type { CSTNode } from '../../src/ingest/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testSpan = { file: 'test', startLine: 0, startCol: 0, endLine: 0, endCol: 0 };

const varNodeJson = JSON.stringify({
  kind: 'Var',
  name: 'x',
  symbolId: 'test:x:0',
  span: testSpan,
  type: { kind: 'Int' },
});

const literalNodeJson = JSON.stringify({
  kind: 'Literal',
  value: { kind: 'Int', value: 42 },
  span: testSpan,
  type: { kind: 'Int' },
});

function makeCstNode(type: string, text: string): CSTNode {
  return {
    type,
    text,
    isNamed: true,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
    children: [],
  };
}

type CreateParams = Parameters<AiClient['messages']['create']>[0];
type AiResponse = { content: Array<{ type: string; text?: string }> };

function makeClient(
  impl: (params: CreateParams) => Promise<AiResponse>,
): { client: AiClient; calls: CreateParams[] } {
  const calls: CreateParams[] = [];
  const client: AiClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return impl(params);
      },
    },
  };
  return { client, calls };
}

function textResponse(text: string): AiResponse {
  return { content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Suite A — context vs node.text contract
// ---------------------------------------------------------------------------

describe('Suite A: context vs node.text contract', () => {
  it('A1: user prompt contains context window, not raw node.text', async () => {
    const { client, calls } = makeClient(async () => textResponse(varNodeJson));
    const handler = new AnthropicLLMFallbackHandler(client);
    const node = makeCstNode('identifier', 'RAW_TEXT');

    await handler.translate(node, 'CONTEXT_TEXT');

    expect(calls).toHaveLength(1);
    const userContent = calls[0]?.messages[0]?.content ?? '';
    expect(userContent).toContain('CONTEXT_TEXT');
    expect(userContent).not.toContain('RAW_TEXT');
  });

  it('A2: user prompt contains node.type (structural label)', async () => {
    const { client, calls } = makeClient(async () => textResponse(varNodeJson));
    const handler = new AnthropicLLMFallbackHandler(client);

    await handler.translate(makeCstNode('function_declaration', ''), 'some context');

    const userContent = calls[0]?.messages[0]?.content ?? '';
    expect(userContent).toContain('function_declaration');
  });
});

// ---------------------------------------------------------------------------
// Suite B — successful translation
// ---------------------------------------------------------------------------

describe('Suite B: successful translation', () => {
  it('B1: parses VarNode returned in a markdown code block', async () => {
    const fenced = `\`\`\`json\n${varNodeJson}\n\`\`\``;
    const { client } = makeClient(async () => textResponse(fenced));
    const handler = new AnthropicLLMFallbackHandler(client);

    const result = await handler.translate(makeCstNode('identifier', ''), 'ctx');

    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Var');
  });

  it('B2: parses LiteralNode returned as bare JSON', async () => {
    const { client } = makeClient(async () => textResponse(literalNodeJson));
    const handler = new AnthropicLLMFallbackHandler(client);

    const result = await handler.translate(makeCstNode('number', ''), 'ctx');

    expect(result).not.toBeNull();
    expect(result?.kind).toBe('Literal');
  });
});

// ---------------------------------------------------------------------------
// Suite C — graceful degradation (always returns null, never throws)
// ---------------------------------------------------------------------------

describe('Suite C: graceful degradation', () => {
  it('C1: returns null when client throws a network error', async () => {
    const { client } = makeClient(async () => { throw new Error('network failure'); });
    const handler = new AnthropicLLMFallbackHandler(client);

    const result = await handler.translate(makeCstNode('expr', ''), 'ctx');

    expect(result).toBeNull();
  });

  it('C2: returns null when client returns syntactically invalid JSON', async () => {
    const { client } = makeClient(async () => textResponse('not valid { json'));
    const handler = new AnthropicLLMFallbackHandler(client);

    const result = await handler.translate(makeCstNode('expr', ''), 'ctx');

    expect(result).toBeNull();
  });

  it('C3: returns null when client returns valid JSON that is not a valid IonIR node', async () => {
    const { client } = makeClient(async () => textResponse('null'));
    const handler = new AnthropicLLMFallbackHandler(client);

    const result = await handler.translate(makeCstNode('expr', ''), 'ctx');

    expect(result).toBeNull();
  });

  it('C4: returns null when client returns an empty string', async () => {
    const { client } = makeClient(async () => textResponse(''));
    const handler = new AnthropicLLMFallbackHandler(client);

    const result = await handler.translate(makeCstNode('expr', ''), 'ctx');

    expect(result).toBeNull();
  });

  it('C5: returns null when content block has no text (e.g. tool_use)', async () => {
    const { client } = makeClient(async () => ({ content: [{ type: 'tool_use' }] }));
    const handler = new AnthropicLLMFallbackHandler(client);

    const result = await handler.translate(makeCstNode('expr', ''), 'ctx');

    expect(result).toBeNull();
  });

  it('C6: returns null when content array is empty', async () => {
    const { client } = makeClient(async () => ({ content: [] }));
    const handler = new AnthropicLLMFallbackHandler(client);

    const result = await handler.translate(makeCstNode('expr', ''), 'ctx');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite D — constructor injection
// ---------------------------------------------------------------------------

describe('Suite D: constructor injection', () => {
  it('D1: default constructor (no arg) does not throw even without ANTHROPIC_API_KEY', () => {
    expect(() => new AnthropicLLMFallbackHandler()).not.toThrow();
  });

  it('D2: injected mock client is used, not a real Anthropic instance', async () => {
    let called = false;
    const mockClient: AiClient = {
      messages: {
        create: async () => {
          called = true;
          return textResponse(varNodeJson);
        },
      },
    };
    const handler = new AnthropicLLMFallbackHandler(mockClient);

    await handler.translate(makeCstNode('expr', ''), 'ctx');

    expect(called).toBe(true);
  });
});
