/*
 * REPRODUCTION: CSS comments are rejected inside several parenthesised value
 * contexts by the SHIPPING (macro-compiled) css parser. All inputs below are
 * valid CSS -- comments are trivia -- and postcss accepts every one of them.
 *
 * MEASURED SIGNATURE (this is the finding; the cause is NOT established):
 *
 *   context                    comment w/o delimiter   comment w/ delimiter
 *   bare ParenValue  (c)       REJECT                  REJECT
 *   calc(...)                  REJECT                  REJECT
 *   var() fallback, top level  accept                  REJECT
 *   var() fallback, nested ()  accept                  accept
 *   no parens at all           accept                  accept
 *   string containing ')'      accept                  accept
 *
 * So it is NOT simply "delimiter inside a comment": `calc(1px /-* c *-/ + 2px)`
 * has no delimiter in the comment and still fails. Whatever the mechanism is,
 * it is context-dependent, and STRINGS survive where COMMENTS do not even
 * though both are in the same ambient `scanSkip` list.
 *
 * The parseman lane's hypothesis -- that through `compose()` ambient
 * `scanSkip` is not honoured inside a `balanced()` interior, though it is via
 * the interpreter -- is consistent with the comment column but does NOT
 * explain the string column. Recorded as an open question, not a diagnosis.
 *
 * Exits 1 while the bug is present. Convert to a vitest case when it is fixed.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('../lib/index.cjs');

/* [label, source, mustParse] */
const CASES = [
  ['bare paren, no comment (CONTROL)', 'a { b: (c) }', true],
  ['bare paren + comment', 'a { b: (/* c */ e) }', true],
  ['bare paren + comment with )', 'a { b: (/* ) */ e) }', true],
  ['calc, no comment (CONTROL)', 'a { b: calc(1px + 2px) }', true],
  ['calc + comment', 'a { b: calc(1px /* c */ + 2px) }', true],
  ['var fallback + comment', 'a { b: var(--x, /* c */ e) }', true],
  ['var fallback + comment with )', 'a { b: var(--x, /* ) */ e) }', true],
  ['var fallback, nested paren + comment', 'a { b: var(--x, (/* c */ e)) }', true],
  ['string containing ) (CONTROL)', 'a { b: var(--x, ")") }', true],
  ['comment, no parens (CONTROL)', 'a { b: /* ) */ e }', true]
];

let failures = 0;
for (const [label, src, mustParse] of CASES) {
  let ok;
  let detail = '';
  try {
    parse(src);
    ok = true;
  } catch (e) {
    ok = false;
    detail = `${e.message} @${e.offset}`;
  }
  const bad = ok !== mustParse;
  if (bad) {
    failures++;
  }
  console.log(`${bad ? 'BUG ' : 'ok  '} ${label.padEnd(38)} ${JSON.stringify(src).padEnd(34)} ${detail}`);
}

console.log(`\n${failures} of ${CASES.length} valid CSS inputs rejected by the shipping parser.`);
console.log('Cross-checked: postcss.parse accepts every case above.');
process.exit(failures === 0 ? 0 : 1);
