import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';
import { serialize } from '@jesscss/core';
import type { Declaration, Ruleset, ValueSlot } from '@jesscss/core/ast';

/**
 * An unknown function's contents are component values up to the matching `)`
 * (css-syntax-3 §5.4.9), so a nested `;` is an ordinary token there, not a
 * declaration terminator. The function body carries three CSS constructs:
 *
 * - BRANCH arguments (ledger P38), css-values-5 §8.3's generic `if()` parse:
 *   `[ <if-args-branch> ; ]* <if-args-branch> ;?`, `<if-args-branch> =
 *   <declaration-value> : <declaration-value>?`, the first `<declaration-value>`
 *   excluding top-level colons. A body whose first argument ends at a top-level
 *   `:` is a branch list; each branch is a `Branch` node (condition, value), and
 *   its colon re-emits as written. A condition's `media()`, `supports()` and
 *   `style()` if-tests hold query syntax and are parsed with the query grammar.
 * - css-values-5 §3.1.1 `{}`-wrapped free-form arguments (`{a, b}`).
 * - css-mixins-1 `<dashed-function> = --*( <declaration-value>#? )`.
 *
 * A body with no branch shape keeps its `;` groups as a `;` List (`foo(a; b)`).
 */
const ROUND_TRIP: Array<[name: string, css: string, emitted?: string]> = [
  ['a style() branch', 'if(style(--scheme: dark): white; else: black)'],
  ['media(), supports() and else branches', 'if(media(width > 600px): 10px; supports(display: grid): 5px; else: 0)'],
  ['a lone else branch', 'if(else: 1px)'],
  ['a trailing semicolon', 'if(media(print): 1px;)'],
  ['an empty branch value', 'if(media(print):; else: 1px)'],
  ['a boolean condition run', 'if(not media(print) and supports(display: grid): 1px 2px; else: 0)'],
  ['a {}-wrapped branch value', 'if(media(print): { a, b }; else: c)'],
  ['if() inside calc()', 'calc(if(media(width > 600px): 10px; else: 0px) + 1px)'],
  ['a comment beside a branch `;`', 'if(media(print): a /* c */ ; else: b)'],
  ['an unknown function with a nested semicolon', 'foo(a; b)'],
  ['empty semicolon groups', 'foo(a;; b)'],
  ['comments beside a `;`', 'foo(a /* c */ ; /* d */ b)'],
  ['a leading colon, which has no condition', 'foo(:x)', 'foo(: x)'],
  ['punctuation glued to a colon, which is not a branch colon', 'foo(a +: 1)'],
  ['an escaped colon, which is not a branch colon', 'foo(a\\:b)'],
  ['a colon inside a string, which is not a branch colon', 'foo("a:b", c)'],
  ['a later `;` group with no colon', 'if(a: 1; b)'],
  ['comma groups and empty groups after a branch', 'if(a: 1; b, c;; d: 2)'],
  ['a {}-wrapped argument', 'random-item(--x, { a, b }, c)'],
  ['a {}-wrapped argument with padding before a comma', 'foo({a , b})', 'foo({ a, b })'],
  ['a var() fallback group holding a nested `;`', 'var(--x, (a; b))'],
  ['a var() fallback group ending on a `;`', 'var(--x, (a;))'],
  ['a dashed function with a {}-wrapped argument', '--max-plus-x({ 1px, 7px, 2px }, 3px)'],
  ['a dashed function', '--foo(1px, 2px)'],
  ['a dashed function inside calc()', 'calc(--foo(1px) + 1px)'],
  ['an unknown function with a slash inside calc()', 'calc(foo(1px / 2) + 1px)'],
  ['a var() fallback holding a semicolon inside a function', 'var(--x, foo(a; b))'],
  ['a var() fallback holding a {}-block', 'var(--x, { a, b })'],
  ['if-tests joined by `or`', 'if(media(width > 600px) or media(print): 1px; else: 0)'],
  ['a supports() test holding a condition group', 'if(supports(not (display: grid)): 1px; else: 0)'],
  ['media(), supports() and style() holding a general-enclosed query', 'media(a, b) supports(a b c) style(a, b)'],
  ['a comment after a branch colon, whose padding is canonical', 'if(media(print):/*c*/ 1px)', 'if(media(print): 1px)'],
  ['an empty argument list', 'foo()']
];

function declarationValue(css: string): ValueSlot {
  const rule = parse(`a { b: ${css}; }`).rules[0] as Ruleset;
  return (rule.rules[0] as Declaration).value;
}

async function emitted(css: string): Promise<string> {
  const out = (await serialize(parse(`a { b: ${css}; }`))).css;
  return /b: (.*);/.exec(out)?.[1] ?? out;
}

describe('CSS function bodies: branches, `;` groups, `{}` arguments, dashed functions', () => {
  for (const [name, css, expected] of ROUND_TRIP) {
    it(`parses and re-emits ${name}`, async () => {
      expect(await emitted(css)).toBe(expected ?? css);
    });
  }

  it('reduces if() branches to one `;` List of Branch nodes over structured values', () => {
    expect(declarationValue('if(style(--scheme: dark): white; else: black)')).toMatchObject({
      type: 'FunctionCall',
      name: 'if',
      args: [{
        value: {
          type: 'List',
          sep: ';',
          value: [
            {
              type: 'Branch',
              condition: { type: 'FunctionCall', name: 'style', args: [{ value: { type: 'Interpolation' } }] },
              value: { type: 'Keyword', src: 'white' }
            },
            { type: 'Branch', condition: { type: 'Keyword', src: 'else' }, value: { type: 'Keyword', src: 'black' } }
          ]
        }
      }]
    });
  });

  it('parses media() and supports() tests with the query grammar', () => {
    expect(declarationValue('if(media(width > 600px): 1; supports(display: grid): 2)')).toMatchObject({
      args: [{
        value: {
          type: 'List',
          sep: ';',
          value: [
            {
              type: 'Branch',
              condition: {
                type: 'FunctionCall',
                name: 'media',
                args: [{ value: { type: 'Operation', operator: '>', left: { src: 'width' }, right: { src: '600px' } } }]
              }
            },
            {
              type: 'Branch',
              condition: {
                type: 'FunctionCall',
                name: 'supports',
                args: [{ value: { type: 'Operation', operator: ':', left: { src: 'display' }, right: { src: 'grid' } } }]
              }
            }
          ]
        }
      }]
    });
  });

  /*
   * An if-test is decided at its opener, wherever it stands: its contents are a
   * query. One that is no media feature or condition is css-values-5's
   * `<general-enclosed>`, held as written.
   */
  it('reads media() as an if-test at its opener, anywhere in a value', () => {
    expect(declarationValue('media(a, b)')).toMatchObject({
      type: 'FunctionCall',
      name: 'media',
      args: [{ value: { type: 'Interpolation' } }]
    });
  });

  /*
   * P38 makes `http` followed by `:` a branch condition, and a value never
   * begins with `/` in this grammar (`b: //x` is rejected too), so the branch
   * has no value to read. Recorded, not decided here.
   */
  it('rejects an unquoted URL as a first argument', () => {
    expect(() => parse('a { b: foo(http://x); }')).toThrow();
  });

  it('keeps a single branch as the one argument', () => {
    expect(declarationValue('if(else: 1px)')).toMatchObject({
      args: [{ value: { type: 'Branch', condition: { src: 'else' }, value: { src: '1px' } } }]
    });
  });

  it('keeps the spec\'s trailing `;` as an empty slot and an omitted value as the empty slot', () => {
    expect(declarationValue('if(media(print):;)')).toMatchObject({
      args: [{ value: { type: 'List', sep: ';', value: [{ type: 'Branch', condition: { name: 'media' }, value: [] }, []] } }]
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
