# PracticaLlmBench

A practical LLM benchmarking engine for user-defined tasks. Evaluate models against your specific use cases, not generic benchmarks.

## Why?

Generic LLM benchmarks (MMLU, HumanEval, etc.) don't tell you how a model will perform on *your* tasks. PracticaLlmBench lets you:

- Define tasks with typed input/output contracts
- Create test cases specific to your domain
- Run benchmarks across multiple models (OpenAI, Ollama, MLX)
- Generate detailed reports with per-task and per-model breakdowns

## Getting Started

```bash
# Clone and install
cd PracticaLlmBench
npm install
npm run build

# Run the example
OPENAI_API_KEY=sk-... npx tsx examples/simple-task.ts
```

## Quick Start

```typescript
// Import from local src (or dist after build)
import {
  BaseTask,
  BenchmarkSuite,
  OpenAIAdapter,
  OllamaAdapter,
  generateTextReport,
} from './src/index.js';

// 1. Define a task
class SentimentTask extends BaseTask<{ text: string }, { sentiment: string }> {
  config = { id: 'sentiment', name: 'Sentiment Analysis' };
  promptTemplate = `Analyze: {{text}}\nRespond with JSON: {"sentiment": "positive"|"negative"|"neutral"}`;
  expectsJSON = true;

  prepareVariables(input) { return { text: input.text }; }
  parseOutput(raw) { return this.extractJSON(raw); }
}

// 2. Create benchmark suite
const suite = new BenchmarkSuite({ name: 'My Benchmark' });

// 3. Add models
suite.addModel('gpt-4o-mini', new OpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
}));
suite.addModel('llama3.2', new OllamaAdapter({
  endpoint: 'http://localhost:11434',
  model: 'llama3.2',
}));

// 4. Add task with test cases
suite.addTask({
  name: 'Sentiment',
  create: (llm) => new SentimentTask(llm),
  testCases: [
    {
      name: 'positive text',
      input: { text: 'I love this!' },
      validate: (o) => ({
        pass: o.sentiment === 'positive',
        message: o.sentiment
      })
    },
  ]
});

// 5. Run and report
const results = await suite.run();
console.log(generateTextReport(results));
```

## Core Concepts

### Task

A **Task** is a typed function wrapping an LLM call:

- `TInput`: The typed input interface
- `TOutput`: The typed output interface
- `promptTemplate`: The prompt with `{{variable}}` placeholders
- `prepareVariables()`: Maps input to template variables
- `parseOutput()`: Parses LLM response to output type

### TaskDefinition

A task packaged with test cases for benchmarking:

```typescript
{
  name: 'My Task',
  create: (llm) => new MyTask(llm),
  testCases: [
    { name: 'test1', input: {...}, validate: (output) => {...} }
  ]
}
```

### BenchmarkSuite

Orchestrates running tasks across models:

```typescript
const suite = new BenchmarkSuite({ name: 'Suite Name' });
suite.addModel('model-name', adapter);
suite.addTask(taskDefinition);
const results = await suite.run();
```

## Adapters

### OpenAI

```typescript
new OpenAIAdapter({
  apiKey: 'sk-...',
  model: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1', // optional
  maxRetries: 3, // optional
  timeoutMs: 30000, // optional
  concurrency: 10, // optional
});
```

### Ollama

```typescript
new OllamaAdapter({
  endpoint: 'http://localhost:11434',
  model: 'llama3.2',
  numCtx: 32768, // optional
  timeoutMs: 600000, // optional
  concurrency: 1, // optional
});
```

### MLX (Apple Silicon)

```typescript
new MLXAdapter({
  endpoint: 'http://localhost:11434/v1',
  model: 'mlx-community/...',
  timeoutMs: 600000, // optional
  concurrency: 1, // optional
});
```

## Reports

### Text Report

```typescript
console.log(generateTextReport(results));
```

### JSON Report

```typescript
fs.writeFileSync('report.json', generateJSONReport(results));
```

### Markdown Report

```typescript
fs.writeFileSync('report.md', generateMarkdownReport(results));
```

## License

MIT
