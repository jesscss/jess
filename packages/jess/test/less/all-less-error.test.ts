import { describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import { resolveLessTestDataRoot, lessHarnessFunctionsPlugin } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/**
 * Less error corpus (`tests-error` — parse + eval). Each fixture is input Less
 * that Less 4.x REJECTS (there's a golden `.txt` error). Per the alpha plan this
 * is a CLASSIFY-only lane: Jess must ALSO error (produce ≥1 diagnostic or throw)
 * — we do not match Less's exact message/line/column (Jess's parser is its own).
 *
 * `acceptedDivergences` are the fixtures Jess currently ACCEPTS where Less errors
 * — a known gap or an intentional v5 repair. They're asserted to keep accepting
 * (so a fix that closes one trips the test and graduates it out of this list),
 * and each carries a reason. Everything else must error.
 */
const TD = resolveLessTestDataRoot();

// With Less-4-parity error surfacing ON (functionMode:'error', unitMode:'strict'
// — see makeCompiler), the function/unit "divergences" now ERROR like Less, so
// they're gone from this list. What remains is: genuine v5 behavior that no
// option changes, plus REAL gaps where Jess still fails to error.
const acceptedDivergences = new Map<string, string>([
  // Intentional v5 behavior even under error-surfacing options — a color fn whose
  // argument is a runtime `var()` can't be evaluated at build, so v5 preserves it.
  ['tests-error/eval/color-func-invalid-color-2.less', 'v5 preserves darken(var(--x), …): a runtime var() arg is un-evaluable at build'],

  // Real should-error GAPS — Jess still ACCEPTS these with error options on;
  // each asserts KEEP-accepting, so a fix that closes it trips the test.
  // (property-in-root / property-in-root2 / detached-ruleset-3 GRADUATED — they
  //  now error via checkValidNodes' root property-in-root check.)
  ['tests-error/eval/property-interp-not-defined.less', 'GAP: undefined @var in a property-name interpolation should error'],
  // detached-ruleset-1/-2 GRADUATED — a detached ruleset (Mixin/Rules) used as a
  // property value now throws eval/ruleset-on-property (declaration.ts).
  ['tests-error/eval/css-guard-default-func.less', 'GAP: default() in a non-mixin CSS guard should error'],
  ['tests-error/eval/multiple-guards-on-css-selectors.less', 'GAP: a guard on a multi-selector rule should error'],
  ['tests-error/eval/multiple-guards-on-css-selectors2.less', 'GAP: a guard on a multi-selector rule should error'],
  ['tests-error/eval/root-func-undefined-1.less', 'GAP: a root-level call returning no root node should error (root-call-without-root)'],
  // ampersand-merge-template-invalid GRADUATED — its parent `@{list-quoted}` is a
  // comma-list value in selector position, so it now throws selector/comma-list-interpolation
  // (interpolated.ts). `.foo-&` itself is a plain compound; the old merge-template throw
  // (assertNotCommaMergeTemplate) was removed with the merge surface.
  ['tests-error/eval/mixin-not-visible-in-scope-1.less', 'GAP: mixin not visible across sibling & scopes should error'],
  // invalid-color-with-comment GRADUATED — colorHex now only matches 3/4/6/8-digit hex.
  ['tests-error/parse/mixins-guards-cond-expected.less', 'GAP: guard without a parenthesized condition should be a parse error']
]);

/**
 * Fixtures whose eval leaves a dangling async handle (unresolved recursion) that
 * force-kills the vitest worker at teardown. They're also should-error GAPS
 * (Less rejects the recursive definition; Jess neither errors nor terminates).
 * Skipped here so the in-process lane stays reliable; tracked for the cycle-
 * detection fix that will let them error and graduate back in.
 */
const hangSkips = new Map<string, string>([
  ['tests-error/eval/recursive-variable.less', 'hangs worker: recursive @var definition not detected (should error)'],
  ['tests-error/eval/recursive-property.less', 'hangs worker: recursive property definition not detected (should error)']
]);

function makeCompiler() {
  return new Compiler({
    output: { collapseNesting: true },
    compile: {
      plugins: [lessPlugin(), lessCompatPlugin({ plugins: [lessHarnessFunctionsPlugin] })],
      // Less 4.x-parity error surfacing: this corpus asks "does Jess error where
      // Less 4.x errors". Under the v5-lenient defaults (functionMode/unitMode
      // 'preserve') Jess would render bad-function / mixed-unit input as-is —
      // that's option-controlled, not a gap. Turn the options that gate those
      // errors ON so what remains accepting is a REAL gap. (leakyScope /
      // equalityMode stay at Less-4 defaults: Less 4.x is leaky + `less` equality.)
      functionMode: 'error',
      unitMode: 'strict'
    }
  });
}

async function rendersWithError(lessPath: string): Promise<boolean> {
  try {
    const r = await makeCompiler().renderToResult(lessPath, { breakOnError: false } as any);
    return (r.errors?.length ?? 0) > 0;
  } catch {
    return true; // a throw is also "errored"
  }
}

describe('Less error corpus (Jess must error where Less errors)', () => {
  const files = glob.sync(path.join(TD, 'tests-error/**/*.less'))
    .map(f => path.relative(TD, f))
    // `imports/` subdirs are helper files pulled in by other fixtures, not
    // standalone error cases — Less's own runner doesn't test them directly.
    .filter(f => !f.includes(`${path.sep}imports${path.sep}`))
    .sort();

  files.forEach((file) => {
    const hang = hangSkips.get(file);
    if (hang) {
      it.skip(`${file} (skipped — ${hang})`, () => {});
      return;
    }
    const divergence = acceptedDivergences.get(file);
    it(`${file}${divergence ? ` (accepts — divergence: ${divergence})` : ''}`, async () => {
      const errored = await rendersWithError(path.join(TD, file));
      if (divergence) {
        expect(errored, `${file} now errors — remove from acceptedDivergences`).toBe(false);
      } else {
        expect(errored, `${file} should error (Less rejects it)`).toBe(true);
      }
    }, 8000);
  });
});
