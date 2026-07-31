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

/**
 * Blanks TYPE positions, preserving offsets. Filter 5 of
 * `docs/state/GRAMMAR-SIZE-FACTS.md` §1.
 *
 * A rule name that collides with an imported AST type name matches inside
 * `Combinator<Interpolation>`, `(children): MixinGuard =>`, and
 * `value as SelectorBranch`. **css does not expose this** — its rule names do
 * not collide with its imported type names — so a probe validated only on css
 * reads clean and mis-ranks every dialect grammar. less collides on
 * `Interpolation`, `MixinGuard`, `SelectorBranch`, `Declaration`, `Stylesheet`,
 * and `Url`.
 */
function blankTypePositions(source) {
  return source

    /* Generic argument lists: `Combinator<Interpolation>`, `node<Quoted>(`. */
    .replace(/(?<=[A-Za-z0-9_>])<[^<>()\n]*>/g, match => ' '.repeat(match.length))

    /*
     * `as Type` assertions and `is Type` predicates, including unions.
     * The predicate form is how **css** exposes this class — `(value): value is
     * Declaration | AtRuleBlock =>` at grammar.ts:3372 and :3654 made css
     * `Declaration` read as an H2 site when it has zero by-const combinator
     * references. Candidate B caught it; the earlier claim in this file that
     * css does not collide was wrong, it collides through predicates rather
     * than through generics.
     */
    .replace(
      /\b(?:as|is)\s+[A-Za-z][A-Za-z0-9_.]*(?:\s*\|\s*[A-Za-z][A-Za-z0-9_.]*)*/g,
      match => ' '.repeat(match.length)
    )

    /*
     * Annotations: `: Type` before `=>`, `=`, `,`, `)`, `;`, or end of line.
     * The type may carry an array suffix or an INDEXED ACCESS —
     * `const interpolationParts: Interpolation['parts'] = []` at
     * less-parser/src/grammar.ts:1165 was the last false positive in this
     * script, and it survived because `[` was not in the lookahead set.
     */
    .replace(
      /:\s*(?:readonly\s+)?[A-Za-z][A-Za-z0-9_.]*(?:\[[^\]\n]*\])*(?=\s*(?:=>|=[^=]|[,);]|$))/gm,
      match => ' '.repeat(match.length)
    );
}

/*
 * Every combinator that can bind a composite const. The first version of this
 * list omitted `otherwise`, `when`, `routed`, `noTrivia` and the scanners, so
 * `const x = otherwise(choice(...))` was INVISIBLE to H1 — and this grammar is
 * dispatch-heavy, so `otherwise(...)` is exactly the shape it uses for routed
 * fallbacks. A too-narrow filter reports H1 0 and looks like a clean grammar,
 * which is the same flattering-silence failure as every other instrument bug
 * this session. Candidate B found it in his own copy while reconciling with C.
 */
const COMPOSITE = [
  'node', 'choice', 'sequence', 'dispatch', 'transform', 'oneOrMore', 'many',
  'optional', 'oneOrMoreSep', 'sepBy', 'token', 'not', 'peek', 'label', 'field',
  'otherwise', 'when', 'routed', 'noTrivia', 'attempt', 'expect', 'balanced',
  'scanTo', 'gate', 'leaf', 'parser', 'skip', 'trivia', 'literal', 'regex',
  'keywords', 'word', 'ref'
].join('|');

/*
 * SCSS and Jess declare rules as `node<Quoted>(…)`. A pattern demanding
 * `node(` matches ZERO of them — 158 in scss and 170 in jess — so those
 * grammars read as clean while carrying the repo's largest H2 counts.
 * Candidate B caught this with a consistency invariant (a grammar cannot
 * export more rules than it declares), which is cheaper than a reviewer and is
 * why `assertUsable()` below exists.
 */
const COMPOSITE_DECL = `\\bconst ([A-Za-z][A-Za-z0-9_]*) = (?:${COMPOSITE})\\s*(?:<[^<>]*>)?\\(`;

const file = process.argv[2];
const raw = readFileSync(file, 'utf8');
const clean = blankTypePositions(blankStringsAndComments(raw));

/*
 * Restrict to the factory body. Everything before the first `const <Name> = ` at
 * factory indentation is imports and type declarations, which name every rule.
 */
const factoryStart = clean.search(new RegExp(`\\n {2}${COMPOSITE_DECL}`));
const body = factoryStart === -1 ? clean : clean.slice(factoryStart);

/* The LAST `return { ... };` in the factory is the rules map. */
const returnMatches = [...body.matchAll(/\n {2}return \{([\s\S]*?)\n {2}\};/g)];
const mapBlock = returnMatches.length > 0 ? returnMatches[returnMatches.length - 1][1] : '';
const mapKeys = new Set(
  [...mapBlock.matchAll(/(?:^|,)\s*([A-Za-z][A-Za-z0-9_]*)\s*(?::|,|$)/gm)].map(match => match[1])
);
const scan = mapBlock === '' ? body : body.slice(0, body.lastIndexOf(mapBlock));

const declared = new Set(
  [...body.matchAll(new RegExp(COMPOSITE_DECL, 'g'))].map(match => match[1])
);

/*
 * Filter 6: a run that detects far fewer composites than the file has consts
 * is a BROKEN RUN, not a clean grammar. This is an error rather than a result
 * because the failure is silent and flattering — a probe tuned on css found 21
 * and 20 composites in scss and jess against 300+ actual, and reported them as
 * the cleanest grammars in the tree.
 */
function assertUsable() {
  const totalConsts = [...body.matchAll(/\n {2}const [A-Za-z]/g)].length;
  if (factoryStart === -1) {
    throw new Error(`${file}: factory-start detection failed; no composite const at factory indentation`);
  }
  if (declared.size * 4 < totalConsts) {
    throw new Error(
      `${file}: detected ${declared.size} composite consts against ${totalConsts} consts in the factory body. `
      + 'That ratio means the composite pattern is missing a declaration form (generics? a combinator not in '
      + 'COMPOSITE?), not that the grammar is clean. Refusing to report.'
    );
  }
  if (mapKeys.size > declared.size) {
    throw new Error(
      `${file}: ${mapKeys.size} rules-map keys against ${declared.size} composite consts. A grammar cannot `
      + 'export more rules than it declares. Refusing to report.'
    );
  }
}

assertUsable();

const viaProxy = new Set(
  [...scan.matchAll(/\b_?g\.([A-Za-z][A-Za-z0-9_]*)/g)].map(match => match[1])
);

let h1 = 0;
let h2 = 0;
const worst = [];
const h2sites = [];

for (const name of declared) {
  /* Subtract the declaration itself; map keys are outside `scan` already. */
  const bare = [...scan.matchAll(new RegExp(`(?<![.\\w'"])${name}\\b`, 'g'))].length - 1;
  if (bare >= 2) {
    h1++;
    worst.push([name, bare, viaProxy.has(name)]);
  }

  /*
   * H2 is membership of the returned rules MAP plus a by-const reference — the
   * rule is emitted once as a named rule and again inlined at the const site.
   * This previously tested `viaProxy`, i.e. "is referenced somewhere as g.X",
   * which is a DIFFERENT set: a rule can be exported in the map and never
   * referenced through the proxy at all. That is the case for eight of the ten
   * real css sites, including the whole `AtRulePrelude*` cluster (declared
   * 2658-2685, referenced by const 2695-2699, all in the map, none via g.),
   * so the wrong set under-reported H2 by 8. Candidate B supplied the line
   * numbers that exposed it.
   */
  if (bare >= 1 && mapKeys.has(name)) {
    h2++;
    h2sites.push([name, bare]);
  }
}

worst.sort((a, b) => b[1] - a[1]);

console.log(file);
console.log('  composite consts declared             ', declared.size);
console.log('  keys in the returned rules map        ', mapKeys.size);
console.log('  H1  referenced by const 2+ times      ', h1, '<- that many transitive inline copies');
console.log('  H2  in the rules map AND by const     ', h2, '<- emitted twice');
for (const [name, count] of h2sites) {
  console.log('        ', `${name}:${count}`);
}
console.log('  H1 top by-const reference counts:');
for (const [name, count, proxied] of worst.slice(0, 12)) {
  console.log('   ', String(count).padStart(3), name, proxied ? '(also via g.)' : '');
}
