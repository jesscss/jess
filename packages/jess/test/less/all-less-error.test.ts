import { describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync } from 'fs';
import { Compiler } from '../../src/index.js';
import { FixtureTimeoutError, lessHarnessFunctionsPlugin, resolveLessTestDataRoot, withFixtureTimeout } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/**
 * Less error corpus (`tests-error` — parse + eval). Each fixture is input Less
 * that Less 4.x REJECTS (there's a golden `.txt` error). Jess must ALSO error
 * (produce ≥1 diagnostic or throw). Messages are never compared; the code and
 * the `.txt` location are compared only for `callSiteErrorFixtures` (parse
 * locations differ, since Jess's parser is its own).
 *
 * `acceptedDivergences` are the fixtures Jess currently ACCEPTS where Less errors
 * — a known gap or an intentional v5 repair. They're asserted to keep accepting
 * (so a fix that closes one trips the test and graduates it out of this list),
 * and each carries a reason. Everything else must error.
 */
const TD = resolveLessTestDataRoot();
const acceptedDivergences = new Map<string, string>([
  /*
   * Intentional v5 behavior even under the error-surfacing options in
   * makeCompiler: regular variables are lazy (ledger R1) and `@base-color` is
   * never referenced, so its failing `darken()` never runs. Referenced, it
   * rejects (function-mode.test.ts).
   */
  ['tests-error/eval/color-func-invalid-color-2.less', 'lazy variables (R1): the failing call sits in an unreferenced variable']
]);

const rootCallFunctionFixtures = new Set([
  'tests-error/eval/functions-1.less',
  'tests-error/eval/functions-5-color.less',
  'tests-error/eval/functions-7-dimension.less',
  'tests-error/eval/functions-12-quoted.less',
  'tests-error/eval/functions-15-value.less'
]);

/*
 * Fixtures Less 4.x rejects in a built-in's argument check or in unit
 * arithmetic. Under the v5 defaults they render — the failing call kept as a
 * call with evaluated, canonically spaced arguments (functionMode 'preserve',
 * ledger C17; pinned per fixture in function-mode.test.ts), the unit clash as
 * `calc()` (unitMode 'preserve', V18) — so they reject only with the options in
 * makeCompiler. They must then reject where Less does: the line and column of
 * the fixture's `.txt`. A unit-arithmetic diagnostic points at the failing
 * operator rather than the declaration start Less reports, so only its line is
 * compared.
 *
 * Wording is not asserted. Known differences: the argument binder reports
 * `percentage: arg 0 expected Dimension, got List` where Less says `argument must
 * be a number` (`unit()` likewise drops Less's parenthesis hint), and
 * `svg-gradient(black, orange)` reports the stop-list message because the stops
 * are counted structurally; Less counted the characters of `orange` and so
 * reached its direction message instead.
 */
const callSiteErrorFixtures = new Map<string, string>([
  ['tests-error/eval/add-mixed-units.less', 'eval/invalid-unit-arithmetic'],
  ['tests-error/eval/add-mixed-units2.less', 'eval/invalid-unit-arithmetic'],
  ['tests-error/eval/divide-mixed-units.less', 'eval/invalid-unit-arithmetic'],
  ['tests-error/eval/multiply-mixed-units.less', 'eval/invalid-unit-arithmetic'],
  ['tests-error/eval/color-func-invalid-color.less', 'eval/invalid-function'],
  ['tests-error/eval/percentage-css-var.less', 'eval/invalid-function'],
  ['tests-error/eval/percentage-non-number-argument.less', 'eval/invalid-function'],
  ['tests-error/eval/svg-gradient1.less', 'eval/invalid-function'],
  ['tests-error/eval/svg-gradient2.less', 'eval/invalid-function'],
  ['tests-error/eval/svg-gradient3.less', 'eval/invalid-function'],
  ['tests-error/eval/svg-gradient4.less', 'eval/invalid-function'],
  ['tests-error/eval/svg-gradient5.less', 'eval/invalid-function'],
  ['tests-error/eval/svg-gradient6.less', 'eval/invalid-function'],
  ['tests-error/eval/unit-function.less', 'eval/invalid-function']
]);

/** The `on line N, column M` location in a fixture's expected Less error. */
function lessErrorLocation(file: string): { line: number; column: number } {
  const txt = readFileSync(path.join(TD, file.replace(/\.less$/, '.txt')), 'utf8');
  const match = / on line (\d+), column (\d+):/.exec(txt);
  if (!match) {
    throw new Error(`${file}: no location in the expected error`);
  }
  return { line: Number(match[1]), column: Number(match[2]) };
}

function makeCompiler() {
  return new Compiler({
    output: { collapseNesting: true },
    compile: {
      /*
       * Upstream plugin fixtures resolve scripts from the test-data root rather
       * than their `tests-error/eval` directory.  Exercise the actual plugin
       * lifecycle failure here, not an incidental missing-file diagnostic.
       */
      jsReadRoot: TD,
      plugins: [lessPlugin(), lessCompatPlugin({ plugins: [lessHarnessFunctionsPlugin] })],

      /*
       * Less 4.x-parity error surfacing: this corpus asks "does Jess error where
       * Less 4.x errors". Under the v5-lenient defaults (functionMode/unitMode
       * 'preserve') Jess would render bad-function / mixed-unit input as-is —
       * that's option-controlled, not a gap. Turn the options that gate those
       * errors ON so what remains accepting is a REAL gap. (leakyScope stays at
       * the Less-4 default: Less 4.x is leaky.)
       */
      functionMode: 'error',
      unitMode: 'strict'
    }
  });
}

async function renderErrors(lessPath: string): Promise<Array<{ code?: string; phase?: string }>> {
  try {
    const r = await withFixtureTimeout(lessPath, () => makeCompiler().renderToResult(lessPath, { breakOnError: false }));
    return r.errors ?? [];
  } catch (error) {
    if (error instanceof FixtureTimeoutError) {
      throw error;
    }

    // A thrown JessError is also a structured error result for this corpus.
    return [error as { code?: string; phase?: string }];
  }
}

describe('Less error corpus (Jess must error where Less errors)', () => {
  const files = glob.sync(path.join(TD, 'tests-error/**/*.less'))
    .map(f => path.relative(TD, f))

    /*
     * `imports/` subdirs are helper files pulled in by other fixtures, not
     * standalone error cases — Less's own runner doesn't test them directly.
     */
    .filter(f => !f.includes(`${path.sep}imports${path.sep}`))
    .sort();

  files.forEach((file) => {
    const divergence = acceptedDivergences.get(file);
    it(`${file}${divergence ? ` (accepts — divergence: ${divergence})` : ''}`, async () => {
      const errors = await renderErrors(path.join(TD, file));
      const errored = errors.length > 0;
      if (file === 'tests-error/eval/plugin-2.less' || file === 'tests-error/eval/plugin-3.less') {
        expect(errors, `${file} should surface a structured eval error`).toEqual(expect.arrayContaining([
          expect.objectContaining({ phase: 'eval', code: expect.any(String) })
        ]));
      }
      if (file === 'tests-error/parse/parser-slashed-combinator.less') {
        expect(errors, `${file} should name the removed combinator (jess#247)`).toEqual(expect.arrayContaining([
          expect.objectContaining({ phase: 'parse', code: 'parse/unsupported-slashed-combinator' })
        ]));
      }
      if (rootCallFunctionFixtures.has(file)) {
        expect(errors, `${file} should reject value results in root statement position`).toEqual(expect.arrayContaining([
          expect.objectContaining({ phase: 'eval', code: 'eval/invalid-statement' })
        ]));
        expect(errors.some(error => error.code === 'eval/async-in-sync-position'), `${file} must not leak the async render lane`).toBe(false);
      }
      const callSiteCode = callSiteErrorFixtures.get(file);
      if (callSiteCode) {
        const { line, column } = lessErrorLocation(file);
        expect(errors[0], `${file} should reject at the Less call site`).toMatchObject({
          code: callSiteCode,
          line,
          ...(callSiteCode === 'eval/invalid-unit-arithmetic' ? {} : { column })
        });
      }
      if (divergence) {
        expect(errored, `${file} now errors — remove from acceptedDivergences`).toBe(false);
      } else {
        expect(errored, `${file} should error (Less rejects it)`).toBe(true);
      }
    });
  });
});
