#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from '@typescript/typescript6';

function configSyntaxKind(path) {
  if (/(^|\/)tsconfig(?:\.[^/]+)?\.json$/u.test(path)) {
    return 'jsonc';
  }
  // VS Code reads workspace settings, launch, and task files as JSON with
  // comments. Keep this narrow: extension manifests and grammar data remain
  // strict JSON because their consumers require strict JSON.
  if (/(^|\/)\.vscode\/(?:launch|settings|tasks)\.json$/u.test(path)) {
    return 'jsonc';
  }
  return 'json';
}

function validateConfigText(path, text) {
  if (configSyntaxKind(path) === 'jsonc') {
    const result = ts.parseConfigFileTextToJson(path, text);
    return result.error
      ? ts.flattenDiagnosticMessageText(result.error.messageText, '\n')
      : undefined;
  }
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function trackedJsonFiles() {
  return execFileSync('git', ['ls-files', '--', '*.json'], {
    encoding: 'utf8'
  }).split('\n').filter(Boolean);
}

function stagedJsonFiles() {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--', '*.json'], {
    encoding: 'utf8'
  }).split('\n').filter(Boolean);
}

function readStagedFile(path) {
  return execFileSync('git', ['show', `:${path}`], { encoding: 'utf8' });
}

function run() {
  const staged = process.argv.includes('--staged');
  const files = staged ? stagedJsonFiles() : trackedJsonFiles();
  const errors = [];
  for (const path of files) {
    const text = staged ? readStagedFile(path) : readFileSync(path, 'utf8');
    const error = validateConfigText(path, text);
    if (error) {
      errors.push(`${path}: ${error}`);
    }
  }
  if (errors.length > 0) {
    console.error('Invalid configuration syntax:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Configuration syntax passed (${files.length} ${staged ? 'staged' : 'tracked'} JSON file(s); known JSONC consumers parsed as JSONC).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}

export {
  configSyntaxKind,
  validateConfigText
};
