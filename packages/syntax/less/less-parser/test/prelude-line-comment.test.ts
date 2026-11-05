import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { preludeLineComment, preludeUrlToken, withoutLineComments } from '@jesscss/core/ast';
import { parse } from '../src/index.js';

/**
 * Two readers decide what a `//` in at-rule prelude bytes is: the regex in the group
 * production, which says where a group ends, and `withoutLineComments`, which builds
 * the text. A disagreement loses bytes or unbalances the CSS, so one battery runs
 * through both.
 */
const battery: ReadonlyArray<readonly [source: string, text: string]> = [
  ['(c // d\n e)', '(c e)'],
  ['(c // )\n e)', '(c e)'],
  ['(// d\n e)', '( e)'],
  ['(c, // )\n e)', '(c, e)'],
  ['("c" // )\n e)', '("c" e)'],
  ['[c // ]\n e]', '[c e]'],
  ['(http://a/b)', '(http://a/b)'],
  ['(c//d)', '(c//d)'],
  ['(c/d)', '(c/d)'],
  ['("c // d")', '("c // d")'],
  ['(c /* // */ d)', '(c /* // */ d)'],
  ['url(//a/b)', 'url(//a/b)'],
  ['URL(//a/b)', 'URL(//a/b)'],
  ['url( //a/b)', 'url( //a/b)'],
  ['(url( //a/b)\n)', '(url( //a/b) )'],
  ['(url(c //a/b))', '(url(c //a/b))'],
  ['(url("c" // d\n e))', '(url("c" e))'],
  ['image-url(//a/b)', 'image-url(//a/b)'],
  ['xurl(//a)', 'xurl(//a)'],
  ['-url(//a)', '-url(//a)'],
  ['_url(//a)', '_url(//a)'],
  ['a-url(//a)', 'a-url(//a)'],
  ['\\url(//a)', '\\url(//a)'],
  ['(myurl(//a)\n)', '(myurl(//a) )'],
  ['fn(//a)', 'fn(//a)'],
  ['fn( // )\n a)', 'fn( a)']
];

describe('the two readers of `//` in a prelude', () => {
  it.each(battery)('agree on %j', (source, text) => {
    const statement = parse(`@foo (a) z ${source} c;`).rules[0];
    expect(statement).toMatchObject({ type: 'AtRuleStatement', prelude: { src: `(a) z ${text} c` } });
  });

  it('are one pattern', () => {
    const grammar = readFileSync(new URL('../src/grammar.ts', import.meta.url), 'utf8');
    expect(grammar).toContain(`regex(/${preludeUrlToken.source}|${preludeLineComment.source}|`);
  });

  it('leaves a run with no comment as it is', () => {
    expect(withoutLineComments('http://a')).toBe('http://a');
    expect(withoutLineComments('"//" //')).toBe('"//"  ');
  });
});
