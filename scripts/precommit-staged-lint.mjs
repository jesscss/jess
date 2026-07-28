#!/usr/bin/env node
/**
 * Fast pre-commit gate: lint ONLY the staged added/modified lines.
 *
 * This is deliberately lightweight — no builds, no test suites, no structural
 * verifiers. Those live in the PR CI workflow and in `pnpm verify:pr`. Keeping
 * this hook snappy is a hard requirement: committing must stay fast.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { stagedTouchedLines, stagedLintableFiles, stagedLintMessages } from './staged-lint.mjs';

const ROOT = process.cwd();

function stagedFiles() {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function stagedHunkLines(file) {
  return stagedTouchedLines(execFileSync('git', ['diff', '--cached', '--unified=0', '--', file], {
    cwd: ROOT,
    encoding: 'utf8'
  }));
}

const files = stagedLintableFiles(stagedFiles());
if (files.length === 0) {
  console.log('- skip staged lint (no staged files in the ESLint policy surface)');
  process.exit(0);
}

console.log(`\n==> ESLint staged API (${files.length} file${files.length === 1 ? '' : 's'})`);

let reports;
try {
  const { lintStagedFiles } = await import('./staged-eslint.mjs');
  reports = await lintStagedFiles(files, { cwd: ROOT });
} catch (error) {
  /*
   * A broken ESLint invocation/config means no complete diagnostic result was
   * available, so it must block rather than be silently skipped.
   */
  const output = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error('ESLint staged API failed before diagnostics could be collected.');
  console.error(output);
  process.exit(1);
}

const actionable = reports.flatMap((report) => {
  const relative = path.relative(ROOT, report.filePath).split(path.sep).join('/');
  const filtered = stagedLintMessages(report.messages ?? [], stagedHunkLines(relative));
  if (report.fatalErrorCount > 0 && !filtered.some(message => message.fatal === true)) {
    filtered.push({
      line: 0,
      column: 0,
      fatal: true,
      message: 'ESLint reported a fatal diagnostic without a corresponding message.'
    });
  }
  return filtered.map(message => ({ filePath: relative, ...message }));
});

if (actionable.length === 0) {
  console.log('- no lint violations on staged added/modified lines');
  process.exit(0);
}

for (const message of actionable) {
  console.error(`${message.filePath}:${message.line}:${message.column} ${message.message}${message.ruleId ? ` (${message.ruleId})` : ''}`);
}
process.exit(1);
