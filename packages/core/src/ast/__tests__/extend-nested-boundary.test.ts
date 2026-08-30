import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  compoundSelectorOf, complexSelector, decl, keyword, stylesheet, rule, sel, selist, simpleSelector, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';

/**
 * NESTED-mode (`collapseNesting: false`, Jess's DEFAULT output) acceptance tests for
 * the PER-BOUNDARY ampersand-crossing hoist (RUNG P-amp continuation).
 *
 * The flat-mode extend corpus never exercises the nested hoist PLACEMENT: in flat mode
 * every rule is fully composed, so a crossing extend and its always-root flatten are
 * byte-identical. In NESTED mode the crossing rule must hoist out of exactly the blocks
 * whose `&` its match reaches (`maxBnd` of the crossed span) and re-nest under the
 * strictly-outer ancestors it does NOT reach — not blindly one level, not always root.
 *
 * The correctness bar these pin (verified against the flat solve as the semantic oracle):
 *   - crossing at 1 level: hoists to root (the crossed ancestor is absorbed into `:is`);
 *   - crossing 2 levels deep (Case G): hoists ONE level, preserving the outer wrapper —
 *     it must NOT double-compose that wrapper (`.outer { .outer :is(…) }` was the bug);
 *   - crossing 2 BOUNDARIES (bubble = 2): re-hoists two levels via the serializer queue;
 *   - within-ampersand: the parent carries the extend, the child inherits in place;
 *   - local: substituted in place, no hoist;
 *   - multiple / interior `&`: crosses correctly across a spliced multi-segment parent.
 */

const evaluator = buildEvaluator(makeLessRegistry());
const nested = (document: Stylesheet): string | undefined =>
  serialize(document, { evaluator, collapseNesting: false }).css;
const flat = (document: Stylesheet): string | undefined =>
  serialize(document, { evaluator, collapseNesting: true }).css;

/** A structured descendant complex `a b c …` (one single-compound segment each), the
 * shape the real parser builds (unlike `sel('a b')`, which collapses to one compound). */
const descendant = (...parts: string[]) =>
  complexSelector(parts.map((p, i) => (i === 0
    ? { term: compoundSelectorOf([simpleSelector(p)]) }
    : { combinator: ' ' as const, term: compoundSelectorOf([simpleSelector(p)]) })));

/** `& .x` (a bare-ampersand segment then a descendant). */
const ampThen = (...parts: string[]) =>
  complexSelector([
    { term: compoundSelectorOf([simpleSelector('&')]) },
    ...parts.map(p => ({ combinator: ' ' as const, term: compoundSelectorOf([simpleSelector(p)]) }))
  ]);

describe('nested-mode ampersand-crossing hoist (per-boundary)', () => {
  it('CROSSING 1 level deep hoists to root, absorbing the crossed ancestor (interior &)', () => {
    /*
     * `.p { .a & .leaf { … } }` composes the child to `.a .p .leaf` (origins 0,1,0).
     * `.z:extend(.p .leaf all)` crosses `.p`(anc)+`.leaf`(own): maxBnd 1 == the child's
     * whole ancestor depth, so NOTHING stays a wrapper — the rule hoists to ROOT with
     * the full composed header, byte-identical to flat.
     */
    const inner = complexSelector([
      { term: compoundSelectorOf([simpleSelector('.a')]) },
      { combinator: ' ', term: compoundSelectorOf([simpleSelector('&')]) },
      { combinator: ' ', term: compoundSelectorOf([simpleSelector('.leaf')]) }
    ]);
    const document = () => stylesheet([
      rule('.p', [rule(inner, [decl('c', keyword('d'))])]),
      rule('.z', [], [{ target: selist(descendant('.p', '.leaf')), partial: true }])
    ]);

    expect(nested(document())).toBe('.a :is(.p .leaf, .z) {\n'
      + '  c: d;\n'
      + '}\n');

    // Semantic oracle: flat mode produces the same single top-level rule.
    expect(flat(document())).toBe(nested(document()));
  });

  it('CROSSING 2 levels deep hoists ONE level, preserving the outer wrapper (Case G — no double-compose)', () => {
    /*
     * `.outer { .mid { & .leaf { … } } }` composes to `.outer .mid .leaf` (origins 2,1,0).
     * `.z:extend(.mid .leaf all)` crosses `.mid`(anc)+`.leaf`(own): maxBnd 1, so the rule
     * hoists out of ONLY `.mid` and re-nests under `.outer` — `.outer :is(.mid .leaf, .z)`.
     * The naive one-level-up hoist double-composed `.outer` (`.outer { .outer :is(…) }`);
     * the per-boundary header STRIPS the preserved `.outer` prefix.
     */
    const document = () => stylesheet([
      rule('.outer', [rule('.mid', [rule(ampThen('.leaf'), [decl('c', keyword('d'))])])]),
      rule('.z', [], [{ target: selist(descendant('.mid', '.leaf')), partial: true }])
    ]);

    expect(nested(document())).toBe('.outer {\n'
      + '  :is(.mid .leaf, .z) {\n'
      + '    c: d;\n'
      + '  }\n'
      + '}\n');
    expect(nested(document())).not.toContain('.outer :is'); // the double-compose regression guard
  });

  it('CROSSING two BOUNDARIES re-hoists two levels, preserving only the un-crossed outermost', () => {
    /*
     * `.top { .outer { .mid { & .leaf { … } } } }` composes to `.top .outer .mid .leaf`
     * (origins 3,2,1,0). `.z:extend(.outer .mid .leaf all)` crosses `.outer`+`.mid`(anc)
     * +`.leaf`(own): maxBnd 2, so the rule re-hoists out of BOTH `.mid` and `.outer`
     * (bubble 2 through the serializer queue) and re-nests under the un-crossed `.top`.
     */
    const document = () => stylesheet([
      rule('.top', [rule('.outer', [rule('.mid', [rule(ampThen('.leaf'), [decl('c', keyword('d'))])])])]),
      rule('.z', [], [{ target: selist(descendant('.outer', '.mid', '.leaf')), partial: true }])
    ]);

    expect(nested(document())).toBe('.top {\n'
      + '  :is(.outer .mid .leaf, .z) {\n'
      + '    c: d;\n'
      + '  }\n'
      + '}\n');

    // Same selectors as flat, just with `.top` kept as a nesting wrapper.
    expect(flat(document())).toBe('.top :is(.outer .mid .leaf, .z) {\n'
      + '  c: d;\n'
      + '}\n');
  });

  it('CROSSING across MULTIPLE interior ampersands (Case F) hoists to root', () => {
    /*
     * `.p { .a & .b & { … } }` composes to `.a .p .b .p` (origins 0,1,0,1). The target
     * `.p .b .p all` crosses `.p`(anc) `.b`(own) `.p`(anc): maxBnd 1 == the child's whole
     * ancestor depth, so it hoists to ROOT (`.p` is absorbed into the graft).
     */
    const inner = complexSelector([
      { term: compoundSelectorOf([simpleSelector('.a')]) },
      { combinator: ' ', term: compoundSelectorOf([simpleSelector('&')]) },
      { combinator: ' ', term: compoundSelectorOf([simpleSelector('.b')]) },
      { combinator: ' ', term: compoundSelectorOf([simpleSelector('&')]) }
    ]);
    const document = () => stylesheet([
      rule('.p', [rule(inner, [decl('c', keyword('d'))])]),
      rule('.z', [], [{ target: selist(descendant('.p', '.b', '.p')), partial: true }])
    ]);

    expect(nested(document())).toBe('.a :is(.p .b .p, .z) {\n'
      + '  c: d;\n'
      + '}\n');
    expect(flat(document())).toBe(nested(document()));
  });

  it('CROSSING hoists out while a surviving sibling stays nested under the wrapper', () => {
    /*
     * `.outer { .mid { & .leaf {c} ; & .other {e} } }`. `.z:extend(.mid .leaf all)` crosses
     * and hoists `.leaf` up to `.outer`; `.other` (unmatched) stays nested under `.mid`,
     * so the `.mid` wrapper is preserved for it while the crossing sibling lands beside it.
     */
    const document = () => stylesheet([
      rule('.outer', [rule('.mid', [
        rule(ampThen('.leaf'), [decl('c', keyword('d'))]),
        rule(ampThen('.other'), [decl('e', keyword('f'))])
      ])]),
      rule('.z', [], [{ target: selist(descendant('.mid', '.leaf')), partial: true }])
    ]);

    expect(nested(document())).toBe('.outer {\n'
      + '  .mid {\n'
      + '    & .other {\n'
      + '      e: f;\n'
      + '    }\n'
      + '  }\n'
      + '  :is(.mid .leaf, .z) {\n'
      + '    c: d;\n'
      + '  }\n'
      + '}\n');
  });

  it('WITHIN-ampersand: the parent carries the extend, the child inherits in place (no hoist)', () => {
    /*
     * `.box { color; .item & { … } }` composes the child to `.item .box` (origins 0,1).
     * `.z:extend(.box all)` matches `.box`(ancestor) ONLY — a within-ampersand match. The
     * parent rule carries it (`.box, .z`) and the child's `.box` slot renders `:is(.box, .z)`
     * in place — no hoist, no flatten.
     */
    const child = complexSelector([
      { term: compoundSelectorOf([simpleSelector('.item')]) },
      { combinator: ' ', term: compoundSelectorOf([simpleSelector('&')]) }
    ]);
    const document = () => stylesheet([
      rule('.box', [decl('color', keyword('red')), rule(child, [decl('c', keyword('d'))])]),
      rule('.z', [], [{ target: selist(sel('.box')), partial: true }])
    ]);

    expect(nested(document())).toBe('.box,\n'
      + '.z {\n'
      + '  color: red;\n'
      + '}\n'
      + '.item :is(.box, .z) {\n'
      + '  c: d;\n'
      + '}\n');
  });

  it('LOCAL: an own-local match is substituted in place, no hoist', () => {
    /*
     * `.box { & .leaf { … } }` composes to `.box .leaf` (origins 1,0). `.z:extend(.leaf all)`
     * matches `.leaf`(own-local) ONLY — a local match, rewritten in place under the nested `&`.
     */
    const document = () => stylesheet([
      rule('.box', [rule(ampThen('.leaf'), [decl('c', keyword('d'))])]),
      rule('.z', [], [{ target: selist(sel('.leaf')), partial: true }])
    ]);

    expect(nested(document())).toBe('.box {\n'
      + '  & :is(.leaf, .z) {\n'
      + '    c: d;\n'
      + '  }\n'
      + '}\n');
  });

  it('EXACT cross-& extender past a foreign split alias hoists in nested mode (not dropped)', () => {
    /*
     * `.button { color; &:hover { color } } .submit { &:extend(.button); &:hover:extend(.button:hover) {} }`
     * The sibling EXACT `.submit:extend(.button)` folds `.submit` into `.button`'s FLAT
     * solve, but that alias is a top-level SPLIT — it does NOT nest `.button`'s children.
     * The exact cross-`&` extender `.submit:hover` targets the nested `.button:hover` leaf;
     * treating `.submit` as a header it descends from would silently DROP the extension
     * (dev bug: `.submit { color: black }` with no `:hover`). The split alias must be
     * excluded from the parent header so the extender routes to cross() and hoists to
     * `:is(.button, .submit):hover` — byte-identical to the flat solve (the oracle).
     */
    const buttonHover = complexSelector([{
      term: compoundSelectorOf([simpleSelector('.button'), simpleSelector(':hover')])
    }]);
    const ampHover = complexSelector([{
      term: compoundSelectorOf([simpleSelector('&'), simpleSelector(':hover')])
    }]);
    const document = () => stylesheet([
      rule('.button', [
        decl('color', keyword('black')),
        rule(ampHover, [decl('color', keyword('inherit'))])
      ]),
      rule(
        '.submit',
        [rule(ampHover, [], [{ target: selist(buttonHover), partial: false }])],
        [{ target: selist(sel('.button')), partial: false }]
      )
    ]);

    const expected =
      '.button,\n'
      + '.submit {\n'
      + '  color: black;\n'
      + '}\n'
      + ':is(.button, .submit):hover {\n'
      + '  color: inherit;\n'
      + '}\n';
    expect(nested(document())).toBe(expected);

    // The nested projection must equal the flat solve (the semantic oracle).
    expect(nested(document())).toBe(flat(document()));
  });
});
