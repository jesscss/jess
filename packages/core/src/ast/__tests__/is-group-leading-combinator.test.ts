import { describe, expect, it } from 'vitest';
import { buildEvaluator } from '../evaluator.js';
import {
  compoundSelector, complexSelector, decl, keyword, rule, sel, selist, stylesheet,
  type ComplexSelector, type Stylesheet
} from '../nodes.js';
import { type Combinator } from '../node.js';
import { serialize } from '../serialize.js';
import { makeLessRegistry } from '@jesscss/fns';

const evaluator = buildEvaluator(makeLessRegistry());
const flat = (document: Stylesheet): string | undefined =>
  serialize(document, { evaluator, collapseNesting: true }).css;

/** `parents { children… { color: red } }`, rendered flat. */
const nest = (parents: string[], children: ComplexSelector[]): string =>
  (flat(stylesheet([
    rule(selist(...parents.map(sel)), [rule(selist(...children), [decl('color', keyword('red'))])])
  ])) ?? '').split('{')[0]!.trim().replace(/,\s+/g, ', ');

/** A single-compound branch opening with `comb` — `> .col`. */
const relative = (comb: Combinator, text: string): ComplexSelector =>
  complexSelector([{ compound: compoundSelector(text) }], comb);

describe('a leading combinator is hoisted OUT of the `:is()` group', () => {
  it('an all-relative child list expands, one header branch per child', () => {
    expect(nest(['.no-gutters'], [relative('>', '.col'), relative('>', '[class*="col-"]')]))
      .toBe('.no-gutters > .col, .no-gutters > [class*="col-"]');
  });

  it('a MIXED list splits by shape — relative branches leave, descendants stay grouped', () => {
    expect(nest(['.nav-fill'], [relative('>', '.nav-link'), sel('.nav-item')]))
      .toBe('.nav-fill > .nav-link, .nav-fill .nav-item');
  });

  it('consecutive descendant branches stay ONE group, in authored order', () => {
    expect(nest(['.a'], [relative('+', '.b'), relative('~', '.c'), sel('.d'), sel('.e')]))
      .toBe('.a + .b, .a ~ .c, .a :is(.d, .e)');
  });

  it('a multi-parent ancestor stays factored into a single `:is()` prefix', () => {
    expect(nest(['.a', '.b'], [relative('~', '.valid-feedback'), relative('~', '.valid-tooltip')]))
      .toBe(':is(.a, .b) ~ .valid-feedback, :is(.a, .b) ~ .valid-tooltip');
  });

  it('a descendant-only child list keeps the `:is()` compaction unchanged', () => {
    expect(nest(['.card'], [sel('.x'), sel('.y'), sel('.z')])).toBe('.card :is(.x, .y, .z)');
  });

  it('a namespace pipe head is part of the compound, not a combinator, so it stays grouped', () => {
    expect(nest(['.a'], [relative('|', 'h1'), sel('.y')])).toBe('.a :is(|h1, .y)');
  });
});
