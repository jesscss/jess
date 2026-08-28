import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { parse } from '@jesscss/less-parser';
import { buildEvaluator } from '../../../../core/src/ast/evaluator.js';
import { serialize } from '../../../../core/src/ast/serialize.js';
import { triviaMapOf } from '../../../../core/src/ast/provenance.js';

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

describe('Less custom properties', () => {
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
    expect(parse('@p: q; a { --@{p}x: red; }')).toMatchObject({
      rules: [
        { type: 'VariableDeclaration' },
        { type: 'Ruleset', rules: [{ type: 'Declaration', name: { type: 'Interpolation' } }] }
      ]
    });
  });

  it('accepts an interpolation as the whole custom-property tail', () => {
    expect(() => parse('@p: q; a { --@{p}: red; }')).not.toThrow();
  });

  it('accepts a custom-property reference in a var() consumer', () => {
    expect(parse('a { color: var(--x, blue); }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: 'color' }] }]
    });
  });

  it('parses raw Less variables inside custom-property values structurally', () => {
    const document = parse('@value: #fff; :root { --color: @value; --fallback: solid @value; }');

    expect(document).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'value' },
        {
          type: 'Ruleset',
          rules: [
            {
              type: 'Declaration',
              name: '--color',
              value: {
                type: 'Interpolation',
                parts: [{ ref: { type: 'Lookup', kind: 'var', name: 'value', raw: '@value', scope: 'scoped' }, unquote: false }]
              }
            },
            {
              type: 'Declaration',
              name: '--fallback',
              value: {
                type: 'Interpolation',
                parts: [
                  { lit: 'solid ' },
                  { ref: { type: 'Lookup', kind: 'var', name: 'value', raw: '@value', scope: 'scoped' }, unquote: false }
                ]
              }
            }
          ]
        }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      ':root {\n'
      + '  --color: #fff;\n'
      + '  --fallback: solid #fff;\n'
      + '}\n'
    );
  });

  it('keeps strict custom-property interpolation unquoted while raw variables preserve quotes', () => {
    const document = parse('@value: "red"; :root { --raw: @value; --strict: @{value}; }');

    expect(document).toMatchObject({
      rules: [
        { type: 'VariableDeclaration', name: 'value' },
        {
          type: 'Ruleset',
          rules: [
            { type: 'Declaration', name: '--raw', value: { type: 'Interpolation', parts: [{ unquote: false }] } },
            { type: 'Declaration', name: '--strict', value: { type: 'Interpolation', parts: [{ unquote: true }] } }
          ]
        }
      ]
    });
    expect(serialize(document, { evaluator: buildEvaluator(makeLessRegistry()) }).css).toBe(
      ':root {\n'
      + '  --raw: "red";\n'
      + '  --strict: red;\n'
      + '}\n'
    );
  });

  it('keeps known at-rule-looking custom-property bytes opaque', () => {
    expect(parse('.card { --x:red @media all {x:y} }')).toMatchObject({
      rules: [{ type: 'Ruleset', rules: [{ type: 'Declaration', name: '--x', value: { type: 'Any', src: 'red @media all {x:y} ' } }] }]
    });
  });

  it('keeps custom-property block comments as trivia and renders them inline', () => {
    const source = '@n: blue; .x { --a: red/* c */blue; --b: f(a/* inner */b); --c: [a/* square */b]; --d: { x: 1/* curly */ }; --e: red/* var */@{n}; --f: "@{literal}"/* q */@{n}; }';
    const document = parse(source);
    const comments = triviaMapOf(document)
      ?.commentRuns()
      .map(run => source.slice(run.start, run.end));

    expect(document).toMatchObject({
      rules: [{ type: 'VariableDeclaration', name: 'n' }, {
        type: 'Ruleset',
        rules: [
          { type: 'Declaration', name: '--a', value: { type: 'Any', src: 'redblue' } },
          { type: 'Declaration', name: '--b', value: { type: 'Any', src: 'f(ab)' } },
          { type: 'Declaration', name: '--c', value: { type: 'Any', src: '[ab]' } },
          { type: 'Declaration', name: '--d', value: { type: 'Any', src: '{ x: 1 }' } },
          { type: 'Declaration', name: '--e', value: { type: 'Interpolation' } },
          { type: 'Declaration', name: '--f', value: { type: 'Interpolation' } }
        ]
      }]
    });
    expect(comments).toEqual(expect.arrayContaining(['/* c */', '/* inner */', '/* square */', '/* curly */', '/* var */', '/* q */']));
    expect(serialize(document).css).toBe(
      '.x {\n'
      + '  --a: red/* c */blue;\n'
      + '  --b: f(a/* inner */b);\n'
      + '  --c: [a/* square */b];\n'
      + '  --d: { x: 1/* curly */ };\n'
      + '  --e: red/* var */blue;\n'
      + '  --f: "@{literal}"/* q */blue;\n'
      + '}\n'
    );
  });
});
