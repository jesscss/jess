/**
 * REFERENCE-SHAPE AUDIT — the board column that stops raw bytes from ranking
 * an authoring accident.
 *
 * THE DEFECT
 * ----------
 * A composite rule referenced by BARE CONST is INLINED at every reference, and
 * the inlining is TRANSITIVE: inline `ValueList` into `Declaration` and you
 * also copy everything `ValueList` reaches. A rule referenced through the `g`
 * proxy is emitted ONCE and called.
 *
 * The worst case is a rule that is BOTH returned in the rules map AND
 * referenced by bare const: it is emitted twice, inlined at each site and again
 * as a named rule, and the map entry looks like it did something.
 *
 * WHY IT IS A GATE AND NOT JUST A METRIC
 * --------------------------------------
 * The price is set by the DEPTH OF THE CLOSURE under each inlined rule, not by
 * how many sites carry the defect. Measured at 1.046x on one candidate's
 * grammar and 13.69x on another's — a ~300x spread for the identical defect.
 * It is invisible to call-site counts. So three entries could differ by an
 * order of magnitude on `ast.js` while being identical grammar DESIGNS, and a
 * raw-byte ranking taken without this check ranks authoring luck.
 *
 * TWO CONTAMINATION BUGS, BOTH FOUND THE HARD WAY BY CANDIDATE C
 * --------------------------------------------------------------
 * C ran this audit, got 109 hazards, found two bugs in its own probe, and the
 * number dropped to 4. Both are corrected here by construction:
 *
 *   1. Scanning from line 0 counts the import list, the `GrammarRuleName`
 *      string-literal union (147 members!) and module-level helpers as
 *      "references". The scan MUST start at the factory body.
 *   2. Counting through string literals lets every `node('X', ...)` count as a
 *      reference to `X`, so every named node self-references. Strings must be
 *      stripped first.
 *
 * That is why this module does its own comment/string stripping and locates
 * the factory span rather than scanning the file.
 */
import { readFileSync } from 'node:fs';

/** Strip comments and string/template literals; preserve regex literals' bulk. */
function strip(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      /*
       * Preserve the NEWLINES inside the comment. Collapsing a block comment
       * to a couple of spaces destroys the line structure that every
       * subsequent anchor (`\n  const`, `\n  return {`) depends on — and since
       * this file's house style puts a long block comment immediately before
       * the factory's return, collapsing it silently hid the entire rules map
       * and reported `returnedRules: 0`.
       */
      for (let k = i; k < end; k++) {
        out += src[k] === '\n' ? '\n' : ' ';
      }
      i = end;
      continue;
    }
    if (c === '/' && d === '/') {
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e;
      continue;
    }
    /*
     * REGEX LITERALS MUST BE SKIPPED BEFORE STRINGS.
     *
     * This grammar's string terminal is `regex(/"(?:[^"\\]|\\.)*"/)`. Treating
     * the `"` inside it as a string opener swallows everything up to the next
     * `"` ANYWHERE LATER IN THE FILE — thousands of lines, including the
     * factory's entire return block. That is what made `returnedRules` come
     * back as 0 while the same regex found all 114 keys on unstripped text.
     *
     * A `/` is a regex opener only where a value may begin, which after the
     * comment cases above is exactly: start of input, or after `( , = : [ ! & |
     * ? { ; return`. Everywhere else it is division.
     */
    if (c === '/') {
      const prev = out.replace(/\s+$/, '').slice(-1);
      const opensValue = prev === '' || '(,=:[!&|?{;'.includes(prev);
      if (opensValue) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length) {
          const ch = src[j];
          if (ch === '\\') {
            j += 2;
            continue;
          }
          if (ch === '[') {
            inClass = true;
          } else if (ch === ']') {
            inClass = false;
          } else if (ch === '/' && !inClass) {
            break;
          } else if (ch === '\n') {
            break;
          }
          j++;
        }
        out += '/RE/';
        i = j + 1;
        continue;
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          break;
        }
        i++;
      }
      i++;
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Audit one grammar source.
 *
 * @param file the `src/grammar.ts` to audit
 * @param factoryName the `const <name> = (g: ...) => {` that opens the factory
 */
/**
 * Find the `rules()` factory a grammar file defines.
 *
 * A candidate grammar module is not obliged to name its factory `cssFactory`,
 * and a refshape audit that silently returns `{ ok: false }` on a name mismatch
 * would report "no reference-shape data" for a grammar that has plenty — an
 * absent column reads as clean, which is the failure mode this harness exists
 * to prevent.
 */
export function detectFactoryName(file) {
  const raw = readFileSync(file, 'utf8');
  const direct = /const\s+(\w+)\s*=\s*\([^)]*\)\s*(?::[^=]+)?=>\s*\{/.exec(raw);
  const named = /const\s+(\w*[Ff]actory)\b/.exec(raw);
  return named?.[1] ?? direct?.[1] ?? null;
}

export function auditReferenceShape(file, factoryName = 'cssFactory') {
  const raw = readFileSync(file, 'utf8');

  /*
   * Locate the FACTORY BODY. Everything before it — imports, the
   * `GrammarRuleName` union, module-level terminals and helpers — is not part
   * of the reference graph and counting it is contamination bug #1.
   */
  const open = raw.indexOf(`const ${factoryName}`);
  if (open < 0) {
    return { ok: false, reason: `no factory named ${factoryName} in ${file}` };
  }
  const body = strip(raw.slice(open));

  /*
   * A COMPOSITE is a const bound to a COMBINATOR EXPRESSION. Requiring that is
   * contamination bug #3, which neither prior audit caught: a bare
   * `\n\s+const X =` also matches every reducer-local variable, and reducers
   * are full of them. My first run of this ranked `values` (16), `name` (12),
   * `args` (7) and `opener` (2) as the most-inlined "rules" in the grammar.
   * They are local variables inside reducer bodies and cost nothing.
   */
  /*
   * `\s*(?:<[^>]*>)?\s*\(` — the OPTIONAL GENERIC ARGUMENT is load-bearing.
   *
   * SCSS and Jess author rules as `node<Quoted>(...)`. A pattern demanding
   * `node(` matches ZERO of them, so those grammars report almost no
   * composites and score CLEAN while being the worst in the tree. Candidate B
   * measured the fix moving scss H2 from 0 to 15/32 and jess H2 from 0 to
   * 28/51 — the generics bug was hiding the two largest double-emission counts
   * in the repo behind a plausible zero.
   *
   * css and less do not use the generic form, so this does not change the css
   * numbers. It is here because the column is mandatory for every entry, and
   * the moment an entry writes `node<T>(...)` its composites would vanish.
   */
  const COMBINATOR_HEAD = /^(?:node|choice|sequence|many|optional|oneOrMore|oneOrMoreSep|sepBy|literal|regex|keywords|word|token|noTrivia|parser|peek|not|expect|dispatch|routed|balanced|scanTo|endsWith|field|transform|classifiedTrivia|when|otherwise)\s*(?:<[^>()]*>)?\s*\(/;

  /*
   * FACTORY ALIASES ARE NOT COMBINATORS — a NAMED EXCLUSION, deliberately kept
   * as a short deny-list rather than by pruning the include-list above.
   *
   * `makeWhen(...)` and `makeWord(...)` return a FACTORY: a matcher policy,
   * applied per call site. They do not lower to a parse table, so "inlined
   * transitively at each reference" does not describe their cost and the H1
   * number does not mean what it means for every other row. Counting
   * `cssCase` (:1045, `makeWhen({ caseInsensitive: true })`, 27 call sites) as
   * the most-inlined rule in the css grammar was this file's largest single
   * error, and `identWord` (:1041) the same. GRAMMAR-REBUILD-SPEC §0.2
   * explicitly blesses this authoring form inside a `rules()` factory.
   *
   * The shape matters, and it is Candidate B's generalisation from the
   * reconciliation: this audit and B's failed in OPPOSITE directions on one
   * axis — an inclusive detector over-counts on factory aliases, an enumerated
   * one under-counts on combinators nobody remembered to list (B's list was
   * missing `otherwise`, which dropped a real site). A permissive include plus
   * a SHORT NAMED EXCLUDE is the more robust composition, because a forgotten
   * exclusion is visible in a five-line list while a forgotten inclusion is
   * invisible in a forty-name one.
   */
  const FACTORY_HEAD = /^(?:makeWhen|makeWord)\s*\(/;

  const declared = new Map();
  /*
   * The initialiser is read with `slice`, NOT captured, and the pattern ends at
   * `=\s*`. That is load-bearing: a capturing `([\s\S]{0,40})` would CONSUME 40
   * characters past the `=`, advancing `lastIndex` beyond the start of the next
   * declaration, and `matchAll`/`exec` would silently skip it. Candidate B
   * measured exactly that — its `urlOpen` row was eaten by the preceding
   * `importAtKeyword` declaration's 40-character capture, and every component
   * check (classifier, declaration regex, reference count) passed while the row
   * simply never appeared. This is filter 9.
   */
  const declRe = /\n(\s{2,})const\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m;
  let seen = 0;
  while ((m = declRe.exec(body)) !== null) {
    seen++;
    const rhs = body.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (!COMBINATOR_HEAD.test(rhs) || FACTORY_HEAD.test(rhs)) {
      continue;
    }
    declared.set(m[2], m.index);
  }

  /*
   * B's detection for the class above, made permanent: assert the number of
   * declarations the scanner VISITED against an independent count of the same
   * declarations. A skipped row is invisible in every per-row check and shows
   * up only as a discrepancy here.
   */
  const independent = (body.match(/\n {2,}const [A-Za-z_$][\w$]*\s*=/g) ?? []).length;
  if (seen !== independent) {
    return {
      ok: false,
      reason: `declaration scan visited ${seen} consts but an independent count found ${independent} — `
        + 'the scanner is skipping declarations (a consuming initialiser capture advances lastIndex past '
        + 'the next one). These numbers are wrong; do not rank on them.'
    };
  }

  /*
   * The returned rules map. Matching `return {` is not enough — the factory's
   * return is indented and there are `return` statements inside reducers. Take
   * the LAST one and require it to be the factory-level return, then read its
   * shorthand keys.
   */
  const returned = new Set();
  const retIdx = body.lastIndexOf('\n  return {');
  if (retIdx >= 0) {
    const tail = body.slice(retIdx);
    const keyRe = /\n\s+([A-Za-z_$][\w$]*)\s*(?:,|:\s*[A-Za-z_$][\w$]*\s*,)/g;
    let k;
    while ((k = keyRe.exec(tail)) !== null) {
      returned.add(k[1]);
    }
  }

  /*
   * FILTER 5 — TYPE POSITIONS. A name in a TYPE position is erased at compile
   * time and costs nothing; counting it as a reference is a false positive.
   *
   * This is not optional and it is not independent of the generics fix above.
   * Candidate A isolated that by toggling this filter alone: scss H2 reads 1
   * with it and 14 without; jess reads 0 with and 25 without. The mechanism is
   * that scss and jess write `node<Declaration>(...)`, so THE GENERIC ARGUMENT
   * IS THE SAME IDENTIFIER AS THE RULE NAME — accepting `node<T>(` without
   * blanking type positions converts a silent zero into a confident wrong
   * number, and only in the grammars that use generics, so the artifact
   * masquerades as a real dialect finding. That is exactly how "the two
   * largest double-emission counts in the repo" were produced out of nothing.
   *
   * CSS EXPOSES IT TOO, via type predicates rather than generics — B's catch,
   * which I verified at grammar.ts:3372 and :3654, both
   * `(value): value is Declaration | AtRuleBlock =>`. Those two are the ONLY
   * non-comment, non-string bare occurrences of `Declaration` in the css
   * factory, so `Declaration` is NOT an H2 site and my reporting it as one was
   * a false positive.
   */
  const typed = body
    // Generic argument lists: `node<Declaration>(`, `Combinator<Declaration>`.
    .replace(/<[^<>()\n]{1,120}>/g, '<>')
    // Type predicates: `value is Declaration | AtRuleBlock`.
    .replace(/\bis\s+[A-Za-z_$][\w$]*(?:\s*\|\s*[A-Za-z_$][\w$]*)*/g, 'is _')
    // Casts: `as Declaration`.
    .replace(/\bas\s+[A-Za-z_$][\w$]*(?:\s*\|\s*[A-Za-z_$][\w$]*)*/g, 'as _');

  const rows = [];
  for (const [name, at] of declared) {
    /*
     * Count bare occurrences, then subtract the two that are not references:
     * the declaration itself, and the rules-map key.
     *
     * The declaration is subtracted EXACTLY ONCE. The previous version both
     * skipped it inside the loop AND subtracted one afterwards, so every
     * single-reference site computed as zero — which is why the five-member
     * `AtRulePreludeSegments` cluster (grammar.ts:2690-2700, five consecutive
     * by-const references at 2695-2699, all five also in the map) reported as
     * clean. Double-subtracting is invisible on multi-reference sites and
     * total on single-reference ones, which is the worst possible shape for a
     * counting bug.
     */
    const bareRe = new RegExp(`(?<!\\.)\\b${name}\\b`, 'g');
    const bare = (typed.match(bareRe) ?? []).length;
    const byName = (body.match(new RegExp(`\\bg\\.${name}\\b`, 'g')) ?? []).length;
    const inMap = returned.has(name);

    const bareRefs = Math.max(0, bare - 1 - (inMap ? 1 : 0));

    /*
     * TWO CLASSES, NEVER SUMMED — they have different costs and different fixes.
     *
     *   H1  inline multiplicity: NOT in the map, referenced by const 2+ times.
     *       Each reference re-inlines the whole transitive closure.
     *   H2  double emission: IN the map AND referenced by const at least ONCE.
     *       Emitted twice — inlined at the site and again as a named rule.
     *
     * The `>= 1` on H2 is the fix for a real bug in this file's first version:
     * it gated BOTH classes behind `bareRefs >= 2`, which silently dropped
     * every H2 site having exactly one by-const reference. That is why it
     * reported H2 = 1 where a hand-verified count found 11, and B's list —
     * `AtRulePreludeWhitespace` (decl 2658, map 3980, by-const 2695) and
     * `QueryBareFeature` (decl 2838, map 3995, by-const 2932) — are precisely
     * the single-reference cases the old threshold hid. B found them by having
     * missed them first and correcting upward.
     */
    const h1 = !inMap && bareRefs >= 2;
    const h2 = inMap && bareRefs >= 1;
    if (h1 || h2) {
      rows.push({ name, bareRefs, byNameRefs: byName, inMap, h1, h2 });
    }
  }

  rows.sort((a, b) => b.bareRefs - a.bareRefs);

  const h1Rows = rows.filter(r => r.h1);
  const h2Rows = rows.filter(r => r.h2);

  /*
   * IMPOSSIBILITY INVARIANT — a grammar cannot export more rules than it
   * declares. B caught the generics bug with exactly this check ("scss reports
   * 38 composites against 143 map keys"), and it is the first self-deception
   * this session caught by the code rather than by a rival reading the work.
   * Cross-review does not scale; a free impossibility check does.
   */
  const impossible = returned.size > declared.size
    ? `composite consts (${declared.size}) < rules-map keys (${returned.size}) — impossible. `
      + 'The const detector is missing declarations (a combinator spelling, or a generic '
      + 'type argument like node<T>(...)). These numbers are wrong; do not rank on them.'
    : null;

  return {
    ok: impossible === null,
    impossible,
    declaredComposites: declared.size,
    returnedRules: returned.size,
    h1: h1Rows.length,
    h1Copies: h1Rows.reduce((a, r) => a + r.bareRefs, 0),
    h2: h2Rows.length,
    h2Copies: h2Rows.reduce((a, r) => a + r.bareRefs, 0),
    // Retained for the board's single-column summary; never a sum of H1 and H2.
    defective: h1Rows.length,
    emittedTwice: h2Rows.length,
    rows
  };
}
