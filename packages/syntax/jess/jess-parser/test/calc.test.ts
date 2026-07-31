import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

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
  ['calc(100%/3)', {
    type: 'Operation',
    operator: '/',
    left: { type: 'Dimension', number: 100, unit: '%' },
    right: { type: 'Dimension', number: 3 }
  }],
  ['calc(1px + 2px*3)', {
    type: 'Operation',
    operator: '+',
    left: { type: 'Dimension', number: 1, unit: 'px' },
    right: { type: 'Operation', operator: '*' }
  }],
  ['calc((1px + 2px)*3)', { type: 'Operation', operator: '*' }]
];

describe('Jess calc()', () => {
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

  it('accepts a var() operand inside calc', () => {
    expect(() => parse('a { width: calc(100% - var(--bs-gutter-x)); }')).not.toThrow();
  });

  /*
   * A Jess variable is an OPERAND in the ported CSS production: it resolves and
   * substitutes, it does not make the arithmetic reduce at parse time. The
   * recorded structure is the same Operation CSS produces for a literal.
   */
  it('accepts a Jess variable as a calc operand', () => {
    expect(parse('a { width: calc($w + 1px); }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', value: {
        type: 'FunctionCall',
        name: 'calc',
        args: [{ type: 'Operation', operator: '+', left: { type: 'VariableReference', name: 'w' }, right: { type: 'Dimension', number: 1, unit: 'px' } }]
      } }] }]
    });
  });

  it('accepts a Jess variable across every calc operator position', () => {
    expect(() => parse('a { width: calc($w*2); }')).not.toThrow();
    expect(() => parse('a { width: calc(100% - $gutter); }')).not.toThrow();
    expect(() => parse('a { width: calc(($w + 1px)*2); }')).not.toThrow();
  });

  it('accepts a nested math function as a calc operand', () => {
    expect(() => parse('a { width: calc(min(1rem,2rem) + 1px); }')).not.toThrow();
  });

  it('accepts the Bootstrap fluid-type shape', () => {
    expect(() => parse('.h1 { font-size: calc(1.375rem + 1.5vw); }')).not.toThrow();
  });

  /*
   * css-values-4 §10.1: the additive operators are whitespace-delimited, so a
   * glued `+`/`-` is a sign on the next operand and leaves the sum dangling.
   */
  it('rejects an unspaced additive operator', () => {
    expect(() => parse('a { width: calc(1rem+1vw); }')).toThrow();
  });
});
