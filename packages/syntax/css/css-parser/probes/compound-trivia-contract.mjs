/*
 * THE COMPOUND-SELECTOR TRIVIA CONTRACT, measured against the incumbent.
 *
 * The three-layer shape at `src/grammar.ts:1449` is:
 *
 *   compoundTrivia     = classifiedTrivia({ blockComment })                 // :774
 *   interstitialTrivia = classifiedTrivia({ whitespace, blockComment })     // :770
 *
 *   CompoundSelector = noTrivia(parser({ trivia: compoundTrivia }, oneOrMore(choice(
 *     NestingSelector,
 *     parser({ trivia: interstitialTrivia }, AttributeSelector),
 *     parser({ trivia: interstitialTrivia }, PseudoSelector),
 *     BasicSelector))))
 *
 * The asymmetry it produces is the part nobody reproduces from reading, and it
 * is three requirements that pull against each other:
 *
 *   1. whitespace SPLITS a compound          `a .b`          -> two compounds
 *   2. a comment does NOT split it           `a/*c*​/.b`      -> one compound
 *   3. whitespace INSIDE `[…]` / `:pseudo()` is legal again  `[href="x" i]`
 *
 * (1) needs whitespace out of the trivia set; (3) needs it back in, but only
 * inside the delimiters. Layer 1 buys (1) and (2); the two inner `parser(...)`
 * re-enables buy (3) without giving back (1).
 *
 * A grammar that satisfies 1 and 2 but not 3 has layer 1 and is missing the
 * inner re-enables -- which is precisely the state Candidate A reverted from,
 * having read the `[href="x" i]` failure as a regression caused by the change
 * rather than as the defect the change was needed to fix.
 *
 * Run against a candidate by pointing CSS_PARSER_LIB at its built lib.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = process.env.CSS_PARSER_LIB ?? '../lib/index.cjs';
const { parse } = require(lib);

/* [label, source, mustParse, requirement] */
const CASES = [
  ['descendant splits', 'a .b {c:d}', true, 1],
  ['descendant, deep', 'a .b .c {c:d}', true, 1],
  ['child combinator', 'a > .b {c:d}', true, 1],
  ['comment does NOT split', 'a/*z*/.b {c:d}', true, 2],
  ['comment at compound edge', '.a/*z*/ .b {c:d}', true, 2],
  ['no-space compound', 'a.b.c {c:d}', true, 2],
  ['attr, no whitespace', 'a[href="x"] {c:d}', true, 3],
  ['attr + case modifier', 'a[href="x" i] {c:d}', true, 3],
  ['attr + s modifier', 'a[href="x" s] {c:d}', true, 3],
  ['attr modifier, glued', 'a[href="x"i] {c:d}', true, 3],
  ['attr, whitespace throughout', 'a[ href = "x" i ] {c:d}', true, 3],
  ['pseudo with inner spaces', 'a:not( .x ) {c:d}', true, 3],
  ['relative leading combinator', 'a:has(> .b) {c:d}', true, 3],
  ['relative, no leading', 'a:has(.b) {c:d}', true, 3]
];

const REQUIREMENT = {
  1: 'whitespace SPLITS a compound (needs whitespace OUT of compound trivia)',
  2: 'a comment does NOT split a compound (needs comments IN compound trivia)',
  3: 'whitespace is legal INSIDE [] and :pseudo() (needs the inner re-enables)'
};

const failedBy = new Map();
let failures = 0;

for (const [label, src, mustParse, req] of CASES) {
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
    failedBy.set(req, (failedBy.get(req) ?? 0) + 1);
  }
  console.log(`${bad ? 'FAIL' : 'ok  '} [${req}] ${label.padEnd(28)} ${JSON.stringify(src).padEnd(26)} ${detail}`);
}

console.log(`\n${failures} of ${CASES.length} failing.`);
if (failures > 0) {
  console.log('\nDIAGNOSIS — which layer is missing:');
  for (const [req, n] of [...failedBy].sort()) {
    console.log(`  requirement ${req}: ${n} failing — ${REQUIREMENT[req]}`);
  }
  if (failedBy.has(3) && !failedBy.has(1) && !failedBy.has(2)) {
    console.log('\n  Only requirement 3 fails: the compound trivia override is PRESENT and the');
    console.log('  inner parser({ trivia: interstitialTrivia }, …) re-enables are MISSING.');
    console.log('  This is NOT a regression from adding the override — it is the override');
    console.log('  applied without its third layer.');
  }
}
process.exit(failures === 0 ? 0 : 1);
