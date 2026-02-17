import { BaseLLMAdapter, LLMRequestOptions } from './BaseLLMAdapter.js';
import type { ToolCallOptions } from './ILLMAdapter.js';
import type { Tool, ToolCallResponse, ToolCall } from '../../core/types.js';

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  endpoint?: string;
  maxRetries?: number;
  timeoutMs?: number;
  concurrency?: number;
}

export class OpenAIAdapter extends BaseLLMAdapter {
  private apiKey: string;
  private model: string;
  private endpoint: string;
  private maxRetries: number;
  private timeoutMs: number;

  constructor(config: OpenAIConfig) {
    super(config.concurrency || 1, config.model, 'openai');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.endpoint = config.endpoint || 'https://api.openai.com/v1';
    this.maxRetries = config.maxRetries ?? 3;
    const isReasoning = this.model.includes('gpt-5') || this.model.includes('o1') || this.model.includes('o3');
    this.timeoutMs = config.timeoutMs ?? (isReasoning ? 120_000 : 30_000);
  }

  protected async performComplete(
    finalPrompt: string,
    options?: LLMRequestOptions
  ): Promise<string> {
    const body = this.buildRequestBody(finalPrompt, true, options);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          const backoff = Math.pow(2, attempt) * 1000;
          this.log(`   Retry ${attempt}/${this.maxRetries} in ${backoff}ms...`);
          await new Promise(r => setTimeout(r, backoff));
        }

        this.log(`LLM CALL [${this.model}] (Attempt ${attempt})`);
        return await this.performStreamedRequest(body);

      } catch (error: unknown) {
        lastError = error as Error;
        const msg = error instanceof Error ? error.message : String(error);
        const isFatal = msg.includes('401') || msg.includes('invalid_api_key');
        if (isFatal) throw error;
        this.log(`   Error (Attempt ${attempt}): ${msg}`);
      }
    }

    throw lastError || new Error('Failed after max retries');
  }

  protected async performStream(
    finalPrompt: string,
    onChunk: (chunk: string) => void,
    options?: LLMRequestOptions
  ): Promise<string> {
    const body = this.buildRequestBody(finalPrompt, true, options);
    this.log(`LLM STREAM [${this.model}]`);
    return this.performStreamedRequest(body, onChunk);
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      return response.ok;
    } catch { return false; }
  }

  private buildRequestBody(
    finalPrompt: string,
    stream: boolean,
    options?: LLMRequestOptions
  ): Record<string, unknown> {
    const isGPT5 = this.model.includes('gpt-5') || this.model.includes('o3') || this.model.includes('o4');

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: finalPrompt }],
      stream,
    };

    if (!isGPT5) {
      body.temperature = options?.expectsJSON ? 0.1 : 0.3;
    }

    if (options?.maxTokens && options.maxTokens > 0) {
      body.max_completion_tokens = options.maxTokens;
    }

    // Structured outputs (JSON Schema) takes precedence over basic JSON mode
    if (options?.jsonSchema && !this.model.includes('nano')) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: options.jsonSchema.name,
          description: options.jsonSchema.description,
          schema: options.jsonSchema.schema,
          strict: options.jsonSchema.strict ?? true,
        },
      };
    } else if (options?.expectsJSON && !this.model.includes('nano')) {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }

  private buildToolRequestBody(
    finalPrompt: string,
    tools: Tool[],
    options?: ToolCallOptions
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: finalPrompt }],
      stream: true,
      tools: tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
          strict: tool.function.strict ?? true,
        },
      })),
    };

    if (options?.maxTokens && options.maxTokens > 0) {
      body.max_completion_tokens = options.maxTokens;
    }

    if (options?.toolChoice) {
      body.tool_choice = options.toolChoice;
    }

    return body;
  }

  protected async performCompleteWithTools(
    finalPrompt: string,
    tools: Tool[],
    options?: ToolCallOptions
  ): Promise<ToolCallResponse> {
    const body = this.buildToolRequestBody(finalPrompt, tools, options);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          const backoff = Math.pow(2, attempt) * 1000;
          this.log(`   Retry ${attempt}/${this.maxRetries} in ${backoff}ms...`);
          await new Promise(r => setTimeout(r, backoff));
        }

        this.log(`LLM TOOL CALL [${this.model}] (Attempt ${attempt})`);
        return await this.performToolStreamedRequest(body);

      } catch (error: unknown) {
        lastError = error as Error;
        const msg = error instanceof Error ? error.message : String(error);
        const isFatal = msg.includes('401') || msg.includes('invalid_api_key');
        if (isFatal) throw error;
        this.log(`   Error (Attempt ${attempt}): ${msg}`);
      }
    }

    throw lastError || new Error('Failed after max retries');
  }

  private async performToolStreamedRequest(
    body: Record<string, unknown>
  ): Promise<ToolCallResponse> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(id);

      if (!response.ok) {
        const err = await response.text();
        if (response.status === 429) throw new Error(`Rate Limited (429): ${err}`);
        throw new Error(`OpenAI API error (${response.status}): ${err}`);
      }

      return await this.readToolSSEResponse(response);

    } catch (error: unknown) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(id);
    }
  }

  private async readToolSSEResponse(response: Response): Promise<ToolCallResponse> {
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let buffer = '';
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' = 'stop';

    // Tool calls are accumulated across chunks
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = done ? '' : lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const choice = json.choices[0];
              const delta = choice?.delta;

              // Accumulate content
              if (delta?.content) {
                content += delta.content;
              }

              // Accumulate tool calls
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index;
                  if (!toolCallsMap.has(index)) {
                    toolCallsMap.set(index, {
                      id: tc.id || '',
                      name: tc.function?.name || '',
                      arguments: '',
                    });
                  }
                  const existing = toolCallsMap.get(index)!;
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                }
              }

              // Capture finish reason
              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }
            } catch { }
          }
        }
      }
      if (done) break;
    }

    // Convert map to array
    const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: tc.arguments,
      },
    }));

    this.log(`   Tool response: ${content.length} chars, ${toolCalls.length} tool calls`);

    return {
      content: content || null,
      toolCalls,
      finishReason,
    };
  }

  private async performStreamedRequest(
    body: Record<string, unknown>,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    const progress = this.startStreamProgress();

    try {
      const response = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(id);

      if (!response.ok) {
        const err = await response.text();
        if (response.status === 429) throw new Error(`Rate Limited (429): ${err}`);
        throw new Error(`OpenAI API error (${response.status}): ${err}`);
      }

      return await this.readSSEResponse(response, progress, onChunk);

    } catch (error: unknown) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(id);
    }
  }
}
