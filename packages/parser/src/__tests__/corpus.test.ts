import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseStructure, SourceText, type LanguageProfile } from '../index.js';
import { invalidLess } from '../../../_shared/index.js';
import { fixtureLessProfile, fixtureProfile, fixtureScssProfile } from './fixtures.js';

const STYLESHEET_EXTENSIONS = new Set(['.css', '.less', '.scss']);
const IGNORED_DIRECTORIES = new Set(['.git', 'lib', 'node_modules']);
const require = createRequire(import.meta.url);

// Keep this aligned with packages/jess/test/less/all-less.test.ts so scanner
// coverage follows the same upstream Less compatibility envelope.
const ADDITIONAL_LESS_TEST_DATA_SKIPS = new Set([
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
]);

describe('stylesheet corpus structural scanning', () => {
  test('parses every checked-in CSS-family fixture without throwing', () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const files = findStylesheetFiles(root);

    expect(files.length).toBeGreaterThan(0);

    for (const filePath of files) {
      const source = new SourceText(readFileSync(filePath, 'utf8'), relative(root, filePath));
      const document = parseStructure(source, profileForFile(filePath));

      expect(document.root.start, source.filePath).toBe(0);
      expect(document.root.end, source.filePath).toBe(source.length);
      expect(document.source.hasLineMap, source.filePath).toBe(false);
    }
  });

  const lessTestDataRoot = resolveOptionalLessTestData();
  const lessTestDataTest = lessTestDataRoot ? test : test.skip;

  lessTestDataTest('parses the upstream Less test-data corpus used by Jess compatibility tests', () => {
    expect(lessTestDataRoot).toBeTruthy();

    const files = findStylesheetFiles(lessTestDataRoot!)
      .map(filePath => relative(lessTestDataRoot!, filePath))
      .filter(filePath => !isSkippedLessTestDataFile(filePath))
      .map(filePath => join(lessTestDataRoot!, filePath));

    expect(files.length).toBeGreaterThan(0);

    for (const filePath of files) {
      const source = new SourceText(readFileSync(filePath, 'utf8'), relative(lessTestDataRoot!, filePath));
      const document = parseStructure(source, profileForFile(filePath));

      expect(document.root.start, source.filePath).toBe(0);
      expect(document.root.end, source.filePath).toBe(source.length);
      expect(document.source.hasLineMap, source.filePath).toBe(false);
    }
  });
});

function findRepoRoot(start: string): string {
  let current = start;

  while (current !== dirname(current)) {
    const packageJson = join(current, 'package.json');
    if (existsSync(packageJson)) {
      const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as unknown;
      if (manifest && typeof manifest === 'object' && 'name' in manifest && manifest.name === '@jesscss/root') {
        return current;
      }
    }
    current = dirname(current);
  }

  throw new Error(`Could not find Jess repo root from ${start}.`);
}

function findStylesheetFiles(root: string): string[] {
  const files: string[] = [];
  visitDirectory(root, files);
  return files.sort();
}

function visitDirectory(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (IGNORED_DIRECTORIES.has(entry)) {
      continue;
    }

    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      visitDirectory(fullPath, files);
      continue;
    }

    if (stat.isFile() && STYLESHEET_EXTENSIONS.has(extname(entry))) {
      files.push(fullPath);
    }
  }
}

function profileForFile(filePath: string): LanguageProfile {
  switch (extname(filePath)) {
    case '.less':
      return fixtureLessProfile;
    case '.scss':
      return fixtureScssProfile;
    default:
      return fixtureProfile;
  }
}

function resolveOptionalLessTestData(): string | undefined {
  try {
    return dirname(require.resolve('@less/test-data'));
  } catch {
    const configuredRoot = process.env.LESS_TEST_DATA_ROOT;
    if (configuredRoot && existsSync(join(configuredRoot, 'package.json'))) {
      return resolve(configuredRoot);
    }

    const localCheckoutRoot = '/Users/matthew/git/oss/less.js/packages/test-data';
    if (existsSync(join(localCheckoutRoot, 'package.json'))) {
      return localCheckoutRoot;
    }

    return undefined;
  }
}

function isSkippedLessTestDataFile(filePath: string): boolean {
  if (extname(filePath) !== '.less') {
    return false;
  }

  return (
    invalidLess.includes(filePath)
    || ADDITIONAL_LESS_TEST_DATA_SKIPS.has(filePath)
    || filePath.includes('-REMOVED')
    || filePath.startsWith('tests-unit/plugin-')
  );
}
