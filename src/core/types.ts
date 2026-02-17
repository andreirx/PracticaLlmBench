/**
 * Core types for PracticaLlmBench
 */

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
