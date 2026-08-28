/**
 * Corpus coverage of the grammar's named rules — BY INSTRUMENTATION, never by
 * estimate.
 *
 * WHY THE NUMBER MATTERS MORE THAN IT LOOKS
 * -----------------------------------------
 * A corpus that never reaches `@container` cannot certify a rewrite of
 * `@container`. The dispatch lane's incident is the proof: a wrong predicate
 * was INVISIBLE at 582 compared pairs and surfaced only at 8,328. The bug never
 * changed; the amount of corpus being examined did. So "zero divergences" is
 * meaningless without "over what fraction of the grammar".
 *
 * TWO CATEGORIES THAT MUST NOT BE MERGED
 * --------------------------------------
 * A rule the corpus MISSES and a rule that is UNREACHABLE are different facts
 * with different remedies:
 *
 *   - MISSED     the corpus is thin here. Remedy: add a fixture. This is a
 *                gap in the gate.
 *   - UNREACHABLE no input can reach it, because no production references it.
 *                Remedy: delete the rule. This is dead code, and it is not a
 *                gate weakness at all.
 *
 * Candidate C found a live instance: `OpaqueAtRuleBlock` (grammar.ts:2746) is
 * exported in the rules map but referenced by NO production — only
 * `RoutedOpaqueAtRuleBlock` is reachable — which also makes `genericAtRuleName`
 * and its ~430-char regex dead for css. Reporting that as "corpus coverage gap"
 * would send someone off to write a fixture for a rule that can never fire.
 *
 * HOW REACHABILITY IS DETERMINED
 * ------------------------------
 * By reference scan over the SOURCE closure: a rule named in the rules map is
 * reachable if some production other than itself names it via `g.<Name>`, or if
 * it is the entry rule. This is a syntactic approximation and it is stated as
 * one — it can call a rule reachable that a dispatch key makes dead in
 * practice. It cannot do the reverse, which is the direction that matters: it
 * never calls a LIVE rule dead, so it never licenses deleting something real.
 */
import { readFileSync } from 'node:fs';

/**
 * parseman ships a first-class coverage surface
 * (`compiledGrammarCoverageDefinitions`, `runWithGrammarCoverage`), and it is
 * finer than rule level — it counts `choice-arm`, `dispatch-arm` and `label`
 * definitions too, which is exactly the granularity that would have caught a
 * dispatch key falling through.
 *
 * BUT it requires a build with the plugin option `grammarCoverage: true`; the
 * SHIPPED artifact has no hooks and throws "grammar has no coverage
 * definitions". So this function returns null when handed a stock build rather
 * than inventing a number, and the caller reports the absence.
 */
export async function parsemanCoverage(grammarModule, exportName, sources) {
  let parseman;
  try {
    parseman = await import('parseman');
  } catch {
    return null;
  }
  const { compiledGrammarCoverageDefinitions, createGrammarCoverageCollector, runWithGrammarCoverage } = parseman;
  if (typeof compiledGrammarCoverageDefinitions !== 'function' || typeof runWithGrammarCoverage !== 'function') {
    return { available: false, reason: 'installed parseman exposes no grammar-coverage surface' };
  }

  const grammar = grammarModule[exportName];
  if (grammar === undefined) {
    return { available: false, reason: `module exports no ${exportName}` };
  }

  let definitions;
  try {
    definitions = compiledGrammarCoverageDefinitions(grammar);
  } catch (e) {
    return {
      available: false,
      reason: `${String(e?.message ?? e)} — rebuild with the tsdown/rolldown plugin option grammarCoverage: true; `
        + 'the shipped artifact deliberately carries no hooks so ordinary macro output stays byte-identical'
    };
  }

  if (!definitions || definitions.length === 0) {
    /*
     * parseman's own `ratio` is NaN when the definition set is empty — it fails
     * closed. Mirror that: an empty definition set is NOT 100% coverage.
     */
    return { available: false, reason: 'empty definition set — coverage ratio would be NaN, not 100%' };
  }

  const collector = createGrammarCoverageCollector(definitions);
  for (const src of sources) {
    try {
      runWithGrammarCoverage(grammar.Stylesheet, src, { collector });
    } catch { /* rejection still records the arms it reached */ }
  }
  const snap = collector.snapshot();
  return {
    available: true,
    definitions: snap.definitions?.length ?? definitions.length,
    hits: snap.hits,
    unhit: snap.unhit,
    ratio: snap.ratio,
    byKind: groupByKind(snap.unhit ?? [])
  };
}

function groupByKind(unhit) {
  const out = {};
  for (const u of unhit) {
    const kind = typeof u === 'string' ? 'rule' : (u.kind ?? 'rule');
    out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
}

/**
 * Rule-level coverage without an instrumented build.
 *
 * Fallback path, and honest about being one: it enumerates the rule-map keys
 * from the SHIPPED artifact (`Object.keys(grammar)`) and determines which the
 * corpus reaches by looking at the node names that actually appear in parsed
 * CSTs. That measures NODE coverage, which is a subset of rule coverage —
 * rules that never materialise a node are invisible to it. Reported as such.
 */
export function nodeCoverageFromCorpus(grammarKeys, cstTrees) {
  const seen = new Set();
  const visit = v => {
    if (v === null || typeof v !== 'object') {
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) {
        visit(x);
      }
      return;
    }
    if (typeof v.grammarType === 'string') {
      seen.add(v.grammarType);
    }
    if (typeof v.type === 'string') {
      seen.add(v.type);
    }
    for (const k of Object.keys(v)) {
      if (k === 'children' && v.children === v.rules) {
        continue;
      }
      visit(v[k]);
    }
  };
  for (const t of cstTrees) {
    visit(t);
  }

  const reached = grammarKeys.filter(k => seen.has(k));
  const missed = grammarKeys.filter(k => !seen.has(k));
  return { total: grammarKeys.length, reached: reached.length, missed, seenNames: [...seen].sort() };
}

/**
 * Split a set of unreached rule names into UNREACHABLE (dead) and MISSED
 * (corpus gap) by scanning the grammar source for `g.<Name>` references.
 */
export function splitUnreachable(names, grammarSourcePath, entryRules = ['Stylesheet']) {
  let src;
  try {
    src = readFileSync(grammarSourcePath, 'utf8');
  } catch {
    return { unreachable: [], missed: names, note: 'grammar source unreadable; cannot classify' };
  }

  const unreachable = [];
  const missed = [];
  for (const name of names) {
    if (entryRules.includes(name)) {
      missed.push(name);
      continue;
    }
    /*
     * Count `g.Name` references. A rule referenced only inside its own
     * definition does not make itself reachable, but detecting that needs a
     * real parse; the count threshold is the syntactic approximation, and it
     * errs toward calling things reachable.
     */
    const refs = (src.match(new RegExp(`\\bg\\.${name}\\b`, 'g')) ?? []).length;
    if (refs === 0) {
      unreachable.push(name);
    } else {
      missed.push(name);
    }
  }
  return { unreachable, missed };
}
