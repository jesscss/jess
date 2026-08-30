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
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', value: { type: 'FunctionCall', name: 'calc', args: [{ value: arg }] } }] }]
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
        args: [{ value: { type: 'Operation', operator: '+', left: { type: 'Lookup', kind: 'var', name: 'w', raw: '@w' }, right: { type: 'Dimension', number: 1, unit: 'px' } } }]
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

  /*
   * The value ladder runs under `noTrivia`, so each interior that admits
   * authored padding has to spell it, and it has to spell the comment-bearing
   * `valueTrivia`: the interiors that spelled a bare `[ \t\n\r\f]` run rejected
   * comments, and the ones that spelled nothing rejected whitespace too. Both
   * columns are asserted together because a fix restoring only the comment
   * column would leave `calc( 1px + 2px)` — the same defect, one character
   * apart — still rejected.
   */
  it('admits authored whitespace and comments at every value-interior boundary', () => {
    const templates = [
      'f(Tc)', 'f(cT)', 'f(cT,d)', 'f(c,Td)',
      'min(1pxT,2px)', 'min(1px,T2px)',
      'var(T--x,e)', 'var(--xT,e)', 'var(--x,Te)', 'var(--x,eT)',
      'calc(T1px + 2px)', 'calc(1px + 2pxT)', 'calc(1pxT*T2)', 'calc(1px T+T 2px)',
      'calc(T(1px + 2px)T)', 'calc((T1px + 2pxT))'
    ];
    for (const template of templates) {
      for (const fill of [' ', '/* c */', '/* ) */']) {
        const source = `a { b: ${template.replaceAll('T', fill)} }`;
        expect(() => parse(source), source).not.toThrow();
      }
    }
  });

  /*
   * css-values-4 §10.1 requires real whitespace on both sides of `+` and `-`,
   * and a comment does not supply it. Widening the padding to admit comments
   * must not quietly drop that, so the one-sided spellings stay rejected.
   */
  it('still requires whitespace, not a comment, on both sides of a calc sum operator', () => {
    for (const source of [
      'a { b: calc(1px+2px) }',
      'a { b: calc(1px/* c */+ 2px) }',
      'a { b: calc(1px +/* c */2px) }'
    ]) {
      expect(() => parse(source), source).toThrow();
    }
  });
});
