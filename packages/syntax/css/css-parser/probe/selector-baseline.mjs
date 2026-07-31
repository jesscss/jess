/**
 * Selector case matrix, run BEFORE and AFTER any selector change.
 *
 * This exists because a pre-existing failure was mistaken for a regression and
 * a correct fix was reverted as a result. A case that was already failing is
 * not a regression, and there is no way to tell the difference without a
 * first column captured on the unmodified grammar.
 *
 * Usage:
 *   node probe/selector-baseline.mjs s5-ast-only            > /tmp/before.txt
 *   ...apply the change, rebuild...
 *   node probe/selector-baseline.mjs s5-ast-only /tmp/before.txt
 */
import { readFileSync } from 'node:fs';
import { run } from 'parseman';

const CASES = [
  'a .b{c:d}',
  '.a.b{c:d}',
  '.a > .b{c:d}',
  'a:is(.x,.y){b:c}',
  'a:has(> .b){c:d}',
  'a:has(.b){c:d}',
  'a[href]{b:c}',
  'a[href="x"]{b:c}',
  'a[href^="h"]{b:c}',
  'a[href="x" i]{b:c}',
  'a/*c*/.b{d:e}',
  'a:nth-child(2n+1){b:c}',
  'a:matches(.x,.y){b:c}',
  '.a,.b{c:d}'
];

const [, , entry, baselinePath] = process.argv;
const mod = await import(new URL(`./probe-lib/${entry}.js`, import.meta.url));
const grammar = mod.cssGrammar ?? Object.values(mod)[0];

/** One line per case: the node kind and arity, or why it failed. */
function outcome(source) {
  try {
    const result = run(grammar.Stylesheet, source);
    const consumed = result.span?.end ?? 0;
    if (!result.ok || consumed < source.length) {
      return `REJECT ${consumed}/${source.length}`;
    }
    const sel = result.value?.rules?.[0]?.selector?.selectors?.[0];
    return `${sel?.type ?? '?'} n=${sel?.value?.length ?? 1}`;
  } catch (error) {
    return `THROW ${error.message.slice(0, 28)}`;
  }
}

const now = new Map(CASES.map(c => [c, outcome(c)]));

if (baselinePath === undefined) {
  for (const [source, result] of now) {
    console.log(`${source}\t${result}`);
  }
} else {
  const before = new Map(
    readFileSync(baselinePath, 'utf8').split('\n').filter(Boolean)
      .map(line => line.split('\t'))
  );
  let regressions = 0;
  let fixes = 0;
  console.log('case'.padEnd(24), 'BEFORE'.padEnd(24), 'AFTER'.padEnd(24), 'VERDICT');
  for (const [source, after] of now) {
    const was = before.get(source) ?? '(not in baseline)';
    const wasBad = was.startsWith('REJECT') || was.startsWith('THROW');
    const isBad = after.startsWith('REJECT') || after.startsWith('THROW');
    let verdict = 'unchanged';
    if (was !== after) {
      verdict = wasBad && !isBad ? 'FIXED' : !wasBad && isBad ? 'REGRESSION' : 'CHANGED';
    }
    if (verdict === 'REGRESSION') {
      regressions++;
    }
    if (verdict === 'FIXED') {
      fixes++;
    }
    console.log(source.padEnd(24), was.padEnd(24), after.padEnd(24), verdict);
  }
  console.log(`\n${fixes} fixed, ${regressions} regressions`);
  if (regressions > 0) {
    process.exitCode = 1;
  }
}
