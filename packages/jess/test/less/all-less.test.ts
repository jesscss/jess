import { describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync } from 'fs';
import { invalidLess } from '@jesscss/shared';
import { Compiler } from '../../src/index.js';
import { outputDiagnostics } from '@jesscss/compiler/diagnostics';
import { getTestCases, resolveLessTestDataRoot, lessFixturePackagesPlugin } from '../test-utils.js';
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
    /*
     * Upstream Less @plugin fixtures reference shared scripts under
     * test-data/plugin/*.js from fixtures in sibling directories; widen the
     * (trusted) harness jsReadRoot to the test-data root so plugin-js can read them.
     */
    jsReadRoot: testData,
    plugins: [
      /*
       * [plugin/P2] The harness function plugin is registered through the NATIVE
       * Less plugin's `plugins` option — its `install`-registered functions become
       * ast/ GLOBAL fns (root-frame registry), no `@jesscss/plugin-less-compat`.
       */
      lessPlugin({ plugins: [lessHarnessFunctionsPlugin] }),

      /*
       * Pins the third-party packages that fixtures `@import` by bare specifier
       * (tests-config/3rd-party/bootstrap4.less) — see lessFixturePackagesPlugin.
       */
      lessFixturePackagesPlugin()
    ]
  }
});

const envFixturePattern = process.env.JESS_LESS_FIXTURE;
const fixtureFilter = envFixturePattern
  ? new RegExp(envFixturePattern)
  : undefined;

const fixtureTimeoutMs = 4500;

class FixtureTimeoutError extends Error {
  constructor(file: string) {
    super(`${file} timed out before surfacing a diagnostic or render result.`);
    this.name = 'FixtureTimeoutError';
  }
}

async function withFixtureTimeout<T>(
  file: string,
  work: () => Promise<T>,
  timeoutMs = fixtureTimeoutMs
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FixtureTimeoutError(file)), timeoutMs);
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

type SkippedFixture = {
  file: string;
  reason: string;
};

/*
 * Files that should be tested in specialized test files or remain out of the
 * first alpha readiness lane until the owning feature is implemented.
 */
const skippedFixtures: SkippedFixture[] = (
  [
    /*
     * NOTE: the former async-deadlock / infinite-loop skips no longer hang (the
     * single-frame / loop-subsystem / D3 eval work fixed them). They now RENDER but
     * still mismatch Less, so they moved to `expectedFailureFixtures` below — the
     * suite runs them (catching any regression to hanging) instead of hiding them.
     */

    /*
     * Config fixtures that need a dedicated compatibility decision or feature
     * work before they can be release gates.
     */
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
    'tests-config/visitorPlugin/visitor.less', // Less visitor plugin API needs scope decision
    {
      file: 'tests-unit/import/import-remote.less',
      reason:
        'remote URL imports require an explicit network/IO allowlist, which is not part of the alpha harness policy'
    }
  ] as Array<string | SkippedFixture>
).map((entry): SkippedFixture => {
  if (typeof entry === 'string') {
    return { file: entry, reason: 'skipped' };
  }
  return entry;
});

const skippedFixtureReasons = new Map(
  skippedFixtures.map(({ file, reason }) => [file, reason])
);

const expectedFailureFixtures = new Map<string, string>([
  /*
   * Was skipped as "broad third-party fixture" while it could not resolve
   * `bootstrap-less-port` at all; it now resolves against the pinned fixture-deps
   * root and fails on a real parser defect, so it runs as a marker instead of
   * being hidden.
   */
  [
    'tests-config/3rd-party/bootstrap4.less',
    'the P29 nested relative-selector work fixed the original parse defect (`.m({ > td { … } })` now parses); it now fails later — the bootstrap-less-port `@plugin` function `breakpoint-min` throws (PluginFunctionError), yielding empty output'
  ],

  /*
   * NOTE: import-reference-issues.less and starting-style.less graduated OUT of
   * this list — the D3 single-render-pass change (removing the separate
   * Compiler-level eval pre-pass so render() is the sole eval driver) eliminated
   * a double-eval that (a) re-ran `+_:` shorthand merges twice (starting-style's
   * padding accumulated to 10 values) and (b) re-ran import resolution twice
   * (import-reference-issues threw "File not found" on the 2nd pass). Both now
   * match the Less golden .css under the harness config.
   */
  [
    'tests-unit/import/import-reference.less',
    'reference import filtering leaves extra at-rules'
  ],

  /*
   * INTENDED DIVERGENCE, not a defect (§12.3b, owner ruling 2026-08-07). A
   * media/layer/supports postlude on a COMPILE-TIME `@import` is now a parse
   * error: a postlude describes a linked CSS resource, and a loaded document is
   * spliced into this one instead. lessc 4.x accepts the source and wraps the
   * loaded rules in `@media`, which is what these two `.css` expectations still
   * encode. The fixtures live in the owner-maintained `@less/test-data` corpus
   * (`~/git/oss/less.js`, branch `alpha`), so they need an OWNER update to the
   * v5 expectation before either fixture can graduate off this list.
   */
  [
    'tests-unit/import/import.less',
    'lines 17/21/23/25 carry a media postlude on a compile-time @import (e.g. `@import (less, multiple) "import/import-test-d.css" screen and (max-width: 601px);`), which §12.3b now rejects at parse time; the .css expectation still encodes the 4.x @media wrap. Behind that sits the pre-existing import-hoisting gap — Less resolves every @import before evaluating, so `.mixin()` at line 12 sees a definition from the file imported at line 18, while jess evaluates in source order'
  ],
  [
    'tests-unit/import/import-inline.less',
    'line 2 is `@import (inline) url("import/import-test-d.css") (min-width:600px);` — `(inline)` makes the import compile-time, so §12.3b rejects its postlude at parse time; the .css expectation still encodes the 4.x behaviour of wrapping the spliced raw bytes in `@media (min-width: 600px)`'
  ],
  [
    'tests-unit/urls/urls.less',
    'renders but CSS @import placement and multiline function formatting differ from Less'
  ],
  [
    'tests-config/static-urls/urls.less',
    'relativeUrls=false/rootpath static URL behavior is not implemented'
  ],
  [
    'tests-config/url-args/urls.less',
    'urlArgs URL query appending is not implemented'
  ],
  [
    'tests-config/sourcemaps-basepath/sourcemaps-basepath.less',
    'source-map annotation and artifact output need a dedicated harness'
  ],
  [
    'tests-config/sourcemaps-include-source/sourcemaps-include-source.less',
    'source-map annotation and artifact output need a dedicated harness'
  ],
  [
    'tests-config/sourcemaps-rootpath/sourcemaps-rootpath.less',
    'source-map annotation and artifact output need a dedicated harness'
  ],
  [
    'tests-config/sourcemaps-url/sourcemaps-url.less',
    'source-map annotation and artifact output need a dedicated harness'
  ],

  /*
   * Former async-deadlock / infinite-loop skips: no longer hang, now render but
   * still mismatch Less. Graduated from skip → expected-failure so they run.
   */
  [
    'tests-unit/mixins/mixins.less',
    'same-named nested ruleset resolves the outer .recursion() mixin; remaining mismatch is fixture-local collapseNesting=false rendering nested CSS against the maintained flattened expectation'
  ],
  [
    'tests-unit/property-name-interp/property-name-interp.less',
    'deprecated dash-only @- and @{-} variable names are rejected'
  ],
  [
    'tests-unit/variables/variables.less',
    'NOT a jess bug: `(@onePixel / @onePixel)` = `1px / 1px` — jess emits `1` (units cancel), which is the v5 ruling (RESOLVED-SEMANTICS-AND-NAMING §"2px / 1px → 2 — units cancel"). The golden encodes stale lessc-4.x `1px` (keeps left unit). Graduates once the owner v5 golden is updated to `1`'
  ],
  [
    'tests-unit/plugin-module/plugin-module.less',
    'the clean-css fixture uses a legacy CommonJS @plugin graph with require(\'./lib/clean\'), which the optional jess-plugin-js Deno compatibility runtime does not support'
  ],

  /*
   * Explicit legacy removals. Keep these fixtures runnable so an accidental
   * reintroduction is visible rather than silently skipped.
   */
  [
    'tests-unit/javascript-REMOVED/legacy/javascript.less',
    'inline backtick JavaScript evaluation is not supported, including javascriptEnabled legacy configurations'
  ],
  [
    'tests-unit/ie-filters-REMOVED/legacy/ie-filters.less',
    'legacy IE progid:DXImageTransform filter syntax is not supported'
  ],
  [
    'tests-unit/functions/legacy/functions.less',
    'this legacy fixture\'s non-Less $list parameter/reference syntax is not supported'
  ],
  [
    'tests-unit/plugin-preeval/plugin-preeval.less',
    'the legacy tree visitor ABI is not supported (isPreEvalVisitor, manager.addVisitor, visitors.Visitor); this is not an @plugin extension-resolution gap'
  ],
  [
    'tests-unit/plugin/plugin.less',
    'the @media-merging gap this used to name is fixed (bubbled at-rules now nest by enclosing at-rule-body depth); it now fails earlier — `@plugin "../../plugin/plugin-set-options"` / `plugin-global` cannot be loaded (the legacy set-options/global plugin-registration API is unsupported), so most output is dropped'
  ],
  [
    'tests-unit/parse-interpolation/parse-interpolation.less',
    'renders but interpolation formatting differs from Less'
  ],
  [
    'tests-unit/parser-slashed-combinator/parser-slashed-combinator.less',
    'slashed combinator not yet supported'
  ],
  [
    'tests-unit/permissive-parse/permissive-parse.less',
    'throws on Less permissive @variable value (@this: () => {…}, VarDeclaration hot-path — scoped) + @{selectorList} comma-list selector (selector-capture agent). --* interpolation-only + unknown-at-rule prelude @{…}/var interpolation now match; two golden lines (--custom-color, --fortran bare-@) superseded by the interpolation-only owner rule, pending owner golden update'
  ],

  /*
   * Strict at-rule preludes: a top-level bare `@variable` in a non-value at-rule
   * prelude/name/identifier is a fatal unsupported-syntax diagnostic (4.x only
   * warned). These upstream 4.x fixtures use the bare form (`@media @smartphone`,
   * `@media @smartphone`); the parser should recognize the removed form well
   * enough to report the exact `@{…}` interpolation migration target, and a `@var`
   * inside `(...)` stays valid. Kept running (asserted to fail) so a change to the
   * ruling trips the marker; goldens are the external less.js 4.x oracle, unedited.
   * (layer.less GRADUATED — it uses the `@{layer-name}` interpolation form, not the
   * bare `@var` prelude, so it renders byte-identical to the maintained `.css`.)
   */
  [
    'tests-unit/at-rule-variable-deprecated/at-rule-variable-deprecated.less',
    'deprecated bare @var at-rule preludes/names/identifiers are rejected; use @{var} interpolation'
  ],
  [
    'tests-unit/media/media.less',
    'top-level bare @var at-rule preludes are rejected (@media @smartphone / @media @all and @tv)'
  ],

  /*
   * Previously-uncategorized hard failures — render but mismatch Less.
   * (extend.less + mixins-guards.less GRADUATED — the dev-merge extend/mixin-namespace
   * fixes made them render byte-identical to Less; they're real passes now.
   * extend-nest.less + extend-selector.less GRADUATED — the cutover-p1 spine extend
   * wire-in now renders both byte-identical to the maintained `.css`; real passes.)
   */

  /*
   * F5: Less/Jess deliberately leaves CSS-shaped, three-or-more-slot
   * un-operated color constructors as authored calls, even when Less 4's oracle
   * would clamp/reformat them. These fixtures exercise that settled lazy
   * boundary; keep them runnable so a future accidental eager dispatch trips
   * the marker rather than hiding it. Less one-/two-slot overload fixtures are
   * expected to stay green and are not listed here.
   */
  [
    'tests-unit/color-functions/operations.less',
    'F5 keeps an un-operated overflowing rgba() call authored instead of Less 4 channel clamping'
  ],
  [
    'tests-unit/functions/functions.less',
    'F5 keeps an un-operated hsl() call authored instead of Less 4 clamp/canonicalization'
  ]
]);

const expectedFailureDiagnosticCodes = new Map<string, string>([
  /*
   * The §12.3b postlude rule now fires at PARSE time, ahead of the import-hoisting
   * resolve failure this fixture used to surface (`resolve/name-not-found`).
   */
  ['tests-unit/import/import.less', 'parse/syntax-error'],
  ['tests-unit/import/import-inline.less', 'parse/syntax-error']
]);

type RenderResult = Awaited<ReturnType<Compiler['renderToResult']>>;

const diagnosticCodesFor = (result: RenderResult): string[] => [
  ...result.errors.map(diagnostic => diagnostic.code),
  ...result.warnings.map(diagnostic => diagnostic.code)
];

// Allow specific fixtures even when they are listed in shared invalidLess.
const forcedIncludes = new Set<string>([]);

describe('Can render Less files to CSS', () => {
  // Run all unit fixtures under tests-unit.
  const unitFiles: string[] = glob.sync(
    path.join(testData, 'tests-unit/*/*.less')
  );
  const configFiles: string[] = glob.sync(
    path.join(testData, 'tests-config/*/*.less')
  );
  const allFiles = [...unitFiles, ...configFiles];

  allFiles
    .map(value => path.relative(testData, value))
    .filter(
      value => forcedIncludes.has(value) || !invalidLess.includes(value)
    )
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
          const testName =
            testCases.length > 1
              ? `${file} [${index + 1}/${testCases.length}]`
              : file;
          const configSuffix =
            testCases.length > 1
              ? ` (${path.basename(testCase.expectedFile)})`
              : '';
          const expectedFailureReason = expectedFailureFixtures.get(file);
          const renderFixture = async () => {
            const expectedCss = readFileSync(testCase.expectedFile, 'utf8');

            /*
             * Merge test case config with base compiler config
             * Default: collapseNesting: true (from baseCompiler)
             * Override: testCase.config.output (from styles.config.ts) takes precedence
             */
            const testCompileConfig = (testCase.config.compile || {}) as Record<
              string,
              any
            >;
            const { plugins: testCasePlugins = [], ...restCompileConfig } =
              testCompileConfig;
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

            const result = await testCompiler.renderToResult(lessPath, {
              outputFile: testCase.expectedFile
            });
            return { expectedCss, result };
          };

          const runFixture = async () => {
            const { expectedCss, result } = await withFixtureTimeout(file, renderFixture);
            try {
              expect(result.css).toBe(expectedCss);
            } catch (error: unknown) {
              // Output diagnostics if available
              if (
                result
                && (result.errors.length > 0 || result.warnings.length > 0)
              ) {
                outputDiagnostics(result.errors, result.warnings, {
                  suppressWarnings: false,
                  breakOnError: false
                });
              }
              throw error;
            }
          };

          it(`${testName}${configSuffix}${
            expectedFailureReason
              ? ` (expected failure: ${expectedFailureReason})`
              : ''
          }`, async () => {
            if (!expectedFailureReason) {
              await runFixture();
              return;
            }

            const expectedDiagnosticCode =
              expectedFailureDiagnosticCodes.get(file);
            if (expectedDiagnosticCode !== undefined) {
              const { result } = await withFixtureTimeout(file, renderFixture);
              const actualDiagnosticCodes = diagnosticCodesFor(result);
              expect(
                actualDiagnosticCodes,
                `${file} is expected to surface diagnostic ${expectedDiagnosticCode}`
              ).toContain(expectedDiagnosticCode);
              return;
            }

            let failed = false;
            try {
              await runFixture();
            } catch (error: unknown) {
              if (error instanceof FixtureTimeoutError) {
                throw error;
              }
              failed = true;
            }
            expect(
              failed,
              `${file} is expected to fail until: ${expectedFailureReason}`
            ).toBe(true);
          }, 5000); // Short hang sentinel: expected failures must still settle.
        });
      } catch (error: any) {
        // If getTestCases throws (no files found), create a failing test
        it(`${file}`, () => {
          throw error;
        });
      }
    });
});

describe('Less fixture harness diagnostics', () => {
  it('surfaces fixture timeouts as harness failures', async () => {
    await expect(
      withFixtureTimeout(
        'tests-unit/import/import.less',
        () => new Promise<never>(() => {
          // Deliberately unsettled to exercise the harness timeout branch.
        }),
        1
      )
    ).rejects.toMatchObject({
      name: 'FixtureTimeoutError',
      message: 'tests-unit/import/import.less timed out before surfacing a diagnostic or render result.'
    });
  });
});
