/**
 * Example: Simple Sentiment Analysis Benchmark
 *
 * This example shows how to:
 * 1. Define a custom task (SentimentTask)
 * 2. Create test cases for it
 * 3. Run benchmarks across multiple models
 * 4. Generate reports
 *
 * Run with: npx tsx examples/simple-task.ts
 */

import {
  BaseTask,
  BenchmarkSuite,
  OpenAIAdapter,
  OllamaAdapter,
  generateTextReport,
  generateMarkdownReport,
  type TaskConfig,
  type ILLMAdapter,
} from '../src/index.js';

// ============ DEFINE A TASK ============

interface SentimentInput {
  text: string;
}

interface SentimentOutput {
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
}

class SentimentTask extends BaseTask<SentimentInput, SentimentOutput> {
  readonly config: TaskConfig = {
    id: 'sentiment-analysis',
    name: 'Sentiment Analysis',
    description: 'Classify text sentiment as positive, negative, or neutral',
    category: 'classification',
    tags: ['nlp', 'sentiment'],
  };

  readonly promptTemplate = `Analyze the sentiment of the following text.

Text: {{text}}

Respond ONLY with JSON in this exact format:
{
  "sentiment": "positive" | "negative" | "neutral",
  "confidence": 0.0-1.0
}`;

  readonly expectsJSON = true;

  prepareVariables(input: SentimentInput): Record<string, string> {
    return { text: input.text };
  }

  protected parseOutput(raw: string): SentimentOutput {
    return this.extractJSON<SentimentOutput>(raw);
  }
}

// ============ DEFINE TEST CASES ============

const sentimentTestCases = [
  {
    name: 'clearly positive',
    input: { text: 'I absolutely love this product! It exceeded all my expectations!' },
    validate: (output: SentimentOutput) => ({
      pass: output.sentiment === 'positive' && output.confidence > 0.5,
      message: `sentiment=${output.sentiment}, confidence=${output.confidence}`,
    }),
  },
  {
    name: 'clearly negative',
    input: { text: 'This is terrible. Complete waste of money. Very disappointed.' },
    validate: (output: SentimentOutput) => ({
      pass: output.sentiment === 'negative' && output.confidence > 0.5,
      message: `sentiment=${output.sentiment}, confidence=${output.confidence}`,
    }),
  },
  {
    name: 'neutral/mixed',
    input: { text: 'The product arrived on time. It works as described.' },
    validate: (output: SentimentOutput) => ({
      pass: ['neutral', 'positive'].includes(output.sentiment),
      message: `sentiment=${output.sentiment}, confidence=${output.confidence}`,
    }),
  },
];

// ============ RUN BENCHMARK ============

async function main() {
  console.log('PracticaLlmBench - Sentiment Analysis Benchmark\n');

  // Create benchmark suite
  const suite = new BenchmarkSuite({
    name: 'Sentiment Analysis Benchmark',
    description: 'Compare sentiment analysis across different LLMs',
  });

  // Add models (uncomment the ones you have access to)

  // OpenAI (requires OPENAI_API_KEY env var)
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    suite.addModel(model, new OpenAIAdapter({
      apiKey: process.env.OPENAI_API_KEY,
      model,
    }));
  }

  // Ollama (requires local Ollama server)
  try {
    const model = process.env.OLLAMA_MODEL || 'llama3.2:3b';
    const ollamaTest = new OllamaAdapter({
      endpoint: 'http://localhost:11434',
      model,
    });
    if (await ollamaTest.testConnection()) {
      suite.addModel(model, ollamaTest);
    }
  } catch {
    console.log('Ollama not available, skipping...');
  }

  // Add the sentiment task
  suite.addTask({
    name: 'Sentiment Analysis',
    create: (llm: ILLMAdapter) => new SentimentTask(llm),
    testCases: sentimentTestCases,
  });

  // Run with progress callbacks
  console.log('Running benchmark...\n');

  const results = await suite.run({
    onTaskStart: (taskName, modelName) => {
      console.log(`  Starting: ${taskName} on ${modelName}`);
    },
    onTaskComplete: (result) => {
      const status = result.pass ? '✓' : '✗';
      console.log(`    ${status} ${result.taskName}: ${result.validationMessage || result.error}`);
    },
  });

  // Generate reports
  console.log('\n' + '='.repeat(60));
  console.log('TEXT REPORT:');
  console.log('='.repeat(60) + '\n');
  console.log(generateTextReport(results));

  // Save markdown report
  const mdReport = generateMarkdownReport(results);
  console.log('\n' + '='.repeat(60));
  console.log('MARKDOWN REPORT:');
  console.log('='.repeat(60) + '\n');
  console.log(mdReport);
}

main().catch(console.error);
