/*
 * Candidate A's inlining hazard, applied to the incumbent CSS grammar.
 *
 * A rule referenced by CONST is inlined at every reference, transitively.
 * A rule referenced by NAME through the `g` proxy is emitted once and called.
 * Two hazards follow:
 *   H1  a composite const referenced 2+ times and NOT in the returned rules
 *       map -- emitted once per reference.
 *   H2  a const that IS in the map but is still referenced by const at a call
 *       site -- emitted twice, inlined at the site AND as a named rule.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/grammar.ts', import.meta.url), 'utf8');
const lines = src.split('\n');

const COMPOSITE = /\b(sequence|choice|many|oneOrMore|oneOrMoreSep|optional|not|peek|node|dispatch|token|noTrivia|scanTo|balanced|expect|sepBy)\(/;

const consts = [];
let cur = null;
for (let i = 0; i < lines.length; i++) {
  const m = /^ {2}const ([A-Za-z_][A-Za-z0-9_]*) =/.exec(lines[i]);
  if (m) {
    if (cur) {
      cur.end = i;
      consts.push(cur);
    }
    cur = { name: m[1], start: i, end: lines.length };
  }
}
if (cur) {
  consts.push(cur);
}
for (const c of consts) {
  c.body = lines.slice(c.start, c.end).join('\n');
  c.composite = COMPOSITE.test(c.body);
}

/* The returned rules map is the final `return { ... };` of the factory. */
const retIdx = lines.findIndex(l => /^ {2}return \{$/.test(l));
const mapBody = lines.slice(retIdx).join('\n');
const inMap = new Set();
for (const m of mapBody.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)[,:]/gm)) {
  inMap.add(m[1]);
}

/*
 * Slice from the FACTORY START, not from line 0: the file header carries
 * imports, a `type` union of every node name, and helper functions, all of
 * which mention rule names without referencing the combinator.
 */
const facIdx = lines.findIndex(l => /^const cssFactory = /.test(l));

/*
 * Strip block comments and string literals too. `node('Quoted', ...)` and
 * `throw new TypeError('Quoted lost ...')` both contain the bare rule name and
 * neither is a combinator reference -- every self-named node() const would
 * otherwise score a spurious self-reference.
 */
const factory = lines.slice(facIdx, retIdx).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/'(?:[^'\\]|\\.)*'/g, '\'\'')
  .replace(/"(?:[^"\\]|\\.)*"/g, '\'\'');
const h1 = [];
const h2 = [];
for (const c of consts) {
  if (!c.composite) {
    continue;
  }

  /* bare-const references, excluding the declaration itself and g.X uses */
  const bare = [...factory.matchAll(new RegExp(`(?<!\\.)\\b${c.name}\\b`, 'g'))].length - 1;
  const viaG = [...factory.matchAll(new RegExp(`\\bg\\.${c.name}\\b`, 'g'))].length;
  if (bare <= 0) {
    continue;
  }
  if (inMap.has(c.name)) {
    h2.push({ name: c.name, bare, viaG });
  } else if (bare >= 2) {
    h1.push({ name: c.name, bare });
  }
}

console.log(`consts: ${consts.length}   composites: ${consts.filter(c => c.composite).length}   in rules map: ${inMap.size}\n`);
console.log(`H1 -- composite, NOT in map, referenced 2+ times (emitted once per reference): ${h1.length}`);
for (const r of h1.sort((a, b) => b.bare - a.bare).slice(0, 20)) {
  console.log(`   ${r.name.padEnd(34)} bare-refs=${r.bare}`);
}
console.log(`\nH2 -- in map AND referenced by bare const (emitted twice): ${h2.length}`);
for (const r of h2.sort((a, b) => b.bare - a.bare).slice(0, 25)) {
  console.log(`   ${r.name.padEnd(34)} bare-refs=${r.bare}  g-refs=${r.viaG}`);
}
