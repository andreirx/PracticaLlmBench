import type { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import type { TaskDefinition } from '../core/TaskRunner.js';
import { runTaskDefinition } from '../core/TaskRunner.js';
import type { BenchmarkResult, SuiteResult, TaskRunResult } from '../core/types.js';

/**
 * Configuration for a benchmark suite
 */
export interface BenchmarkSuiteConfig {
  name: string;
  description?: string;
}

/**
 * A benchmark suite that runs tasks across multiple models
 */
export class BenchmarkSuite {
  private tasks: TaskDefinition[] = [];
  private models: Map<string, ILLMAdapter> = new Map();

  constructor(private config: BenchmarkSuiteConfig) {}

  /**
   * Add a task to the benchmark suite
   */
  addTask<TInput, TOutput>(task: TaskDefinition<TInput, TOutput>): this {
    this.tasks.push(task as TaskDefinition);
    return this;
  }

  /**
   * Add a model to benchmark against
   */
  addModel(name: string, adapter: ILLMAdapter): this {
    this.models.set(name, adapter);
    return this;
  }

  /**
   * Run the benchmark suite
   */
  async run(options?: {
    onTaskStart?: (taskName: string, modelName: string) => void;
    onTaskComplete?: (result: TaskRunResult) => void;
    filterTasks?: string[];
  }): Promise<SuiteResult> {
    const timestamp = new Date().toISOString();
    const taskResults: BenchmarkResult[] = [];
    let totalRuns = 0;
    let totalPassed = 0;
    const startTime = Date.now();

    // Filter tasks if specified
    let tasksToRun = this.tasks;
    if (options?.filterTasks && options.filterTasks.length > 0) {
      tasksToRun = this.tasks.filter(t =>
        options.filterTasks!.some(f =>
          t.name.toLowerCase().includes(f.toLowerCase())
        )
      );
    }

    for (const taskDef of tasksToRun) {
      const runs: TaskRunResult[] = [];

      for (const [modelName, adapter] of this.models) {
        options?.onTaskStart?.(taskDef.name, modelName);

        const modelRuns = await runTaskDefinition(adapter, taskDef);
        for (const run of modelRuns) {
          options?.onTaskComplete?.(run);
          runs.push(run);
          totalRuns++;
          if (run.pass) totalPassed++;
        }
      }

      // Aggregate metrics
      const passRate = runs.length > 0
        ? runs.filter(r => r.pass).length / runs.length
        : 0;
      const durations = runs.map(r => r.durationMs);
      const avgDuration = durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

      taskResults.push({
        taskId: taskDef.name,
        taskName: taskDef.name,
        timestamp,
        runs,
        passRate,
        avgDurationMs: avgDuration,
        minDurationMs: Math.min(...durations, 0),
        maxDurationMs: Math.max(...durations, 0),
      });
    }

    const totalDurationMs = Date.now() - startTime;

    return {
      name: this.config.name,
      timestamp,
      tasks: taskResults,
      models: Array.from(this.models.keys()),
      totalTasks: tasksToRun.length,
      totalRuns,
      overallPassRate: totalRuns > 0 ? totalPassed / totalRuns : 0,
      totalDurationMs,
    };
  }
}
