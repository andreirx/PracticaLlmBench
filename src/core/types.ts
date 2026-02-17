/**
 * Core types for PracticaLlmBench
 */

// ============ STRUCTURED OUTPUTS (JSON SCHEMA) ============

/**
 * JSON Schema for structured outputs.
 * When provided, the LLM is forced to return JSON matching this schema.
 */
export interface JSONSchemaDefinition {
  name: string;
  description?: string;
  schema: Record<string, unknown>; // JSON Schema object
  strict?: boolean; // OpenAI: enforce strict schema adherence
}

// ============ FUNCTION/TOOL CALLING ============

/**
 * Definition of a function the LLM can call
 */
export interface ToolFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>; // JSON Schema for parameters
  strict?: boolean; // OpenAI: enforce strict parameter schema
}

/**
 * A tool available to the LLM
 */
export interface Tool {
  type: 'function';
  function: ToolFunction;
}

/**
 * How the LLM should choose which tool to call
 */
export type ToolChoice =
  | 'auto'      // LLM decides whether to call a tool
  | 'required'  // LLM must call at least one tool
  | 'none'      // LLM should not call any tools
  | { type: 'function'; function: { name: string } }; // Force specific tool

/**
 * A tool call made by the LLM
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string of arguments
  };
}

/**
 * Response from completeWithTools()
 */
export interface ToolCallResponse {
  content: string | null;  // Text response (may be null if only tool calls)
  toolCalls: ToolCall[];   // Tool calls made by the model
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

// ============ TASK CONFIGURATION ============

/**
 * Configuration for a benchmarkable task
 */
export interface TaskConfig {
  /** Unique identifier for this task */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this task tests */
  description?: string;
  /** Category for grouping tasks */
  category?: string;
  /** Tags for filtering */
  tags?: string[];
}

/**
 * Result of running a single task on a single model
 */
export interface TaskRunResult {
  taskId: string;
  taskName: string;
  pass: boolean;
  validationMessage: string;
  durationMs: number;
  error?: string;

  // Model info
  adapter: string;
  model: string;

  // I/O details
  input: unknown;
  renderedPrompt: string | null;
  promptCharCount: number;
  rawOutput: string | null;
  outputCharCount: number;
  parsedOutput: unknown;

  // Task metadata
  expectsJSON: boolean;
  ttftMs: number | null;
}

/**
 * Result of benchmarking a task across multiple models
 */
export interface BenchmarkResult {
  taskId: string;
  taskName: string;
  timestamp: string;
  runs: TaskRunResult[];

  // Aggregated metrics
  passRate: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

/**
 * Full benchmark suite result
 */
export interface SuiteResult {
  name: string;
  timestamp: string;
  tasks: BenchmarkResult[];
  models: string[];

  // Summary
  totalTasks: number;
  totalRuns: number;
  overallPassRate: number;
  totalDurationMs: number;
}

/**
 * Test case definition for a task
 */
export interface TaskTestCase<TInput = unknown, TOutput = unknown> {
  name: string;
  input: TInput;
  validate: (output: TOutput) => { pass: boolean; message: string };
}
