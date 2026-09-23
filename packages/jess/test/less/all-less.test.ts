import { afterAll, describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'node:crypto';
import { Compiler } from '../../src/index.js';
import { outputDiagnostics } from '@jesscss/compiler/diagnostics';
import { getTestCases, resolveLessTestDataRoot, lessFixturePackagesPlugin } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/*
 * HOW A FIXTURE CAN FAIL TO RUN — all of it is in this file, on purpose.
 *
 * 1. `skippedFixtures` — not run. Every entry needs a reason, every entry is
 *    reported as a skipped test so it shows up in the run, and the stale-skip
 *    gate at the bottom of this file fails if one starts matching its golden.
 * 2. `expectedFailureFixtures` — RUN, and asserted to fail. Fixing the cause
 *    fails the entry, which is how a fix gets noticed.
 * 3. no `.css` golden next to the `.less` — a helper or partial, never a fixture.
 *
 * There used to be a fourth: an `invalidLess` array in `@jesscss/shared` that
 * filtered fixtures out of the glob silently. Six of its entries had gone stale
 * and were passing unnoticed, so it is gone and its contents live in (1).
 * Do not add another list. If a fixture must not run, give it a reason here.
 */

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
       * The Less.js compatibility layer that supplies the legacy `@plugin` script
       * ABI (`registerPlugin`/`setOptions`/`functions`/`tree` globals). It is NOT
       * part of the default compiler stack (see @jesscss/compiler-preset), so a
       * downstream install never auto-loads it — the test harness opts in
       * explicitly so upstream legacy-`@plugin` fixtures (plugin/plugin.less) run.
       */
      lessCompatPlugin(),

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
const forceCollapseNesting = process.env.JESS_FORCE_COLLAPSE_NESTING === 'true';
const manifestOut = process.env.JESS_LESS_MANIFEST_OUT;

/*
 * Fixtures whose maintained less.js golden is the FLATTENED 4.x output, so they
 * are gated against that oracle at collapseNesting:true regardless of the
 * fixture directory's collapseNesting:false default. Their sibling fixtures in
 * the same directory (import-reference-issues, mixins/maps) keep genuine v5
 * nested goldens and stay at the directory default. Nested-mode correctness for
 * these two is covered by the separate nested==collapsed equivalence tests.
 */
const collapseNestingTrueFixtures = new Set<string>([
  'tests-unit/import/import-reference.less',
  'tests-unit/mixins/mixins.less'
]);

type CorpusManifestRecord = {
  case: string;
  cssSha256?: string;
  diagnosticCodes?: string[];
};

const manifestRecords: CorpusManifestRecord[] = [];

function recordManifest(testCase: string, result: RenderResult): void {
  if (manifestOut === undefined) {
    return;
  }
  const diagnosticCodes = result.errors.map(diagnostic => diagnostic.code);
  manifestRecords.push(diagnosticCodes.length === 0
    ? {
        case: testCase,
        cssSha256: createHash('sha256').update(result.css).digest('hex')
      }
    : { case: testCase, diagnosticCodes });
}

afterAll(() => {
  if (manifestOut !== undefined) {
    manifestRecords.sort((left, right) => left.case.localeCompare(right.case));
    writeFileSync(manifestOut, `${JSON.stringify(manifestRecords, null, 2)}\n`, 'utf8');
  }
});

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

  /**
   * Justification for exempting this entry from the stale-skip gate, for the
   * case where matching the golden is not evidence that the feature works.
   * A bare skip cannot say that, which is why it has to be written down.
   */
  gateExempt?: string;
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
    { file: 'tests-config/debug/linenumbers.less', reason: 'debug output fixture; no expected CSS in upstream fixture' },
    { file: 'tests-config/filemanagerPlugin/filemanager.less', reason: 'custom Less file manager plugin API needs scope decision' },
    { file: 'tests-config/include-path/import-test-e.less', reason: 'helper imported by include-path fixture; no expected CSS' },
    { file: 'tests-config/import-redirect/import-redirect.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/js-type-errors/js-type-error.less', reason: 'expected error fixture, not render-to-CSS fixture' },
    { file: 'tests-config/math-always/mixins-guards.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-always/no-sm-operations.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-parens-division/media-math.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-parens-division/mixins-args.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-parens-division/new-division.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-parens-division/parens.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-strict/css.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-strict/media-math.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-strict/mixins-args.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/math-strict/parens.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/no-js-errors/no-js-errors.less', reason: 'expected error fixture, not render-to-CSS fixture' },
    { file: 'tests-config/postProcessorPlugin/postProcessor.less', reason: 'Less postprocessor plugin API needs scope decision' },
    { file: 'tests-config/preProcessorPlugin/preProcessor.less', reason: 'Less preprocessor plugin API needs scope decision' },
    { file: 'tests-config/root-registry/file.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/root-registry/root.less', reason: 'no expected CSS in upstream fixture' },
    { file: 'tests-config/strict-imports/imported.less', reason: 'helper imported by strict-imports fixture; no expected CSS' },
    { file: 'tests-config/sourcemaps/basic.less', reason: 'source-map output suite needs dedicated output artifact checks' },
    { file: 'tests-config/sourcemaps/custom-props.less', reason: 'source-map output suite needs dedicated output artifact checks' },
    { file: 'tests-config/sourcemaps-disable-annotation/basic.less', reason: 'source-map output suite needs dedicated output artifact checks' },
    { file: 'tests-config/sourcemaps-empty/empty.less', reason: 'source-map output suite needs dedicated output artifact checks' },
    { file: 'tests-config/sourcemaps-empty/var-defs.less', reason: 'source-map output suite needs dedicated output artifact checks' },
    { file: 'tests-config/sourcemaps-variable-selector/basic.less', reason: 'source-map output suite needs dedicated output artifact checks' },
    { file: 'tests-config/sourcemaps-variable-selector/vars.less', reason: 'source-map output suite needs dedicated output artifact checks' },
    { file: 'tests-config/visitorPlugin/visitor.less', reason: 'Less visitor plugin API needs scope decision' },
    {
      file: 'tests-unit/import/import-remote.less',
      reason:
        'remote URL imports require an explicit network/IO allowlist, which is not part of the alpha harness policy',
      gateExempt:
        'matches its golden OFFLINE only because the harness fixture-package plugin maps those cdn.jsdelivr.net URLs onto the local corpus. That is not evidence that remote imports work — jess#219 decides the network policy, and Phase C of the release plan gates on it.'
    },

    /*
     * CARRIED OVER from the former `invalidLess` list in `@jesscss/shared`,
     * which filtered fixtures out of the glob with no trace in a test run. One
     * list now holds every exclusion, every entry states a reason, and the
     * stale-skip gate below re-measures them.
     */
    /*
     * Nested fixtures, visible since the lane started discovering one level
     * deeper. Both features are deferred, and these four are the only nested
     * fixtures with goldens that do not pass.
     */
    {
      file: 'tests-config/debug/all/linenumbers-all.less',
      reason: 'dumpLineNumbers is declared in the config surface (core/src/types/config.ts) but nothing consumes it — the golden expects `/* line N, {path} */` annotations (same feature as the tests-config/debug/linenumbers.less skip)'
    },
    {
      file: 'tests-config/debug/comments/linenumbers-comments.less',
      reason: 'dumpLineNumbers is not implemented — the golden expects `/* line N, {path} */` annotations'
    },
    {
      file: 'tests-config/debug/mediaquery/linenumbers-mediaquery.less',
      reason: 'dumpLineNumbers is not implemented — the golden expects @media-encoded line annotations'
    },
    {
      file: 'tests-config/sourcemaps/comprehensive/comprehensive.less',
      reason: 'source-map output suite needs dedicated output artifact checks (same reason as the other sourcemaps fixtures)'
    },
    {
      file: 'tests-unit/permissive-parse/permissive-parse.less',
      reason: 'INTENDED DIVERGENCE (P7): a bare `@function-name` at-rule prelude is rejected'
    },
    {
      file: 'tests-unit/permissive-parse/legacy/permissive-parse.less',
      reason: 'same P7 prelude ruling as its non-legacy sibling'
    },
    {
      file: 'tests-unit/property-name-interp/property-name-interp.less',
      reason: 'OPEN F7(a): repeated complex property-name interpolation drops value-owned layout trivia'
    },
    {
      file: 'tests-unit/functions/legacy/functions.less',
      reason: 'non-Less `$list` parameter syntax is deliberately unsupported'
    },
    {
      file: 'tests-unit/parser-slashed-combinator/parser-slashed-combinator.less',
      reason: 'every case in the upstream fixture is commented out, so it renders to nothing while its golden is a stray newline. The cases are commented out because `/deep/` and `/shadow/` do not parse in jess though lessc 4.9.1 accepts them — jess#247. Uncommenting them upstream pins whichever way that is ruled'
    },
    {
      file: 'tests-unit/javascript/javascript.less',
      reason: 'inline backtick JavaScript is intentionally unsupported in v5'
    },
    {
      file: 'tests-config/js-type-errors/js-type-error.less',
      reason: 'inline backtick JavaScript is intentionally unsupported in v5'
    },
    {
      file: 'tests-config/no-js-errors/no-js-errors.less',
      reason: 'inline backtick JavaScript is intentionally unsupported in v5'
    },
    {
      file: 'tests-config/math-parens-division/new-division.less',
      reason: 'the deprecated `./` dot-slash division operator was removed in v5; it is now a parse error'
    },
    {
      file: 'tests-config/math-always/no-sm-operations.less',
      reason: 'no reason was recorded when this entry was added; not re-measured'
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
   * NOTE: import-reference-issues.less and starting-style.less graduated OUT of
   * this list — the D3 single-render-pass change (removing the separate
   * Compiler-level eval pre-pass so render() is the sole eval driver) eliminated
   * a double-eval that (a) re-ran `+_:` shorthand merges twice (starting-style's
   * padding accumulated to 10 values) and (b) re-ran import resolution twice
   * (import-reference-issues threw "File not found" on the 2nd pass). Both now
   * match the Less golden .css under the harness config.
   *
   * import-reference.less GRADUATED too (gated at collapseNesting:true): the
   * ruleset-mixin extend-splice leak (`.b { .z() }`), the reference-mixin body drop
   * under extends (`.zz()` keeps `.y`), and inline-import-inside-a-block placement
   * (`div { @import(inline) … }`) are all fixed, so it renders byte-identical to the
   * v5-reconciled golden (extend through a reference outputs only the extender —
   * DESIGN-DECISIONS X13; bare-`&` emits a CSS-nesting block; source-asserted inline
   * comment preserved; `only-with-visible` renamed `stays-invisible`).
   */

  /*
   * Owner 2026-09-02 restored the 4.x behavior: a media query on a legacy
   * compile-time `@import` now desugars to a `@media <query>` wrapper around the
   * spliced document, AND the spliced rules indent inside the wrapper exactly
   * like an authored `@media` body (less grammar `ImportStatement` +
   * `serialize.ts` `emitBubbleBody`; docs/architecture/core/DESIGN-DECISIONS.md
   * A10). `import-inline.less` now matches its golden and has GRADUATED off this
   * list. `import.less` has ALSO GRADUATED. Two things closed its remaining gap:
   * (1) DESIGN-DECISIONS.md N11 — a source-leading document block comment now
   * emits after the hoisted `@charset` and before the hoisted root CSS `@import`s
   * (CSS Syntax Module Level 3 §3.2 forces the charset first; serialize.ts
   * `continueRender`); and
   * (2) the stale 4.x golden π (`3.141592653589793`) was updated to jess's v5
   * 10-digit output quantization (`3.1415926536`, DESIGN-DECISIONS.md V4). The
   * owner authorized landing this `import.less` fix (2026-09-06); the placement
   * itself is the OPEN N11 spec argument, not an owner placement ruling.
   */
  [
    'tests-unit/urls/urls.less',
    'INTENDED DIVERGENCE (§12.3b): the fully interpolated target in `.add_an_import("file.css")` is authored as a compile-time StyleImport, so terminal classification does not defer until it evaluates to `file.css`; normal import resolution therefore reports the missing file'
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
   * (mixins.less GRADUATED — its maintained golden is the flattened 4.x output,
   * so it is gated at collapseNesting:true against that oracle via
   * collapseNestingTrueFixtures and now renders byte-identical; a real pass.)
   */
  [
    'tests-unit/property-name-interp/property-name-interp.less',
    'OPEN F7(a): property-name interpolation renders byte-identically except that repeated `@{p}@{p}` loses the `/* foo */` source layout carried inside each complex interpolated value; interpolation-splice layout preservation awaits an owner ruling'
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
    'INTENDED DIVERGENCE (owner ruling 2026-08-18). Lines 124-135 use `@plugin (option) "…"` with the `registerPlugin({ install, use, setOptions })` lifecycle — a documented Less 4.x plugin-API form, but `@plugin` itself is DEPRECATED in v5 (script integration moves to @use / @-use; see deprecation.ts). The bare, common ABI works: with the harness-loaded @jesscss/plugin-less-compat, `functions.addMultiple`/`tree` @plugin scripts (plugin-global, plugin-transitive) load fine. The `registerPlugin`/`setOptions`/`(option)` plugin-manager lifecycle is deliberately NOT built out in the compat bridge — it is a rarely-used corner of a deprecated feature, so any script-integration effort belongs in the @use path instead. Owner-maintained @less/test-data fixture'
  ],
  [
    'tests-unit/parse-interpolation/parse-interpolation.less',
    'selector capture itself is complete. INTENDED DIVERGENCE (owner ruling 2026-08-22): fixture-local collapseNesting:false preserves the final `@{list-cap} { .fruit-cap-& {…} }` boundary instead of implicitly flattening it; collapseNesting:true emits the golden `.fruit-cap-apple, …` branches exactly, and Less `each()` is the explicit rule-multiplication form. Separate OPEN O8 owner decisions remain for canonical nested selector-list wrapping and leading whitespace from an escaped quoted selector at the header boundary; the maintained golden also says `foo: bar` where its quoted-case source says `foo: baz`. Owner reconciliation is required for those output-policy rows and the fixture typo'
  ],
  [
    'tests-unit/permissive-parse/permissive-parse.less',
    'INTENDED DIVERGENCE (P7): the fixture begins with bare `@function-name` interpolation in an at-rule prelude, which v5 rejects in favor of `@{function-name}`; permissive CSS-base `--*` declaration values and selector capture are already implemented independently'
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
  ]

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
   * would clamp/reformat them (settled: DESIGN-DECISIONS F5). color-functions/
   * operations.less GRADUATED — its `.e { rgba(-99.9, 31.4159, 321, 0.42) }`
   * un-operated overflow call now matches the v5-reconciled golden byte-for-byte.
   *
   * functions.less GRADUATED — every remaining diff was an intended v5 divergence
   * whose stale 4.x golden was updated: (1) `min()`/`max()` over incompatible
   * units preserve every authored argument (`min(6em, 5, 4ex, 3, 2pt, 1)`) rather
   * than emitting less.js's order-dependent partial reduction, an "implementation
   * accident, not a semantic" — DESIGN-DECISIONS C20 (OPEN, owner-to-ratify);
   * `packages/fns/src/less/min-max.ts`. And (2) the numeric output policy is a
   * single owner (`format-number.ts`, shortest decimal within 1e-10 relative, no
   * significant-figure cap) — DESIGN-DECISIONS V4 (SETTLED) with F6 as its
   * formatting-section cross-reference; SEMANTIC-INVARIANTS §3/S1 records less.js's
   * 8-dp `numPrecision` rounding as a leak — so `pi`/`tan`/`sin`/`cos` and the
   * luma/luminance percentages carry more digits than that rounding. The one
   * genuine bug — bare `not <operand>` (`boolean(not false)`, `if(not false, …)`)
   * was truthiness-tested as a two-keyword value instead of negated — was FIXED in
   * the less grammar `not`-opener gate (P8/§B5 branch-lazy conditions unchanged).
   */
]);

const expectedFailureDiagnosticCodes = new Map<string, string>([
  /* Owner 2026-09-02 restored the 4.x wrap: a media query on a legacy
   * compile-time `@import` now desugars to `@media <query>` instead of raising a
   * parse error, so these two import fixtures no longer surface a diagnostic —
   * they still differ from the external golden only on render layout (see the
   * expected-failure reasons), not on a parse error. */
  ['tests-unit/urls/urls.less', 'import/not-found']
]);

type RenderResult = Awaited<ReturnType<Compiler['renderToResult']>>;

const diagnosticCodesFor = (result: RenderResult): string[] => [
  ...result.errors.map(diagnostic => diagnostic.code),
  ...result.warnings.map(diagnostic => diagnostic.code)
];

// Allow specific fixtures even when they carry a skip reason.
const forcedIncludes = new Set<string>([]);

describe('Can render Less files to CSS', () => {
  // Run all unit fixtures under tests-unit.
  const unitFiles: string[] = glob.sync(
    path.join(testData, 'tests-unit/*/*.less')
  );
  const configFiles: string[] = glob.sync(
    path.join(testData, 'tests-config/*/*.less')
  );

  /*
   * The corpus nests some fixtures one level deeper (`tests-config/units/loose/`,
   * `tests-unit/functions/legacy/`). A two-level glob silently skipped all ten of
   * them, goldens and all — including the three `unitMode` fixtures, which pass.
   * An undiscovered fixture leaves no trace, so depth is a discovery bug, not a
   * policy: anything that should not run belongs in `skippedFixtures` with a reason.
   */
  const nestedFiles: string[] = glob
    .sync(path.join(testData, 'tests-{unit,config}/*/*/*.less'))
    .filter(file => existsSync(file.replace(/\.less$/, '.css')));
  const allFiles = [...unitFiles, ...configFiles, ...nestedFiles];

  allFiles
    .map(value => path.relative(testData, value))
    .filter(value => forcedIncludes.has(value) || !skippedFixtureReasons.has(value))
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
                ...(testCase.config.output || {}),
                ...(collapseNestingTrueFixtures.has(file)
                  ? { collapseNesting: true }
                  : {}),
                ...(forceCollapseNesting ? { collapseNesting: true } : {})
              }
            });

            const result = await testCompiler.renderToResult(lessPath, {
              outputFile: testCase.expectedFile
            });
            recordManifest(`${testName}${configSuffix}`, result);
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

/*
 * Every skipped fixture is REPORTED, so `invalidLess`-style invisible exclusions
 * cannot come back: a reader of the test output sees the file and the reason.
 */
describe('Skipped Less fixtures (not run)', () => {
  for (const { file, reason, gateExempt } of skippedFixtures) {
    it.skip(
      `${file} — ${reason}${gateExempt === undefined ? '' : ` [exempt from the stale-skip gate: ${gateExempt}]`}`,
      () => {}
    );
  }
});

/*
 * A skip is a claim that the fixture does not match its golden yet. This gate
 * re-measures that claim, because six exclusions had silently gone stale. A
 * fixture that renders byte-identically must lose its skip and become a gate.
 *
 * Anything that throws, times out, or has no golden still counts as "does not
 * match" — this gate only fires on the one case a skip cannot explain.
 */
describe('Skipped Less fixtures are still failing', () => {
  const measurable = skippedFixtures.filter(({ file, gateExempt }) => {
    if (gateExempt !== undefined) {
      return false;
    }
    try {
      return getTestCases(path.join(testData, file)).length > 0;
    } catch {
      return false;
    }
  });

  for (const { file, reason } of measurable) {
    it(`${file} still differs from its golden`, async () => {
      const lessPath = path.join(testData, file);
      const [testCase] = getTestCases(lessPath);
      let matched = false;
      try {
        const expectedCss = readFileSync(testCase.expectedFile, 'utf8');
        const result = await withFixtureTimeout(file, () => new Compiler({
          ...baseCompiler.opts,
          ...testCase.config,
          output: {
            ...baseCompiler.opts.output,
            ...(testCase.config.output || {}),
            ...(collapseNestingTrueFixtures.has(file) ? { collapseNesting: true } : {})
          }
        }).renderToResult(lessPath, { outputFile: testCase.expectedFile }));
        matched = result.css === expectedCss;
      } catch {
        matched = false;
      }

      expect(
        matched,
        `${file} now matches its golden, so its skip is stale — remove it from `
        + `skippedFixtures and let it gate. Recorded reason: ${reason}`
      ).toBe(false);
    }, 10000);
  }
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
