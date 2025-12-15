import * as glob from 'glob';
import * as path from 'path';
import { invalidLess } from '@jesscss/shared';
import { Compiler } from '../../src';
import { getTestCases } from '../test-utils';
import lessPlugin from '@jesscss/plugin-less';

const testData = path.dirname(require.resolve('@less/test-data'));

const baseCompiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [
      lessPlugin({
        mathMode: 0
      })
    ]
  }
});

// Files that should be tested in specialized test files
const specializedTests = [
  'tests-unit/color-functions/colors.less', // Tested in colors.test.ts
  'tests-unit/nesting/nesting.less' // Tested in nesting.test.ts
];

// Temporarily filter to specific tests for debugging - set to empty array to run all
const targetTests: string[] = [
  // 'tests-unit/mixins/mixins.less'
  'tests-unit/media/media.less'
];

describe('Can render Less files to CSS', () => {
  // Get all .less files from tests-unit and tests-config directories
  const unitFiles = glob.sync(path.join(testData, 'tests-unit/*/*.less'));
  const configFiles = glob.sync(path.join(testData, 'tests-config/*/*.less'));
  const allFiles = [...unitFiles, ...configFiles];

  allFiles
    .map(value => path.relative(testData, value))
    .filter(value => !invalidLess.includes(value))
    .filter(value => !specializedTests.includes(value)) // Skip files tested elsewhere
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
            const expectedCss = require('fs').readFileSync(testCase.expectedFile, 'utf8');

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

            const actualCss = await testCompiler.render(lessPath);

            expect(actualCss).toBeString(expectedCss.trim());
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