import type { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { substituteTemplate } from '../utils/index.js';
import type { TaskConfig } from './types.js';

/**
 * A Task = typed function wrapping an LLM call.
 *
 * - TInput: typed input interface
 * - TOutput: typed output interface
 * - promptTemplate: the prompt (the implementation)
 * - parseOutput(): validates LLM response into TOutput
 * - run(input): end-to-end execution
 *
 * This is the core abstraction for benchmarkable LLM tasks.
 */
export abstract class BaseTask<TInput, TOutput> {
  /** Task configuration */
  abstract readonly config: TaskConfig;

  /** The prompt template with {{variable}} placeholders */
  abstract readonly promptTemplate: string;

  /** Whether the LLM should return JSON */
  abstract readonly expectsJSON: boolean;

  constructor(
    protected llm: ILLMAdapter,
    protected promptOverride?: string
  ) {}

  // ============ ABSTRACT METHODS ============

  /** Map typed input to template variables. */
  abstract prepareVariables(input: TInput): Record<string, string | number | string[]>;

  /** Parse raw LLM string into typed output. */
  protected abstract parseOutput(raw: string): TOutput;

  // ============ PUBLIC API ============

  /** End-to-end execution: prepare -> call LLM -> parse. */
  async run(input: TInput, options?: { maxTokens?: number }): Promise<TOutput> {
    const prompt = this.promptOverride || this.promptTemplate;
    const variables = this.prepareVariables(input);

    // Log input size
    const rendered = substituteTemplate(prompt, variables as Record<string, string | number>);
    console.log(`   [${this.config.name}] Input: ${rendered.length} chars`);

    const raw = await this.llm.complete(prompt, variables, {
      maxTokens: options?.maxTokens,
      expectsJSON: this.expectsJSON,
    });

    console.log(`   [${this.config.name}] Output: ${raw.length} chars`);
    return this.parseOutput(raw);
  }

  /** Get the rendered prompt for a given input (useful for debugging). */
  renderPrompt(input: TInput): string {
    const prompt = this.promptOverride || this.promptTemplate;
    const variables = this.prepareVariables(input);
    return substituteTemplate(prompt, variables as Record<string, string | number>);
  }

  // ============ PARSING HELPERS ============

  /** Extract JSON object from raw text. */
  protected extractJSON<T>(text: string): T {
    let clean = text.trim();
    // Remove markdown code blocks
    clean = clean.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1');

    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');

    if (start === -1 || end === -1) {
      throw new Error(`[${this.config.name}] No JSON object found: ${text.slice(0, 200)}`);
    }

    let jsonStr = this.sanitizeJSON(clean.slice(start, end + 1));

    try {
      return JSON.parse(jsonStr) as T;
    } catch (e) {
      throw new Error(`[${this.config.name}] Invalid JSON syntax: ${e}\nInput: ${jsonStr.slice(0, 200)}`);
    }
  }

  /** Extract JSON array from raw text. */
  protected extractJSONArray<T>(text: string): T[] {
    let clean = text.trim();
    clean = clean.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1');

    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');

    if (start === -1 || end === -1) {
      throw new Error(`[${this.config.name}] No JSON array found: ${text.slice(0, 200)}`);
    }

    let jsonStr = this.sanitizeJSON(clean.slice(start, end + 1));

    try {
      return JSON.parse(jsonStr) as T[];
    } catch (e) {
      throw new Error(`[${this.config.name}] JSON array parse failed: ${e}\nInput: ${jsonStr.slice(0, 200)}`);
    }
  }

  /** Apply robustness fixes to JSON strings. */
  private sanitizeJSON(jsonStr: string): string {
    // Fix double-quoted keys
    jsonStr = jsonStr.replace(/"\s+"(\w+)"/g, '"$1"');
    // Remove trailing commas
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
    return jsonStr;
  }
}
