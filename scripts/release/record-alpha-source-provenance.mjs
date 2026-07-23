#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ALPHA_BRANCH,
  ALPHA_SOURCE_PROVENANCE_PATH,
  ALPHA_SOURCE_PROVENANCE_SCHEMA,
  ALPHA_SOURCE_REF,
  currentBranch,
  fetchAlphaSource
} from './alpha-source-sync.mjs';

function parseArgs(argv) {
  if (argv.slice(2).includes('--help') || argv.slice(2).includes('-h')) {
    return { help: true, stage: false };
  }
  if (argv.slice(2).length === 1 && argv[2] === '--stage') {
    return { help: false, stage: true };
  }
  if (argv.slice(2).length === 0) {
    return { help: false, stage: false };
  }
  throw new Error('Usage: node scripts/release/record-alpha-source-provenance.mjs --stage');
}

function stage(rootDir, relativePath) {
  const result = spawnSync('git', ['add', '--', relativePath], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Could not stage ${relativePath}.`);
  }
}

function main() {
  const { help, stage: shouldStage } = parseArgs(process.argv);
  if (help) {
    console.log('Usage: node scripts/release/record-alpha-source-provenance.mjs --stage');
    return;
  }
  if (!shouldStage) {
    throw new Error('Missing required --stage; provenance must enter the controlled alpha snapshot index.');
  }
  const rootDir = process.cwd();
  if (currentBranch(rootDir) !== ALPHA_BRANCH) {
    throw new Error(`Alpha source provenance must run on branch '${ALPHA_BRANCH}'.`);
  }
  const sourceCommit = fetchAlphaSource(rootDir);
  const relativePath = ALPHA_SOURCE_PROVENANCE_PATH;
  const provenancePath = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(provenancePath), { recursive: true });
  writeFileSync(provenancePath, `${JSON.stringify({
    schemaVersion: ALPHA_SOURCE_PROVENANCE_SCHEMA,
    sourceRef: ALPHA_SOURCE_REF,
    sourceCommit
  }, null, 2)}\n`);
  stage(rootDir, relativePath);
  console.log(`Recorded and staged alpha source provenance: ${ALPHA_SOURCE_REF} at ${sourceCommit}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
