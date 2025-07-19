#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findTestFiles(dir) {
  const files = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '__tests__') {
          // Found a __tests__ directory, look for .ts files
          const testFiles = fs.readdirSync(fullPath)
            .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'))
            .map(file => path.join(fullPath, file));

          files.push(...testFiles);
        } else {
          // Recursively search subdirectories
          files.push(...findTestFiles(fullPath));
        }
      }
    }
  } catch (err) {
    // Skip directories we can't read
  }

  return files;
}

function renameTestFiles() {
  const testFiles = findTestFiles('.');

  for (const file of testFiles) {
    const dir = path.dirname(file);
    const filename = path.basename(file, '.ts');
    const newFile = path.join(dir, `${filename}.test.ts`);

    console.log(`Renaming: ${file} -> ${newFile}`);
    fs.renameSync(file, newFile);
  }

  console.log(`Renamed ${testFiles.length} test files.`);
}

renameTestFiles();