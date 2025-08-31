#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const category = args[0] || 'all';

console.log(`Running Less tests for category: ${category}`);

const testCommands = {
  all: 'pnpm test packages/jess/test/less/',
  colors: 'pnpm test packages/jess/test/less/colors.test.ts',
  nesting: 'pnpm test packages/jess/test/less/nesting.test.ts',
  functions: 'pnpm test packages/jess/test/less/functions.test.ts',
  variables: 'pnpm test packages/jess/test/less/variables.test.ts',
  general: 'pnpm test packages/jess/test/less/all-less.test.ts'
};

const command = testCommands[category];

if (!command) {
  console.error(`Unknown test category: ${category}`);
  console.log('Available categories:', Object.keys(testCommands).join(', '));
  process.exit(1);
}

try {
  console.log(`Executing: ${command}`);
  execSync(command, { stdio: 'inherit' });
} catch (error) {
  console.error(`Test failed: ${error.message}`);
  process.exit(1);
}
