/**
 * PracticaLlmBench - A practical LLM benchmarking engine for user-defined tasks
 *
 * Core concepts:
 * - Task: A typed LLM call with input/output contracts (TInput -> TOutput)
 * - TaskDefinition: A task with test cases for benchmarking
 * - BenchmarkSuite: Runs tasks across multiple models
 *
 * Example:
 * ```typescript
 * import { BaseTask, BenchmarkSuite, OpenAIAdapter, OllamaAdapter } from 'practica-llm-bench';
 *
 * // Define a task
 * class SentimentTask extends BaseTask<{ text: string }, { sentiment: string }> {
 *   config = { id: 'sentiment', name: 'Sentiment Analysis' };
 *   promptTemplate = 'Analyze the sentiment of: {{text}}\nRespond with JSON: {"sentiment": "positive"|"negative"|"neutral"}';
 *   expectsJSON = true;
 *
 *   prepareVariables(input) { return { text: input.text }; }
 *   parseOutput(raw) { return this.extractJSON(raw); }
 * }
 *
 * // Create benchmark suite
 * const suite = new BenchmarkSuite({ name: 'Sentiment Benchmark' });
 * suite.addModel('gpt-4o-mini', new OpenAIAdapter({ apiKey: '...', model: 'gpt-4o-mini' }));
 * suite.addModel('llama3.2', new OllamaAdapter({ endpoint: '...', model: 'llama3.2' }));
 * suite.addTask({
 *   name: 'Sentiment',
 *   create: (llm) => new SentimentTask(llm),
 *   testCases: [
 *     { name: 'positive', input: { text: 'I love this!' }, validate: (o) => ({ pass: o.sentiment === 'positive', message: o.sentiment }) }
 *   ]
 * });
 *
 * const results = await suite.run();
 * ```
 */

// Core
export { BaseTask } from './core/BaseTask.js';
export {
  DiagnosticLLMProxy,
  runTask,
  runTaskDefinition,
  type TaskDefinition,
} from './core/TaskRunner.js';
export type {
  TaskConfig,
  TaskRunResult,
  BenchmarkResult,
  SuiteResult,
  TaskTestCase,
  // Structured outputs & tool calling
  JSONSchemaDefinition,
  Tool,
  ToolFunction,
  ToolChoice,
  ToolCall,
  ToolCallResponse,
} from './core/types.js';

// Benchmark
export {
  BenchmarkSuite,
  type BenchmarkSuiteConfig,
} from './benchmark/BenchmarkSuite.js';
export {
  generateTextReport,
  generateJSONReport,
  generateMarkdownReport,
} from './benchmark/Reporter.js';

// Adapters
export type { ILLMAdapter, CompletionOptions, ToolCallOptions } from './adapters/llm/ILLMAdapter.js';
export { BaseLLMAdapter, type LLMRequestOptions } from './adapters/llm/BaseLLMAdapter.js';
export { OpenAIAdapter, type OpenAIConfig } from './adapters/llm/OpenAIAdapter.js';
export { OllamaAdapter, type OllamaConfig } from './adapters/llm/OllamaAdapter.js';
export { MLXAdapter, type MLXConfig } from './adapters/llm/MLXAdapter.js';

// Utilities
export { Semaphore, substituteTemplate } from './utils/index.js';
