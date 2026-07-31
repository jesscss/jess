/**
 * Static metrics: artifact bytes, source bytes, combinator count, regex share.
 *
 * ARTIFACT BYTES — ONE WAY, STATED
 * --------------------------------
 * Raw = `statSync(path).size` on the ESM file exactly as tsdown emits it. No
 * minification, no post-processing. Gzip = zlib level 9 over those same bytes.
 * Both are reported; RAW is the rank key. They have already moved in opposite
 * directions once this session (a lane cut raw 4.1% while gzip grew 2.9%), so
 * reporting only one is how a regression gets called a win.
 *
 * All FOUR emitted grammar artifacts are measured, not just `ast.js`:
 * `ast/positions.js` is 88 KB larger than `ast.js` and is an easy accidental
 * substitution. More importantly, all four compile from ONE hostMode source, so
 * a shape that shrinks `ast.js` while inflating the other three has moved bytes
 * rather than removed them, and the board has to be able to see that.
 *
 * REGEX SHARE — THE ANTI-GAMING METRIC
 * ------------------------------------
 * "Fewest combinators" is trivially gamed by collapsing structure into one
 * giant regex. That stops being a combinator grammar, defeats first-set gating,
 * and violates the standing rule that there is NO regex outside `regex()`.
 *
 * THE RULE: regexes may cover TERMINALS; STRUCTURE must remain combinators.
 *
 * So three numbers per entry: total regex source characters, the longest single
 * regex, and the count of regexes that match across a STRUCTURAL BOUNDARY. The
 * third is the one that matters and it is the one that needs a definition,
 * given below.
 *
 * Counting is done on the SOURCE via a real parse (`extractRegexLiterals`),
 * never on the built artifact: `parseman` is imported `with { type: 'macro' }`,
 * so every `regex()` call is lowered at compile time and no regex literal
 * survives into `lib/`. A source scan is the only place these exist.
 */
import { statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname, join } from 'node:path';

/** The four emitted ESM grammar artifacts, in board order. `ast.js` ranks. */
export const ARTIFACTS = Object.freeze([
  'lib/grammar/ast.js',
  'lib/grammar/cst.js',
  'lib/grammar/ast/positions.js',
  'lib/grammar/cst/positions.js'
]);

export const RANK_ARTIFACT = 'lib/grammar/ast.js';

export function artifactBytes(pkgDir) {
  const out = {};
  let totalRaw = 0;
  let totalGzip = 0;
  for (const rel of ARTIFACTS) {
    const p = resolve(pkgDir, rel);
    let raw = null;
    let gzip = null;
    try {
      const buf = readFileSync(p);
      raw = buf.length;
      gzip = gzipSync(buf, { level: 9 }).length;
      totalRaw += raw;
      totalGzip += gzip;
    } catch {
      // Reported as null, never as zero: a missing artifact must not look like a win.
    }
    out[rel] = { raw, gzip };
  }
  return { perArtifact: out, totalRaw, totalGzip, rank: out[RANK_ARTIFACT] };
}

/**
 * Resolve the transitive first-party import closure of an entry source file.
 *
 * This is what "source bytes" means, and the boundary is deliberate: without
 * it, a candidate shrinks `grammar.ts` by pushing terminals into
 * `parser-shared` and scores a free win on a file nobody is measuring. The
 * closure follows relative imports and `@jesscss/*` workspace imports, and
 * stops at `node_modules` and at type-only imports.
 */
export function sourceClosure(entryFile, repo) {
  const seen = new Set();
  const files = [];

  const visit = file => {
    const abs = resolve(file);
    if (seen.has(abs)) {
      return;
    }
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      return;
    }
    seen.add(abs);
    files.push({ path: abs, bytes: Buffer.byteLength(text, 'utf8'), text });

    /*
     * `import type` / `export type` are erased and cost nothing at runtime or
     * in the artifact, so they are not part of the measured source.
     */
    const importRe = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRe.exec(text)) !== null) {
      const spec = m[1];
      if (spec === 'parseman' || spec.startsWith('parseman/') || spec.startsWith('node:')) {
        continue;
      }
      if (spec.startsWith('.')) {
        const base = join(dirname(abs), spec).replace(/\.js$/, '');
        for (const ext of ['.ts', '.mts', '.tsx', '/index.ts', '.js']) {
          try {
            statSync(base + ext);
            visit(base + ext);
            break;
          } catch { /* try next extension */ }
        }
        continue;
      }
      if (spec.startsWith('@jesscss/')) {
        const pkg = spec.split('/').slice(0, 2).join('/');
        const local = WORKSPACE_SRC[pkg];
        if (local === undefined) {
          continue;
        }
        const sub = spec.split('/').slice(2).join('/');
        const target = resolve(repo, local, sub === '' ? 'index.ts' : `${sub}.ts`);
        try {
          statSync(target);
          visit(target);
        } catch { /* not a source file we own */ }
      }
    }
  };

  visit(entryFile);
  return { files, totalBytes: files.reduce((a, f) => a + f.bytes, 0) };
}

/** Workspace packages whose `src/` counts toward a candidate's source bytes. */
const WORKSPACE_SRC = Object.freeze({
  '@jesscss/parser-shared': 'packages/parser-shared/src'
});

/**
 * The parseman combinator vocabulary. Counting these is the owner's stated
 * objective ("source bytes / combinator count"), so the list is explicit and
 * versioned here rather than inferred, and the board states it.
 */
export const COMBINATORS = Object.freeze([
  'balanced', 'choice', 'classifiedTrivia', 'composeLeaf', 'dispatch', 'endsWith', 'expect', 'field',
  'keywords', 'literal', 'makeWhen', 'makeWord', 'many', 'noTrivia', 'node', 'not', 'oneOrMore',
  'oneOrMoreSep', 'optional', 'otherwise', 'parser', 'peek', 'regex', 'routed', 'rules', 'scanTo',
  'sepBy', 'sequence', 'token', 'transform', 'when', 'word'
]);

/**
 * Count combinator CALL SITES across a source closure.
 *
 * Call sites, not imports and not consts: the artifact cost tracks how many
 * times a construct is instantiated. A word boundary plus a following `(` is
 * required so that a mention in a comment or a type position is not counted.
 */
export function combinatorCounts(closure) {
  const counts = {};
  for (const name of COMBINATORS) {
    counts[name] = 0;
  }
  let total = 0;
  for (const f of closure.files) {
    const stripped = stripCommentsAndStrings(f.text);
    for (const name of COMBINATORS) {
      const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
      const n = (stripped.match(re) ?? []).length;
      counts[name] += n;
      total += n;
    }
  }
  return { counts, total };
}

/**
 * Remove comments and string/template literals before counting.
 *
 * Without this, a combinator named in a doc comment — and these files are
 * heavily commented by house style — inflates the count, and a candidate could
 * lower its score by deleting documentation. That would be a perverse
 * incentive on a project whose review standard requires the comments.
 *
 * Regex literals are preserved, because `extractRegexLiterals` runs on the
 * same stripped text and needs them.
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? n : end;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      out += quote;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          break;
        }
        i++;
      }
      i++;
      out += quote;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Extract every `regex(...)` literal from a source closure.
 *
 * Scans for the `regex(` call site and then reads a REGEX LITERAL by walking
 * character classes, because a naive `\/.*\//` breaks on the very patterns
 * this grammar uses — `regex(/\/\*(?:[^*]|\*(?!\/))*\*\//)` (the block-comment
 * terminal) contains three escaped slashes and a `/` inside no class at all.
 * String-form `regex('...')` is picked up too.
 */
export function extractRegexLiterals(closure) {
  const found = [];
  for (const f of closure.files) {
    const src = stripCommentsAndStrings(f.text);
    const re = /\bregex\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      let i = m.index + m[0].length;
      while (i < src.length && /\s/.test(src[i])) {
        i++;
      }
      if (src[i] !== '/') {
        continue;
      }
      const start = ++i;
      let inClass = false;
      while (i < src.length) {
        const c = src[i];
        if (c === '\\') {
          i += 2;
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
        i++;
      }
      if (src[i] !== '/') {
        continue;
      }
      const source = src.slice(start, i);
      let flags = '';
      let j = i + 1;
      while (j < src.length && /[a-z]/.test(src[j])) {
        flags += src[j];
        j++;
      }
      found.push({ file: f.path, source, flags, chars: source.length });
    }
  }
  return found;
}

/**
 * Classify a regex as terminal-covering or structure-covering.
 *
 * THE DEFINITION, stated so it can be argued with rather than trusted:
 *
 * A regex covers only a TERMINAL if it matches one lexical token — an
 * identifier, a number, a string, a comment, one punctuator, one keyword. It
 * covers STRUCTURE if a single match can span a construct that the grammar
 * would otherwise have to compose: i.e. it can consume a nesting delimiter, or
 * it can match an unbounded sequence of what are separately grammar-visible
 * items.
 *
 * Three signals, each of which alone is sufficient:
 *
 *  1. It can match a BLOCK/GROUP DELIMITER (`{ } ( ) ; ,`) outside a negated
 *     character class. Consuming a brace or a semicolon in a terminal is how a
 *     whole rule body disappears into one token.
 *  2. It contains an unbounded quantifier (`* + {n,}`) applied to a group
 *     containing alternation — the signature of "match a sequence of things"
 *     rather than "match one thing".
 *  3. Its source exceeds LONG_REGEX_CHARS. A length threshold is crude, but a
 *     200-character terminal is not a terminal, and the number is reported
 *     rather than silently applied.
 *
 * The block-comment and string terminals legitimately trip signal 2, so they
 * are allow-listed BY SOURCE and the allowance is visible on the board. An
 * allow-list that is not printed is a loophole.
 */
export const LONG_REGEX_CHARS = 120;

const TERMINAL_ALLOWLIST = Object.freeze([
  String.raw`\/\*(?:[^*]|\*(?!\/))*\*\/`,
  String.raw`"(?:[^"\\]|\\.)*"`,
  String.raw`'(?:[^'\\]|\\.)*'`
]);

export function classifyRegexes(literals) {
  let totalChars = 0;
  let longest = { chars: 0, source: '' };
  const spanning = [];

  for (const lit of literals) {
    totalChars += lit.chars;
    if (lit.chars > longest.chars) {
      longest = lit;
    }
    if (TERMINAL_ALLOWLIST.includes(lit.source)) {
      continue;
    }

    const reasons = [];
    if (matchesDelimiterOutsideNegatedClass(lit.source)) {
      reasons.push('can consume a block/group delimiter');
    }
    if (/\([^)]*\|[^)]*\)\s*(?:[*+]|\{\d+,\})/.test(lit.source)) {
      reasons.push('unbounded quantifier over an alternation');
    }
    if (lit.chars > LONG_REGEX_CHARS) {
      reasons.push(`source exceeds ${LONG_REGEX_CHARS} chars`);
    }
    if (reasons.length > 0) {
      spanning.push({ ...lit, reasons });
    }
  }

  return { count: literals.length, totalChars, longest, spanning, spanningCount: spanning.length };
}

/**
 * True when the pattern can match a structural delimiter.
 *
 * Negated classes are skipped: `[^{}]` EXCLUDES braces, so finding `{` inside
 * one and calling it structure-spanning would flag every well-behaved
 * "anything but a brace" terminal in the grammar — the exact opposite of the
 * intent. Positive classes and bare escaped delimiters do count.
 */
function matchesDelimiterOutsideNegatedClass(source) {
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      if ('{}();,'.includes(source[i + 1])) {
        return true;
      }
      i += 2;
      continue;
    }
    if (c === '[') {
      const negated = source[i + 1] === '^';
      let j = i + 1;
      let body = '';
      while (j < source.length && source[j] !== ']') {
        if (source[j] === '\\') {
          body += source[j + 1];
          j += 2;
          continue;
        }
        body += source[j];
        j++;
      }
      if (!negated && /[{}();,]/.test(body)) {
        return true;
      }
      i = j + 1;
      continue;
    }
    if (';,'.includes(c)) {
      return true;
    }
    i++;
  }
  return false;
}
