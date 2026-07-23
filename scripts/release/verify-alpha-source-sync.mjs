#!/usr/bin/env node
import { verifyAlphaSourceSync } from './alpha-source-sync.mjs';

try {
  const { sourceCommit } = verifyAlphaSourceSync();
  console.log(`Alpha source sync verified against origin/dev at ${sourceCommit}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
