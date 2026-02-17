import type { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { substituteTemplate } from '../utils/index.js';
import type { BaseTask } from './BaseTask.js';
import type { TaskRunResult, TaskTestCase } from './types.js';

// ============ DIAGNOSTIC LLM PROXY ============

interface LLMCallRecord {
  renderedPrompt: string;
  promptCharCount: number;
  options: Record<string, unknown>;
  rawOutput: string;
  outputCharCount: number;
  ttftMs: number | null;
  totalMs: number;
}

/**
 * Wraps an ILLMAdapter and records every call's inputs and outputs.
 * Used by the runner to capture the exact rendered prompt, raw output, and timing.
 */
export class DiagnosticLLMProxy implements ILLMAdapter {
  readonly modelName?: string;
  readonly adapterName?: string;
  lastCall: LLMCallRecord | null = null;

  constructor(private inner: ILLMAdapter) {
    this.modelName = inner.modelName;
    this.adapterName = inner.adapterName;
  }

  async complete(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    options?: { maxTokens?: number; expectsJSON?: boolean }
  ): Promise<string> {
    // Render the prompt ourselves to capture it
    const processedVars: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(variables)) {
      processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
    }
    const renderedPrompt = substituteTemplate(prompt, processedVars);

    const start = Date.now();
    const rawOutput = await this.inner.complete(prompt, variables, options);
    const totalMs = Date.now() - start;

    this.lastCall = {
      renderedPrompt,
      promptCharCount: renderedPrompt.length,
      options: options || {},
      rawOutput,
      outputCharCount: rawOutput.length,
      ttftMs: null,
      totalMs,
    };

    return rawOutput;
  }

  async testConnection(): Promise<boolean> {
    return this.inner.testConnection();
  }

  getLastCall(): LLMCallRecord | null {
    return this.lastCall;
  }
}

// ============ TASK RUNNER ============

export interface TaskDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  create: (llm: ILLMAdapter) => BaseTask<TInput, TOutput>;
  testCases: TaskTestCase<TInput, TOutput>[];
}

/**
 * Run a task with a specific test case and capture diagnostics
 */
export async function runTask<TInput, TOutput>(
  llm: ILLMAdapter,
  task: BaseTask<TInput, TOutput>,
  testCase: TaskTestCase<TInput, TOutput>
): Promise<TaskRunResult> {
  const proxy = new DiagnosticLLMProxy(llm);
  // Recreate task with proxy
  const taskWithProxy = Object.create(Object.getPrototypeOf(task));
  Object.assign(taskWithProxy, task);
  taskWithProxy.llm = proxy;

  const start = Date.now();

  try {
    const output = await taskWithProxy.run(testCase.input);
    const validation = testCase.validate(output);
    const durationMs = Date.now() - start;
    const call = proxy.getLastCall();

    return {
      taskId: task.config.id,
      taskName: testCase.name,
      pass: validation.pass,
      validationMessage: validation.message,
      durationMs,
      adapter: proxy.adapterName || 'unknown',
      model: proxy.modelName || 'unknown',
      input: testCase.input,
      renderedPrompt: call?.renderedPrompt ?? null,
      promptCharCount: call?.promptCharCount ?? 0,
      rawOutput: call?.rawOutput ?? null,
      outputCharCount: call?.outputCharCount ?? 0,
      parsedOutput: output,
      expectsJSON: task.expectsJSON,
      ttftMs: call?.ttftMs ?? null,
    };
  } catch (e: unknown) {
    const durationMs = Date.now() - start;
    const call = proxy.getLastCall();
    const error = e instanceof Error ? e.message : String(e);

    return {
      taskId: task.config.id,
      taskName: testCase.name,
      pass: false,
      validationMessage: '',
      durationMs,
      error,
      adapter: proxy.adapterName || 'unknown',
      model: proxy.modelName || 'unknown',
      input: testCase.input,
      renderedPrompt: call?.renderedPrompt ?? null,
      promptCharCount: call?.promptCharCount ?? 0,
      rawOutput: call?.rawOutput ?? null,
      outputCharCount: call?.outputCharCount ?? 0,
      parsedOutput: null,
      expectsJSON: task.expectsJSON,
      ttftMs: call?.ttftMs ?? null,
    };
  }
}

/**
 * Run all test cases for a task definition
 */
export async function runTaskDefinition<TInput, TOutput>(
  llm: ILLMAdapter,
  taskDef: TaskDefinition<TInput, TOutput>
): Promise<TaskRunResult[]> {
  const results: TaskRunResult[] = [];
  const task = taskDef.create(llm);

  for (const testCase of taskDef.testCases) {
    const taskInstance = taskDef.create(llm);
    const result = await runTask(llm, taskInstance, testCase);
    results.push(result);
  }

  return results;
}
