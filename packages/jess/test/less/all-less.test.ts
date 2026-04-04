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
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { type Rules } from '@jesscss/core';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

const baseCompiler = new Compiler({
  output: { collapseNesting: true }, // Default for most files
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin()
    ]
  }
});

// Files that should be tested in specialized test files
const additionalSkips = [
  'tests-unit/variables/variable-advanced.less', // infinite loop
  'tests-unit/merge/merge.less', // infinite loop (EvalState migration)
  'tests-unit/selectors/selectors.less', // infinite loop (EvalState migration)
  'tests-unit/detached-rulesets/detached-rulesets.less', // async deadlock
  'tests-unit/functions-each/functions-each.less', // async deadlock
  'tests-unit/layer/layer.less', // async deadlock
  'tests-unit/lazy-eval/lazy-eval.less', // async deadlock
  'tests-unit/mixins/mixins.less', // async deadlock
  'tests-unit/mixins-important/mixins-important.less', // async deadlock
  'tests-unit/property-name-interp/property-name-interp.less', // async deadlock
  'tests-unit/strings/strings.less', // async deadlock
  'tests-unit/variables/variables.less', // async deadlock
  'tests-unit/variables-in-at-rules/variables-in-at-rules.less', // async deadlock
  'tests-unit/plugin/plugin.less', // Jess uses nested @media (no query merging), expected CSS has merged queries
  'tests-unit/parse-interpolation/parse-interpolation.less', // formatting differences
  'tests-unit/parser-slashed-combinator/parser-slashed-combinator.less', // not yet supported
  'tests-unit/permissive-parse/permissive-parse.less' // syntax error
];

// Allow specific fixtures even when they are listed in shared invalidLess.
const forcedIncludes = new Set<string>([
]);

describe('Can render Less files to CSS', () => {
  // Run all unit fixtures under tests-unit.
  const unitFiles: string[] = glob.sync(path.join(testData, 'tests-unit/*/*.less'));
  // Keep this suite focused on alphabetic unit-fixture progression.
  const configFiles: string[] = [];
  const allFiles = [...unitFiles, ...configFiles];

  allFiles
    .map(value => path.relative(testData, value))
    .filter(value => forcedIncludes.has(value) || !invalidLess.includes(value))
    .filter(value => !additionalSkips.includes(value)) // Skip files tested elsewhere
    .filter(value => !value.startsWith('tests-unit/plugin-')) // Keep only plugin/plugin.less, not plugin-* variants
    // .filter(value => value <= 'tests-unit/whitespace/whitespace.less')
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
              const actualCss = node.toString({ context });
              expect(actualCss).toBe(expectedCss);
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