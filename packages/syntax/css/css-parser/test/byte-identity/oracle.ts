/**
 * The CSS byte-identity oracle — ONE definition, bound by the vitest entry.
 *
 * ## The question
 *
 * *Does a valid CSS file survive `parse` -> `serialize` with every byte intact,
 * trivia included?* CSS is the superset base every other dialect is a copy of,
 * so a byte the CSS parser drops, invents, or reorders is a defect in all four.
 *
 * This is the instrument `GRAMMAR-REVIEW-STANDARD.md` item 15 asks for and §4
 * records as missing: *"There is no equivalent script for the other three
 * dialects … an unchanged [Less] oracle on a `css-parser` change is a null
 * result, not a pass."*
 *
 * ## Why it is not the render differential
 *
 * `test/render-differential/` answers a DIFFERENT question — *did the emitted
 * bytes MOVE since the committed baseline?* That is relative: it needs a
 * before-state, it cannot say whether either state was right, and rebaselining
 * makes any output correct by construction. This oracle is ABSOLUTE. The input
 * IS the expected output, so there is nothing to rebaseline and no state in
 * which a wrong answer is green. The two are complements, and the corpus
 * builder is deliberately shared rather than forked.
 *
 * ## `collapseNesting: false`
 *
 * `serialize`'s default (`true`, the 4.x behaviour) flattens authored block
 * structure into composed selector strings, which is a deliberate semantic
 * transform and therefore not round-trippable — nesting information is gone by
 * design. `false` is the Less v5 default and preserves the authored blocks, so
 * it is the only setting under which byte-identity is a meaningful question.
 * This is also the setting that makes the oracle SENSITIVE to the defect class
 * it exists for: a nested rule swallowed into a `Declaration` shows up as
 * missing bytes only while nesting is still being emitted as nesting.
 *
 * ## Three outcomes, three channels
 *
 * Following `render-differential/differential.mjs`'s rule that a parse and a
 * throw must never share a result space:
 *
 *  - `identical`  — the round trip reproduced the input exactly.
 *  - `divergent`  — it parsed and serialized, but the bytes differ. Reported
 *                   with the first differing offset and both sides in context.
 *  - `parseError` — the grammar refused a corpus file. Never silently folded
 *                   into `divergent`: reporting a rejection as a byte
 *                   divergence is how a gate lies about what it measured.
 *  - `emitError`  — parsed, would not serialize. Its own channel for the same
 *                   reason.
 */

export type RoundTripStatus = 'identical' | 'divergent' | 'parseError' | 'emitError';

export interface RoundTripResult {
  readonly id: string;
  readonly status: RoundTripStatus;

  /** First differing byte offset. `null` unless `status === 'divergent'`. */
  readonly firstDiff: number | null;

  /** Human-readable one-line account of the divergence or error. */
  readonly detail: string | null;
}

export interface OracleReport {
  readonly results: readonly RoundTripResult[];
  readonly counts: Record<RoundTripStatus, number>;

  /** Ids whose status is not `identical`, sorted. The ratchet compares this. */
  readonly failing: readonly string[];
}

export interface CorpusEntry {
  readonly id: string;
  readonly source: string;
}

/**
 * The round-trip surface. A parameter, not a static import, so the same
 * definition can be bound to `src` (vitest) or to built `lib`, and so the
 * negative controls can bind a deliberately broken surface. Two copies of this
 * function would drift; one function with several bindings cannot.
 */
export interface RoundTripSurface {
  (source: string): Promise<string>;
}

/** Byte offset of the first difference, or `-1` when the strings are equal. */
export function firstDifference(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) {
    i += 1;
  }
  if (i === limit && a.length === b.length) {
    return -1;
  }
  return i;
}

const WINDOW = 48;

function context(text: string, at: number): string {
  return JSON.stringify(text.slice(Math.max(0, at - WINDOW), at + WINDOW));
}

/**
 * Run the oracle. Every entry is visited; nothing is skipped, because a corpus
 * that quietly shrinks produces a smaller-but-plausible green run, which is
 * indistinguishable from a real pass.
 */
export async function runOracle(
  entries: readonly CorpusEntry[],
  roundTrip: RoundTripSurface
): Promise<OracleReport> {
  const results: RoundTripResult[] = [];
  const counts: Record<RoundTripStatus, number> = {
    identical: 0,
    divergent: 0,
    parseError: 0,
    emitError: 0
  };

  for (const entry of entries) {
    let output: string;
    try {
      output = await roundTrip(entry.source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      /*
       * The surface does parse and serialize in one call, so the two error
       * channels are told apart by the error's own class. A `CssParseError` is
       * a fact about the grammar; anything else is a tool failure, and calling
       * a tool failure a grammar rejection is the lie this split prevents.
       */
      const status: RoundTripStatus = error instanceof Error && /parse/i.test(error.name)
        ? 'parseError'
        : 'emitError';
      counts[status] += 1;
      results.push({ id: entry.id, status, firstDiff: null, detail: `${status}: ${message.split('\n')[0]}` });
      continue;
    }

    const at = firstDifference(entry.source, output);
    if (at === -1) {
      counts.identical += 1;
      results.push({ id: entry.id, status: 'identical', firstDiff: null, detail: null });
      continue;
    }
    counts.divergent += 1;
    results.push({
      id: entry.id,
      status: 'divergent',
      firstDiff: at,
      detail: `at byte ${at}: in ${context(entry.source, at)} -> out ${context(output, at)}`
    });
  }

  return {
    results,
    counts,
    failing: results.filter(r => r.status !== 'identical').map(r => r.id).sort()
  };
}

/** One-screen summary, always printed: a check that prints nothing is indistinguishable from one that never ran. */
export function formatOracle(label: string, report: OracleReport): string {
  const { identical, divergent, parseError, emitError } = report.counts;
  return `[css-byte-identity:${label}] files=${report.results.length} identical=${identical} `
    + `divergent=${divergent} parse-error=${parseError} emit-error=${emitError}`;
}
