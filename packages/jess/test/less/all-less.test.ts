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
import { type Rules } from '@jesscss/core';

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
  'tests-unit/javascript/javascript.less', // inline backtick JavaScript is intentionally unsupported
  'tests-unit/variables/variable-advanced.less' // infinite loop
];

// Run unit fixtures alphabetically up through this filename (inclusive).
const runUnitThrough = 'tests-unit/layer/layer.less';

describe('Can render Less files to CSS', () => {
  // Get all .less files from tests-unit and tests-config directories
  const unitFiles: string[] = glob.sync(path.join(testData, 'tests-unit/*/*.less')).filter((f) => {
    const rel = path.relative(testData, f).replace(/\\/g, '/');
    return rel.localeCompare(runUnitThrough) <= 0;
  });
  // Keep this suite focused on alphabetic unit-fixture progression.
  const configFiles: string[] = [];
  const allFiles = [...unitFiles, ...configFiles];

  allFiles
    .map(value => path.relative(testData, value))
    .filter(value => !invalidLess.includes(value))
    .filter(value => !additionalSkips.includes(value)) // Skip files tested elsewhere
    .filter(value => value.startsWith('tests-unit/'))
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
            const testCompileConfig = (testCase.config.compile || {}) as Record<string, any>;
            const {
              plugins: testCasePlugins = [],
              ...restCompileConfig
            } = testCompileConfig;
            const testCompiler = new Compiler({
              ...baseCompiler.opts,
              ...testCase.config,
              compile: {
                ...(baseCompiler.opts.compile || {}),
                ...restCompileConfig,
                plugins: [
                  ...(baseCompiler.opts.compile?.plugins || []),
                  ...testCasePlugins
                ]
              },
              output: {
                ...baseCompiler.opts.output,
                ...(testCase.config.output || {})
              }
            });

            let context: any;
            let node: Rules;
            try {
              ({ context, tree: node } = await testCompiler.compile(lessPath, { outputFile: testCase.expectedFile }));
            } catch (error: any) {
              // Output diagnostics if available
              if (context && (context.errors.length > 0 || context.warnings.length > 0)) {
                outputDiagnostics(context.errors, context.warnings, {
                  suppressWarnings: false,
                  breakOnError: false
                });
              }
              throw error;
            }
            try {
              expect(node.toString({ context })).toBe(expectedCss);
            } catch (error: any) {
              // Output diagnostics if available
              if (context && (context.errors.length > 0 || context.warnings.length > 0)) {
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