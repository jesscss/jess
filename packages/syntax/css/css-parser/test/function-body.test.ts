import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';
import { serialize } from '@jesscss/core';
import type { Declaration, Ruleset, ValueSlot } from '@jesscss/core/ast';

/**
 * An unknown function's contents are component values up to the matching `)`
 * (css-syntax-3 §5.4.9), so a nested `;` is an ordinary token there, not a
 * declaration terminator. Three CSS constructs depend on the function body:
 *
 * - css-values-5 §8.3 `if()`:
 *   `if( [ <if-branch> ; ]* <if-branch> ;? )`,
 *   `<if-branch> = <if-condition> : <declaration-value>?`,
 *   `<if-condition> = <boolean-expr[ <if-test> ]> | else`.
 * - css-values-5 §3.1.1 `{}`-wrapped free-form arguments (`{a, b}`).
 * - css-mixins-1 `<dashed-function> = --*( <declaration-value>#? )`.
 *
 * The `;` is a structural separator (a `;` List of the branches). The `:` inside
 * a branch is the punctuation component it already is in a declaration value,
 * so it re-emits with the spacing every glued punctuation run gets
 * (`if(else : 1px)`); the condition and value either side of it stay structured
 * values.
 */
const ROUND_TRIP: Array<[name: string, css: string, emitted?: string]> = [
  ['a style() branch', 'if(style(--scheme: dark): white; else: black)', 'if(style(--scheme : dark) : white; else : black)'],
  [
    'media(), supports() and else branches',
    'if(media(width > 600px): 10px; supports(display: grid): 5px; else: 0)',
    'if(media(width > 600px) : 10px; supports(display : grid) : 5px; else : 0)'
  ],
  ['a lone else branch', 'if(else: 1px)', 'if(else : 1px)'],
  ['a trailing semicolon', 'if(media(print): 1px;)', 'if(media(print) : 1px;)'],
  ['an empty branch value', 'if(media(print):; else: 1px)', 'if(media(print) :; else : 1px)'],
  ['if() inside calc()', 'calc(if(media(width > 600px): 10px; else: 0px) + 1px)', 'calc(if(media(width > 600px) : 10px; else : 0px) + 1px)'],
  ['an unknown function with a nested semicolon', 'foo(a; b)'],
  ['empty semicolon groups', 'foo(a;; b)'],
  ['comments beside a `;`', 'foo(a /* c */ ; /* d */ b)'],
  ['a {}-wrapped argument', 'random-item(--x, { a, b }, c)'],
  ['a dashed function with a {}-wrapped argument', '--max-plus-x({ 1px, 7px, 2px }, 3px)'],
  ['a dashed function', '--foo(1px, 2px)'],
  ['a dashed function inside calc()', 'calc(--foo(1px) + 1px)'],
  ['an unknown function with a slash inside calc()', 'calc(foo(1px / 2) + 1px)'],
  ['a var() fallback holding a semicolon inside a function', 'var(--x, foo(a; b))'],
  ['a var() fallback holding a {}-block', 'var(--x, { a, b })']
];

function declarationValue(css: string): ValueSlot {
  const rule = parse(`a { b: ${css}; }`).rules[0] as Ruleset;
  return (rule.rules[0] as Declaration).value;
}

async function emitted(css: string): Promise<string> {
  const out = (await serialize(parse(`a { b: ${css}; }`))).css;
  return /b: (.*);/.exec(out)?.[1] ?? out;
}

describe('CSS function bodies: `;` groups, `{}` arguments, dashed functions', () => {
  for (const [name, css, expected] of ROUND_TRIP) {
    it(`parses and re-emits ${name}`, async () => {
      expect(await emitted(css)).toBe(expected ?? css);
    });
  }

  it('reduces if() branches to one `;` List argument whose branches are structured values', () => {
    expect(declarationValue('if(style(--scheme: dark): white; else: black)')).toMatchObject({
      type: 'FunctionCall',
      name: 'if',
      args: [{
        value: {
          type: 'List',
          sep: ';',
          value: [
            [
              { type: 'FunctionCall', name: 'style' },
              { type: 'Any', src: ':' },
              { type: 'Keyword', src: 'white' }
            ],
            [{ type: 'Keyword', src: 'else' }, { type: 'Any', src: ':' }, { type: 'Keyword', src: 'black' }]
          ]
        }
      }]
    });
  });

  it('records an empty group after a trailing `;` as the empty slot', () => {
    expect(declarationValue('if(media(print): 1px;)')).toMatchObject({
      args: [{ value: { type: 'List', sep: ';', value: [[{ name: 'media' }, { src: ':' }, { src: '1px' }], []] } }]
    });
  });

  it('keeps a comma-only call as a flat argument vector', () => {
    expect(declarationValue('foo(a, b)')).toMatchObject({
      type: 'FunctionCall',
      args: [{ value: { type: 'Keyword', src: 'a' } }, { value: { type: 'Keyword', src: 'b' } }]
    });
  });

  it('keeps comma groups inside `;` groups as comma Lists', () => {
    expect(declarationValue('foo(a, b; c)')).toMatchObject({
      args: [{ value: { type: 'List', sep: ';', value: [{ type: 'List', sep: ',' }, { src: 'c' }] } }]
    });
  });

  it('reduces a {}-wrapped argument to a curly Block holding the comma List', () => {
    expect(declarationValue('--max-plus-x({ 1px, 7px }, 3px)')).toMatchObject({
      type: 'FunctionCall',
      name: '--max-plus-x',
      args: [
        { value: { type: 'Block', delimiter: 'curly', value: { type: 'List', sep: ',' } } },
        { value: { type: 'Dimension', src: '3px' } }
      ]
    });
  });

  it('keeps a bare dashed ident a value, not a call', () => {
    expect(declarationValue('--x')).toMatchObject({ type: 'Keyword', src: '--x' });
  });

  it('does not admit a {}-block as a top-level declaration value', () => {
    expect(() => parse('a { b: { c }; }')).toThrow();
  });
});
