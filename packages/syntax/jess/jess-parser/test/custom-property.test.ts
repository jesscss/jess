import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

/**
 * A custom property is permissive at the CSS base, and valid CSS must parse in
 * every dialect. The same matrix is asserted in the less / scss / jess parser
 * packages, so a dialect that re-invents custom-property recognition instead of
 * composing the shared CSS leaves fails there rather than drifting silently.
 *
 * The value grammar is `<declaration-value>` (css-syntax-3 §7.2): any token
 * sequence without a bad string/url, an unmatched close delimiter, or a
 * top-level `;`. The name is a `<dashed-ident>` (css-syntax-3 §4.3.9) except
 * bare `--`, which css-variables-1 §2 reserves.
 */
const ACCEPTED: Array<[string, string, string, boolean?]> = [
  ['static keyword value', 'a { --x: red; }', 'red'],
  ['numeric value', 'a { --x: 0; }', '0'],
  ['multi-term value', 'a { --x: 1px solid black; }', '1px solid black'],
  ['empty value', 'a { --x:; }', ''],
  ['whitespace-only value', 'a { --x:   ; }', ''],
  ['nested parens', 'a { --x: foo(bar(1, 2)); }', 'foo(bar(1, 2))'],
  ['a brace block', 'a { --x: { color: red }; }', '{ color: red }'],
  ['a semicolon inside a string', 'a { --x: "a;b"; }', '"a;b"'],
  ['a semicolon inside a bracket group', 'a { --x: [a;b]; }', '[a;b]'],
  ['a protocol-relative url', 'a { --x: url(//e.com/a;b.png); }', 'url(//e.com/a;b.png)'],
  ['an escape and a non-ASCII byte', 'a { --x: \\2014 é; }', '\\2014 é'],
  ['a lone solidus', 'a { --x: a/b; }', 'a/b'],

  /*
   * css-syntax-3 §5.5.6 strips a trailing `!important` and sets the priority flag
   * before the custom-property original-text step, so the preserved value excludes
   * the marker and the whitespace in front of it. Asserted in all four dialects.
   */
  ['a trailing priority marker', 'a { --x: red !important; }', 'red', true],
  ['a bare priority marker', 'a { --x: !important; }', '', true],
  ['a non-final priority marker', 'a { --x: red !important b; }', 'red !important b']
];

const NAMES = ['--x', '--X', '--x-y', '--0', '---x', '--_x', '--é'];

describe('Jess custom properties', () => {
  for (const [label, source, expected, important = false] of ACCEPTED) {
    it(`accepts ${label}`, () => {
      expect(parse(source)).toMatchObject({
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: '--x', value: { type: 'Any', src: expected }, important }] }]
      });
    });
  }

  for (const name of NAMES) {
    it(`accepts the custom-property name \`${name}\``, () => {
      expect(parse(`a { ${name}: red; }`)).toMatchObject({
        rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name, value: { type: 'Any', src: 'red' } }] }]
      });
    });
  }

  it('rejects the reserved bare `--` name', () => {
    expect(() => parse('a { --: red; }')).toThrow();
  });

  it('accepts a custom property at root, nested, and inside @media', () => {
    expect(() => parse(':root { --x: red; }')).not.toThrow();
    expect(() => parse('a { b { --x: red; } }')).not.toThrow();
    expect(() => parse('@media screen { a { --x: red; } }')).not.toThrow();
  });

  it('accepts an interpolated custom-property name', () => {
    expect(parse('$p: q; a { --${p}x: red; }')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration' },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: { type: 'Interpolation' } }] }
      ]
    });
  });

  it('accepts an interpolation as the whole custom-property tail', () => {
    expect(() => parse('$p: q; a { --${p}: red; }')).not.toThrow();
  });

  it('keeps a custom-property value verbatim rather than evaluating it', () => {
    expect(parse('a { --x: 1px+2px; --y: $notavariable; }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [
        { type: 'Declaration', name: '--x', value: { type: 'Any', src: '1px+2px' } },
        { type: 'Declaration', name: '--y', value: { type: 'Any', src: '$notavariable' } }
      ] }]
    });
  });

  it('keeps a `${…}` segment inside a custom-property value structural', () => {
    expect(parse('$v: red; a { --x: 1px ${v}; }')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration' },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: '--x', value: { type: 'Interpolation' } }] }
      ]
    });
  });

  it('accepts a custom-property reference in a var() consumer', () => {
    expect(parse('a { color: var(--x, blue); }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }]
    });
  });

  it('keeps the CSS-defined empty var() fallback without relaxing trailing commas elsewhere', () => {
    expect(() => parse('a { font-family: var(--family,); }')).not.toThrow();
    expect(() => parse('a { font-family: 1,2,; }')).toThrow(SyntaxError);
    expect(() => parse('a { font-family: fn(1,); }')).toThrow(SyntaxError);
  });
});
