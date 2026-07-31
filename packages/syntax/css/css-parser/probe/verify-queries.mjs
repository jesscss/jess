/**
 * Tree evidence for the conditional-prelude productions.
 *
 * Batch 1 shipped a "9/9 fixtures parse" line. Candidate B pointed out that
 * parse-success is not tree-evidence and that two of the four query
 * productions were unreachable while every fixture still passed. This asserts
 * on the PRODUCED TREE — which node type came out, and what text it carries —
 * so an unreachable production shows up as a wrong node rather than a green
 * tick.
 */
import { run } from 'parseman';

/** source, the node type the spec says this is, and the text it should carry. */
const CASES = [
  ['@media (hover){a{b:c}}', 'QueryBareFeature', 'hover'],
  ['@media (min-width:30em){a{b:c}}', 'QueryColonFeature', 'min-width'],
  ['@media (width >= 600px){a{b:c}}', 'QueryComparisonFeature', 'width'],
  ['@media (400px <= width <= 700px){a{b:c}}', 'QueryRangeFeature', '400px'],
  ['@supports (display:grid){a{b:c}}', 'SupportsInParens', 'display'],
  ['@supports selector(a > b){a{b:c}}', 'GeneralEnclosed', 'selector'],
  ['@media foo(bar){a{b:c}}', 'GeneralEnclosed', 'foo']
];

const entry = process.argv[2];
const mod = await import(new URL(`./probe-lib/${entry}.js`, import.meta.url));
const grammar = Object.values(mod)[0];

/** Every `src`/`text`/`name` string anywhere in the tree, in encounter order. */
function texts(node, out = []) {
  if (node === null || typeof node !== 'object') {
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      texts(item, out);
    }
    return out;
  }
  for (const key of ['src', 'text', 'name']) {
    if (typeof node[key] === 'string') {
      out.push(node[key]);
    }
  }
  for (const value of Object.values(node)) {
    texts(value, out);
  }
  return out;
}

let bad = 0;

for (const [source, expectedKind, expectedText] of CASES) {
  let verdict;
  let detail;
  try {
    const result = run(grammar.Stylesheet, source);
    /*
     * `ok` alone is NOT acceptance. `Stylesheet` is `many(Item)` and `many`
     * succeeds on zero matches, so a total parse failure returns ok with an
     * empty tree and a 0..0 span — `!!!garbage!!!` "parses". Every consumption
     * claim must assert the span reaches the end of the input.
     */
    const consumed = result.span?.end ?? 0;
    if (!result.ok || consumed < source.length) {
      verdict = 'REJECT';
      detail = `consumed ${consumed}/${source.length}`;
    } else {
      const found = texts(result.value);
      /* The delimiter test: a carried text containing ( or : means the routed */
      /* span leaked its delimiters into the reduced value.                    */
      const leaked = found.filter(t => /[(:]/.test(t));
      const carries = found.some(t => t === expectedText);
      verdict = carries && leaked.length === 0 ? 'ok' : 'WRONG-TREE';
      detail = `${carries ? '' : `no leaf === "${expectedText}"; `}${
        leaked.length > 0 ? `delimiter leak: ${JSON.stringify(leaked.slice(0, 2))}` : ''
      }texts=${JSON.stringify(found.slice(0, 5))}`;
    }
  } catch (error) {
    verdict = 'THROW';
    detail = error.message.slice(0, 60);
  }
  if (verdict !== 'ok') {
    bad++;
  }
  console.log(verdict.padEnd(11), expectedKind.padEnd(24), source);
  if (verdict !== 'ok') {
    console.log(' '.repeat(12), detail.slice(0, 150));
  }
}

console.log(bad === 0 ? '\nALL TREES CORRECT' : `\n${bad}/${CASES.length} WRONG`);
