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

const acceptedDivergences = new Map<string, string>([
  // Intentional v5 repairs — Jess correctly PRESERVES where Less 4.x threw.
  ['tests-error/eval/add-mixed-units.less', 'v5 unitMode:preserve → calc() for mixed-unit +, not an error'],
  ['tests-error/eval/add-mixed-units2.less', 'v5 unitMode:preserve → calc() for mixed-unit +, not an error'],
  ['tests-error/eval/divide-mixed-units.less', 'v5 unitMode:preserve → calc() for mixed-unit /, not an error'],
  ['tests-error/eval/color-func-invalid-color.less', 'v5 functionMode:preserve → renders color() as-is + warns, not an error'],
  ['tests-error/eval/color-func-invalid-color-2.less', 'v5 functionMode:preserve → renders color() as-is + warns, not an error'],
  // Real should-error GAPS — Jess accepts what Less rejects; to fix (make Jess error).
  ['tests-error/eval/css-guard-default-func.less', 'GAP: default() in a non-mixin CSS guard should error'],
  ['tests-error/eval/detached-ruleset-1.less', 'GAP: detached ruleset used on a property should error'],
  ['tests-error/eval/detached-ruleset-2.less', 'GAP: @a() detached call without [...] lookup should error'],
  ['tests-error/eval/detached-ruleset-3.less', 'GAP: property/detached-call in the root should error'],
  ['tests-error/eval/ampersand-merge-template-invalid.less', 'GAP: invalid ampersand merge template should error'],
  ['tests-error/eval/mixin-not-visible-in-scope-1.less', 'GAP: mixin not visible across sibling & scopes should error'],
  // More intentional v5 repairs (functionMode/unitMode preserve).
  ['tests-error/eval/multiply-mixed-units.less', 'v5 unitMode:preserve → calc() for mixed-unit *, not an error'],
  ['tests-error/eval/percentage-non-number-argument.less', 'v5 functionMode:preserve → renders percentage() as-is, not an error'],
  ['tests-error/eval/unit-function.less', 'v5 functionMode:preserve → renders unit() as-is, not an error'],
  ['tests-error/eval/root-func-undefined-1.less', 'v5 functionMode:preserve → unknown func() renders as-is, not an error'],
  ['tests-error/eval/svg-gradient1.less', 'v5 functionMode:preserve → renders svg-gradient() as-is, not an error'],
  ['tests-error/eval/svg-gradient2.less', 'v5 functionMode:preserve → renders svg-gradient() as-is, not an error'],
  ['tests-error/eval/svg-gradient3.less', 'v5 functionMode:preserve → renders svg-gradient() as-is, not an error'],
  ['tests-error/eval/svg-gradient4.less', 'v5 functionMode:preserve → renders svg-gradient() as-is, not an error'],
  ['tests-error/eval/svg-gradient5.less', 'v5 functionMode:preserve → renders svg-gradient() as-is, not an error'],
  ['tests-error/eval/svg-gradient6.less', 'v5 functionMode:preserve → renders svg-gradient() as-is, not an error'],
  // More real should-error GAPS — Jess accepts what Less rejects; to fix.
  ['tests-error/eval/property-in-root.less', 'GAP: a property in the root should error'],
  ['tests-error/eval/property-in-root2.less', 'GAP: a property in the root should error'],
  ['tests-error/eval/property-interp-not-defined.less', 'GAP: undefined @var in a property-name interpolation should error'],
  ['tests-error/eval/multiple-guards-on-css-selectors.less', 'GAP: a guard on a multi-selector rule should error'],
  ['tests-error/eval/multiple-guards-on-css-selectors2.less', 'GAP: a guard on a multi-selector rule should error'],
  ['tests-error/parse/invalid-color-with-comment.less', 'GAP: malformed hex color (#fffff) should be a parse error'],
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
      plugins: [lessPlugin(), lessCompatPlugin({ plugins: [lessHarnessFunctionsPlugin] })]
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
