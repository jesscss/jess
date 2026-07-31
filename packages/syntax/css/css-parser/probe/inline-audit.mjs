/**
 * Mechanical audit for the by-const inlining defect.
 *
 * A composite rule referenced by const is inlined at every reference, and the
 * inlining is transitive, so each by-const reference copies the rule's whole
 * closure. A rule referenced through the `g` proxy is emitted once and called.
 *
 *   H1  a composite const referenced by bare name 2+ times
 *       -> that many transitive inline copies
 *   H2  a composite const referenced by bare name AND through `g`
 *       -> emitted twice: inlined at the const site and again as a named rule
 *
 * CONTAMINATION, and why this file reads the way it does. The first version of
 * this script counted identifiers over the RAW source. That over-counted three
 * ways, all of which inflate H1 and H2:
 *
 *   - `node('Declaration', ...)` — the rule's own name as a string literal,
 *     which made almost every node() rule reference itself;
 *   - the `GrammarRuleName` type union, which lists every rule name as a
 *     string literal;
 *   - the returned rules map, where a bare key IS the name.
 *
 * Candidate C hit the identical bug independently (109 H2 -> 4 H2 after fixing
 * it), which is what prompted this rewrite. Strings and comments are now blanked
 * before any identifier is counted, the scan is restricted to the factory body,
 * and map keys are excluded from the reference count rather than counted as
 * references.
 */
import { readFileSync } from 'node:fs';

/** Replaces string and comment bodies with spaces, preserving every offset. */
function blankStringsAndComments(source) {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, ' ');
      index = stop;
    } else if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - index);
      index = stop;
    } else if (ch === '\'' || ch === '"' || ch === '`') {
      let cursor = index + 1;
      while (cursor < source.length && source[cursor] !== ch) {
        cursor += source[cursor] === '\\' ? 2 : 1;
      }
      out += ' '.repeat(Math.min(cursor + 1, source.length) - index);
      index = cursor + 1;
    } else if (ch === '/' && /[=(,[:!&|?{;\n]\s*$/.test(out)) {
      /* A regex literal, not division: blank it so its body cannot match. */
      let cursor = index + 1;
      let inClass = false;
      while (cursor < source.length) {
        const c = source[cursor];
        if (c === '\\') {
          cursor += 2;
          continue;
        }
        if (c === '[') {
          inClass = true;
        } else if (c === ']') {
          inClass = false;
        } else if (c === '/' && !inClass) {
          break;
        } else if (c === '\n') {
          break;
        }
        cursor++;
      }
      out += ' '.repeat(Math.min(cursor + 1, source.length) - index);
      index = cursor + 1;
    } else {
      out += ch;
      index++;
    }
  }
  return out;
}

const COMPOSITE = 'node|choice|sequence|dispatch|transform|oneOrMore|many|optional|oneOrMoreSep|sepBy|token|not|peek|label|field';

const file = process.argv[2];
const raw = readFileSync(file, 'utf8');
const clean = blankStringsAndComments(raw);

/*
 * Restrict to the factory body. Everything before the first `const <Name> = ` at
 * factory indentation is imports and type declarations, which name every rule.
 */
const factoryStart = clean.search(new RegExp(`\\n {2}const [A-Za-z][A-Za-z0-9_]* = (?:${COMPOSITE})\\(`));
const body = factoryStart === -1 ? clean : clean.slice(factoryStart);

/* The LAST `return { ... };` in the factory is the rules map. */
const returnMatches = [...body.matchAll(/\n {2}return \{([\s\S]*?)\n {2}\};/g)];
const mapBlock = returnMatches.length > 0 ? returnMatches[returnMatches.length - 1][1] : '';
const mapKeys = new Set(
  [...mapBlock.matchAll(/(?:^|,)\s*([A-Za-z][A-Za-z0-9_]*)\s*(?::|,|$)/gm)].map(match => match[1])
);
const scan = mapBlock === '' ? body : body.slice(0, body.lastIndexOf(mapBlock));

const declared = new Set(
  [...body.matchAll(new RegExp(`\\bconst ([A-Za-z][A-Za-z0-9_]*) = (?:${COMPOSITE})\\(`, 'g'))]
    .map(match => match[1])
);

const viaProxy = new Set(
  [...scan.matchAll(/\b_?g\.([A-Za-z][A-Za-z0-9_]*)/g)].map(match => match[1])
);

let h1 = 0;
let h2 = 0;
const worst = [];

for (const name of declared) {
  /* Subtract the declaration itself; map keys are outside `scan` already. */
  const bare = [...scan.matchAll(new RegExp(`(?<![.\\w'"])${name}\\b`, 'g'))].length - 1;
  if (bare >= 2) {
    h1++;
    worst.push([name, bare, viaProxy.has(name)]);
  }
  if (bare >= 1 && viaProxy.has(name)) {
    h2++;
  }
}

worst.sort((a, b) => b[1] - a[1]);

console.log(file);
console.log('  composite consts declared             ', declared.size);
console.log('  keys in the returned rules map        ', mapKeys.size);
console.log('  H1  referenced by const 2+ times      ', h1, '<- that many transitive inline copies');
console.log('  H2  referenced by const AND via g.    ', h2, '<- emitted twice');
console.log('  top by-const reference counts:');
for (const [name, count, proxied] of worst.slice(0, 12)) {
  console.log('   ', String(count).padStart(3), name, proxied ? '(also via g.)' : '');
}
