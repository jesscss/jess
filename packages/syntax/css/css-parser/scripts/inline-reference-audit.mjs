/**
 * Grammar inline-reference audit.
 *
 * Reports how each composite production in a `rules(...)` factory is
 * REFERENCED, because reference shape — not rule count and not combinator
 * call-site count — is what decides how many times codegen emits a rule's
 * closure into the compiled artifact.
 *
 * Two findings, deliberately kept apart because they have different costs and
 * different fixes:
 *
 *   H1  inline multiplicity — a composite const NOT in the returned rules map,
 *       referenced by const 2+ times. Each reference inlines the const's whole
 *       transitive closure again. This is where artifact bytes are: measured at
 *       -7.4% for five references to two trivial closures, and the heaviest
 *       in-tree case (`declarationListBlock`, 7 references) drags the entire
 *       declaration / at-rule / ruleset body each time.
 *       Fix: add it to the rules map and reference it as `g.<name>`.
 *
 *   H2  double emission — a composite const that IS in the returned map but is
 *       still referenced by const. It is emitted twice: inlined at the call
 *       site and again as a named rule. Small in practice, and it looks like it
 *       already works, which is why it survives review.
 *       Fix: change the call site to `g.<name>`.
 *
 * WHY THIS SCRIPT EXISTS. Three grammar lanes independently wrote this audit in
 * one session and all three over-reported by roughly an order of magnitude, in
 * the same direction: 86, 109, and 65, the last topped by `values` and `value`,
 * which are reducer parameter names. Four things are required to get a true
 * number, and omitting any one of them reproduces the failure:
 *
 *   1. restrict to the factory BODY — a rule name also appears as a type
 *      import, a union string literal, a type-guard function name and a return
 *      type annotation, all outside the factory;
 *   2. neutralise comments, string literals and regex literals — rule names are
 *      discussed in prose and appear as `node('Name', ...)` tags;
 *   3. use a `(?<![\w.])` lookbehind so a correct `g.Name` cannot match as a
 *      bare `Name`;
 *   4. filter consts to those whose INITIALIZER is a combinator call, so
 *      reducer locals, `makeWord`/`makeWhen` aliases and plain arrays drop out.
 *
 * Neutralising preserves character offsets rather than deleting, so reported
 * line numbers stay valid.
 *
 * Usage: node scripts/inline-reference-audit.mjs <grammar.ts> [...]
 */
import { readFileSync } from 'node:fs';

/*
 * The optional `<...>` is required, not cosmetic: SCSS and Jess author their
 * rules as `node<Quoted>(...)`, and a pattern demanding `node(` immediately
 * matches none of them. That silently reported 38 composite consts against 143
 * map rules — a grammar cannot have fewer productions than it exports, and that
 * impossibility is the check worth keeping.
 */
const COMBINATOR = /^(?:sequence|choice|many|oneOrMore|oneOrMoreSep|optional|literal|regex|node|field|token|noTrivia|keywords|word|peek|not|dispatch|sepBy|balanced|scanTo|expect|routed|classifiedTrivia)\s*(?:<[^;{}()]*>)?\s*\(/;

/**
 * Replaces comments, string literals and regex literals with spaces, keeping
 * length and newlines so every offset and line number stays valid.
 */
function neutralise(source) {
  const out = source.split('');
  const blank = (start, end) => {
    for (let i = start; i < end && i < out.length; i++) {
      if (out[i] !== '\n') {
        out[i] = ' ';
      }
    }
  };
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === '\'' || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        j += source[j] === '\\' ? 2 : 1;
      }
      blank(i, j + 1);
      i = j + 1;
      continue;
    }

    /*
     * Only regex literals in argument position are neutralised. That is the
     * only place they occur in these grammars, and it sidesteps the division
     * ambiguity entirely rather than guessing at it.
     */
    if (ch === '/' && /[(,[=:]\s*$/.test(source.slice(Math.max(0, i - 40), i))) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
          j += 2;
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
        j++;
      }
      blank(i, j + 1);
      i = j + 1;
      continue;
    }
    i++;
  }

  /*
   * TYPE POSITIONS. A rule name that collides with an imported AST type name
   * also appears where no value is referenced. SCSS and Jess make this acute:
   * they write `const Declaration = node<Declaration>(...)`, where the generic
   * ARGUMENT is the same identifier as the rule. Counting bare occurrences and
   * subtracting one for the declaration then leaves the generic argument
   * looking like a real by-const reference.
   *
   * This is not independent of allowing generics in the combinator pattern.
   * Allowing `node<T>(` WITHOUT blanking type positions is worse than allowing
   * neither: it turns a silent zero into a confident wrong number, and it does
   * so only in the grammars that use generics, which makes the resulting
   * "finding" look like a real dialect difference.
   */
  let text = out.join('');
  const blankRange = (source, pattern, group) => source.replace(pattern, (match, captured, offset) => {
    const start = group ? match.indexOf(captured) : 0;
    const head = match.slice(0, start);
    const target = group ? captured : match;
    return head + target.replace(/[^\n]/g, ' ') + match.slice(start + target.length);
  });
  text = blankRange(text, /(?<=[A-Za-z0-9_])(<[^<>;{}()\n]*>)/g, true);
  text = blankRange(text, /\b(?:as|is)\s+([A-Z][A-Za-z0-9]*)/g, true);
  text = blankRange(text, /\)\s*:\s*([A-Z][A-Za-z0-9]*)/g, true);
  return text;
}

/** Locates the factory body and its returned rules map. */
function locateFactory(clean) {
  const factory = /const\s+\w*[Ff]actory\s*=\s*\(/.exec(clean);
  if (!factory) {
    return null;
  }

  /*
   * The LAST such return, not the first. A factory may contain nested helper
   * closures that return object literals at the same indentation; taking the
   * first truncates the body and silently under-reports. The tell is a grammar
   * whose composite-const count falls below its rules-map size.
   */
  const returnStart = clean.lastIndexOf('\n  return {\n');
  if (returnStart === -1 || returnStart < factory.index) {
    return null;
  }
  const returnEnd = clean.indexOf('\n  };', returnStart);
  return {
    body: clean.slice(factory.index, returnStart),
    bodyOffset: factory.index,
    map: clean.slice(returnStart, returnEnd === -1 ? clean.length : returnEnd)
  };
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

function audit(path) {
  const source = readFileSync(path, 'utf8');
  const clean = neutralise(source);
  const found = locateFactory(clean);
  if (!found) {
    return { path, error: 'no rules() factory with a `return {` map found' };
  }
  const { body, bodyOffset, map } = found;

  const mapKeys = new Set(
    [...map.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*(?:,|:)/gm)].map(match => match[1])
  );

  const h1 = [];
  const h2 = [];
  let composites = 0;

  for (const declaration of body.matchAll(/^ {2}const ([A-Za-z][A-Za-z0-9]*) = ([\s\S]{0,40})/gm)) {
    const name = declaration[1];
    if (!COMBINATOR.test(declaration[2].trimStart())) {
      continue;
    }
    composites++;
    const uses = [...body.matchAll(new RegExp(`(?<![\\w.])${name}(?![\\w])`, 'g'))];
    const references = uses.length - 1;
    if (references < 1) {
      continue;
    }
    const row = {
      name,
      references,
      line: lineOf(source, bodyOffset + declaration.index)
    };
    if (mapKeys.has(name)) {
      h2.push(row);
    } else if (references >= 2) {
      h1.push(row);
    }
  }

  h1.sort((a, b) => b.references - a.references);
  h2.sort((a, b) => b.references - a.references);
  return { path, composites, mapKeys: mapKeys.size, h1, h2 };
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node scripts/inline-reference-audit.mjs <grammar.ts> [...]');
  process.exit(2);
}

for (const path of paths) {
  const result = audit(path);
  console.log(`\n=== ${result.path}`);
  if (result.error) {
    console.log(`  ${result.error}`);
    continue;
  }
  const h1Copies = result.h1.reduce((total, row) => total + row.references, 0);
  const h2Copies = result.h2.reduce((total, row) => total + row.references, 0);
  console.log(`  composite consts ${result.composites}   rules in map ${result.mapKeys}`);
  console.log(`  H1 inline multiplicity  ${result.h1.length} consts / ${h1Copies} redundant inline copies`);
  console.log(`  H2 double emission      ${result.h2.length} consts / ${h2Copies} redundant references`);
  if (result.h1.length > 0) {
    console.log('  H1:', result.h1.map(row => `${row.name}:${row.references}@${row.line}`).join(' '));
  }
  if (result.h2.length > 0) {
    console.log('  H2:', result.h2.map(row => `${row.name}:${row.references}@${row.line}`).join(' '));
  }
}
