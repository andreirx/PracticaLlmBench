import type {
  JSONSchemaDefinition,
  Tool,
  ToolChoice,
  ToolCallResponse,
} from '../../core/types.js';

/**
 * Options for LLM completion requests
 */
export interface CompletionOptions {
  maxTokens?: number;
  expectsJSON?: boolean;
  /** Structured output: force response to match this JSON schema */
  jsonSchema?: JSONSchemaDefinition;
}

/**
 * Options for tool-calling requests
 */
export interface ToolCallOptions {
  maxTokens?: number;
  toolChoice?: ToolChoice;
}

/**
 * Interface for LLM adapters
 * Provides a unified interface for different LLM providers
 */
export interface ILLMAdapter {
  /** Human-readable model identifier (e.g. "gpt-4o-mini", "llama3.2:3b") */
  readonly modelName?: string;
  /** Adapter type (e.g. "openai", "ollama", "mlx") */
  readonly adapterName?: string;

  /**
   * Complete a prompt with the configured LLM
   * @param prompt - The prompt template or direct prompt text
   * @param variables - Variables to substitute in the prompt (if using templates)
   * @param options - Optional settings including JSON schema for structured outputs
   * @returns The completion text from the LLM
   */
  complete(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    options?: CompletionOptions
  ): Promise<string>;

  /**
   * Complete a prompt with tool/function calling support
   * @param prompt - The prompt template or direct prompt text
   * @param variables - Variables to substitute in the prompt
   * @param tools - Available tools the LLM can call
   * @param options - Optional settings
   * @returns Response with content and/or tool calls
   */
  completeWithTools?(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    tools: Tool[],
    options?: ToolCallOptions
  ): Promise<ToolCallResponse>;

  /**
   * Stream a completion from the LLM
   * @param prompt - The prompt template or direct prompt text
   * @param variables - Variables to substitute in the prompt (if using templates)
   * @param onChunk - Callback for each chunk of text received
   * @param options - Optional settings
   * @returns The full completion text
   */
  stream?(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    onChunk: (chunk: string) => void,
    options?: { maxTokens?: number }
  ): Promise<string>;

  /**
   * Test the connection to the LLM service
   * @returns true if connection is successful, false otherwise
   */
  testConnection(): Promise<boolean>;
}
