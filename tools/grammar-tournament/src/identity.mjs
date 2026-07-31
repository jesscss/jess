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
  let checked = 0;
  let bothThrew = 0;

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
    return { verdict: 'no-verdict', divergences, undigested, checked, bothThrew };
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

  return {
    verdict: divergences.length === 0 ? 'pass' : 'fail',
    divergences: sized.slice(0, limitReports).map(s => ({ ...s.d, inputBytes: s.size })),
    divergenceCount: divergences.length,
    undigested,
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
