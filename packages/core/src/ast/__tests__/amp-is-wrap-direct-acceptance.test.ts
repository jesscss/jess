import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import {
  compoundSelector, compoundSelectorOf, complexSelector, decl, keyword, pseudoSelector,
  rule, sel, selist, simpleSelector, stylesheet, type ComplexSelector, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { makeLessRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeLessRegistry());
const flat = (document: Stylesheet): string | undefined =>
  serialize(document, { evaluator, collapseNesting: true }).css;

/** `parents { child { color: red } }`, rendered flat (composed-header path). */
const nest = (parents: string[], child: ComplexSelector): string | undefined =>
  flat(stylesheet([
    rule(selist(...parents.map(sel)), [rule(child, [decl('color', keyword('red'))])])
  ]));

/*
 * A multi-branch top-level rule renders one branch per line (`.a,\n.b`); normalize
 * the comma-newline back to `, ` so an inline `.a, .b` target reads cleanly.
 */
const header = (css: string | undefined): string =>
  (css ?? '').split('{')[0]!.trim().replace(/,\s+/g, ', ');

// `.c:not(&)` — `.c` followed by a STRUCTURED `:not()` whose sole arg is a bare `&`.
const cNotAmp = (): ComplexSelector => complexSelector([{
  term: compoundSelectorOf([simpleSelector('.c'), pseudoSelector(':not', selist(sel('&')))])
}]);

describe('selector-reference `&` over a multi-item parent list wraps as `:is()`', () => {
  it('bare `&` inside `:not()` args resolves to the BARE parent list (no De-Morgan over-match)', () => {
    expect(header(nest(['.a', '.b'], cNotAmp()))).toBe('.c:not(.a, .b)');
  });

  it('combinator `& + &` wraps each hole in `:is(parents)`', () => {
    const child = complexSelector([
      { term: compoundSelector('&') },
      { combinator: '+', term: compoundSelector('&') }
    ]);
    expect(header(nest(['.a', '#b'], child))).toBe(':is(.a, #b) + :is(.a, #b)');
  });

  it('compound-sibling `&.mod` wraps `&` in `:is(parents)`', () => {
    const child = complexSelector([{ term: compoundSelectorOf([simpleSelector('&'), simpleSelector('.mod')]) }]);
    expect(header(nest(['.a', '#b'], child))).toBe(':is(.a, #b).mod');
  });

  it('compound-sibling `&:hover` wraps `&` in `:is(parents)`', () => {
    const child = complexSelector([{ term: compoundSelectorOf([simpleSelector('&'), simpleSelector(':hover')]) }]);
    expect(header(nest(['.a', '#b'], child))).toBe(':is(.a, #b):hover');
  });

  it('fused append `&-foo` DISTRIBUTES per parent name (never `:is()`-wrapped)', () => {
    expect(header(nest(['.a', '.b'], sel('&-foo')))).toBe('.a-foo, .b-foo');
  });

  it('fused append `&__el` (BEM element) DISTRIBUTES per parent name', () => {
    expect(header(nest(['.a', '.b'], sel('&__el')))).toBe('.a__el, .b__el');
  });

  it('fused append `&--mod` (BEM modifier) DISTRIBUTES per parent name', () => {
    expect(header(nest(['.a', '.b'], sel('&--mod')))).toBe('.a--mod, .b--mod');
  });

  it('whole-selector bare `&` branch-multiplies to the parent list itself', () => {
    expect(header(nest(['.a', '.b'], sel('&')))).toBe('.a, .b');
  });

  it('`&`-less descendant child keeps the single `:is(parents) child` prefix', () => {
    expect(header(nest(['.a', '.b'], sel('.c')))).toBe(':is(.a, .b) .c');
  });

  // ---- Regression guards: single-parent is already spec-faithful, unchanged. ----

  it('single parent: `.c:not(&)` substitutes bare', () => {
    expect(header(nest(['.a'], cNotAmp()))).toBe('.c:not(.a)');
  });

  it('single parent: `&__el` BEM concat', () => {
    expect(header(nest(['.block'], sel('&__el')))).toBe('.block__el');
  });

  it('single parent: `&.mod` substitutes bare', () => {
    const child = complexSelector([{ term: compoundSelectorOf([simpleSelector('&'), simpleSelector('.mod')]) }]);
    expect(header(nest(['.a'], child))).toBe('.a.mod');
  });

  it('single parent: `& + &`', () => {
    const child = complexSelector([
      { term: compoundSelector('&') },
      { combinator: '+', term: compoundSelector('&') }
    ]);
    expect(header(nest(['.a'], child))).toBe('.a + .a');
  });
});
