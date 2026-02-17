import type { ILLMAdapter, CompletionOptions, ToolCallOptions } from './ILLMAdapter.js';
import type { JSONSchemaDefinition, Tool, ToolCallResponse } from '../../core/types.js';
import { Semaphore, substituteTemplate } from '../../utils/index.js';

/**
 * Options passed from the base class to adapter-specific perform methods.
 */
export interface LLMRequestOptions {
  maxTokens?: number;
  expectsJSON?: boolean;
  jsonSchema?: JSONSchemaDefinition;
}

/**
 * Abstract base class for LLM adapters.
 * Handles all shared concerns: concurrency, variable processing, template substitution,
 * output cleaning, JSON extraction, and logging.
 *
 * Concrete adapters only implement transport-specific methods:
 * - performComplete() - make the actual API call and return raw text
 * - performStream() - make a streaming API call, call onChunk for each piece
 * - testConnection() - check if the service is reachable
 */
export abstract class BaseLLMAdapter implements ILLMAdapter {
  readonly modelName?: string;
  readonly adapterName?: string;
  protected semaphore: Semaphore;

  constructor(concurrency: number = 1, modelName?: string, adapterName?: string) {
    this.semaphore = new Semaphore(concurrency);
    this.modelName = modelName;
    this.adapterName = adapterName;
  }

  // ============ PUBLIC API ============

  async complete(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    options?: CompletionOptions
  ): Promise<string> {
    return this.semaphore.run(async () => {
      const finalPrompt = this.preparePrompt(prompt, variables);
      const expectsJSON = options?.expectsJSON !== undefined
        ? options.expectsJSON
        : (options?.jsonSchema != null || this.detectJSONExpectation(prompt));

      const raw = await this.performComplete(finalPrompt, {
        maxTokens: options?.maxTokens,
        expectsJSON,
        jsonSchema: options?.jsonSchema,
      });

      if (!raw || raw.trim().length === 0) {
        throw new Error('Received empty response from API');
      }

      return expectsJSON ? this.extractJSON(raw) : this.cleanOutput(raw);
    });
  }

  async completeWithTools(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    tools: Tool[],
    options?: ToolCallOptions
  ): Promise<ToolCallResponse> {
    return this.semaphore.run(async () => {
      const finalPrompt = this.preparePrompt(prompt, variables);
      return this.performCompleteWithTools(finalPrompt, tools, options);
    });
  }

  async stream(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    onChunk: (chunk: string) => void,
    options?: { maxTokens?: number }
  ): Promise<string> {
    return this.semaphore.run(async () => {
      const finalPrompt = this.preparePrompt(prompt, variables);
      const raw = await this.performStream(finalPrompt, onChunk, {
        maxTokens: options?.maxTokens
      });
      return this.cleanOutput(raw);
    });
  }

  // ============ ABSTRACT - each adapter implements these ============

  protected abstract performComplete(
    finalPrompt: string,
    options?: LLMRequestOptions
  ): Promise<string>;

  protected abstract performStream(
    finalPrompt: string,
    onChunk: (chunk: string) => void,
    options?: LLMRequestOptions
  ): Promise<string>;

  /**
   * Perform a tool-calling request. Override in adapters that support tools.
   * Default throws "not supported".
   */
  protected async performCompleteWithTools(
    finalPrompt: string,
    tools: Tool[],
    options?: ToolCallOptions
  ): Promise<ToolCallResponse> {
    throw new Error(`Tool calling not supported by ${this.adapterName || 'this adapter'}`);
  }

  public abstract testConnection(): Promise<boolean>;

  // ============ SHARED HELPERS ============

  protected preparePrompt(
    prompt: string,
    variables: Record<string, string | number | string[]>
  ): string {
    const processedVars: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(variables)) {
      processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
    }
    return substituteTemplate(prompt, processedVars);
  }

  protected detectJSONExpectation(prompt: string): boolean {
    return prompt.includes('Respond ONLY with JSON') || prompt.includes('Return a JSON');
  }

  protected cleanOutput(text: string): string {
    let clean = text.trim();
    // Remove XML Thinking tags (DeepSeek style)
    clean = clean.replace(/<(think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '');
    // Remove Markdown Code Fences
    const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) clean = jsonMatch[1];
    else clean = clean.replace(/```/g, '');
    return clean.trim();
  }

  protected extractJSON(text: string): string {
    const cleaned = this.cleanOutput(text);
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end >= start) {
      return cleaned.slice(start, end + 1);
    }
    throw new Error(`No JSON object found in LLM response: "${text.slice(0, 80)}..."`);
  }

  protected log(msg: string, data?: unknown): void {
    const ts = new Date().toISOString().split('T')[1].slice(0, -1);
    if (data) console.log(`[${ts}] ${msg}`, data);
    else console.log(`[${ts}] ${msg}`);
  }

  protected startStreamProgress(): StreamProgress {
    return new StreamProgress(this.log.bind(this));
  }

  /**
   * Parse OpenAI-compatible SSE response stream.
   */
  protected async readSSEResponse(
    response: Response,
    progress: StreamProgress,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

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
              const delta = json.choices[0]?.delta;

              if (delta?.reasoning_content) {
                progress.onThinking();
              }

              const content = delta?.content || '';
              if (content) {
                fullText += content;
                progress.onToken();
                if (onChunk) onChunk(content);
              }
            } catch { }
          }
        }
      }
      if (done) break;
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
        try {
          const json = JSON.parse(trimmed.slice(6));
          const content = json.choices[0]?.delta?.content || '';
          if (content) {
            fullText += content;
            if (onChunk) onChunk(content);
          }
        } catch { }
      }
    }

    progress.finish(fullText.length);
    return fullText;
  }
}

/**
 * Encapsulates streaming progress logging
 */
export class StreamProgress {
  private start = Date.now();
  private firstTokenReceived = false;
  private logFn: (msg: string) => void;

  constructor(logFn: (msg: string) => void) {
    this.logFn = logFn;
    process.stdout.write('   Generating: ');
  }

  onToken(): void {
    if (!this.firstTokenReceived) {
      const latency = Date.now() - this.start;
      process.stdout.write(` [TTFT: ${latency}ms] `);
      this.firstTokenReceived = true;
    }
    if (Math.random() > 0.8) process.stdout.write('.');
  }

  onThinking(): void {
    if (!this.firstTokenReceived) {
      process.stdout.write(' (Thinking) ');
      this.firstTokenReceived = true;
    }
    if (Math.random() > 0.9) process.stdout.write('*');
  }

  finish(totalLength: number): void {
    process.stdout.write('\n');
    this.logFn(`   Complete. Output: ${totalLength} chars`);
  }
}
