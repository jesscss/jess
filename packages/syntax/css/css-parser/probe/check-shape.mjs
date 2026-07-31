/**
 * Smoke-checks a built shape artifact: does it actually parse CSS, and do two
 * shapes that claim to be the same grammar agree on the tree?
 *
 * A byte count from a grammar that rejects its own language is not a score, and
 * the tournament ranks on bytes, so this check has to run before any number is
 * reported.
 */
import { run } from 'parseman';

const SOURCES = [
  'a{color:red}',
  '.a,.b>.c{margin:0 auto;padding:1px 2px}',
  '@media screen{a{color:#fff}}',
  'a{background:url(x.png) no-repeat}',
  'a{content:"hi";font:12px/1.5 sans-serif}',
  ':root{--x: 1px 2px}',
  'a[href^="http" i]:hover{color:rgba(0,0,0,.5)}',
  '@import "a.css";',
  'a{width:calc(1px + 2px)}'
];

const [, , ...entries] = process.argv;
const grammars = [];

for (const entry of entries) {
  const mod = await import(new URL(`./probe-lib/${entry}.js`, import.meta.url));
  const exported = Object.values(mod)[0];
  grammars.push([entry, exported]);
}

let mismatches = 0;

for (const source of SOURCES) {
  const results = grammars.map(([name, grammar]) => {
    try {
      const result = run(grammar.Stylesheet, source);
      return [name, result.ok ? JSON.stringify(result.value) : `REJECT@${result.span?.start}`];
    } catch (error) {
      return [name, `THROW ${error.message.slice(0, 60)}`];
    }
  });
  const distinct = new Set(results.map(r => r[1]));
  const agree = distinct.size === 1;
  if (!agree) {
    mismatches++;
  }
  const shown = results[0][1];
  console.log(
    agree ? 'agree ' : 'DIFFER',
    (shown.startsWith('REJECT') || shown.startsWith('THROW') ? shown.slice(0, 40) : 'ok').padEnd(42),
    source
  );
  if (!agree) {
    for (const [name, value] of results) {
      console.log('        ', name, value.slice(0, 120));
    }
  }
}

console.log(mismatches === 0 ? 'ALL SHAPES AGREE' : `${mismatches} DISAGREEMENTS`);
