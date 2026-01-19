import { describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { invalidLess } from '@jesscss/shared';
import { Compiler } from '../../src/index.js';
import { outputDiagnostics } from '../../src/diagnostics.js';
import { getTestCases } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { type Rules, serializeTypes } from '@jesscss/core';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

const baseCompiler = new Compiler({
  output: { collapseNesting: true }, // Default for most files
  compile: {
    plugins: [
      lessPlugin()
    ]
  }
});

// Files that should be tested in specialized test files
const additionalSkips = [
  'tests-unit/color-functions/colors.less', // Tested in colors.test.ts
  'tests-unit/nesting/nesting.less', // Tested in nesting.test.ts
  'tests-unit/variables/variable-advanced.less' // infinite loop
];

// Temporarily filter to specific tests for debugging - set to empty array to run all
const targetTests: string[] = [
  'tests-unit/extend-selector/extend-selector.less'
];

describe('Can render Less files to CSS', () => {
  // Get all .less files from tests-unit and tests-config directories
  // Filter to alphabetical tests up to and including all extend*.less files
  const unitFiles: string[] = glob.sync(path.join(testData, 'tests-unit/**/*.less')).filter((f) => {
    const dir = path.basename(path.dirname(f));
    // Include all files alphabetically up to and including the last extend directory
    // The last extend directory is 'extend-selector'
    return dir <= 'extend-selector';
  });
  const configFiles: string[] = [];
  const allFiles = [...unitFiles, ...configFiles];

  allFiles
    .map(value => path.relative(testData, value))
    .filter(value => !invalidLess.includes(value))
    .filter(value => !additionalSkips.includes(value)) // Skip files tested elsewhere
    .filter(value => targetTests.length === 0 || targetTests.includes(value)) // Target specific tests
    .sort()
    .forEach((file) => {
      const lessPath = path.join(testData, file);

      try {
        const testCases = getTestCases(lessPath);

        testCases.forEach((testCase, index) => {
          const testName = testCases.length > 1 ? `${file} [${index + 1}/${testCases.length}]` : file;
          const configSuffix = testCases.length > 1 ? ` (${path.basename(testCase.expectedFile)})` : '';

          it(`${testName}${configSuffix}`, async () => {
            const expectedCss = readFileSync(testCase.expectedFile, 'utf8');

            // Merge test case config with base compiler config
            // Default: collapseNesting: true (from baseCompiler)
            // Override: testCase.config.output (from styles.config.ts) takes precedence
            const testCompiler = new Compiler({
              ...baseCompiler.opts,
              ...testCase.config,
              // Merge output options - testCase.config.output overrides baseCompiler defaults
              output: {
                ...baseCompiler.opts.output,
                ...(testCase.config.output || {})
              }
            });

            const context = testCompiler.createContext(lessPath, { outputFile: testCase.expectedFile });
            // DEBUG: Check collapseNesting value
            if (file.includes('extend-selector')) {
              const { getConfig } = await import('../../src/config.js');
              const rawConfig = getConfig(lessPath);
              console.log('DEBUG collapseNesting:', {
                baseCompiler: baseCompiler.opts.output?.collapseNesting,
                rawConfigFromFile: rawConfig,
                rawConfigOutput: rawConfig.output,
                testCaseConfig: testCase.config,
                testCaseConfigOutput: testCase.config.output,
                merged: testCompiler.opts.output?.collapseNesting,
                contextOpts: context.opts.collapseNesting
              });
            }
            let node: Rules;
            try {
              ({ node } = await context.getTree(lessPath));
              // Debug: serialize AST for extend-selector test
              if (lessPath.includes('extend-selector')) {
                const sExpr = serializeTypes(node);
                console.log('=== PARSED AST (s-expression) ===');
                console.log(sExpr);
                console.log('=== END AST ===');
              }
            } catch (error: any) {
              // Output diagnostics if available
              if (context.errors.length > 0 || context.warnings.length > 0) {
                outputDiagnostics(context.errors, context.warnings, {
                  suppressWarnings: false,
                  breakOnError: false
                });
              }
              throw error;
            }
            try {
              const evald = await node.eval(context);
              expect(evald.toString({ context })).toBe(expectedCss);
            } catch (error: any) {
              // Output diagnostics if available
              if (context.errors.length > 0 || context.warnings.length > 0) {
                outputDiagnostics(context.errors, context.warnings, {
                  suppressWarnings: false,
                  breakOnError: false
                });
              }
              throw error;
            }
          }, 5000); // 5 second timeout to catch infinite loops
        });
      } catch (error: any) {
        // If getTestCases throws (no files found), create a failing test
        it(`${file}`, () => {
          throw error;
        });
      }
    });
});