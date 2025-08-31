#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const localTestDataPath = path.resolve(__dirname, '../../less.js/packages/test-data');
const nodeModulesPath = path.resolve(__dirname, '../node_modules/@less/test-data');

console.log('Setting up @less/test-data...');

// Check if local test-data exists
if (fs.existsSync(localTestDataPath)) {
  console.log('Found local test-data at:', localTestDataPath);

  // Remove existing node_modules version if it exists
  if (fs.existsSync(nodeModulesPath)) {
    console.log('Removing existing npm version...');
    fs.rmSync(nodeModulesPath, { recursive: true, force: true });
  }

  // Create symlink to local version
  console.log('Creating symlink to local version...');
  fs.symlinkSync(localTestDataPath, nodeModulesPath, 'dir');
  console.log('✅ Using local test-data');
} else {
  console.log('Local test-data not found, using npm version');
  console.log('To use local version, ensure ../less.js/packages/test-data exists');
}

console.log('Setup complete!');
