import { BaseLLMAdapter, LLMRequestOptions } from './BaseLLMAdapter.js';
import type { ToolCallOptions } from './ILLMAdapter.js';
import type { Tool, ToolCallResponse, ToolCall } from '../../core/types.js';
import { Agent } from 'undici';

export interface OllamaConfig {
  endpoint: string;
  model: string;
  timeoutMs?: number;
  numCtx?: number;
  concurrency?: number;
}

export class OllamaAdapter extends BaseLLMAdapter {
  private endpoint: string;
  private model: string;
  private timeoutMs: number;
  private numCtx: number;

  constructor(config: OllamaConfig) {
    super(config.concurrency || 1, config.model, 'ollama');
    this.endpoint = config.endpoint.endsWith('/') ? config.endpoint.slice(0, -1) : config.endpoint;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs || 600000; // 10 minutes
    this.numCtx = config.numCtx || 32768;
  }

  protected async performComplete(
    finalPrompt: string,
    options?: LLMRequestOptions
  ): Promise<string> {
    const predictLimit = options?.maxTokens ?? 4096;

    const body: Record<string, unknown> = {
      model: this.model,
      prompt: finalPrompt,
      stream: true,
      options: {
        temperature: 0.1,
        num_ctx: this.numCtx,
        num_predict: predictLimit
      }
    };

    // Structured outputs (JSON Schema) takes precedence over basic JSON mode
    if (options?.jsonSchema) {
      body.format = options.jsonSchema.schema;
    } else if (options?.expectsJSON) {
      body.format = 'json';
    }

    this.log(`LLM CALL [${this.model}]`);
    return this.performOllamaStream(body);
  }

  protected async performStream(
    finalPrompt: string,
    onChunk: (chunk: string) => void,
    options?: LLMRequestOptions
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: finalPrompt,
      stream: true,
      options: {
        temperature: 0.1,
        num_ctx: this.numCtx,
        num_predict: options?.maxTokens || 4096
      }
    };

    this.log(`LLM STREAM [${this.model}]`);
    return this.performOllamaStream(body, onChunk);
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      return res.ok;
    } catch { return false; }
  }

  protected async performCompleteWithTools(
    finalPrompt: string,
    tools: Tool[],
    options?: ToolCallOptions
  ): Promise<ToolCallResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: finalPrompt }],
      stream: false, // Ollama tool calling works better non-streaming
      tools: tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      })),
      options: {
        temperature: 0.1,
        num_ctx: this.numCtx,
        num_predict: options?.maxTokens || 4096,
      }
    };

    this.log(`LLM TOOL CALL [${this.model}]`);
    return this.performOllamaChatWithTools(body);
  }

  private async performOllamaChatWithTools(
    body: Record<string, unknown>
  ): Promise<ToolCallResponse> {
    const dispatcher = new Agent({
      headersTimeout: this.timeoutMs,
      connectTimeout: this.timeoutMs,
      bodyTimeout: 0
    });

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // @ts-ignore - dispatcher is a Node.js specific extension
        dispatcher,
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);

      const json = await response.json() as {
        message?: {
          content?: string;
          tool_calls?: Array<{
            function: { name: string; arguments: Record<string, unknown> };
          }>;
        };
        done_reason?: string;
      };

      const message = json.message;
      const toolCalls: ToolCall[] = (message?.tool_calls || []).map((tc, i) => ({
        id: `call_${i}`,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments),
        },
      }));

      const finishReason = json.done_reason === 'stop' ? 'stop' as const :
                          toolCalls.length > 0 ? 'tool_calls' as const : 'stop' as const;

      this.log(`   Tool response: ${message?.content?.length || 0} chars, ${toolCalls.length} tool calls`);

      return {
        content: message?.content || null,
        toolCalls,
        finishReason,
      };

    } catch (error) {
      this.log(`   LLM Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Ollama uses NDJSON streaming (not SSE).
   */
  private async performOllamaStream(
    body: Record<string, unknown>,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const dispatcher = new Agent({
      headersTimeout: this.timeoutMs,
      connectTimeout: this.timeoutMs,
      bodyTimeout: 0
    });

    const progress = this.startStreamProgress();

    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // @ts-ignore - dispatcher is a Node.js specific extension
        dispatcher,
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              if (json.response) {
                fullText += json.response;
                progress.onToken();
                if (onChunk) onChunk(json.response);
              }
              if (json.done) done = true;
            } catch { }
          }
        }
      }

      progress.finish(fullText.length);
      return fullText;

    } catch (error) {
      this.log(`   LLM Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
