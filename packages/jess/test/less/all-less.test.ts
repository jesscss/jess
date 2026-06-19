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

const readNumericFunctionArg = (value: any): number => {
  if (typeof value?.value === 'number') {
    return value.value;
  }
  if (typeof value?.value?.number === 'number') {
    return value.value.number;
  }
  const primitive = value?.valueOf?.() ?? value;
  return Number(primitive);
};

const readStringFunctionArg = (value: any): string => {
  if (typeof value?.value === 'string') {
    return value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  if (typeof value?.value?.value === 'string') {
    return value.value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  const primitive = value?.valueOf?.() ?? value;
  return String(primitive).replace(/^(['"])(.*)\1$/, '$2');
};

const lessHarnessFunctionsPlugin = {
  install(less: any) {
    less.functions.functionRegistry.addMultiple({
      add(a: any, b: any) {
        return readNumericFunctionArg(a) + readNumericFunctionArg(b);
      },
      increment(a: any) {
        return readNumericFunctionArg(a) + 1;
      },
      _color(str: any) {
        if (readStringFunctionArg(str) === 'evil red') {
          return '#660000';
        }
        return undefined;
      }
    });
  }
};

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

const baseCompiler = new Compiler({
  output: { collapseNesting: true }, // Default for most files
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin({
        plugins: [lessHarnessFunctionsPlugin]
      })
    ]
  }
});

const envFixturePattern = process.env.JESS_LESS_FIXTURE;
const fixtureFilter = envFixturePattern
  ? new RegExp(envFixturePattern)
  : undefined;

type SkippedFixture = {
  file: string;
  reason: string;
};

// Files that should be tested in specialized test files or remain out of the
// first alpha readiness lane until the owning feature is implemented.
const skippedFixtures: SkippedFixture[] = ([
  'tests-unit/variables/variable-advanced.less', // infinite loop
  'tests-unit/merge/merge.less', // infinite loop (EvalState migration)
  'tests-unit/selectors/selectors.less', // infinite loop (EvalState migration)
  'tests-unit/detached-rulesets/detached-rulesets.less', // async deadlock
  'tests-unit/functions-each/functions-each.less', // async deadlock
  'tests-unit/layer/layer.less', // async deadlock
  'tests-unit/lazy-eval/lazy-eval.less', // async deadlock
  'tests-unit/mixins/mixins.less', // async deadlock
  'tests-unit/extend-exact/extend-exact.less', // infinite loop in extend exact matching
  'tests-unit/mixins-important/mixins-important.less', // async deadlock
  'tests-unit/property-name-interp/property-name-interp.less', // async deadlock
  'tests-unit/strings/strings.less', // async deadlock
  'tests-unit/variables/variables.less', // async deadlock
  'tests-unit/variables-in-at-rules/variables-in-at-rules.less', // async deadlock
  'tests-unit/plugin/plugin.less', // Jess uses nested @media (no query merging), expected CSS has merged queries
  'tests-unit/parse-interpolation/parse-interpolation.less', // formatting differences
  'tests-unit/parser-slashed-combinator/parser-slashed-combinator.less', // not yet supported
  'tests-unit/permissive-parse/permissive-parse.less', // syntax error

  // Config fixtures that need a dedicated compatibility decision or feature
  // work before they can be release gates.
  'tests-config/3rd-party/bootstrap4.less', // broad third-party fixture; keep out of config smoke progression
  'tests-config/at-rules-compressed/at-rules-compressed.less', // compression output parity not yet alpha-gated
  'tests-config/at-rules-compressed-evaluation/at-rules-compressed-evaluation.less', // compression output parity not yet alpha-gated
  'tests-config/compression/compression.less', // compression output parity not yet alpha-gated
  'tests-config/debug/linenumbers.less', // debug output fixture; no expected CSS in upstream fixture
  'tests-config/filemanagerPlugin/filemanager.less', // custom Less file manager plugin API needs scope decision
  'tests-config/include-path/import-test-e.less', // helper imported by include-path fixture; no expected CSS
  'tests-config/import-redirect/import-redirect.less', // no expected CSS in upstream fixture
  'tests-config/js-type-errors/js-type-error.less', // expected error fixture, not render-to-CSS fixture
  'tests-config/math-always/mixins-guards.less', // no expected CSS in upstream fixture
  'tests-config/math-always/no-sm-operations.less', // no expected CSS in upstream fixture
  'tests-config/math-parens-division/media-math.less', // no expected CSS in upstream fixture
  'tests-config/math-parens-division/mixins-args.less', // no expected CSS in upstream fixture
  'tests-config/math-parens-division/new-division.less', // no expected CSS in upstream fixture
  'tests-config/math-parens-division/parens.less', // no expected CSS in upstream fixture
  'tests-config/math-strict/css.less', // no expected CSS in upstream fixture
  'tests-config/math-strict/media-math.less', // no expected CSS in upstream fixture
  'tests-config/math-strict/mixins-args.less', // no expected CSS in upstream fixture
  'tests-config/math-strict/parens.less', // no expected CSS in upstream fixture
  'tests-config/no-js-errors/no-js-errors.less', // expected error fixture, not render-to-CSS fixture
  'tests-config/postProcessorPlugin/postProcessor.less', // Less postprocessor plugin API needs scope decision
  'tests-config/preProcessorPlugin/preProcessor.less', // Less preprocessor plugin API needs scope decision
  'tests-config/root-registry/file.less', // no expected CSS in upstream fixture
  'tests-config/root-registry/root.less', // no expected CSS in upstream fixture
  'tests-config/strict-imports/imported.less', // helper imported by strict-imports fixture; no expected CSS
  'tests-config/sourcemaps/basic.less', // source-map output suite needs dedicated output artifact checks
  'tests-config/sourcemaps/custom-props.less', // source-map output suite needs dedicated output artifact checks
  'tests-config/sourcemaps-disable-annotation/basic.less', // source-map output suite needs dedicated output artifact checks
  'tests-config/sourcemaps-empty/empty.less', // source-map output suite needs dedicated output artifact checks
  'tests-config/sourcemaps-empty/var-defs.less', // source-map output suite needs dedicated output artifact checks
  'tests-config/sourcemaps-variable-selector/basic.less', // source-map output suite needs dedicated output artifact checks
  'tests-config/sourcemaps-variable-selector/vars.less', // source-map output suite needs dedicated output artifact checks
  'tests-config/visitorPlugin/visitor.less' // Less visitor plugin API needs scope decision
] as Array<string | SkippedFixture>).map((entry): SkippedFixture => {
  if (typeof entry === 'string') {
    return { file: entry, reason: 'skipped' };
  }
  return entry;
});

const skippedFixtureReasons = new Map(skippedFixtures.map(({ file, reason }) => [file, reason]));

const expectedFailureFixtures = new Map<string, string>([
  ['tests-unit/import/import-reference-issues.less', 'reference import selector scoping differs from Less'],
  ['tests-unit/import/import-reference.less', 'reference import filtering leaves extra at-rules'],
  ['tests-unit/import/import.less', 'Less @plugin script execution is not available in this harness'],
  ['tests-unit/mixins-guards-default-func/mixins-guards-default-func.less', 'default() guard resolution differs from Less'],
  ['tests-unit/operations/operations-advanced.less', 'advanced math/color operation behavior differs from Less'],
  ['tests-unit/property-accessors/property-accessors.less', 'property accessor precedence differs from Less'],
  ['tests-unit/scope/scope.less', 'parent selector scope output differs from Less'],
  ['tests-unit/starting-style/starting-style.less', 'nested shorthand math expansion in @starting-style differs from Less'],
  ['tests-config/namespacing/namespacing-1.less', 'namespace map duplicate precedence differs from Less'],
  ['tests-config/namespacing/namespacing-5.less', 'nested namespace callable lookup does not match Less'],
  ['tests-config/namespacing/namespacing-8.less', 'each() custom-property value lookup inside detached map differs from Less'],
  ['tests-config/namespacing/namespacing-functions.less', 'detached ruleset callable lookup result differs from Less'],
  ['tests-config/namespacing/namespacing-media.less', 'namespace lookup inside media query expression differs from Less'],
  ['tests-config/process-imports/google.less', 'processImports=false should leave remote CSS imports out of rendered CSS'],
  ['tests-config/rewrite-urls-all/rewrite-urls-all.less', 'rewriteUrls=all URL rebasing is not implemented'],
  ['tests-config/rewrite-urls-local/rewrite-urls-local.less', 'rewriteUrls=local URL rebasing is not implemented'],
  ['tests-config/rootpath-rewrite-urls-all/rootpath-rewrite-urls-all.less', 'rootpath with rewriteUrls=all is not implemented'],
  ['tests-config/rootpath-rewrite-urls-local/rootpath-rewrite-urls-local.less', 'rootpath with rewriteUrls=local is not implemented'],
  ['tests-config/static-urls/urls.less', 'relativeUrls=false/rootpath static URL behavior is not implemented'],
  ['tests-config/url-args/urls.less', 'urlArgs URL query appending is not implemented'],
  ['tests-config/sourcemaps-basepath/sourcemaps-basepath.less', 'source-map annotation and artifact output need a dedicated harness'],
  ['tests-config/sourcemaps-include-source/sourcemaps-include-source.less', 'source-map annotation and artifact output need a dedicated harness'],
  ['tests-config/sourcemaps-rootpath/sourcemaps-rootpath.less', 'source-map annotation and artifact output need a dedicated harness'],
  ['tests-config/sourcemaps-url/sourcemaps-url.less', 'source-map annotation and artifact output need a dedicated harness']
]);

// Allow specific fixtures even when they are listed in shared invalidLess.
const forcedIncludes = new Set<string>([
]);

describe('Can render Less files to CSS', () => {
  // Run all unit fixtures under tests-unit.
  const unitFiles: string[] = glob.sync(path.join(testData, 'tests-unit/*/*.less'));
  const configFiles: string[] = glob.sync(path.join(testData, 'tests-config/*/*.less'));
  const allFiles = [...unitFiles, ...configFiles];

  allFiles
    .map(value => path.relative(testData, value))
    .filter(value => forcedIncludes.has(value) || !invalidLess.includes(value))
    .filter(value => !skippedFixtureReasons.has(value)) // Skip files tested elsewhere or outside the current alpha lane
    .filter(value => !value.startsWith('tests-unit/plugin-')) // Keep only plugin/plugin.less, not plugin-* variants
    .filter(value => !fixtureFilter || fixtureFilter.test(value))
    // .filter(value => value <= 'tests-unit/whitespace/whitespace.less')
    .sort()
    .forEach((file) => {
      const lessPath = path.join(testData, file);

      try {
        const testCases = getTestCases(lessPath);

        testCases.forEach((testCase, index) => {
          const testName = testCases.length > 1 ? `${file} [${index + 1}/${testCases.length}]` : file;
          const configSuffix = testCases.length > 1 ? ` (${path.basename(testCase.expectedFile)})` : '';
          const expectedFailureReason = expectedFailureFixtures.get(file);

          const runFixture = async () => {
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

            let result: Awaited<ReturnType<Compiler['renderToResult']>> | undefined;
            try {
              result = await testCompiler.renderToResult(lessPath, { outputFile: testCase.expectedFile });
            } catch (error: any) {
              throw error;
            }
            try {
              expect(result.css).toBe(expectedCss);
            } catch (error: any) {
              // Output diagnostics if available
              if (result && (result.errors.length > 0 || result.warnings.length > 0)) {
                outputDiagnostics(result.errors, result.warnings, {
                  suppressWarnings: false,
                  breakOnError: false
                });
              }
              throw error;
            }
          };

          it(`${testName}${configSuffix}${expectedFailureReason ? ` (expected failure: ${expectedFailureReason})` : ''}`, async () => {
            if (!expectedFailureReason) {
              await runFixture();
              return;
            }

            let failed = false;
            try {
              await runFixture();
            } catch {
              failed = true;
            }
            expect(failed, `${file} is expected to fail until: ${expectedFailureReason}`).toBe(true);
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
