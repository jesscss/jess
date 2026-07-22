import { describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync } from 'fs';
import { invalidLess } from '@jesscss/shared';
import { Compiler } from '../../src/index.js';
import { outputDiagnostics } from '../../src/diagnostics.js';
import { getTestCases, resolveLessTestDataRoot } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';

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

const testData = resolveLessTestDataRoot();

const baseCompiler = new Compiler({
  output: { collapseNesting: true }, // Default for most files
  compile: {
    // Upstream Less @plugin fixtures reference shared scripts under
    // test-data/plugin/*.js from fixtures in sibling directories; widen the
    // (trusted) harness jsReadRoot to the test-data root so plugin-js can read them.
    jsReadRoot: testData,
    plugins: [
      // [plugin/P2] The harness function plugin is registered through the NATIVE
      // Less plugin's `plugins` option — its `install`-registered functions become
      // ast/ GLOBAL fns (root-frame registry), no `@jesscss/plugin-less-compat`.
      lessPlugin({ plugins: [lessHarnessFunctionsPlugin] })
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
  // NOTE: the former async-deadlock / infinite-loop skips no longer hang (the
  // single-frame / loop-subsystem / D3 eval work fixed them). They now RENDER but
  // still mismatch Less, so they moved to `expectedFailureFixtures` below — the
  // suite runs them (catching any regression to hanging) instead of hiding them.

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
  // NOTE: import-reference-issues.less and starting-style.less graduated OUT of
  // this list — the D3 single-render-pass change (removing the separate
  // Compiler-level eval pre-pass so render() is the sole eval driver) eliminated
  // a double-eval that (a) re-ran `+_:` shorthand merges twice (starting-style's
  // padding accumulated to 10 values) and (b) re-ran import resolution twice
  // (import-reference-issues threw "File not found" on the 2nd pass). Both now
  // match the Less golden .css under the harness config.
  ['tests-unit/import/import-reference.less', 'reference import filtering leaves extra at-rules'],
  ['tests-unit/import/import.less', '@jesscss/plugin-js now auto-wires and the @plugin pi() script executes; renders but still diverges from Less on @import media-query handling and @media query merging (non-plugin render gaps)'],
  ['tests-config/namespacing/namespacing-5.less', 'nested namespace callable lookup does not match Less'],
  ['tests-config/namespacing/namespacing-8.less', 'each() custom-property value lookup inside detached map differs from Less'],
  ['tests-config/namespacing/namespacing-functions.less', 'detached ruleset callable lookup result differs from Less'],
  ['tests-config/namespacing/namespacing-media.less', 'namespace lookup inside media query expression differs from Less'],
  ['tests-unit/urls/urls.less', 'renders but CSS @import placement and multiline function formatting differ from Less'],
  ['tests-config/process-imports/google.less', 'processImports=false should leave remote CSS imports out of rendered CSS'],
  ['tests-config/static-urls/urls.less', 'relativeUrls=false/rootpath static URL behavior is not implemented'],
  ['tests-config/url-args/urls.less', 'urlArgs URL query appending is not implemented'],
  ['tests-config/sourcemaps-basepath/sourcemaps-basepath.less', 'source-map annotation and artifact output need a dedicated harness'],
  ['tests-config/sourcemaps-include-source/sourcemaps-include-source.less', 'source-map annotation and artifact output need a dedicated harness'],
  ['tests-config/sourcemaps-rootpath/sourcemaps-rootpath.less', 'source-map annotation and artifact output need a dedicated harness'],
  ['tests-config/sourcemaps-url/sourcemaps-url.less', 'source-map annotation and artifact output need a dedicated harness'],

  // Former async-deadlock / infinite-loop skips: no longer hang, now render but
  // still mismatch Less. Graduated from skip → expected-failure so they run.
  ['tests-unit/selectors/selectors.less', 'renders but throws mid-eval (currentArg.eval is not a function)'],
  ['tests-unit/detached-rulesets/detached-rulesets.less', 'detached-ruleset argument closure now matches Less; nested @media query merging still differs'],
  ['tests-unit/functions-each/functions-each.less', 'renders but each() output differs from Less'],
  ['tests-unit/mixins/mixins.less', 'group-selector member call (.bar) now resolves; remaining blocker is same-named nested ruleset calling an outer mixin (.recursion) — nearest-scope-frame lookup does not continue past the self-excluded enclosing ruleset'],
  ['tests-unit/property-name-interp/property-name-interp.less', 'Less5 owner-set rejection of deprecated dash-only @- and @{-} variable names; Less4 deprecation is implemented in unpushed worktree commit db03543d'],
  ['tests-unit/variables/variables.less', 'renders but variable output differs from Less'],
  ['tests-unit/plugin/plugin.less', '@jesscss/plugin-js now auto-wires and the @plugin scripts execute; renders but Jess nests @media (no query merging) where the expected CSS merges queries (non-plugin render gap)'],
  ['tests-unit/parse-interpolation/parse-interpolation.less', 'renders but interpolation formatting differs from Less'],
  ['tests-unit/parser-slashed-combinator/parser-slashed-combinator.less', 'slashed combinator not yet supported'],
  ['tests-unit/permissive-parse/permissive-parse.less', 'throws on Less permissive @variable value (@this: () => {…}, VarDeclaration hot-path — scoped) + @{selectorList} comma-list selector (selector-capture agent). --* interpolation-only + unknown-at-rule prelude @{…}/var interpolation now match; two golden lines (--custom-color, --fortran bare-@) superseded by the interpolation-only owner rule, pending owner golden update'],

  // v5 STRICT at-rule preludes: a top-level bare `@variable` in a non-value at-rule
  // prelude/name/identifier is a HARD parse error (4.x only warned). These upstream
  // 4.x fixtures use the bare form (`@media @smartphone`, `@container @varfoo (…)`);
  // the migration target is `@{…}` interpolation, and a `@var` inside `(...)` stays
  // valid. Kept running (asserted to fail) so a change to the ruling trips the marker;
  // goldens are the external less.js 4.x oracle, unedited.
  // (layer.less GRADUATED — it uses the `@{layer-name}` interpolation form, not the
  //  bare `@var` prelude, so v5 renders it byte-identical to the maintained `.css`.)
  ['tests-unit/media/media.less', 'v5 rejects a top-level bare @var at-rule prelude (@media @smartphone / @media @all and @tv)'],
  ['tests-unit/container/container.less', 'v5 rejects a top-level bare @var at-rule prelude (@container @varfoo (…))'],

  // Previously-uncategorized hard failures — render but mismatch Less.
  // (extend.less + mixins-guards.less GRADUATED — the dev-merge extend/mixin-namespace
  //  fixes made them render byte-identical to Less; they're real passes now.
  //  extend-nest.less + extend-selector.less GRADUATED — the cutover-p1 spine extend
  //  wire-in now renders both byte-identical to the maintained `.css`; real passes.)

  // F5: Less/Jess deliberately leaves CSS-shaped, three-or-more-slot
  // un-operated color constructors as authored calls, even when Less 4's oracle
  // would clamp/reformat them. These fixtures exercise that settled lazy
  // boundary; keep them runnable so a future accidental eager dispatch trips
  // the marker rather than hiding it. Less one-/two-slot overload fixtures are
  // expected to stay green and are not listed here.
  ['tests-unit/color-functions/operations.less', 'F5 keeps an un-operated overflowing rgba() call authored instead of Less 4 channel clamping'],
  ['tests-unit/functions/functions.less', 'F5 keeps an un-operated hsl() call authored instead of Less 4 clamp/canonicalization']
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
