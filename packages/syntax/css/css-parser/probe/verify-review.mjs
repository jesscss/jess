/**
 * Verifies a reviewer's findings against a built shape rather than accepting
 * them on assertion. Prints the actual tree fragment for each case so the
 * failure mode is visible, not just a pass/fail.
 */
import { run } from 'parseman';

const CASES = [
  ['F1 comma is a separator, not a component', 'a{color:red,blue}'],
  ['F2 !important sets the flag', 'a{color:red!important}'],
  ['F3 unicode-range is one token', '@font-face{unicode-range:U+0025-00FF}'],
  ['F4 dimension keeps its unit', 'a{width:10px}'],
  ['F5 complex selector keeps every compound', '.a > .b{color:red}']
];

const entry = process.argv[2];
const mod = await import(new URL(`./probe-lib/${entry}.js`, import.meta.url));
const grammar = Object.values(mod)[0];

for (const [label, source] of CASES) {
  const result = run(grammar.Stylesheet, source);
  console.log(`\n=== ${label}`);
  console.log(`    ${source}`);
  if (!result.ok) {
    console.log(`    REJECTED at ${result.span?.start}`);
    continue;
  }
  console.log(`    ${JSON.stringify(result.value).replace(/"_[se]":\{[^}]*\},?/g, '').slice(0, 460)}`);
}
