import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import {
  compoundSelectorOf, complexSelector, decl, keyword, simpleSelector, stylesheet, rule, sel, selist, type Stylesheet
} from '../nodes.js';
import { serialize } from '../serialize.js';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';

/**
 * A ROOT parentless `&` — the `& when (…) { … }` / `& { … }` guard-block idiom Less
 * ports lean on (bootstrap-less-port's `_grid.less` and `_navbar.less` both wrap
 * their class output in one) — resolves to EMPTY. It is not a selector, so it
 * contributes neither a descendant prefix nor an `:is()` arm to the rules nested
 * inside it, and a rule nested directly in one composes as a ROOT rule.
 *
 * Both projections of that context have to agree:
 *   - the SERIALIZER's `rootStrings` → child-context path (`flattenResolved`), and
 *   - the EXTEND IR's `composePath`, which folds the same ancestor path into the
 *     flat branch an extender contributes to its target's header.
 *
 * They did not: extend composed the un-stripped `& .child`, so a `:extend()` inside
 * a root guard block leaked a literal `&` into flat CSS (`\%ph, & .container-sm`).
 * Every expectation below is Less 4.6.3's output for the equivalent Less source.
 */

const evaluator = buildEvaluator(makeLessRegistry());
const flat = (document: Stylesheet): string | undefined =>
  serialize(document, { evaluator, collapseNesting: true }).css;

/** `& { … }` — a root guard block, modelled as its post-guard rule. */
const ampBlock = (rules: Parameters<typeof rule>[1]) => rule('&', rules);

/** A structured descendant complex (`sel('a b')` would collapse to ONE compound,
 * which no `all`-extend can match through). */
const descendant = (...parts: string[]) =>
  complexSelector(parts.map((p, i) => (i === 0
    ? { term: compoundSelectorOf([simpleSelector(p)]) }
    : { combinator: ' ' as const, term: compoundSelectorOf([simpleSelector(p)]) })));

describe('root parentless ampersand', () => {
  it('does not leak `&` into an extender folded into its target header', () => {
    // `\%ph { max-width: 5px } & { .container-sm { &:extend(\%ph) } }`
    const document = stylesheet([
      rule('\\%ph', [decl('max-width', keyword('5px'))]),
      ampBlock([rule('.container-sm', [], [{ target: selist(sel('\\%ph')), partial: false }])])
    ]);

    expect(flat(document)).toBe('\\%ph,\n'
      + '.container-sm {\n'
      + '  max-width: 5px;\n'
      + '}\n');
  });

  it('does not leak `&` into an `all`-extender substituted inside a target branch', () => {
    /*
     * The bootstrap `_grid.less` shape: the extender lands inside the target's own
     * branch rather than beside it, which is where `& :is(…, & .cs)` came from.
     */
    const document = stylesheet([
      rule('.f', [decl('width', keyword('100%'))]),
      ampBlock([rule('.cs', [], [{ target: selist(sel('.f')), partial: true }])]),
      rule(descendant('.nav', '.f'), [decl('color', keyword('red'))])
    ]);

    expect(flat(document)).toBe('.f,\n'
      + '.cs {\n'
      + '  width: 100%;\n'
      + '}\n'
      + '.nav :is(.f, .cs) {\n'
      + '  color: red;\n'
      + '}\n');
  });

  it('composes a nested rule as a root rule, with no leading descendant space', () => {
    const document = stylesheet([ampBlock([rule('.a', [decl('color', keyword('red'))])])]);

    expect(flat(document)).toBe('.a {\n  color: red;\n}\n');
  });

  it('keeps the empty branch out of a multi-branch root selector list', () => {
    /*
     * `&, .p { .a { … } }` → Less drops the `&` branch entirely: `.p .a`, never
     * `:is(, .p) .a`.
     */
    const document = stylesheet([
      rule(selist(sel('&'), sel('.p')), [rule('.a', [decl('color', keyword('red'))])])
    ]);

    expect(flat(document)).toBe('.p .a {\n  color: red;\n}\n');
  });

  it('strips the ampersand from a rule nested directly in a root ampersand block', () => {
    /*
     * `& { & .x { … } }` and `& { &.x { … } }` — the inner `&` is itself parentless
     * once the transparent block is peeled, so it resolves to empty in turn.
     */
    expect(flat(stylesheet([ampBlock([rule('& .x', [decl('color', keyword('red'))])])])))
      .toBe('.x {\n  color: red;\n}\n');
    expect(flat(stylesheet([ampBlock([rule('&.x', [decl('color', keyword('red'))])])])))
      .toBe('.x {\n  color: red;\n}\n');
  });

  it('peels through two stacked root ampersand blocks', () => {
    const document = stylesheet([
      ampBlock([ampBlock([rule('.a', [rule('.b', [decl('color', keyword('red'))])])])])
    ]);

    expect(flat(document)).toBe('.a .b {\n  color: red;\n}\n');
  });

  it('still composes a real ancestor under a root ampersand block', () => {
    // The peel must stop at the first level that survives: `.a` IS a parent.
    const document = stylesheet([
      rule('.t', [decl('color', keyword('red'))]),
      ampBlock([rule('.a', [rule('.b', [], [{ target: selist(sel('.t')), partial: false }])])])
    ]);

    expect(flat(document)).toBe('.t,\n'
      + '.a .b {\n'
      + '  color: red;\n'
      + '}\n');
  });
});

/*
 * A `&` fused into a compound under a parent of several compounds is the parent spliced
 * in place, as the serializer composes it: the simples before the `&` join the parent's
 * first compound and those after it (a `&-suffix` included) its last. Extend matches that
 * composed selector, never a one-arm `:is(parent)` wrap.
 */
describe('fused ampersand under a multi-compound parent', () => {
  const renderLess = (src: string): string | undefined => flat(parseLess(src));

  it('is matched as the composed selector', () => {
    expect(renderLess('.b { .p { &.q { m: 1 } } } .x:extend(.b .p.q) {}'))
      .toBe('.b .p.q,\n.x {\n  m: 1;\n}\n');
    expect(renderLess('.b { .p { .q& { m: 1 } } } .z:extend(.q.b .p) {}'))
      .toBe('.q.b .p,\n.z {\n  m: 1;\n}\n');
    expect(renderLess('.b { .p { &-foo { m: 1 } } } .z:extend(.b .p-foo) {}'))
      .toBe('.b .p-foo,\n.z {\n  m: 1;\n}\n');
  });

  /*
   * An `all` match of a target of several compounds keeps the simples the span's first
   * compound has beyond the target before it and those its last compound has after it,
   * for the extender as for the matched selector (lessc 4.9.1 writes the same).
   */
  it('keeps the simples around a multi-compound all match on the extender', () => {
    expect(renderLess('.header { .header-nav { a: 1; &:before { b: 2; } } } .footer { .footer-nav { &:extend(.header .header-nav all); } }'))
      .toBe('.header .header-nav,\n.footer .footer-nav {\n  a: 1;\n}\n.header .header-nav:before,\n.footer .footer-nav:before {\n  b: 2;\n}\n');
    expect(renderLess('div.a .b { m: 1 } .x:extend(.a .b all) {}')).toBe('div.a .b,\ndiv.x {\n  m: 1;\n}\n');
    expect(renderLess('.q .a.k .b.m .z { m: 1 } .x .y:extend(.a .b all) {}'))
      .toBe('.q .a.k .b.m .z,\n.q .k.x .y.m .z {\n  m: 1;\n}\n');
  });

  it('carries an all graft without a one-arm :is() around the parent', () => {
    expect(renderLess('.x { .arrow { &::before { m: 1 } } } .y:extend(.x all) {}'))
      .toBe(':is(.x, .y) .arrow::before {\n  m: 1;\n}\n');
  });

  // An attribute selector is one token: a `&` in its value is text, not a parent reference.
  it('leaves a `&` inside an attribute value alone', () => {
    expect(renderLess('.b { .p { &[title="&"] { m: 1 } } }'))
      .toBe('.b .p[title="&"] {\n  m: 1;\n}\n');
    expect(renderLess('.b { .p { &[title="&"] { m: 1 } } } .x:extend(.p all) {}'))
      .toBe('.b :is(.p, .x)[title="&"] {\n  m: 1;\n}\n');
    expect(renderLess('.b { [title="&"] { m: 1 } }')).toBe('.b [title="&"] {\n  m: 1;\n}\n');
  });
});

/*
 * An `&` concatenation that continues a one-simple class name is that class to the
 * `:is()` grouping (ledger X3); one that does not continue a name stays out of groups.
 */
describe('a composed `&` concatenation in an extend group', () => {
  const renderLess = (src: string): string | undefined => flat(parseLess(src));

  it('groups a name continuation as the class it continues', () => {
    expect(renderLess('.base.k { m: 1 } .btn { &-primary:extend(.base all) {} }'))
      .toBe(':is(.base, .btn-primary).k {\n  m: 1;\n}\n');
  });

  it('keeps a join of several simples out of the group', () => {
    expect(renderLess('.base.k { m: 1 } .a.b { &-x:extend(.base all) {} }'))
      .toBe('.base.k,\n.a.b-x.k {\n  m: 1;\n}\n');
  });
});

describe('the nesting fold of an escaped class name', () => {
  // `flat` flattens with the default `'native'` fold.
  it('groups an escaped class like any class', () => {
    expect(flat(parseLess('.t { .\\31 0, .x { a: 1 } }'))).toBe('.t :is(.\\31 0, .x) {\n  a: 1;\n}\n');
  });
});
