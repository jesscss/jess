import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  compoundSelectorOf, complexSelector, decl, keyword, stylesheet, rule, sel, selist, simpleSelector, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());
const render = (document: Stylesheet, collapseNesting = true): string | undefined =>
  serialize(document, { evaluator, collapseNesting }).css;

/**
 * Element/ID conflict guard — ported from tree-v1 `partialWrapMayConflict`
 * (`packages/core/src/tree/extend/extend-index.ts:817`) and the acceptance cases in
 * `packages/core/src/tree/util/__tests__/extend-duplicate-validation.test.ts` /
 * `extend-selector-algorithm.test.ts:9-37`.
 *
 * A partial `:is()`-wrap that would place a SECOND element type or a SECOND id into
 * one compound context is INVALID CSS. Extend must REJECT it — the matched branch
 * is left exactly as authored.
 */
describe('extend element/id conflict guard', () => {
  it('rejects extending a.info with div.foo (element conflict → unchanged)', () => {
    // `a.info { }` + `div.foo:extend(.info all) { }` — wrapping `.info` inside `a…`
    // as `a:is(.info, div.foo)` would expand to `adiv.foo`, an invalid two-element
    // compound. Reject: `a.info` stays exactly as authored.
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('a'), simpleSelector('.info')]) }]);
    const extender = complexSelector([{ compound: compoundSelectorOf([simpleSelector('div'), simpleSelector('.foo')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule(selist(extender), [], [{ target: selist(sel('.info')), partial: true }])
    ]);

    expect(render(document)).toBe(
      'a.info {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('rejects extending div.class with span.other (element conflict → unchanged)', () => {
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('div'), simpleSelector('.class')]) }]);
    const extender = complexSelector([{ compound: compoundSelectorOf([simpleSelector('span'), simpleSelector('.other')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule(selist(extender), [], [{ target: selist(sel('.class')), partial: true }])
    ]);

    expect(render(document)).toBe(
      'div.class {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('rejects extending #main.info with #other.foo (id conflict → unchanged)', () => {
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('#main'), simpleSelector('.info')]) }]);
    const extender = complexSelector([{ compound: compoundSelectorOf([simpleSelector('#other'), simpleSelector('.foo')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule(selist(extender), [], [{ target: selist(sel('.info')), partial: true }])
    ]);

    expect(render(document)).toBe(
      '#main.info {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('allows extending div.a with .b (no element/id in extender → :is wrap)', () => {
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('div'), simpleSelector('.a')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule('.b', [], [{ target: selist(sel('.a')), partial: true }])
    ]);

    expect(render(document)).toBe(
      'div:is(.a, .b) {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('allows extending div.a with div.b (same element type → no conflict)', () => {
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('div'), simpleSelector('.a')]) }]);
    const extender = complexSelector([{ compound: compoundSelectorOf([simpleSelector('div'), simpleSelector('.b')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule(selist(extender), [], [{ target: selist(sel('.a')), partial: true }])
    ]);

    expect(render(document)).toBe(
      'div:is(.a, div.b) {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('rejects a TYPE extend re-entered transitively through an :is() graft (element conflict)', () => {
    // div.a { }
    // .b:extend(.a all)   → benign, forms `div:is(.a, .b)`
    // span:extend(.a all)  → span is a TYPE; `div…` already carries type `div`, so
    //                        wrapping span into the `div`-rooted graft would carry an
    //                        invalid `div ∧ span`. The span extend must be REJECTED,
    //                        exactly as the non-transitive top-level guard already does.
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('div'), simpleSelector('.a')]) }]);
    const spanExtender = complexSelector([{ compound: compoundSelectorOf([simpleSelector('span')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule('.b', [], [{ target: selist(sel('.a')), partial: true }]),
      rule(selist(spanExtender), [], [{ target: selist(sel('.a')), partial: true }])
    ]);

    expect(render(document)).toBe(
      'div:is(.a, .b) {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('rejects an ID extend re-entered transitively through an :is() graft (id conflict)', () => {
    // #x.a { }
    // .b:extend(.a all)     → benign, forms `#x:is(.a, .b)`
    // #y:extend(.a all)      → #y is an ID; `#x…` already carries id `#x`, so wrapping
    //                          #y into the `#x`-rooted graft would carry two ids. Reject.
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('#x'), simpleSelector('.a')]) }]);
    const idExtender = complexSelector([{ compound: compoundSelectorOf([simpleSelector('#y')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule('.b', [], [{ target: selist(sel('.a')), partial: true }]),
      rule(selist(idExtender), [], [{ target: selist(sel('.a')), partial: true }])
    ]);

    expect(render(document)).toBe(
      '#x:is(.a, .b) {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('rejects a lone TYPE extender re-entering a graft grown by a DIFFERENT target', () => {
    // div.y { }
    // .a:extend(.y all)    → group A (target .y) grows `div:is(.y, .a)`; `.a` now lives
    //                        ONLY inside the graft.
    // span:extend(.a all)  → group B (target .a) is a lone extender (NOT folded with a
    //                        benign one), so per-extender filtering alone cannot catch it —
    //                        only threading the enclosing `div` into the graft recursion
    //                        exposes the `div ∧ span` conflict. Reject: `div:is(.y, .a)`.
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('div'), simpleSelector('.y')]) }]);
    const spanExtender = complexSelector([{ compound: compoundSelectorOf([simpleSelector('span')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule('.a', [], [{ target: selist(sel('.y')), partial: true }]),
      rule(selist(spanExtender), [], [{ target: selist(sel('.a')), partial: true }])
    ]);

    expect(render(document)).toBe(
      'div:is(.y, .a) {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('still allows a benign class extender re-entering a graft grown by a different target', () => {
    // Same shape as above but the re-entering extender is a CLASS (`.z`) — no conflict,
    // so the transitive extend MUST still fire. `.a` is a whole branch inside the graft,
    // so `.z` appends as a sibling arm: `div:is(.y, .a, .z)`. (Guard proven to reject the
    // conflicting `span` in the prior test while leaving this benign path untouched.)
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('div'), simpleSelector('.y')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule('.a', [], [{ target: selist(sel('.y')), partial: true }]),
      rule('.z', [], [{ target: selist(sel('.a')), partial: true }])
    ]);

    expect(render(document)).toBe(
      'div:is(.y, .a, .z) {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('allows extending #foo#foo.class with .bar (single distinct id → no conflict)', () => {
    const base = complexSelector([{ compound: compoundSelectorOf([simpleSelector('#foo'), simpleSelector('#foo'), simpleSelector('.class')]) }]);
    const document = stylesheet([
      rule(base, [decl('color', keyword('red'))]),
      rule('.bar', [], [{ target: selist(sel('.class')), partial: true }])
    ]);

    expect(render(document)).toBe(
      '#foo#foo:is(.class, .bar) {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });
});
