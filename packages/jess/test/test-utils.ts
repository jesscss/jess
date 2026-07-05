import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { getExpectedOutputFiles, type OutputTestConfig } from '../src/config.js';
import type { StylesConfig } from 'styles-config';

export interface TestCase {
  expectedFile: string;
  config: Partial<StylesConfig>;
}

export type NumericLike = {
  value?: number | { number?: number };
  valueOf?: () => unknown;
};

export type StringLike = {
  value?: string | { value?: string };
  valueOf?: () => unknown;
};

export const lessTestDataAdditionalSkips = [
  'tests-unit/variables/variable-advanced.less',
  'tests-unit/merge/merge.less',
  'tests-unit/selectors/selectors.less',
  'tests-unit/detached-rulesets/detached-rulesets.less',
  'tests-unit/functions-each/functions-each.less',
  'tests-unit/layer/layer.less',
  'tests-unit/lazy-eval/lazy-eval.less',
  'tests-unit/mixins/mixins.less',
  'tests-unit/mixins-important/mixins-important.less',
  'tests-unit/property-name-interp/property-name-interp.less',
  'tests-unit/strings/strings.less',
  'tests-unit/variables/variables.less',
  'tests-unit/variables-in-at-rules/variables-in-at-rules.less',
  'tests-unit/plugin/plugin.less',
  'tests-unit/parse-interpolation/parse-interpolation.less',
  'tests-unit/parser-slashed-combinator/parser-slashed-combinator.less',
  'tests-unit/permissive-parse/permissive-parse.less'
];

export const lessTestDataForcedIncludes = new Set<string>([]);

export const lessHarnessFunctionsPlugin = {
  install(less: {
    functions: {
      functionRegistry: {
        addMultiple(functions: Record<string, (...args: unknown[]) => unknown>): void;
      };
    };
  }) {
    less.functions.functionRegistry.addMultiple({
      add(a: NumericLike, b: NumericLike) {
        return readNumericFunctionArg(a) + readNumericFunctionArg(b);
      },
      increment(a: NumericLike) {
        return readNumericFunctionArg(a) + 1;
      },
      _color(str: StringLike) {
        if (readStringFunctionArg(str) === 'evil red') {
          return '#660000';
        }
        return undefined;
      }
    });
  }
};

export function readNumericFunctionArg(value: NumericLike): number {
  if (typeof value?.value === 'number') {
    return value.value;
  }
  if (typeof value?.value === 'object' && typeof value.value.number === 'number') {
    return value.value.number;
  }
  const primitive = value?.valueOf?.() ?? value;
  return Number(primitive);
}

export function readStringFunctionArg(value: StringLike): string {
  if (typeof value?.value === 'string') {
    return value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  if (typeof value?.value === 'object' && typeof value.value.value === 'string') {
    return value.value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  const primitive = value?.valueOf?.() ?? value;
  return String(primitive).replace(/^(['"])(.*)\1$/, '$2');
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

const require = createRequire(import.meta.url);

/**
 * Resolves the upstream Less.js test-data directory in normal installs,
 * linked workspace installs, and isolated git worktrees.
 */
export function resolveLessTestDataRoot(): string {
  const envRoot = existingDirectory(process.env.LESS_TEST_DATA_ROOT);
  if (envRoot) {
    return envRoot;
  }
  try {
    return path.dirname(require.resolve('@less/test-data'));
  } catch {
    // Continue to workspace and checkout fallbacks below.
  }
  try {
    const rootRequire = createRequire(path.join(process.cwd(), 'package.json'));
    return path.dirname(rootRequire.resolve('@less/test-data'));
  } catch {
    // Continue to checkout fallbacks below.
  }
  const checkoutRoot = gitCommonRepoRoot();
  const checkoutCandidates = [
    path.resolve(process.cwd(), '../less.js/packages/test-data'),
    checkoutRoot ? path.resolve(checkoutRoot, '../less.js/packages/test-data') : undefined
  ];
  for (const candidate of checkoutCandidates) {
    const resolved = existingDirectory(candidate);
    if (resolved) {
      return resolved;
    }
  }
  throw new Error(
    'Unable to resolve @less/test-data. Set LESS_TEST_DATA_ROOT to the Less.js packages/test-data directory.'
  );
}

function existingDirectory(value: string | undefined): string | undefined {
  if (!value) {
    return;
  }
  const resolved = path.resolve(value);
  try {
    return fs.statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return;
  }
}

function gitCommonRepoRoot(): string | undefined {
  try {
    const output = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    }).trim();
    return path.dirname(output);
  } catch {
    return;
  }
}
