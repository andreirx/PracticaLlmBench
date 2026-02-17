/**
 * Tests for BaseTask and TaskRunner
 */

import { describe, it, expect, vi } from 'vitest';
import { BaseTask } from './BaseTask.js';
import { DiagnosticLLMProxy, runTask } from './TaskRunner.js';
import type { TaskConfig } from './types.js';
import type { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';

// Mock LLM adapter matching ILLMAdapter interface
function createMockAdapter(response: string): ILLMAdapter {
  return {
    modelName: 'test-model',
    adapterName: 'test-adapter',
    complete: vi.fn().mockResolvedValue(response),
    testConnection: vi.fn().mockResolvedValue(true),
  };
}

// Simple test task
interface TestInput {
  value: string;
}

interface TestOutput {
  result: string;
}

class EchoTask extends BaseTask<TestInput, TestOutput> {
  readonly config: TaskConfig = {
    id: 'echo',
    name: 'Echo Task',
    description: 'Echoes the input',
  };

  readonly promptTemplate = 'Echo this: {{value}}. Respond with JSON: {"result": "..."}';
  readonly expectsJSON = true;

  prepareVariables(input: TestInput): Record<string, string> {
    return { value: input.value };
  }

  protected parseOutput(raw: string): TestOutput {
    return this.extractJSON<TestOutput>(raw);
  }
}

describe('BaseTask', () => {
  it('should run task and parse JSON output', async () => {
    const mockAdapter = createMockAdapter('{"result": "hello world"}');
    const task = new EchoTask(mockAdapter);

    const output = await task.run({ value: 'hello world' });

    expect(output.result).toBe('hello world');
    expect(mockAdapter.complete).toHaveBeenCalled();
  });

  it('should pass variables to LLM adapter', async () => {
    const mockAdapter = createMockAdapter('{"result": "test"}');
    const task = new EchoTask(mockAdapter);

    await task.run({ value: 'test input' });

    // Check that complete was called with the template and variables
    const callArgs = (mockAdapter.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain('{{value}}'); // Template with placeholder
    expect(callArgs[1]).toEqual({ value: 'test input' }); // Variables
  });

  it('should extract JSON from markdown code blocks', async () => {
    const mockAdapter = createMockAdapter('Here is the response:\n```json\n{"result": "extracted"}\n```');
    const task = new EchoTask(mockAdapter);

    const output = await task.run({ value: 'test' });

    expect(output.result).toBe('extracted');
  });

  it('should render prompt correctly', () => {
    const mockAdapter = createMockAdapter('');
    const task = new EchoTask(mockAdapter);

    const rendered = task.renderPrompt({ value: 'hello' });

    expect(rendered).toContain('Echo this: hello');
    expect(rendered).not.toContain('{{value}}');
  });
});

describe('DiagnosticLLMProxy', () => {
  it('should record LLM calls', async () => {
    const mockAdapter = createMockAdapter('{"result": "test"}');
    const proxy = new DiagnosticLLMProxy(mockAdapter);

    await proxy.complete('Test prompt: {{name}}', { name: 'Alice' }, { maxTokens: 100, expectsJSON: true });

    expect(proxy.lastCall).not.toBeNull();
    expect(proxy.lastCall?.renderedPrompt).toBe('Test prompt: Alice');
    expect(proxy.lastCall?.rawOutput).toBe('{"result": "test"}');
    expect(proxy.lastCall?.options.maxTokens).toBe(100);
    expect(proxy.lastCall?.options.expectsJSON).toBe(true);
  });

  it('should record timing information', async () => {
    const mockAdapter = createMockAdapter('response');
    const proxy = new DiagnosticLLMProxy(mockAdapter);

    await proxy.complete('prompt', {});

    expect(proxy.lastCall?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('should record prompt character count', async () => {
    const mockAdapter = createMockAdapter('response');
    const proxy = new DiagnosticLLMProxy(mockAdapter);

    await proxy.complete('Hello {{name}}!', { name: 'World' });

    expect(proxy.lastCall?.renderedPrompt).toBe('Hello World!');
    expect(proxy.lastCall?.promptCharCount).toBe(12);
  });
});

describe('runTask', () => {
  it('should run task with test case and validate', async () => {
    const mockAdapter = createMockAdapter('{"result": "positive"}');
    const task = new EchoTask(mockAdapter);

    const result = await runTask(
      mockAdapter,
      task,
      {
        name: 'test case',
        input: { value: 'test' },
        validate: (output) => ({
          pass: output.result === 'positive',
          message: `result=${output.result}`,
        }),
      }
    );

    expect(result.pass).toBe(true);
    expect(result.validationMessage).toBe('result=positive');
    expect(result.parsedOutput).toEqual({ result: 'positive' });
  });

  it('should handle validation failure', async () => {
    const mockAdapter = createMockAdapter('{"result": "negative"}');
    const task = new EchoTask(mockAdapter);

    const result = await runTask(
      mockAdapter,
      task,
      {
        name: 'test case',
        input: { value: 'test' },
        validate: (output) => ({
          pass: output.result === 'positive',
          message: `expected positive, got ${output.result}`,
        }),
      }
    );

    expect(result.pass).toBe(false);
    expect(result.validationMessage).toContain('negative');
  });

  it('should handle task errors', async () => {
    const mockAdapter: ILLMAdapter = {
      complete: vi.fn().mockRejectedValue(new Error('API error')),
      testConnection: vi.fn(),
    };
    const task = new EchoTask(mockAdapter);

    const result = await runTask(
      mockAdapter,
      task,
      {
        name: 'test case',
        input: { value: 'test' },
        validate: () => ({ pass: true, message: 'ok' }),
      }
    );

    expect(result.pass).toBe(false);
    expect(result.error).toBe('API error');
  });

  it('should capture prompt and output metadata', async () => {
    const mockAdapter = createMockAdapter('{"result": "captured"}');
    const task = new EchoTask(mockAdapter);

    const result = await runTask(
      mockAdapter,
      task,
      {
        name: 'metadata test',
        input: { value: 'capture me' },
        validate: () => ({ pass: true, message: 'ok' }),
      }
    );

    expect(result.renderedPrompt).toContain('capture me');
    expect(result.rawOutput).toBe('{"result": "captured"}');
    expect(result.promptCharCount).toBeGreaterThan(0);
    expect(result.outputCharCount).toBe(22); // {"result": "captured"}
  });
});
