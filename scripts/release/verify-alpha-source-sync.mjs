#!/usr/bin/env node
import { verifyAlphaSourceSync } from './alpha-source-sync.mjs';

try {
  const { sourceCommit, provenance, sourceDrift } = verifyAlphaSourceSync();
  console.log(`Alpha source projection verified from ${provenance.sourceCommit} against origin/dev at ${sourceCommit}`
    + ` (${sourceDrift} commits ahead).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
