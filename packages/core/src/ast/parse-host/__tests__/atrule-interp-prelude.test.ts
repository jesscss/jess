import { describe, it, expect } from 'vitest';
import { renderAstDoc } from './whole-doc-driver.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';

/**
 * At-rule prelude interpolation on the DIRECT ast/ host (`parseToAst` → `serialize`).
 *
 * v5 makes a top-level bare `@var` in a non-value at-rule prelude a HARD parse error
 * (covered in the less-parser suite); `@{…}` interpolation is the migration target
 * and must RESOLVE here. This also pins the `@supports @{cond}` build-host fix: the
 * block-brace search (`blockBraceIndex`) skips the `{` of the `@{…}` interpolation,
 * so the prelude is the full `@{cond}` (not the truncated bare `@` it produced
 * before) and `parsePreludeValue` resolves it through scope.
 */
function render(src: string): string {
  const res = renderAstDoc(src, { evaluator: buildEvaluator(makeBuiltinRegistry()) });
  expect(res.threw, res.threw?.message).toBeNull();
  expect(res.parseErrors, JSON.stringify(res.parseErrors)).toEqual([]);
  return res.css ?? '';
}

describe('at-rule prelude interpolation resolves (direct ast/ host)', () => {
  it('@keyframes @{name} resolves the interpolated identifier', () => {
    expect(render('@name: slidein;\n@keyframes @{name} { from { top: 0; } }\n'))
      .toContain('@keyframes slidein {');
  });

  it('@media @{q} resolves the interpolated query', () => {
    expect(render('@q: screen;\n@media @{q} { a { color: red; } }\n'))
      .toContain('@media screen {');
  });

  it('@supports @{cond} resolves the interpolation (not a bare @)', () => {
    const css = render('@cond: (color: red);\n@supports @{cond} { a { color: red; } }\n');
    expect(css).toContain('color: red');
    // The build-host bug rendered a bare `@` here; the fixed prelude carries the
    // full interpolation, so the resolved condition text is present and `@ {` isn't.
    expect(css).not.toContain('@supports @ {');
    expect(css).not.toContain('@supports @{cond}');
  });

  it('unknown at-rule @foo @{v} resolves the interpolation', () => {
    expect(render('@v: bar;\n@foo @{v} { a { color: red; } }\n'))
      .toContain('@foo bar {');
  });

  it('unknown at-rule keeps a paren-wrapped declaration value resolving (@foo (x: @w))', () => {
    expect(render('@w: 10px;\n@foo (x: @w) { a { color: red; } }\n'))
      .toContain('@foo (x: 10px) {');
  });

  // ── @media / @container query-prelude EVALUATION ────────────────────────────
  // A query prelude routes its `@{…}` interpolation, bare `@var` references, and
  // escaped strings through the value evaluator (the same eval as a declaration
  // value), instead of emitting verbatim. Mirrors the `media` / `container` alpha
  // fixtures; verified against Less 4.x.

  it('@media resolves a bare @var alongside a @{…} container-name interp', () => {
    // The interp made the whole prelude an `Interp`; a bare `@var` sitting in a
    // literal gap must still resolve (valid inside a query prelude, unlike a
    // statement prelude) — regression pin for `@container @{name} (min-width: @bp)`.
    expect(render('@varfoo: foo;\n@threshold: 400px;\n@container @{varfoo} (min-width: @threshold) { a { x: 1; } }\n'))
      .toContain('@container foo (min-width: 400px) {');
  });

  it('@media evaluates @{…} interpolation inside an escaped query string', () => {
    // `~'@{a} / @{b}'` → interp resolved AND the `~'…'` wrapper unquoted; the source
    // spacing (` / `) is preserved verbatim (an escaped string is opaque to ratio
    // spacing).
    expect(render('@ratio_large: 16;\n@ratio_small: 9;\n@media all and (device-aspect-ratio: ~\'@{ratio_large} / @{ratio_small}\') { a { x: 1; } }\n'))
      .toContain('@media all and (device-aspect-ratio: 16 / 9) {');
  });

  it('@media unquotes an escaped query string, keeping its bytes opaque (no ratio spacing)', () => {
    // `~"2/1"` → `2/1` tight — the unquoted escaped bytes are NOT `/`-spaced.
    expect(render('@media (-o-min-device-pixel-ratio: ~"2/1") { a { x: 1; } }\n'))
      .toContain('(-o-min-device-pixel-ratio: 2/1)');
  });
});
