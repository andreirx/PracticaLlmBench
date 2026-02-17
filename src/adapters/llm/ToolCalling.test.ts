/**
 * Tests for structured outputs and tool calling
 */

import { describe, it, expect, vi } from 'vitest';
import type { ILLMAdapter, CompletionOptions, ToolCallOptions } from './ILLMAdapter.js';
import type { Tool, ToolCallResponse, JSONSchemaDefinition } from '../../core/types.js';

// Mock adapter that captures options passed to it
function createMockAdapter(): ILLMAdapter & {
  lastOptions?: CompletionOptions;
  lastTools?: Tool[];
  lastToolOptions?: ToolCallOptions;
} {
  const adapter: ILLMAdapter & {
    lastOptions?: CompletionOptions;
    lastTools?: Tool[];
    lastToolOptions?: ToolCallOptions;
  } = {
    modelName: 'test-model',
    adapterName: 'test-adapter',
    complete: vi.fn(async (_prompt, _vars, options) => {
      adapter.lastOptions = options;
      return '{"result": "test"}';
    }),
    completeWithTools: vi.fn(async (_prompt, _vars, tools, options) => {
      adapter.lastTools = tools;
      adapter.lastToolOptions = options;
      return {
        content: null,
        toolCalls: [{
          id: 'call_123',
          type: 'function' as const,
          function: {
            name: 'get_weather',
            arguments: '{"location": "Paris"}',
          },
        }],
        finishReason: 'tool_calls' as const,
      };
    }),
    testConnection: vi.fn().mockResolvedValue(true),
  };
  return adapter;
}

describe('Structured Outputs (JSON Schema)', () => {
  it('should accept JSON schema in completion options', async () => {
    const adapter = createMockAdapter();

    const schema: JSONSchemaDefinition = {
      name: 'sentiment_response',
      description: 'Sentiment analysis result',
      schema: {
        type: 'object',
        properties: {
          sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['sentiment', 'confidence'],
      },
      strict: true,
    };

    await adapter.complete(
      'Analyze sentiment',
      {},
      { jsonSchema: schema }
    );

    expect(adapter.lastOptions?.jsonSchema).toEqual(schema);
  });

  it('should support both expectsJSON and jsonSchema options', async () => {
    const adapter = createMockAdapter();

    // Basic JSON mode
    await adapter.complete('Test', {}, { expectsJSON: true });
    expect(adapter.lastOptions?.expectsJSON).toBe(true);
    expect(adapter.lastOptions?.jsonSchema).toBeUndefined();

    // Schema mode
    await adapter.complete('Test', {}, {
      jsonSchema: { name: 'test', schema: { type: 'object' } }
    });
    expect(adapter.lastOptions?.jsonSchema).toBeDefined();
  });
});

describe('Tool/Function Calling', () => {
  it('should call completeWithTools with tools array', async () => {
    const adapter = createMockAdapter();

    const tools: Tool[] = [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['location'],
        },
      },
    }];

    const response = await adapter.completeWithTools!(
      'What is the weather in Paris?',
      {},
      tools,
      { toolChoice: 'auto' }
    );

    expect(adapter.lastTools).toEqual(tools);
    expect(adapter.lastToolOptions?.toolChoice).toBe('auto');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].function.name).toBe('get_weather');
  });

  it('should return ToolCallResponse with correct structure', async () => {
    const adapter = createMockAdapter();

    const tools: Tool[] = [{
      type: 'function',
      function: {
        name: 'calculate',
        parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      },
    }];

    const response = await adapter.completeWithTools!(
      'Calculate 2 + 2',
      {},
      tools
    );

    // Verify response structure
    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('toolCalls');
    expect(response).toHaveProperty('finishReason');
    expect(Array.isArray(response.toolCalls)).toBe(true);

    // Verify tool call structure
    const toolCall = response.toolCalls[0];
    expect(toolCall).toHaveProperty('id');
    expect(toolCall).toHaveProperty('type', 'function');
    expect(toolCall).toHaveProperty('function');
    expect(toolCall.function).toHaveProperty('name');
    expect(toolCall.function).toHaveProperty('arguments');
  });

  it('should support forced tool choice', async () => {
    const adapter = createMockAdapter();

    await adapter.completeWithTools!(
      'Test',
      {},
      [{ type: 'function', function: { name: 'my_func', parameters: {} } }],
      { toolChoice: { type: 'function', function: { name: 'my_func' } } }
    );

    expect(adapter.lastToolOptions?.toolChoice).toEqual({
      type: 'function',
      function: { name: 'my_func' },
    });
  });

  it('should support required tool choice', async () => {
    const adapter = createMockAdapter();

    await adapter.completeWithTools!(
      'Test',
      {},
      [{ type: 'function', function: { name: 'func', parameters: {} } }],
      { toolChoice: 'required' }
    );

    expect(adapter.lastToolOptions?.toolChoice).toBe('required');
  });
});

describe('Tool argument parsing', () => {
  it('should return arguments as JSON string', async () => {
    const adapter = createMockAdapter();

    const response = await adapter.completeWithTools!(
      'Weather in Paris',
      {},
      [{ type: 'function', function: { name: 'get_weather', parameters: {} } }]
    );

    const args = response.toolCalls[0].function.arguments;
    expect(typeof args).toBe('string');

    // Should be valid JSON
    const parsed = JSON.parse(args);
    expect(parsed).toEqual({ location: 'Paris' });
  });
});
