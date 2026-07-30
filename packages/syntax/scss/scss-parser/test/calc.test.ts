import { describe, expect, it } from 'vitest';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { parse } from '@jesscss/scss-parser';

/**
 * `calc()` is CSS-base arithmetic, and valid CSS must parse in every dialect.
 * The same matrix is asserted in the less / scss / jess parser packages, so a
 * dialect that routes `calc(` through its generic function grammar instead of
 * the CSS math production fails here rather than drifting silently.
 *
 * The grammar is css-values-4 §10: `<calc-sum>` over `<calc-product>` over
 * `<calc-value>`, so `*` `/` `%` bind tighter than `+` `-`. The additive
 * operators REQUIRE surrounding whitespace (§10.1) because `+`/`-` are
 * sign-ambiguous against a following number; the multiplicative ones do not.
 *
 * Regression: jess accepted only `/` here, and accepted it as the modern
 * slash SEPARATOR (`rgb(15 23 42 / .22)`) rather than as division — so
 * `calc(100%/3)` silently produced a slash List where CSS produces an
 * Operation, and `+`, `-` and `*` were hard parse errors. That made real
 * Bootstrap output (`calc(1.375rem + 1.5vw)`) unparseable in jess alone.
 */
const ACCEPTED: Array<[string, string]> = [
  ['additive with rem/vw operands', 'calc(1rem + 1vw)'],
  ['subtractive with a percentage', 'calc(100% - 1px)'],
  ['multiplicative, unspaced', 'calc(1rem*2)'],
  ['division, unspaced', 'calc(100%/3)'],
  ['a comma-argument math function', 'min(1rem,2rem)']
];

/* Product binds tighter than sum, and explicit parens override that. */
const SHAPES: Array<[string, unknown]> = [
  ['calc(1rem + 1vw)', {
    type: 'Operation',
    operator: '+',
    left: { type: 'Dimension', number: 1, unit: 'rem' },
    right: { type: 'Dimension', number: 1, unit: 'vw' }
  }],
  ['calc(1px + 2px*3)', {
    type: 'Operation',
    operator: '+',
    left: { type: 'Dimension', number: 1, unit: 'px' },
    right: { type: 'Operation', operator: '*' }
  }],
  ['calc((1px + 2px)*3)', { type: 'Operation', operator: '*' }]
];

describe('SCSS calc()', () => {
  for (const [label, value] of ACCEPTED) {
    it(`accepts ${label}`, () => {
      expect(parse(`a { width: ${value}; }`)).toMatchObject({
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'width' }] }]
      });
    });
  }

  for (const [source, arg] of SHAPES) {
    it(`structures \`${source}\` as arithmetic`, () => {
      expect(parse(`a { width: ${source}; }`)).toMatchObject({
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', value: { type: 'FunctionCall', name: 'calc', args: [arg] } }] }]
      });
    });
  }

  /*
   * TODO(scss-calc-slash): SCSS structures `calc(100%/3)` as a bare
   * ValueSlot list, where css/less/jess all produce an Operation. SCSS has no
   * calc production of its own — `+`/`-`/`*` reach an Operation only via SCSS's
   * general value arithmetic, and `/` lands on the Sass slash ambiguity before
   * it gets there. Inside a `calc()` the solidus is division regardless of
   * Sass's top-level slash rule, so this is a divergence, not a dialect
   * semantic. Out of scope for the jess calc fix that added this file; SCSS
   * needs the same CSS-math production jess now has.
   */
  it('structures `calc(100%/3)` as a slash list, diverging from CSS', () => {
    expect(parse('a { width: calc(100%/3); }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', value: { type: 'FunctionCall', name: 'calc', args: [[{ type: 'Dimension', number: 100, unit: '%' }, { type: 'Dimension', number: 3 }]] } }] }]
    });
  });

  it('accepts a var() operand inside calc', () => {
    expect(() => parse('a { width: calc(100% - var(--bs-gutter-x)); }')).not.toThrow();
  });

  it('accepts the Bootstrap fluid-type shape', () => {
    expect(() => parse('.h1 { font-size: calc(1.375rem + 1.5vw); }')).not.toThrow();
  });

  /*
   * `calc(1rem+1vw)` is INVALID calc(): css-values-4 §10.1 requires whitespace
   * around the additive operators because `+`/`-` are sign-ambiguous, and the
   * CSS base rejects it. This dialect accepts it as its own value arithmetic,
   * which is only defensible because it NORMALIZES the result — the emitted
   * declaration is the spaced, valid form. Accepting the glued spelling and
   * then emitting it verbatim would be a bug, so the output is asserted here
   * rather than just the parse.
   *
   * Jess deliberately does not follow this dialect: its math operators are
   * spaces-only, so it matches the CSS base and rejects the glued form.
   */
  it('normalizes an unspaced additive operator to valid CSS', () => {
    expect(parse('a { width: calc(1rem+1vw); }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', value: { type: 'FunctionCall', name: 'calc', args: [{ type: 'Operation', operator: '+' }] } }] }]
    });
    expect(serialize(parse('a { width: calc(1rem+1vw); }')).css).toBe('a {\n  width: calc(1rem + 1vw);\n}\n');
  });
});
