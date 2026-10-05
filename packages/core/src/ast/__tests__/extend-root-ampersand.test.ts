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
  const renderLess = (src: string): string | undefined =>
    serialize(parseLess(src), { evaluator, collapseNesting: true }).css;

  it('is matched as the composed selector', () => {
    expect(renderLess('.b { .p { &.q { m: 1 } } } .x:extend(.b .p.q) {}'))
      .toBe('.b .p.q,\n.x {\n  m: 1;\n}\n');
    expect(renderLess('.b { .p { .q& { m: 1 } } } .z:extend(.q.b .p) {}'))
      .toBe('.q.b .p,\n.z {\n  m: 1;\n}\n');
    expect(renderLess('.b { .p { &-foo { m: 1 } } } .z:extend(.b .p-foo) {}'))
      .toBe('.b .p-foo,\n.z {\n  m: 1;\n}\n');
  });

  it('carries an all graft without a one-arm :is() around the parent', () => {
    expect(renderLess('.x { .arrow { &::before { m: 1 } } } .y:extend(.x all) {}'))
      .toBe(':is(.x, .y) .arrow::before {\n  m: 1;\n}\n');
  });
});
