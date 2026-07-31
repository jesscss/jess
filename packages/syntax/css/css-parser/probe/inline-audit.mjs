/**
 * Mechanical audit for the by-const inlining defect.
 *
 * A composite rule referenced by const is inlined at every reference, and the
 * inlining is transitive. This counts, per grammar file, how many composite
 * consts are referenced by bare name more than once, and how many are BOTH in
 * the returned rules map AND still referenced by const (emitted twice).
 *
 * Purely lexical - it counts identifiers, it does not read structure.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const src = readFileSync(file, 'utf8');

const declared = [...src.matchAll(/\bconst ([A-Za-z][A-Za-z0-9_]*) = (node|choice|sequence|dispatch|transform|oneOrMore|many|optional|oneOrMoreSep|sepBy|token)\(/g)]
  .map(match => match[1]);

const mapped = new Set(
  [...src.matchAll(/\b_?g\.([A-Za-z][A-Za-z0-9_]*)/g)].map(match => match[1])
);

let inlinedOnce = 0;
let inlinedMany = 0;
let emittedTwice = 0;
const worst = [];

for (const name of new Set(declared)) {
  const bare = [...src.matchAll(new RegExp(`(?<![.\\w])${name}\\b`, 'g'))].length - 1;
  if (bare <= 0) {
    continue;
  }
  if (bare === 1) {
    inlinedOnce++;
  } else {
    inlinedMany++;
    worst.push([name, bare, mapped.has(name)]);
  }
  if (mapped.has(name)) {
    emittedTwice++;
  }
}

worst.sort((a, b) => b[1] - a[1]);

console.log(file);
console.log('  composite consts declared          ', new Set(declared).size);
console.log('  referenced by const exactly once   ', inlinedOnce);
console.log('  referenced by const 2+ times       ', inlinedMany, '<- each reference is a transitive inline copy');
console.log('  also reachable as g.<name>         ', emittedTwice, '<- emitted twice: inlined AND as a named rule');
console.log('  top by-const reference counts:');
for (const [name, count] of worst.slice(0, 15)) {
  console.log('   ', String(count).padStart(3), name);
}
