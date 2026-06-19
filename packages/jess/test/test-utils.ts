import * as fs from 'fs';
import * as path from 'path';
import { getExpectedOutputFiles, type OutputTestConfig } from '../src/config.js';
import type { StylesConfig } from 'styles-config';

export interface TestCase {
  expectedFile: string;
  config: Partial<StylesConfig>;
}

/**
 * Get test cases for a LESS file based on output configuration.
 *
 * Logic:
 * 1. If output config is specified and the output file exists → use that file with that config
 * 2. If output config is specified but the output file doesn't exist → fall back to {name}.css with merged config options
 * 3. If no files exist at all → throw an error
 *
 * @param lessFilePath - Path to the LESS file
 * @returns Array of test cases, each with expected file and config to use
 */
export function getTestCases(lessFilePath: string): TestCase[] {
  const dir = path.dirname(lessFilePath);
  const name = path.basename(lessFilePath, path.extname(lessFilePath));
  const defaultCssPath = path.join(dir, `${name}.css`);

  const outputConfigs = getExpectedOutputFiles(lessFilePath);
  const configs: OutputTestConfig[] = Array.isArray(outputConfigs) ? outputConfigs : [outputConfigs];

  const testCases: TestCase[] = [];

  for (const outputConfig of configs) {
    // Check if the specified output file exists
    if (fs.existsSync(outputConfig.file)) {
      testCases.push({
        expectedFile: outputConfig.file,
        config: outputConfig.config
      });
    } else if (outputConfig.file !== defaultCssPath) {
      throw new Error(`Expected output file ${outputConfig.file} does not exist`);
    } else {
      // Fall back to {name}.css with merged config options
      if (fs.existsSync(defaultCssPath)) {
        // Only add if we haven't already added this exact test case
        const alreadyAdded = testCases.some(
          tc => tc.expectedFile === defaultCssPath
            && JSON.stringify(tc.config) === JSON.stringify(outputConfig.config)
        );
        if (!alreadyAdded) {
          testCases.push({
            expectedFile: defaultCssPath,
            config: outputConfig.config
          });
        }
      }
      // If default doesn't exist either, we'll check at the end
    }
  }

  // If no test cases were found, check if default exists
  if (testCases.length === 0) {
    if (fs.existsSync(defaultCssPath)) {
      // No output config or all output files missing, but default exists
      testCases.push({
        expectedFile: defaultCssPath,
        config: {}
      });
    }
  }

  if (testCases.length === 0) {
    throw new Error(`No expected output CSS found for ${lessFilePath}`);
  }

  return testCases;
}
