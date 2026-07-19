import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * Number precision at the value / interpolation boundary (matches less.js `alpha`).
 *
 * less.js applies its 8-dp `numPrecision` rounding only when a `Dimension` is
 * emitted as a declaration VALUE (`Dimension.genCSS` under the toCSS context that
 * carries `numPrecision: 8`). An interpolated dimension (`@{x}` spliced into a
 * selector / property name / `~"…"` string) is serialized at EVAL time, where no
 * `numPrecision` is threaded, so it keeps FULL double precision. Evidence:
 *   `.less`  @x: pi(); .sel-@{x} { a: @x }
 *   less.js  .sel-3.141592653589793 { a: 3.14159265 }
 * (probed against `~/git/worktrees/less.js` alpha and the alpha `test-data` corpus:
 * `functions.css` → `pi: 3.14159265`; `property-name-interp.css` → `3.14159265…793`.)
 */
function render(src: string): string {
  const res = renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()) });
  expect(res.threw, res.threw?.message).toBeNull();
  expect(res.parseErrors, JSON.stringify(res.parseErrors)).toEqual([]);
  return res.css ?? '';
}

describe('number precision: value rounds at 8 dp, interpolation keeps full precision', () => {
  it('a computed constant is 8-dp rounded as a declaration VALUE', () => {
    expect(render('.a { v: pi(); }\n')).toContain('v: 3.14159265;');
  });

  it('a computed constant keeps FULL precision spliced into a SELECTOR', () => {
    expect(render('@x: pi();\n.sel-@{x} { a: 1; }\n')).toContain('.sel-3.141592653589793 {');
  });

  it('a computed constant keeps FULL precision spliced into a PROPERTY NAME', () => {
    expect(render('.b { @n: pi(); @{n}-prop: 2; }\n')).toContain('3.141592653589793-prop: 2;');
  });

  it('a computed constant keeps FULL precision spliced into a ~"…" STRING', () => {
    expect(render('@x: pi();\n.c { d: ~"val @{x}"; }\n')).toContain('d: val 3.141592653589793;');
  });

  it('a rounded computed value (1/3) is 8-dp as a value but full-precision in interp', () => {
    expect(render('.d { v: (1 / 3); }\n')).toContain('v: 0.33333333;');
    expect(render('@t: (1 / 3);\n.e-@{t} { a: 1; }\n')).toContain('.e-0.3333333333333333 {');
  });

  it('an un-operated source literal is emitted VERBATIM in both value and interpolation', () => {
    // `1.0px` / `2PX` are un-operated tokens: no rounding, no normalization, and the
    // full-precision interp path must NOT touch them (their bytes are the source spelling).
    expect(render('.f { a: 1.0px; b: 2PX; }\n')).toContain('a: 1.0px;');
    expect(render('.f { a: 1.0px; b: 2PX; }\n')).toContain('b: 2PX;');
    expect(render('@u: 1.0px;\n.g-@{u} { a: 1; }\n')).toContain('.g-1.0px {');
  });
});
