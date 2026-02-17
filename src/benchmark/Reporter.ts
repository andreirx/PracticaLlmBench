import type { SuiteResult, TaskRunResult, BenchmarkResult } from '../core/types.js';

/**
 * Generate a detailed text report from benchmark results
 */
export function generateTextReport(result: SuiteResult): string {
  const lines: string[] = [];
  const hr = (char: string = '=', width: number = 80) => char.repeat(width);
  const indent = (text: string, prefix: string = '  ') =>
    text.split('\n').map(line => prefix + line).join('\n');

  // Header
  lines.push(hr('='));
  lines.push(`PRACTICA LLM BENCHMARK REPORT: ${result.name}`);
  lines.push(hr('='));
  lines.push(`Timestamp:     ${result.timestamp}`);
  lines.push(`Models:        ${result.models.join(', ')}`);
  lines.push(`Tasks:         ${result.totalTasks}`);
  lines.push(`Total Runs:    ${result.totalRuns}`);
  lines.push(`Pass Rate:     ${(result.overallPassRate * 100).toFixed(1)}%`);
  lines.push(`Total Time:    ${result.totalDurationMs}ms`);
  lines.push(hr('='));

  // Per-task sections
  for (const task of result.tasks) {
    lines.push(`\n${hr('-')}`);
    lines.push(`TASK: ${task.taskName}`);
    lines.push(`Pass Rate: ${(task.passRate * 100).toFixed(1)}% | Avg: ${task.avgDurationMs.toFixed(0)}ms | Min: ${task.minDurationMs}ms | Max: ${task.maxDurationMs}ms`);
    lines.push(hr('-'));

    for (const run of task.runs) {
      const status = run.pass ? '[PASS]' : '[FAIL]';
      lines.push(`\n  ${status} ${run.model} (${run.durationMs}ms)`);

      if (run.error) {
        lines.push(`    Error: ${run.error}`);
      }

      lines.push(`    Validation: ${run.validationMessage || '(none)'}`);
      lines.push(`    Prompt: ${run.promptCharCount} chars | Output: ${run.outputCharCount} chars`);
    }
  }

  // Summary table
  lines.push(`\n\n${hr('=')}`);
  lines.push('SUMMARY BY MODEL');
  lines.push(hr('='));

  for (const model of result.models) {
    const modelRuns = result.tasks.flatMap(t => t.runs.filter(r => r.model === model));
    const passed = modelRuns.filter(r => r.pass).length;
    const total = modelRuns.length;
    const avgMs = modelRuns.length > 0
      ? modelRuns.reduce((sum, r) => sum + r.durationMs, 0) / modelRuns.length
      : 0;

    lines.push(`  ${model.padEnd(30)} ${passed}/${total} passed  avg: ${avgMs.toFixed(0)}ms`);
  }

  lines.push(hr('='));

  return lines.join('\n');
}

/**
 * Generate a JSON report
 */
export function generateJSONReport(result: SuiteResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Generate a markdown report
 */
export function generateMarkdownReport(result: SuiteResult): string {
  const lines: string[] = [];

  lines.push(`# Benchmark Report: ${result.name}`);
  lines.push('');
  lines.push(`**Timestamp:** ${result.timestamp}`);
  lines.push(`**Models:** ${result.models.join(', ')}`);
  lines.push(`**Pass Rate:** ${(result.overallPassRate * 100).toFixed(1)}%`);
  lines.push(`**Total Duration:** ${result.totalDurationMs}ms`);
  lines.push('');

  // Summary table
  lines.push('## Summary by Model');
  lines.push('');
  lines.push('| Model | Passed | Total | Pass Rate | Avg Time |');
  lines.push('|-------|--------|-------|-----------|----------|');

  for (const model of result.models) {
    const modelRuns = result.tasks.flatMap(t => t.runs.filter(r => r.model === model));
    const passed = modelRuns.filter(r => r.pass).length;
    const total = modelRuns.length;
    const passRate = total > 0 ? (passed / total * 100).toFixed(1) : '0';
    const avgMs = total > 0
      ? (modelRuns.reduce((sum, r) => sum + r.durationMs, 0) / total).toFixed(0)
      : '0';

    lines.push(`| ${model} | ${passed} | ${total} | ${passRate}% | ${avgMs}ms |`);
  }

  lines.push('');

  // Per-task details
  lines.push('## Task Details');

  for (const task of result.tasks) {
    lines.push('');
    lines.push(`### ${task.taskName}`);
    lines.push('');
    lines.push(`Pass Rate: ${(task.passRate * 100).toFixed(1)}%`);
    lines.push('');

    for (const run of task.runs) {
      const status = run.pass ? '✅' : '❌';
      lines.push(`- ${status} **${run.model}** (${run.durationMs}ms): ${run.validationMessage || run.error || ''}`);
    }
  }

  return lines.join('\n');
}
