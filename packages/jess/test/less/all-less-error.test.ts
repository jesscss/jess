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
  // detached-ruleset-1/-2 GRADUATED — a detached ruleset (Mixin/Rules) used as a
  // property value now throws eval/ruleset-on-property (declaration.ts).
  ['tests-error/eval/multiple-guards-on-css-selectors2.less', 'GAP: a guard on a multi-selector rule should error'],
  ['tests-error/eval/root-func-undefined-1.less', 'GAP: a root-level call returning no root node should error (root-call-without-root)'],
  // Same root-call-without-root GAP, newly VISIBLE: these fixtures load their
  // plugin through an EXTENSIONLESS `@plugin "…/plugin-tree-nodes"` specifier.
  // That specifier never resolved before, so the fixtures "errored" on a missing
  // file rather than on the behaviour under test. Now that a `@plugin` path
  // resolves against script extensions, the plugin loads, the call runs, and the
  // real gap shows: Jess emits the returned value at root instead of rejecting a
  // root-level call whose result is not a root node. Closing root-call-without-root
  // graduates all five together.
  ['tests-error/eval/root-func-undefined-2.less', 'GAP: a root-level call returning no root node should error (root-call-without-root)'],
  ['tests-error/eval/functions-1.less', 'GAP: a root-level call returning no root node should error (root-call-without-root)'],
  ['tests-error/eval/functions-7-dimension.less', 'GAP: a root-level call returning no root node should error (root-call-without-root)'],
  ['tests-error/eval/functions-12-quoted.less', 'GAP: a root-level call returning no root node should error (root-call-without-root)'],
  ['tests-error/eval/functions-15-value.less', 'GAP: a root-level call returning no root node should error (root-call-without-root)'],
  // ampersand-merge-template-invalid GRADUATED — its parent `@{list-quoted}` is a
  // comma-list value in selector position, so it now throws selector/comma-list-interpolation
  // (interpolated.ts). `.foo-&` itself is a plain compound; the old merge-template throw
  // (assertNotCommaMergeTemplate) was removed with the merge surface.
  // invalid-color-with-comment GRADUATED — colorHex now only matches 3/4/6/8-digit hex.
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
      // Upstream plugin fixtures resolve scripts from the test-data root rather
      // than their `tests-error/eval` directory.  Exercise the actual plugin
      // lifecycle failure here, not an incidental missing-file diagnostic.
      jsReadRoot: TD,
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

async function renderErrors(lessPath: string): Promise<Array<{ code?: string; phase?: string }>> {
  try {
    const r = await makeCompiler().renderToResult(lessPath, { breakOnError: false } as any);
    return r.errors ?? [];
  } catch (error) {
    // A thrown JessError is also a structured error result for this corpus.
    return [error as { code?: string; phase?: string }];
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
      const errors = await renderErrors(path.join(TD, file));
      const errored = errors.length > 0;
      if (file === 'tests-error/eval/plugin-2.less' || file === 'tests-error/eval/plugin-3.less') {
        expect(errors, `${file} should surface a structured eval error`).toEqual(expect.arrayContaining([
          expect.objectContaining({ phase: 'eval', code: expect.any(String) }),
        ]));
      }
      if (divergence) {
        expect(errored, `${file} now errors — remove from acceptedDivergences`).toBe(false);
      } else {
        expect(errored, `${file} should error (Less rejects it)`).toBe(true);
      }
    }, 8000);
  });
});
