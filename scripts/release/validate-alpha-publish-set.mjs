#!/usr/bin/env node
import path from 'node:path';
import { getAlphaReleasePlan } from './release-utils.mjs';

const rootDir = process.cwd();
const allowlistPath = path.join(rootDir, 'scripts/release/alpha-allowlist.json');
const plan = getAlphaReleasePlan({ rootDir, allowlistPath });

if (plan.errors.length > 0) {
  console.error('Alpha publish-set validation failed:\n');
  for (const error of plan.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const version = plan.packages[0]?.manifest.version ?? 'unknown';
console.log(`Alpha publish-set validation passed (${plan.allowlist.length} packages, version ${version}).`);
console.log('\nTopological publish order:');
for (const name of plan.publishOrder) {
  const pkg = plan.packagesByName.get(name);
  const relativeDir = path.relative(rootDir, pkg.dir);
  console.log(`- ${name} (${relativeDir})`);
}
