/**
 * One parse verdict, spelled the same way for all four dialects.
 *
 * ## Why this exists
 *
 * The standing ruling is that **valid CSS is valid in all four dialects**, and
 * it is ONE-WAY: `css` is the base, the dialects extend it, and a construct
 * that parses in `scss` but not in `css` is a defect in `css`. Checking that
 * ruling means asking the same question of four grammars, and the question has
 * to mean the same thing each time.
 *
 * ## Why the verdict is `ok && unconsumedFrom === null`
 *
 * - `ok` alone is not enough. Parseman reports `ok` for a run that consumed
 *   NOTHING; 1,467 non-consuming parses read as successes in the sass-spec
 *   baseline before this was understood.
 * - `span.end === source.length` is not enough either. Whether a dialect's root
 *   span covers trailing trivia is a per-dialect convention, and it differs on
 *   two of the four — that formulation gives the wrong answer for those two.
 * - `errors` are parseman's RECOVERY errors. `parse()` throws on the first one,
 *   so a run carrying them is not an accepted parse either. Reported separately
 *   so a recovery-only failure is distinguishable from an outright reject.
 *
 * ## Relationship to `test/css-superset-corpus.ts`
 *
 * That module exports its own `DIALECTS` for the four PER-PACKAGE construct
 * gates, each of which calls its own package's public CST entry. This module is
 * the ROOT-level runner: it holds all four grammars at once, which is what a
 * cross-dialect corpus sweep needs and what a per-package suite cannot do. The
 * two constants are deliberately independent — merging them would make every
 * per-package gate import the root corpus table.
 */
/*
 * The four grammars are imported from `src`, not through the `./grammar`
 * package subpath. Only css-parser has a vitest alias for that subpath, so the
 * other three would resolve to built `lib` and this file would be measuring a
 * stale artefact against current source — the half-source graph vitest.config.ts
 * documents at length. A relative source import cannot go stale.
 */
import { run } from 'parseman';
import { cssGrammar } from '../packages/syntax/css/css-parser/src/grammar.js';
import { lessGrammar } from '../packages/syntax/less/less-parser/src/grammar.js';
import { scssGrammar } from '../packages/syntax/scss/scss-parser/src/grammar.js';
import { jessGrammar } from '../packages/syntax/jess/jess-parser/src/grammar.js';

export const DIALECTS = ['css', 'less', 'scss', 'jess'] as const;

export type Dialect = (typeof DIALECTS)[number];

/**
 * Bind one runner per dialect from its own concrete grammar.
 *
 * The four compiled rule tables are four distinct structural types, so a shared
 * `Record<Dialect, Grammar>` is only reachable through a cast, and this file
 * must not need one. Each runner closes over its own table and calls `run` with
 * exactly the arguments that table types.
 *
 * The `Stylesheet` entry is checked once, at module load, and the failure
 * THROWS. A grammar whose public entry has been renamed would otherwise make
 * every verdict in this file `false`, and a corpus reporting 0% would read as a
 * catastrophic regression rather than as a broken instrument.
 */
function bind(
  dialect: Dialect,
  grammar: { Stylesheet?: unknown; whitespace?: unknown },
  call: (source: string) => ReturnType<typeof run>
): (source: string) => ReturnType<typeof run> {
  if (grammar.Stylesheet === undefined || grammar.whitespace === undefined) {
    throw new TypeError(
      `${dialect} grammar is missing its public Stylesheet/whitespace entry — `
      + 'every parse verdict from this module would be false.'
    );
  }
  return call;
}

const RUNNERS: Record<Dialect, (source: string) => ReturnType<typeof run>> = {
  css: bind('css', cssGrammar, source =>
    run(cssGrammar.Stylesheet!, source, { trivia: cssGrammar.whitespace })),
  less: bind('less', lessGrammar, source =>
    run(lessGrammar.Stylesheet!, source, { trivia: lessGrammar.whitespace })),
  scss: bind('scss', scssGrammar, source =>
    run(scssGrammar.Stylesheet!, source, { trivia: scssGrammar.whitespace })),
  jess: bind('jess', jessGrammar, source =>
    run(jessGrammar.Stylesheet!, source, { trivia: jessGrammar.whitespace }))
};

export type ParseVerdict = {
  /** The verdict. `true` iff the whole document was recognised and consumed. */
  readonly parses: boolean;
  /** Parseman recovery errors. Non-zero means `parse()` would throw. */
  readonly recovered: number;
  /** First byte the run refused, or `null` when everything was consumed. */
  readonly unconsumedFrom: number | null;
  /** Terminals the run wanted at the failure point. Empty on success. */
  readonly expected: readonly string[];
  /**
   * A reducer invariant that BLEW UP rather than declining the input.
   *
   * This is a third outcome, not a flavour of reject, and it is kept distinct
   * because collapsing it into `parses: false` is how it stays invisible.
   * `a{color:()}` makes the CSS grammar throw "CSS AST value grammar lost its
   * value child" — an internal `Error`, not the `SyntaxError` the public
   * `parse()` contract promises. Recognising less than the language is a
   * grammar gap; crashing on it is a defect of a different kind.
   */
  readonly crashed: string | undefined;
};

export function parseVerdict(dialect: Dialect, source: string): ParseVerdict {
  let result: ReturnType<typeof run>;
  try {
    result = RUNNERS[dialect](source);
  } catch (error) {
    return {
      parses: false,
      recovered: 0,
      unconsumedFrom: null,
      expected: [],
      crashed: error instanceof Error ? error.message : String(error)
    };
  }
  return {
    parses: result.ok && result.unconsumedFrom === null && result.errors.length === 0,
    recovered: result.errors.length,
    unconsumedFrom: result.unconsumedFrom,
    expected: result.ok ? [] : (result.expected ?? []),
    crashed: undefined
  };
}

/** The dialects that accept `source`, in `DIALECTS` order. */
export function acceptingDialects(source: string): Dialect[] {
  return DIALECTS.filter(dialect => parseVerdict(dialect, source).parses);
}
