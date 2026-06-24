/**
 * Regression guard for the functional CSS grammar — verifies it produces a
 * valid AST and round-trips selectors correctly across a representative set
 * of CSS constructs. (Previously compared against the class-based CssParser;
 * that class is now builder-only, so this suite is the authoritative coverage.)
 */
import { parseCssFn } from '../src/grammar.js';
import { serializeTypes, isNode, N } from '@jesscss/core';

const CASES: string[] = [
  '@charset "UTF-8";',
  'a { b: c; }',
  'a + b { c: d; }',
  'a /* gap */ b { c: d; }',
  '[foo=\'bar\' i] { a: b }',
  '@page Test:first { margin: 1cm; }',
  'a:is(b, c) { d: e }',
  ':host(.sel.a), :host-context(.sel.b) { type: shadow-dom; }',
  ':unknown(.sel.a) { color: red; }',
  ':unknown(.sel .a) { color: red; }',
  'a{ background:url(foo) }',
  'a{ w: 10px; z: 2 }',
  'a { color: color(plum); }',
  'a { b: linear-gradient(#333 /*{comment}*/, #111); }',
  '#a,\n/*x*//*y*/\n.b,/*z*/.c { d: e; }',
  '#comments /* boo *//* boo again*/, .comments { color: red; }',
  'a { /*x*/ b { c: d; } }',
  'a { b: yes /* comment */; }',
  'a { color/* survive */ /* me too */: grey; }',
  '@-webkit-keyframes /* Safari */ hover /* and Chrome */ { 0% { color: red; } }',
  'a{ m: 1, 2, 3; n: 1 2 3 }',
  '@media screen { a{b:c} }'
];

describe('functional CSS grammar — regression', () => {
  for (const src of CASES) {
    test(`parses without errors: ${JSON.stringify(src)}`, () => {
      const result = parseCssFn(src);
      expect(result.errors.length).toBe(0);
      expect(serializeTypes(result.tree)).toBeTruthy();
    });
  }

  test('selector toString round-trips with trivia', () => {
    const selCases = [
      ':unknown(.sel.a) { color: red; }',
      ':unknown(.sel .a) { color: red; }',
      ':host(.sel.a) { color: red; }',
      ':host(.sel /*c*/ .a) { color: red; }',
      'a /* gap */ b { c: d; }'
    ];
    for (const src of selCases) {
      const result = parseCssFn(src);
      const ruleset = result.tree.rules[0];
      if (!isNode(ruleset, N.Ruleset)) {
        throw new Error('expected ruleset');
      }
      const str = ruleset.selector.toString({ trivia: result.trivia });
      expect(str).toBeTruthy();
    }
  });
});
