/**
 * The tree-identity oracle. THIS IS THE PASS/FAIL GATE. Nothing overrides it.
 *
 * WHY EXISTING SUITES ARE NOT ENOUGH
 * ----------------------------------
 * A `'@' | 32` typo (a backtick where a pipe belonged) made every `@`-led
 * dispatch key fall through, so `@font-face` parsed as `OpaqueAtRuleBlock`.
 * 288 css tests stayed green. Assertions check what someone thought to assert;
 * a full structural diff over a real corpus checks everything the corpus
 * reaches. That is the class of bug this exists to catch, and it is why a
 * green suite is necessary but never sufficient here.
 *
 * WHAT IS COMPARED
 * ----------------
 * All THREE shipping surfaces, because all three ship and all three compile
 * from one hostMode grammar source:
 *
 *   ast  `parse(src)`         — the compile path
 *   cst  `parseCssCst(src)`   — what the language service consumes
 *   doc  `parseCssDoc(src)`   — the incremental/editable surface
 *
 * Gating only `ast` would leave the language service's entire surface
 * unchecked, and `cst` is the surface that materialises `grammarType` — i.e.
 * the one that actually pins the production set. A candidate could rewrite the
 * production structure wholesale and leave `ast` byte-identical.
 *
 * A THROWN ERROR IS A RESULT, NOT AN ABSENCE
 * ------------------------------------------
 * "The grammar rejected this input" is observable behaviour and must match. It
 * is hashed like any other outcome. What is NOT hashed is the harness failing
 * to compute a digest — that is a different fact, reported on its own channel,
 * and it yields NO VERDICT rather than a green or a red. A tool that reports
 * its own breakage in the vocabulary of a grammar regression does not degrade,
 * it lies.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, firstDivergence, describe, assertInjective } from './canonical.mjs';
import { isMalformed } from './corpus.mjs';

/** Load the three shipping surfaces from ONE built `lib/` directory. */
export async function loadSurfaces(libDir) {
  const index = await import(`${libDir}/index.js`);
  const cst = await import(`${libDir}/cst.js`);
  return [
    { name: 'ast', parse: src => index.parse(src) },
    { name: 'cst', parse: src => cst.parseCssCst(src) },
    { name: 'doc', parse: src => cst.parseCssDoc(src) }
  ].filter(s => s.parse !== undefined);
}

/**
 * Get the package's own `parseWith` out of a BUILT `lib/`.
 *
 * There is no `lib/parse-with.js`. Only `lib/parse-with.d.ts` exists — a
 * types-only near-miss that makes the directory listing look right — and the
 * implementation lives in a rolldown chunk whose exports are MANGLED to single
 * letters (`n`, `t`). Importing the chunk and guessing a name yields
 * `undefined`, which fails as "parseWith is not a function" or, worse, silently
 * if anything optional-chains it. Candidate B measured this.
 *
 * So the alias is resolved from `lib/index.js`'s own import statement, which is
 * the authority on which mangled binding is which:
 *
 *     import { n as CssParseError, t as parseWith } from "./chunks/parse-with.js";
 *
 * This needs NO build change, so it works against a candidate's existing `lib/`.
 * It also cannot degrade quietly: every failure path throws with the reason,
 * and the result is type-checked before it is returned.
 */
async function resolveParseWith(libDir) {
  try {
    const direct = await import(`${libDir}/parse-with.js`);
    if (typeof direct.parseWith === 'function') {
      return direct.parseWith;
    }
  } catch { /* expected today: the module is not emitted */ }

  const indexSrc = readFileSync(`${libDir}/index.js`, 'utf8');
  for (const m of indexSrc.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const alias = /(\w+)\s+as\s+parseWith/.exec(m[1]);
    if (alias === null) {
      continue;
    }
    const chunk = await import(`${libDir}/${m[2].replace(/^\.\//, '')}`);
    const fn = chunk[alias[1]];
    if (typeof fn !== 'function') {
      throw new Error(`lib/index.js aliases '${alias[1]}' as parseWith, but ${m[2]} exports no such function (exports: ${Object.keys(chunk).join(', ')})`);
    }
    return fn;
  }
  throw new Error('cannot resolve parseWith: no lib/parse-with.js, and lib/index.js has no `… as parseWith` import');
}

/**
 * Build the three surfaces from a BARE GRAMMAR MODULE rather than the
 * package's public entry, so a candidate never has to wire its grammar in as
 * an export of the shipping package (owner ruling). The wiring the package
 * itself does is thin — `parse` is `parseWith(cssGrammar, input)`, the CST
 * entries are `parseCst`/`parseDocCst` over `cssCstGrammar` — so the module
 * only has to export those two compiled artifacts. Host, trivia policy and
 * error projection all come from the snapshot's own `lib/`, identical to the
 * baseline's.
 *
 * ONE BASE, ONE MEANING. `entryRel` is resolved against the PACKAGE ROOT, the
 * same base as `--grammar-module src/...`, and nothing strips a leading `lib/`.
 *
 * The previous version resolved the entry against `lib/` here while
 * `artifactBytes` resolved the same string against the package root. Both
 * accept `lib/grammar/ast.js`, which is worse than either failing: the two
 * agreed on the spelling everyone tested with and disagreed silently on every
 * other one, so `terminal-up.js` LOADED from `lib/` and was MEASURED at the
 * package root, where it does not exist. A candidate could be graded against a
 * path its author did not mean.
 */
export async function loadSurfacesFromModule(pkgDir, entryRel) {
  const entryAbs = resolve(pkgDir, entryRel);
  if (!existsSync(entryAbs)) {
    throw new Error(`grammar entry not found at ${entryAbs} (resolved from --grammar-entry '${entryRel}' against the package root; paths are package-root-relative, so use 'lib/…' not a bare filename)`);
  }
  const libDir = resolve(pkgDir, 'lib');
  const mod = await import(pathToFileURL(entryAbs).href);
  const parseWith = await resolveParseWith(libDir);
  const host = await import(`${pathToFileURL(libDir).href}/cst-host.js`);

  const astGrammar = mod.cssGrammar ?? mod.astGrammar ?? mod.grammar;
  const cstGrammar = mod.cssCstGrammar ?? mod.cstGrammar;
  if (astGrammar === undefined) {
    throw new Error(`${entryRel} exports no AST grammar (looked for cssGrammar, astGrammar, grammar)`);
  }

  const surfaces = [{ name: 'ast', parse: src => parseWith(astGrammar, src) }];
  if (cstGrammar !== undefined) {
    surfaces.push(
      { name: 'cst', parse: src => host.parseCst(cstGrammar, src, 'Stylesheet') },
      { name: 'doc', parse: src => host.parseDocCst(cstGrammar, src, 'Stylesheet') }
    );
  }
  return surfaces;
}

/**
 * How many bytes of the input a parse actually consumed, or null when the
 * surface does not say.
 *
 * This exists because SUCCESS IS NOT CONSUMPTION. `Stylesheet` is `many(Item)`
 * and `many` succeeds on zero matches, so a parse can report `ok` while having
 * read nothing:
 *
 *     run(Stylesheet, '@media (hover){a{b:c}}')  ->  ok=true span={0,0} rules=0
 *
 * A whole at-rule can vanish from the tree while the parse reports success —
 * that hid a real routing bug for a full round while the fixtures read 9/9.
 * Two empty trees also compare EQUAL, so an identity gate that only diffs
 * trees cannot see this class at all.
 *
 * Surfaces report it three different ways: `unconsumedFrom` (cst/doc, null when
 * complete), `span.end` (cst), and `_e` (the AST document's end offset).
 */
export function consumedEnd(value) {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  if (typeof value.unconsumedFrom === 'number') {
    return value.unconsumedFrom;
  }
  if (value.span !== null && typeof value.span === 'object' && typeof value.span.end === 'number') {
    return value.span.end;
  }
  if (typeof value._e === 'number') {
    return value._e;
  }
  return null;
}

/**
 * Run one surface and return either a value or a projected error.
 *
 * The absolute repo path is stripped from error messages: jess errors cite
 * repo-rooted paths, which would make a digest machine-specific and turn the
 * first cross-machine comparison into a total false regression.
 */
function runSurface(surface, src, repo) {
  try {
    return { threw: false, value: surface.parse(src) };
  } catch (e) {
    const message = String(e?.message ?? e).split(repo).join('<repo>');
    return { threw: true, value: { __error: true, name: e?.name ?? 'unknown', message } };
  }
}

/**
 * Compare two builds over a corpus.
 *
 * @returns {{ verdict: 'pass'|'fail'|'no-verdict', divergences: object[], checked: number, undigested: object[] }}
 */
export function compareBuilds({ base, candidate, corpus, renames = {}, repo, limitReports = 10 }) {
  assertInjective(renames);

  const divergences = [];
  const undigested = [];
  const shortParses = [];
  const baselineShort = [];
  const illusory = [];
  let checked = 0;
  let bothThrew = 0;
  let wellFormedChecked = 0;

  for (const id of corpus.ids) {
    let src;
    try {
      src = corpus.read(id);
    } catch (e) {
      undigested.push({ id, surface: '(read)', error: String(e?.message ?? e) });
      continue;
    }

    for (let i = 0; i < base.length; i++) {
      const bs = base[i];
      const cs = candidate.find(s => s.name === bs.name);
      if (cs === undefined) {
        undigested.push({ id, surface: bs.name, error: `candidate does not expose surface ${bs.name}` });
        continue;
      }

      const a = runSurface(bs, src, repo);
      const b = runSurface(cs, src, repo);
      checked++;

      /*
       * CONSUMPTION IS CHECKED BEFORE THE TREES ARE COMPARED, and on each side
       * independently, because two trees that are both empty compare EQUAL.
       * Diffing alone would report a match for a candidate that parsed nothing
       * at all. `--min-real` does not cover this: it catches an empty corpus,
       * not a corpus that parses to nothing.
       *
       * Only well-formed inputs are held to it. A malformed fixture is
       * SUPPOSED to stop early, and its stopping point is already part of the
       * digest via the projected error.
       */
      if (!isMalformed(id)) {
        wellFormedChecked++;
        const ae = a.threw ? null : consumedEnd(a.value);
        const be = b.threw ? null : consumedEnd(b.value);
        const aShort = ae !== null && ae !== src.length;
        const bShort = be !== null && be !== src.length;

        if (aShort && bShort && ae === be) {
          /*
           * BOTH truncate at the SAME offset. The trees still compare equal,
           * and that equality is worth nothing: neither side read the rest of
           * the file. This is the `--min-real` blind spot — the corpus is not
           * empty, it just parses to nothing — so the pair is subtracted from
           * the real-tree count rather than inflating it.
           */
          illusory.push({ id, surface: bs.name, consumed: ae, length: src.length });
        } else if (aShort && !bShort) {
          /*
           * The BASELINE truncates and the candidate does not. Not the
           * candidate's fault and not disqualifying — it cannot fix the
           * incumbent — but it must be loud, because it means the baseline is
           * the thing that is wrong on this input.
           */
          baselineShort.push({ id, surface: bs.name, consumed: ae, length: src.length });
        } else if (bShort) {
          /*
           * The CANDIDATE truncates where the baseline did not, or truncates
           * at a different offset. That is a real regression and it FAILS,
           * including the case where both are short at different points.
           */
          shortParses.push({ id, surface: bs.name, consumed: be, baseConsumed: ae, length: src.length });
        }
      }

      let da;
      let db;
      try {
        // Renames apply to the INCUMBENT side only; the candidate already uses its own names.
        da = digest(a.value, renames);
        db = digest(b.value, {});
      } catch (e) {
        undigested.push({ id, surface: bs.name, error: String(e?.message ?? e) });
        continue;
      }

      if (da === db) {
        if (a.threw) {
          bothThrew++;
        }
        continue;
      }

      const where = firstDivergence(a.value, b.value, renames) ?? {
        path: '$',
        reason: 'digest-differs-but-structural-walk-agrees',
        left: '<see note>',
        right: '<see note>'
      };

      divergences.push({
        id,
        surface: bs.name,
        malformed: isMalformed(id),
        baseThrew: a.threw,
        candidateThrew: b.threw,
        path: where.path,
        reason: where.reason,
        base: where.left,
        candidate: where.right,
        node: where.node,
        baseTop: describe(a.value),
        candidateTop: describe(b.value)
      });
    }
  }

  /*
   * `undigested` is NOT a fail. It means the tool could not answer, which is a
   * different fact from "the grammar moved" and must not be reported in the
   * same vocabulary. It suppresses the verdict entirely.
   */
  if (undigested.length > 0) {
    return { verdict: 'no-verdict', divergences, undigested, shortParses, baselineShort, illusory, wellFormedChecked, checked, bothThrew };
  }

  /*
   * Report the SMALLEST inputs first, not the alphabetically-first.
   *
   * Corpus ids sort with `node_modules/...` early, so the default order led
   * with `bootstrap4.css` — a 156 KB file whose first divergence is reported
   * as "the stylesheet has 1078 children instead of 800". That is a true
   * statement and a useless one: it names the blast radius, not the cause.
   *
   * A 40-byte error fixture that diverges tells you the same thing and points
   * at the construct. Sorting by source size turns the first report from an
   * aftermath photo into a repro.
   */
  const sized = divergences.map(d => {
    let size = Number.MAX_SAFE_INTEGER;
    try {
      size = corpus.read(d.id).length;
    } catch { /* unreadable: sort last */ }
    return { d, size };
  });
  sized.sort((x, y) => x.size - y.size);

  /*
   * A short parse FAILS the gate on its own, even when both sides agree, and
   * even when no tree diverged. That is the whole point: the defect it catches
   * is invisible to a diff precisely because it makes both trees empty.
   */
  return {
    verdict: divergences.length === 0 && shortParses.length === 0 ? 'pass' : 'fail',
    divergences: sized.slice(0, limitReports).map(s => ({ ...s.d, inputBytes: s.size })),
    divergenceCount: divergences.length,
    undigested,
    shortParses,
    baselineShort,
    illusory,
    wellFormedChecked,
    checked,
    bothThrew
  };
}

export function formatDivergence(d, n) {
  const lines = [
    `  [${n}] ${d.surface}  ${d.id}${d.malformed ? '  (malformed input)' : ''}${d.inputBytes !== undefined ? `  [${d.inputBytes} B]` : ''}`,
    `       at   ${d.path}`,
    `       why  ${d.reason}`,
    `       base      ${d.base}`,
    `       candidate ${d.candidate}`
  ];
  if (d.node) {
    lines.push(`       node base=${d.node.left}  candidate=${d.node.right}`);
  }
  if (d.baseThrew !== d.candidateThrew) {
    lines.push(`       THROW MISMATCH: base threw=${d.baseThrew}, candidate threw=${d.candidateThrew}`);
  }
  return lines.join('\n');
}
