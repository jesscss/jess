import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { Context } from '../../context.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';

/*
 * Three serialization gaps surfaced by the bootstrap4 / mixins Less corpus:
 *   1. a root-context (parentless) `&` must resolve to EMPTY, in NESTED output too
 *      — Less drops a parentless ampersand (`& .underParents` at root → `.underParents`).
 *   2. under `collapseNesting:true`, a rule FLATTENED out of a detached-ruleset /
 *      mixin / `@content()` expansion inside a bubbled `@media` must indent to the
 *      at-rule body level, not column 0.
 *   3. a `+`/`-` GLUED to a right-hand custom-ident (`5px auto -webkit-focus-ring-color`)
 *      is a sign on that ident, not subtraction, and serializes verbatim (no stray space).
 */

const evaluator = buildEvaluator(makeLessRegistry());

function render(src: string, collapseNesting: boolean): string {
  const context = new Context();
  context.registerValueEvaluator(evaluator);
  return serialize(parseLess(src), { context, collapseNesting }).css ?? '';
}

describe('bootstrap4/mixins serialize gaps', () => {
  const mixinSrc = '.has_parents() {\n'
    + '  & .underParents {\n'
    + '    color: red;\n'
    + '  }\n'
    + '}\n'
    + '.has_parents();\n'
    + '.parent {\n'
    + '  .has_parents();\n'
    + '}\n';

  it('bug1: a root-injected `&` collapses to empty in nested output; a nested call still composes', () => {
    // NESTED (collapseNesting:false, the v5 default) is where the literal `&` used to leak.
    expect(render(mixinSrc, false)).toBe('.underParents {\n'
      + '  color: red;\n'
      + '}\n'
      + '.parent {\n'
      + '  & .underParents {\n'
      + '    color: red;\n'
      + '  }\n'
      + '}\n');
  });

  it('bug1: the same source flattens to the Less golden under collapseNesting', () => {
    expect(render(mixinSrc, true)).toBe('.underParents {\n'
      + '  color: red;\n'
      + '}\n'
      + '.parent .underParents {\n'
      + '  color: red;\n'
      + '}\n');
  });

  it('bug1: a LONE root `&` is preserved verbatim in nested output (namespacing-7)', () => {
    /*
     * A bare `&` cannot become an empty selector: the v5 transparent-group form
     * `& when (…) { … }` / `& { … }` keeps its literal `&` in nested output.
     */
    const src = '& when (1 = 1) {\n  .output {\n    a: b;\n  }\n}\n';
    expect(render(src, false)).toBe('& {\n'
      + '  .output {\n'
      + '    a: b;\n'
      + '  }\n'
      + '}\n');

    // Under collapseNesting the transparent group flattens (children as root rules).
    expect(render(src, true)).toBe('.output {\n  a: b;\n}\n');
  });

  it('bug2: a flattened descendant from `@content()` inside `@media` indents to the body level', () => {
    const src = '.mbp(@content) {\n'
      + '  @media (min-width: 576px) {\n'
      + '    @content();\n'
      + '  }\n'
      + '}\n'
      + '.card-deck {\n'
      + '  display: flex;\n'
      + '  .mbp({\n'
      + '    flex-flow: row wrap;\n'
      + '    .card {\n'
      + '      flex: 1;\n'
      + '    }\n'
      + '  });\n'
      + '}\n';
    expect(render(src, true)).toBe('.card-deck {\n'
      + '  display: flex;\n'
      + '}\n'
      + '@media (min-width: 576px) {\n'
      + '  .card-deck {\n'
      + '    flex-flow: row wrap;\n'
      + '  }\n'
      + '  .card-deck .card {\n'
      + '    flex: 1;\n'
      + '  }\n'
      + '}\n');
  });

  it('bug2: a flattened descendant from a plain mixin call inside `@media` indents to the body level', () => {
    const src = '.gen() {\n'
      + '  .item {\n'
      + '    color: red;\n'
      + '  }\n'
      + '}\n'
      + '.wrap {\n'
      + '  @media screen {\n'
      + '    display: flex;\n'
      + '    .gen();\n'
      + '  }\n'
      + '}\n';
    expect(render(src, true)).toBe('@media screen {\n'
      + '  .wrap {\n'
      + '    display: flex;\n'
      + '  }\n'
      + '  .wrap .item {\n'
      + '    color: red;\n'
      + '  }\n'
      + '}\n');
  });

  it('bug2: a flattened descendant from an `each()` loop inside `@media` indents to the body level', () => {
    const src = '@items: a, b;\n'
      + '.wrap {\n'
      + '  @media screen {\n'
      + '    display: flex;\n'
      + '    each(@items, {\n'
      + '      .item-@{value} { color: red; }\n'
      + '    });\n'
      + '  }\n'
      + '}\n';
    expect(render(src, true)).toBe('@media screen {\n'
      + '  .wrap {\n'
      + '    display: flex;\n'
      + '  }\n'
      + '  .wrap .item-a {\n'
      + '    color: red;\n'
      + '  }\n'
      + '  .wrap .item-b {\n'
      + '    color: red;\n'
      + '  }\n'
      + '}\n');
  });

  it('bug3: a leading-hyphen custom-ident in a space list serializes verbatim (no stray space)', () => {
    expect(render('.a {\n  outline: 5px auto -webkit-focus-ring-color;\n}\n', false))
      .toBe('.a {\n  outline: 5px auto -webkit-focus-ring-color;\n}\n');
    expect(render('.a {\n  appearance: none -moz-appearance;\n}\n', false))
      .toBe('.a {\n  appearance: none -moz-appearance;\n}\n');

    // A genuinely spaced operator is preserved as authored (not glued).
    expect(render('.a {\n  outline: auto - webkit-x;\n}\n', false))
      .toBe('.a {\n  outline: auto - webkit-x;\n}\n');
  });
});
