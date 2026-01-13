import { describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { invalidLess } from '@jesscss/shared';
import { Compiler } from '../../src';
import { outputDiagnostics } from '../../src/diagnostics';
import { getTestCases } from '../test-utils';
import lessPlugin from '@jesscss/plugin-less';
import { type Rules } from '@jesscss/core';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

const baseCompiler = new Compiler({
  output: { collapseNesting: true },
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
];

describe('Can render Less files to CSS', () => {
  // Get all .less files from tests-unit and tests-config directories
  // Filter to alphabetical tests up to directives-bubbling for now
  const unitFiles: string[] = glob.sync(path.join(testData, 'tests-unit/*/extend*.less')).filter((f) => {
    const dir = path.basename(path.dirname(f));
    return dir <= 'extend-chaining';
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
            // The test case config overrides base config options
            const testCompiler = new Compiler({
              ...baseCompiler.opts,
              ...testCase.config,
              // Merge output options
              output: {
                ...baseCompiler.opts.output,
                ...testCase.config.output
              }
            });

            const context = testCompiler.createContext(lessPath, { outputFile: testCase.expectedFile });
            let node: Rules;
            try {
              ({ node } = await context.getTree(lessPath));
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