import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { invalidLess } from '@jesscss/shared';
import { Compiler } from '../../src';
import lessPlugin from '@jesscss/plugin-less';

const testData = path.dirname(require.resolve('@less/test-data'));

const compiler = new Compiler({
  output: { collapseNesting: false }, // Disabled - collapseNesting has an infinite loop bug
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
  'tests-unit/mixins/mixins.less'
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
      it(`${file}`, async () => {
        const lessPath = path.join(testData, file);
        // CSS files are now co-located with .less files
        const cssPath = lessPath.replace(/\.less$/, '.css');

        if (!fs.existsSync(cssPath)) {
          console.warn(`No expected CSS file found for ${file}, skipping test`);
          return;
        }

        const css = fs.readFileSync(cssPath).toString();
        const output = await compiler.render(lessPath);

        expect(output).toMatchCss(css);
      });
    });
});