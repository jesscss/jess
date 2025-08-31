#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('Cleaning up original test files that have been replaced...');

// Files to remove (original files that have been replaced by focused tests)
const filesToRemove = [
  'node_modules/@less/test-data/less/_main/colors.less',
  'node_modules/@less/test-data/css/_main/colors.css',
  'node_modules/@less/test-data/less/_main/colors2.less',
  'node_modules/@less/test-data/css/_main/colors2.css',
  'node_modules/@less/test-data/less/_main/calc.less',
  'node_modules/@less/test-data/css/_main/calc.css',
  'node_modules/@less/test-data/less/_main/charsets.less',
  'node_modules/@less/test-data/css/_main/charsets.css',
  'node_modules/@less/test-data/less/_main/import/import-charset-test.less',
  'node_modules/@less/test-data/less/_main/comments.less',
  'node_modules/@less/test-data/css/_main/comments.css',
  'node_modules/@less/test-data/less/_main/comments2.less',
  'node_modules/@less/test-data/css/_main/comments2.css',
  'node_modules/@less/test-data/less/_main/variables.less',
  'node_modules/@less/test-data/css/_main/variables.css',
  'node_modules/@less/test-data/less/_main/operations.less',
  'node_modules/@less/test-data/css/_main/operations.css',
  'node_modules/@less/test-data/less/_main/strings.less',
  'node_modules/@less/test-data/css/_main/strings.css',
  'node_modules/@less/test-data/less/_main/javascript.less',
  'node_modules/@less/test-data/css/_main/javascript.css',
  'node_modules/@less/test-data/less/_main/css-escapes.less',
  'node_modules/@less/test-data/css/_main/css-escapes.css',
  'node_modules/@less/test-data/less/_main/whitespace.less',
  'node_modules/@less/test-data/css/_main/whitespace.css',
  'node_modules/@less/test-data/less/_main/extend.less',
  'node_modules/@less/test-data/css/_main/extend.css',
  'node_modules/@less/test-data/less/_main/rulesets.less',
  'node_modules/@less/test-data/css/_main/rulesets.css',
  'node_modules/@less/test-data/less/_main/property-name-interp.less',
  'node_modules/@less/test-data/css/_main/property-name-interp.css',
  'node_modules/@less/test-data/less/_main/parse-interpolation.less',
  'node_modules/@less/test-data/css/_main/parse-interpolation.css',
  'node_modules/@less/test-data/less/_main/lazy-eval.less',
  'node_modules/@less/test-data/css/_main/lazy-eval.css',
  'node_modules/@less/test-data/less/_main/merge.less',
  'node_modules/@less/test-data/css/_main/merge.css',
  'node_modules/@less/test-data/less/_main/selectors.less',
  'node_modules/@less/test-data/css/_main/selectors.css',
  'node_modules/@less/test-data/less/_main/urls.less',
  'node_modules/@less/test-data/css/_main/urls.css',
  'node_modules/@less/test-data/less/_main/scope.less',
  'node_modules/@less/test-data/css/_main/scope.css',
  'node_modules/@less/test-data/less/_main/no-output.less',
  'node_modules/@less/test-data/css/_main/no-output.css',
  'node_modules/@less/test-data/less/_main/empty.less',
  'node_modules/@less/test-data/css/_main/empty.css',
  'node_modules/@less/test-data/less/_main/mixin-noparens.less',
  'node_modules/@less/test-data/css/_main/mixin-noparens.css',
  'node_modules/@less/test-data/less/_main/mixins-closure.less',
  'node_modules/@less/test-data/css/_main/mixins-closure.css',
  'node_modules/@less/test-data/less/_main/mixins-important.less',
  'node_modules/@less/test-data/css/_main/mixins-important.css',
  'node_modules/@less/test-data/less/_main/mixins-named-args.less',
  'node_modules/@less/test-data/css/_main/mixins-named-args.css',
  'node_modules/@less/test-data/less/_main/mixins-nested.less',
  'node_modules/@less/test-data/css/_main/mixins-nested.css',
  'node_modules/@less/test-data/less/_main/mixins-pattern.less',
  'node_modules/@less/test-data/css/_main/mixins-pattern.css',
  'node_modules/@less/test-data/less/_main/mixins-interpolated.less',
  'node_modules/@less/test-data/css/_main/mixins-interpolated.css',
  'node_modules/@less/test-data/less/_main/plugin-module.less',
  'node_modules/@less/test-data/css/_main/plugin-module.css',
  'node_modules/@less/test-data/less/_main/plugi.less',
  'node_modules/@less/test-data/css/_main/plugi.css',
  'node_modules/@less/test-data/less/_main/impor.less',
  'node_modules/@less/test-data/css/_main/impor.css',
  'node_modules/@less/test-data/less/_main/plugin-preeval.less',
  'node_modules/@less/test-data/css/_main/plugin-preeval.css',
  'node_modules/@less/test-data/less/_main/variables-in-at-rules.less',
  'node_modules/@less/test-data/css/_main/variables-in-at-rules.css',
  'node_modules/@less/test-data/less/_main/import-inline.less',
  'node_modules/@less/test-data/css/_main/import-inline.css',
  'node_modules/@less/test-data/less/_main/import-interpolation.less',
  'node_modules/@less/test-data/css/_main/import-interpolation.css',
  'node_modules/@less/test-data/less/_main/import-module.less',
  'node_modules/@less/test-data/css/_main/import-module.css',
  'node_modules/@less/test-data/less/_main/import-once.less',
  'node_modules/@less/test-data/css/_main/import-once.css',
  'node_modules/@less/test-data/less/_main/import-reference.less',
  'node_modules/@less/test-data/css/_main/import-reference.css',
  'node_modules/@less/test-data/less/_main/import-remote.less',
  'node_modules/@less/test-data/css/_main/import-remote.css',
  'node_modules/@less/test-data/less/_main/import.less',
  'node_modules/@less/test-data/css/_main/import.css',
  'node_modules/@less/test-data/less/_main/color-functions' // directory
];

filesToRemove.forEach((filePath) => {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(fullPath)) {
    if (fs.lstatSync(fullPath).isDirectory()) {
      console.log(`Removing directory: ${filePath}`);
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      console.log(`Removing file: ${filePath}`);
      fs.unlinkSync(fullPath);
    }
  } else {
    console.log(`File not found: ${filePath}`);
  }
});

console.log('Cleanup complete!');
