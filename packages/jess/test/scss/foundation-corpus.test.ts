/**
 * Foundation for Sites (Sass) corpus — parse + eval inventory.
 *
 * The sibling of `bootstrap-corpus.test.ts`, and deliberately a different
 * shape of stress. Bootstrap is mostly declarative: maps, `@each` over a
 * utilities map, and a thin mixin layer. Foundation is control-flow heavy —
 * `@function` definitions with `@return`, nested `@if`/`@else if`/`@else`,
 * `@each` over multi-value lists with destructuring, `@warn`/`@error`
 * guards, and a `map-get`-driven settings layer that every component reads
 * through. It therefore exercises constructs Bootstrap barely touches.
 *
 * Same contract as the Bootstrap corpus: SCSS is an explicit NON-GOAL for
 * feature completeness, so this file is a RATCHET, not a gate. Every corpus
 * file gets a reported outcome; the suite fails only if a file recorded as
 * passing stops passing (or if a newly-passing file has not been added to the
 * baseline). Individual unimplemented-SCSS failures are recorded, never
 * thrown.
 *
 * Two lanes, deliberately different in scope:
 *
 *   parse — every `.scss` shipped in the `foundation-sites` package, through
 *           the SCSS plugin's `safeParse` (the product path). Parsing is
 *           context-free, so partials are meaningful standalone and all of
 *           them are in scope. That reach is wider than the library's own
 *           `scss/` tree on purpose: `_vendor/sassy-lists` is pure function
 *           definitions, `test/sass` is sass-true assertion syntax, and
 *           `docs/assets/scss` is ordinary authored SCSS — three more
 *           authoring styles for the same grammar.
 *   eval  — the self-contained entry points only, through
 *           `Compiler.safeRender` (import resolution + eval + serialize).
 *           "Self-contained" is not a judgement call: it is the set that
 *           dart-sass compiles standalone. `docs/assets/scss/docs.scss` is
 *           excluded because it imports the unshipped `motion-ui` peer, so a
 *           failure there would be a fixture artifact, not a model gap.
 *           Partials are likewise not eval'd standalone.
 *
 * The per-construct explanation of these failures lives in
 * `scss-construct-support.test.ts` — that matrix is the categorized
 * inventory; this file measures how far it reaches across a real-world
 * codebase.
 *
 * `JESS_SCSS_CORPUS_REPORT=1` rewrites FOUNDATION-CORPUS-REPORT.json /
 * FOUNDATION-CORPUS-REPORT.md next to this file — everything except the
 * hand-maintained tail of the `.md`, which `corpus-report-tail.ts` copies
 * through untouched.
 */
import { describe, expect, it } from 'vitest';
import * as glob from 'glob';
import * as path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';
import scssPlugin from '@jesscss/plugin-scss';
import { writeReportPreservingTail } from './corpus-report-tail.js';

const req = createRequire(import.meta.url);
const foundationRoot = path.dirname(req.resolve('foundation-sites/package.json'));
const foundationVersion: string = JSON.parse(
  readFileSync(path.join(foundationRoot, 'package.json'), 'utf8')
).version;

const rel = (p: string) => path.relative(foundationRoot, p).split(path.sep).join('/');

/**
 * Self-contained entry points — the only files that are meaningful to eval.
 * Verified against dart-sass: each of these compiles standalone.
 */
const ENTRY_POINTS = [
  'assets/foundation.scss',
  'assets/foundation-float.scss',
  'assets/foundation-prototype.scss',
  'assets/foundation-rtl.scss',
  'scss/foundation.scss'
];

const PER_FILE_TIMEOUT_MS = 30_000;

/**
 * Blocking constructs. Unlike the Bootstrap list — which was written against
 * the categories in `scss-construct-support.test.ts` — every entry here was
 * confirmed by reducing a corpus failure to a standalone snippet and feeding
 * it to `@jesscss/scss-parser` directly, so each pattern names a construct
 * that provably does not parse today rather than one that merely correlates
 * with a failing file. The reduced snippet is quoted with each entry.
 *
 * A file is attributed to every blocker it contains — files usually hit
 * several, so these counts overlap by design. The report additionally ranks by
 * the blocker sitting at each file's reported failure POSITION, which is the one
 * the parser actually gave up on; see `blockerAt`.
 *
 * An entry is REMOVED when the construct starts parsing, not left at zero: the
 * match is a presence regex, so a construct that parses would keep attracting
 * files that fail for an unrelated reason in the `contains` column. Closed so
 * far: `@return` nested inside `@if`/`@else`, `@include` with a trailing content
 * block, `@content`, `@while`, `@error`/`@warn`/`@debug`, and chained unary
 * `not not`. Forgetting to remove one no longer corrupts the ranking
 * — that column is read off the failure position — but it still inflates
 * `contains`.
 */
const BLOCKERS: Array<[string, RegExp]> = [
  // `$x: f($lightness: 1);`
  ['keyword argument ($name: v) in a function-call argument list', /[a-z][\w.-]*\(\s*(?:[^()]*?,\s*)?\$[\w-]+\s*:/],

  // `$x: if($a == b, 1, 2);` — the same `==` parses fine in an @if condition.
  ['comparison (== / !=) inside a function-call argument list', /[a-z][\w.-]*\([^()]*(?:==|!=)/],

  /*
   * `$m: (a, b, c,);` — a trailing comma in a parenthesized list. Surfaced by
   * closing the `@include`-content-block blocker: files now parse far enough to
   * reach it.
   */
  ['trailing comma in a parenthesized list', /,\s*\)/],

  // `.a:nth-child(#{$i}) { color: red; }`
  ['interpolation inside a pseudo-class argument list', /:{1,2}[\w-]+\([^()]*#\{/],

  // `.a { @at-root .b { color: red; } }` — bare `@at-root { … }` does parse.
  ['@at-root with a selector prelude', /@at-root\s+[^{\s]/],

  /*
   * `@mixin m() { div:hover, .b { color: red; } }` — the leading `div:` is
   * committed to the declaration path, and `.`/`#` cannot follow in a value.
   */
  ['nested selector list `type:pseudo, .class`', /^[ \t]*[a-z][\w-]*:-?[\w-]+,[ \t]*$/m]
];

type Outcome = 'pass' | 'fail';

interface LaneResult {
  file: string;
  outcome: Outcome;

  /** `line:col` of the point where the parser gave up. */
  at?: string;

  /** Source line at that point, trimmed. */
  source?: string;

  /** Every known blocking construct present in the file. */
  blockers?: string[];

  /**
   * The blocker at `at` — the one the parser actually gave up on. `blockers`
   * over-counts by design; this does not. Absent when no listed blocker sits at
   * the failure position, which means the list is missing an entry.
   */
  primaryBlocker?: string;
  detail?: string;
  bytes?: number;
}

const firstLine = (e: unknown): string => {
  const message = typeof e === 'object' && e !== null && 'message' in e ? e.message : e;
  return String(message).split('\n')[0].trim();
};

const blockersIn = (src: string): string[] =>
  BLOCKERS.filter(([, re]) => re.test(src)).map(([name]) => name);

/** Every [start, end] span of a blocker in a source file. */
const spansOf = (re: RegExp, src: string): Array<[number, number]> => {
  const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const spans: Array<[number, number]> = [];
  for (const match of src.matchAll(scan)) {
    if (match.index !== undefined) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  return spans;
};

/**
 * The end of the construct the parser was inside when it gave up: the first
 * `;` or `}` at bracket depth zero from `offset` onward.
 *
 * Deliberately a scan and not a parse — it bounds a report heuristic, and the
 * one thing it must not do is claim a blocker fifty lines away in an unrelated
 * block. Strings and comments are not skipped; SCSS interpolation inside them
 * is brace-balanced, so it cancels out.
 */
const constructEnd = (src: string, offset: number): number => {
  let depth = 0;
  for (let i = offset; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '(') {
      depth++;
    } else if (c === '}' || c === ')') {
      if (depth === 0) {
        return i;
      }
      depth--;
    } else if (c === ';' && depth === 0) {
      return i;
    }
  }
  return src.length;
};

/**
 * The blocker at the position where the parser ACTUALLY gave up.
 *
 * This used to take the blocker with the lowest match index in the whole file,
 * which answers a different question — "which listed construct appears first" —
 * and answers it wrongly the moment a construct starts parsing. Files kept the
 * name of a blocker they now sail past while their `gave up at` moved tens of
 * lines further down, so the ranked table pointed at constructs that were
 * already fixed. `gave up at` is the truth; this reads from it.
 *
 * Two positional cases, because the parser reports two kinds of offset:
 *
 *   1. the offset falls INSIDE a blocker's match — the precise case, e.g.
 *      `color.adjust($dark-gray, $lightness: -10%)` gives up on the keyword
 *      colon, which is inside the keyword-argument match. The innermost (latest
 *      starting) containing match wins.
 *   2. the offset is the START of the construct that failed, because the real
 *      blocker is in its body — `@else {` at `42:4` in `scss/util/_flex.scss`,
 *      whose next line is the `@error` it gave up on. Then the nearest blocker
 *      after the offset wins, but only WITHIN that construct (`constructEnd`).
 *      Unbounded, this degenerates into the bug being fixed: the nearest match
 *      in the rest of the file is not evidence, and it labelled
 *      `scss/components/_dropdown-menu.scss` with an `@error` 57 lines below.
 *
 * When neither applies the file is left unattributed rather than assigned a
 * blocker it does not fail on. An unattributed failure means the blocker list is
 * missing an entry, which is a fact worth reading off the report — not one worth
 * hiding behind a plausible name.
 */
const blockerAt = (src: string, offset: number | undefined): string | undefined => {
  if (offset === undefined) {
    return undefined;
  }
  const limit = constructEnd(src, offset);
  let containing: string | undefined;
  let containingStart = -1;
  let following: string | undefined;
  let followingStart = Number.POSITIVE_INFINITY;

  for (const [name, re] of BLOCKERS) {
    for (const [start, end] of spansOf(re, src)) {
      if (start <= offset && offset <= end) {
        if (start > containingStart) {
          containingStart = start;
          containing = name;
        }
      } else if (start > offset && start <= limit && start < followingStart) {
        followingStart = start;
        following = name;
      }
    }
  }
  return containing ?? following;
};

/** Turn the parser's byte offset into a `line:col` plus the offending line. */
const locate = (src: string, offset: number) => {
  const before = src.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = src.indexOf('\n', offset);
  return {
    at: `${before.split('\n').length}:${offset - lineStart}`,
    source: src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim().slice(0, 120)
  };
};

const allFiles = glob
  .sync(path.join(foundationRoot, '**/*.scss'), { ignore: '**/node_modules/**' })
  .map(rel)
  .sort();

const parseResults: LaneResult[] = [];
const evalResults: LaneResult[] = [];

const runParse = (file: string): LaneResult => {
  const full = path.join(foundationRoot, file);
  const source = readFileSync(full, 'utf8');
  const result = scssPlugin().safeParse(full, source);
  if (result.errors.length === 0 && result.document) {
    return { file, outcome: 'pass' };
  }

  /*
   * The plugin diagnostic flattens the parser's position, so re-run the raw
   * parser purely to recover the offset for the report.
   */
  let at: string | undefined;
  let sourceLine: string | undefined;
  let offset: number | undefined;
  try {
    parse(source);
  } catch (error) {
    if (
      typeof error === 'object' && error !== null
      && 'offset' in error && typeof error.offset === 'number'
    ) {
      offset = error.offset;
      ({ at, source: sourceLine } = locate(source, error.offset));
    }
  }
  return {
    file,
    outcome: 'fail',
    at,
    source: sourceLine,
    blockers: blockersIn(source),
    primaryBlocker: blockerAt(source, offset),
    detail: result.errors.length > 0 ? firstLine(result.errors[0]) : 'no document returned'
  };
};

const runEval = async (file: string): Promise<LaneResult> => {
  const full = path.join(foundationRoot, file);

  /*
   * collapseNesting mirrors dart-sass `expanded` output, which is the shape the
   * cross-engine benchmark comparison reads.
   */
  const compiler = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [scssPlugin()] }
  });
  try {
    const result = await compiler.safeRender(full, { suppressWarnings: true });
    if (result.errors.length > 0) {
      return { file, outcome: 'fail', detail: firstLine(result.errors[0]) };
    }
    if (result.css === null) {
      return { file, outcome: 'fail', detail: 'no css returned' };
    }
    return { file, outcome: 'pass', bytes: result.css.length };
  } catch (error) {
    return { file, outcome: 'fail', detail: firstLine(error) };
  } finally {
    compiler.dispose();
  }
};

describe(`Foundation for Sites ${foundationVersion} SCSS corpus`, () => {
  it('discovers the corpus', () => {
    expect(allFiles.length).toBeGreaterThan(100);
    for (const entry of ENTRY_POINTS) {
      expect(allFiles).toContain(entry);
    }
  });

  describe('parse', () => {
    allFiles.forEach((file) => {
      it(`parses ${file}`, () => {
        parseResults.push(runParse(file));
      });
    });
  });

  describe('eval', () => {
    ENTRY_POINTS.forEach((file) => {
      it(`evaluates ${file}`, async () => {
        evalResults.push(await runEval(file));
      }, PER_FILE_TIMEOUT_MS);
    });
  });
});

// ── ratchet ──────────────────────────────────────────────────────────────────

/**
 * Named baselines for Foundation for Sites 6.9.0 — NOT counts.
 *
 * A count floor ("at least 40 of 136 parse") is satisfied by *any* 40 files, so
 * a run that fixes one file and breaks another reads as unchanged. These sets
 * name the exact files, so the diff a reviewer reads says which fixture moved
 * and in which direction.
 *
 * GROWING is deliberate: a file that starts parsing fails the gate until it is
 * added here, which is a one-line, obviously-correct edit. SHRINKING requires
 * removing a name, which is visible in review.
 */
const PARSE_PASS_BASELINE: readonly string[] = [
  '_vendor/sassy-lists/stylesheets/functions/_contain.scss',
  '_vendor/sassy-lists/stylesheets/functions/_purge.scss',
  '_vendor/sassy-lists/stylesheets/functions/_remove.scss',
  '_vendor/sassy-lists/stylesheets/functions/_replace.scss',
  '_vendor/sassy-lists/stylesheets/functions/_to-list.scss',
  'assets/foundation-float.scss',
  'assets/foundation-prototype.scss',
  'assets/foundation-rtl.scss',
  'assets/foundation.scss',
  'docs/assets/scss/_component-list.scss',
  'docs/assets/scss/_course-callout.scss',
  'docs/assets/scss/content/_install.scss',
  'docs/assets/scss/examples/_buttons.scss',
  'docs/assets/scss/examples/_motion-ui.scss',
  'docs/assets/scss/examples/_off-canvas.scss',
  'docs/assets/scss/examples/_orbit.scss',
  'docs/assets/scss/examples/_responsive-embed.scss',
  'docs/assets/scss/examples/_reveal.scss',
  'scss/_global.scss',
  'scss/components/_accordion-menu.scss',
  'scss/components/_accordion.scss',
  'scss/components/_badge.scss',
  'scss/components/_breadcrumbs.scss',
  'scss/components/_card.scss',
  'scss/components/_close-button.scss',
  'scss/components/_drilldown.scss',
  'scss/components/_dropdown.scss',
  'scss/components/_flex-video.scss',
  'scss/components/_flex.scss',
  'scss/components/_float.scss',
  'scss/components/_label.scss',
  'scss/components/_media-object.scss',
  'scss/components/_menu-icon.scss',
  'scss/components/_orbit.scss',
  'scss/components/_pagination.scss',
  'scss/components/_progress-bar.scss',
  'scss/components/_responsive-embed.scss',
  'scss/components/_sticky.scss',
  'scss/components/_thumbnail.scss',
  'scss/components/_title-bar.scss',
  'scss/components/_tooltip.scss',
  'scss/components/_top-bar.scss',
  'scss/components/_visibility.scss',
  'scss/forms/_checkbox.scss',
  'scss/forms/_error.scss',
  'scss/forms/_fieldset.scss',
  'scss/forms/_forms.scss',
  'scss/forms/_help-text.scss',
  'scss/forms/_input-group.scss',
  'scss/forms/_label.scss',
  'scss/forms/_meter.scss',
  'scss/forms/_progress.scss',
  'scss/forms/_range.scss',
  'scss/forms/_select.scss',
  'scss/forms/_text.scss',
  'scss/foundation.scss',
  'scss/grid/_flex-grid.scss',
  'scss/grid/_grid.scss',
  'scss/grid/_gutter.scss',
  'scss/grid/_position.scss',
  'scss/grid/_row.scss',
  'scss/grid/_size.scss',
  'scss/prototype/_arrow.scss',
  'scss/prototype/_border-box.scss',
  'scss/prototype/_border-none.scss',
  'scss/prototype/_bordered.scss',
  'scss/prototype/_box.scss',
  'scss/prototype/_display.scss',
  'scss/prototype/_font-styling.scss',
  'scss/prototype/_list-style-type.scss',
  'scss/prototype/_overflow.scss',
  'scss/prototype/_position.scss',
  'scss/prototype/_prototype.scss',
  'scss/prototype/_rotate.scss',
  'scss/prototype/_rounded.scss',
  'scss/prototype/_separator.scss',
  'scss/prototype/_shadow.scss',
  'scss/prototype/_sizing.scss',
  'scss/prototype/_spacing.scss',
  'scss/prototype/_text-transformation.scss',
  'scss/prototype/_text-utilities.scss',
  'scss/typography/_alignment.scss',
  'scss/typography/_helpers.scss',
  'scss/typography/_print.scss',
  'scss/typography/_typography.scss',
  'scss/util/_direction.scss',
  'scss/util/_flex.scss',
  'scss/util/_selector.scss',
  'scss/util/_typography.scss',
  'scss/util/_util.scss',
  'scss/vendor/normalize.scss',
  'scss/xy-grid/_collapse.scss',
  'scss/xy-grid/_frame.scss',
  'scss/xy-grid/_grid.scss',
  'scss/xy-grid/_gutters.scss',
  'scss/xy-grid/_layout.scss',
  'scss/xy-grid/_xy-grid.scss',
  'test/sass/_breakpoint.scss',
  'test/sass/_components.scss',
  'test/sass/_unit.scss'
];

/** Entry points known to evaluate end-to-end. Add each one as it graduates. */
const EVAL_PASS_BASELINE: readonly string[] = [];

/**
 * Compare an observed pass set against its named baseline in BOTH directions.
 * Returns the human-readable failure text, or `null` when the sets agree.
 */
function baselineDrift(lane: string, observed: readonly string[], baseline: readonly string[]): string | null {
  const seen = new Set(observed);
  const expected = new Set(baseline);
  const regressed = [...expected].filter(name => !seen.has(name)).sort();
  const improved = [...seen].filter(name => !expected.has(name)).sort();
  if (regressed.length === 0 && improved.length === 0) {
    return null;
  }
  const lines = [`${lane} baseline drifted (${seen.size} passing, baseline names ${expected.size}):`];
  if (regressed.length > 0) {
    lines.push(`  REGRESSED — these were passing and now fail:\n${regressed.map(n => `    - ${n}`).join('\n')}`);
  }
  if (improved.length > 0) {
    lines.push(
      '  IMPROVED — these now pass and must be ADDED to the baseline'
      + ` (${lane === 'parse' ? 'PARSE_PASS_BASELINE' : 'EVAL_PASS_BASELINE'} in this file):\n`
      + improved.map(n => `    - ${n}`).join('\n')
    );
  }
  return lines.join('\n');
}

describe('Foundation SCSS corpus ratchet', () => {
  it('parse/eval pass sets match their named baselines exactly', () => {
    const parsePassed = parseResults.filter(r => r.outcome === 'pass').map(r => r.file);
    const evalPassed = evalResults.filter(r => r.outcome === 'pass').map(r => r.file);

    if (process.env.JESS_SCSS_CORPUS_REPORT) {
      writeReport(parseResults, evalResults);
    }

    const drift = [
      baselineDrift('parse', parsePassed, PARSE_PASS_BASELINE),
      baselineDrift('eval', evalPassed, EVAL_PASS_BASELINE)
    ].filter((entry): entry is string => entry !== null);

    expect(drift.join('\n\n'), drift.join('\n\n')).toBe('');
  });
});

// ── report ───────────────────────────────────────────────────────────────────

/**
 * The report tail that is NOT derived from a run: the owner rulings on each
 * blocker, and the ident-start disambiguation rule.
 *
 * It lives HERE rather than in the .md because `writeReport` rewrites that file
 * WHOLESALE — a hand-appended section is silently deleted by the next
 * regeneration, which is exactly what happened on 2026-08-08. Emitting it from
 * the generator makes that loss impossible instead of merely warned about.
 */
const STANDING_SECTIONS: readonly string[] = [
  '## Owner rulings on each blocker (2026-08-08)',
  '',
  '> **This section is hand-written but generator-OWNED.** It used to live only in',
  '> this file, where `JESS_SCSS_CORPUS_REPORT=1` deleted it on every regeneration',
  '> (it did, on 2026-08-08, and was restored from git). It now lives in',
  '> `STANDING_SECTIONS` in `foundation-corpus.test.ts` and is re-emitted by',
  '> `writeReport`, so regeneration preserves it. Edit it THERE, not here — an edit',
  '> made here is what the next regeneration overwrites.',
  '>',
  '> Anything you want to hand-write DIRECTLY in this file goes BELOW the',
  '> `HAND-MAINTAINED BELOW` marker at the end. `corpus-report-tail.ts` copies that',
  '> tail through byte-for-byte and THROWS if the marker is missing, so a hand-edit',
  '> down there can never be silently discarded.',
  '',
  'Recorded against the ranked table above. These decide WHAT each construct lowers',
  'to. Rows marked LANDED are implemented; the rest are still design-only.',
  '',
  '| # | blocker | ruling |',
  '| --- | --- | --- |',
  '| 1 | keyword arg `$name: v` in a call arg list | **Real gap — OPEN, and it is an AST change, not a grammar change.** Less v5, Sass+ and Jess all admit direct assignment, keyed on what `defineFunction` exposes on the returned function object (`params`, each with a `name`). Not a Sass-only affordance. **No new AST kind is owed**: `.less` `.m(@a: 1)` already lowers to `MixinCall.args = [{name:\'a\', value}]`, i.e. `CallArg` (`packages/core/src/ast/mixin-dispatch.ts:30`), and `$name: value` is the same `.jess` spelling in either call — §12.0\'s first test makes them the SAME node. What blocks it is that `FunctionCall.args` is `ValueSlot[]` (`nodes.ts:277`) and cannot carry a name. Converting it to `CallArg[]` is a hidden-class change to the hottest value node in the tree and touches ~65 read sites (43 `.args` in `serialize.ts`, 22 in `packages/fns/src`) plus 29 `funcCall(` construction sites across all four grammars. Sized, designed, not started. |',
  '| 2 | `@include` with a trailing content block | **LANDED.** Lowers to `.jess` `$ > m(): @{ … }` — a `MixinCall` carrying the block on a `content` slot, with Sass `using (…)` becoming that block AnonymousMixin `params`. The block is NOT an argument: it binds the callee-visible `content` variable that #6 reads. No new AST kind. |',
  '| 3 | `@error` / `@warn` / `@debug` | **LANDED.** **They do not become NODES.** That is the operative point — not that they are no-ops. They are compile-time diagnostics with no `.jess` spelling, so by §12.0\'s law no AST kind is owed one. Plugin *visitor* support for specific cases is worth reasoning about separately; it does not require a node. |',
  '| 4 | `==` / `!=` inside a call arg list | **LANDED for `.scss`.** Becomes an `Expression` over a `Condition`, per §4.5.2: a call argument is value position, so a comparison there needs the `$( … )` boundary, and the lowering supplies it because Sass source has no `$( … )` to write. Neither kind is new. Implemented as the single `CallArgument` const in `scss-parser/src/grammar.ts`, referenced by both argument sites (`Call`\'s head and `ArgumentPair`\'s tail). `==` / `!=` lower to the `sass-equal` primitive, the same lowering `IfComparison` already performs, so a comparison cannot mean one thing in a guard and another in an argument. **`.jess` needs no change, and that is the rule rather than a gap**: §4.5.2 says "if it computes, it is inside `$( )` — no exceptions". Sass has no `$( … )` to write, so the lowering must supply the boundary; `.jess` HAS the marker, so a bare `f($x == 1)` must stay a parse error and the author writes `f($($x == 1))` — which already parses. `.less` already routes `if(@x = 1, …)` through `FunctionCondition` (§4.5.3a). So this blocker was only ever `.scss`. |',
  '| 5 | `@return` nested inside `@if`/`@else` | **LANDED.** Only top-level `@return` parsing was the bug: `ReturnRule` is now an `IfBody` arm too, building the same `result:` Declaration §4.5.3b already used — verified byte-equal to the tree a top-level `@return` builds. No new AST kind. |',
  '| 6 | `@content` | **LANDED (bare form).** Lowers to the documented built-in `$content()` — a `Reference` on a live `content` `Lookup` with one `Call` step, asserted EQUAL to the tree the Jess grammar builds for `$content()`. No new AST kind. The parameterised `$content($type)` form PARSES but does not EVALUATE: a statement-position call WITH arguments to a variable-bound `AnonymousMixin` is a pre-existing core gap that `.jess` own `$m: @($c) { … }` spelling cannot reach either. Foundation uses only the bare form. **A block-less `@include` makes `@content` a NO-OP** (owner ruling, 2026-08-08, matching dart-sass): the content block is OPTIONAL by design — a mixin that emits `@content` conditionally, or that is called both with and without a block, is the common idiom, and erroring would break every one of them. Not an exception for one name: it is the settled "a resolve failure is an eval error UNLESS the resolve is optional" rule, and `$content()` is precisely the optional case. Only the total MISS is silent — an ordinary `content` binding in scope still resolves, and every other unbound statement-position call still throws. |',
  '| 7 | `@while` | **LANDED.** Gets a **`$while`**, alongside `$if` / `$for`. |',
  '| 8 | chained unary `not not` | **LANDED.** Sass `not not $x` lowers to `.jess` `not(not($x))`. Falls out of §4.5.4\'s rule that `not` always takes parens — it needed no special case, only the missing `Expression` arm in the condition-source spelling. |',
  '| 9 | nested selector list `type:pseudo, .class` | **A grammar defect, and the rule is fully specified — see below.** |',
  '| 10 | interpolation in a pseudo-class arg | Not yet ruled on. |',
  '| 11 | `@at-root` with a selector prelude | **Needs a decision.** Bare `@at-root { … }` already parses. |',
  '| 12 | `@extend %placeholder` — a placeholder-selector extend | **NEEDS AN OWNER RULING. Not on the original eleven-item list**; it was found by the position-based attribution, which left `scss/components/_reveal.scss` unattributed and thereby named the gap instead of hiding it. That file gives up at `108:2` on `@extend %reveal-centered;`. `%name` is a Sass selector that emits nothing on its own and exists only to be extended; `.less` has no spelling for it, and `.jess` has not been given one, so the question is what it LOWERS TO before it is a grammar question. Recorded, deliberately not implemented here. |',
  '',
  '**Sequencing note:** #2, #5 and #6 are LANDED, together — #6 IS the lowering',
  'target for #2, so neither closes alone. #1 and #9 are defects. #10, #11 and #12',
  'are the ones still needing a ruling. Closing #2/#5/#6 surfaced one new entry in',
  'the ranked table above: a trailing comma in a parenthesized list, which files',
  'only reach now that the `@include` content block no longer stops the parse.',
  '',
  '',
  '## The ident-start disambiguation rule (blocker #9)',
  '',
  '**Owner ruling, 2026-08-08.** At an ident start, PEEK for a non-wrapped opening',
  '`{` to decide declaration-vs-nested-rule **only when the construct is genuinely',
  'ambiguous** — that is, when ALL of:',
  '',
  '1. the ident is followed by a colon, **and**',
  '2. the colon is **not** followed by a space, **and**',
  '3. what follows the colon **is an identifier** — i.e. it could be a valid',
  '   pseudo-class.',
  '',
  'Anything failing one of those is unambiguous and commits immediately, with no',
  'lookahead:',
  '',
  '| source | ambiguous? | why |',
  '| --- | --- | --- |',
  '| `div:hover {` / `color:red;` | **YES — peek** | `hover` / `red` are identifiers, so element-plus-pseudo-class is a live reading. Only the `{` separates `color:red { … }` (a nested RULE) from `color:red;` (a DECLARATION). |',
  '| `color: red` | no | a pseudo-class cannot have a space after its colon |',
  '| **`div:1px`** | no | `1px` is not an identifier, so it cannot be a pseudo-class — declaration, decided |',
  '| `a b {` | no | no colon |',
  '',
  'The peek is therefore the NARROW case, not the default.',
  '',
  '### CLOSED (2026-08-08) — and the premise above was wrong',
  '',
  'Measured at `a22594121` by probing the NODE each dialect produced, not whether',
  'the parse succeeded. **The CSS base and Less already satisfied the table on',
  'every row.** `css-parser`\'s `Declaration` carries `not(literal(\'{\'))`, so an',
  'ident-colon construct followed by a block already fell through to `Ruleset`.',
  'Nothing in css or less needed changing, and nothing in them was changed.',
  '',
  'The defect was in the two supersets, and in SCSS it was worse than a parse',
  'failure — it was SILENT. `div:hover, span { … }` produced a `Declaration` named',
  '`div` that swallowed the nested rule and its body. The two rows this document',
  'listed as already working (`div:hover, span`, `div:hover, [a]`) were wrong',
  'nodes, not passes; verifying parse success alone would have ratified the bug.',
  '',
  '| source | css | less | scss (was) | jess (was) |',
  '| --- | --- | --- | --- | --- |',
  '| `div:hover, .b { … }` | Ruleset | Ruleset | **fail** | **fail** |',
  '| `div:hover, span { … }` | Ruleset | Ruleset | **Declaration(div)** | **fail** |',
  '| `color:red { … }` | Ruleset | Ruleset | **Declaration(color)** | **fail** |',
  '',
  'Root cause in SCSS was its own fork of the decision, `directNestedPropertyAhead`',
  '(`not(regex(/[^{};]*[;}]/))`), gating `NestedPropertyDeclaration` AHEAD of the',
  'declaration arm. It asks only "is there a `{` before any `;`/`}`" — true of',
  'every nested RULE as well — so it is NECESSARY but not SUFFICIENT. Jess simply',
  'lacked the CSS guard.',
  '',
  'The fix is subtractive in effect: both supersets now reach the CSS decision.',
  '`directNestedPropertyAhead` is retained as the cheap FAST REJECT (deleting it',
  'costs ~70% on a declaration-only corpus, because every `color: red;` then',
  'speculatively parses its whole value before failing on the absent `{`), and a',
  'new `nestedPropertyColon` supplies the sufficient half.',
  '',
  '**The discriminator is the space after the colon, so nested properties survive.**',
  'A pseudo-class colon is adjacent to its name (`div:hover`), so a colon followed',
  'by whitespace — or by the block itself — cannot begin a pseudo-class:',
  '`font: 12px { weight: bold }` and `font: { weight: bold }` remain nested',
  'properties, while `color:red { … }` becomes the Ruleset the table requires.',
  '',
  'Two notes for whoever reads this next:',
  '',
  '- `adjacent()` / `notAdjacent()` **do not exist in parseman 0.46.0** (verified',
  '  against the installed package\'s exports). The condition is spelled with',
  '  `regex()`/`not()` instead; ledger G24\'s "spell adjacency negatively" is',
  '  honoured by the `not(...)` forms.',
  '- The rule could not live in `css-parser/src/grammar.ts` for the supersets to',
  '  import: the four grammars do not import each other, and a cross-module',
  '  combinator const does not macro-fuse. No third copy was authored — css and',
  '  less were left untouched and the supersets converged onto their decision.'
];

function writeReport(parseLane: LaneResult[], evalLane: LaneResult[]) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const failed = parseLane.filter(r => r.outcome === 'fail');

  const counts = BLOCKERS.map(([name]) => ({
    name,

    /** Files that give up ON this blocker — with `unattributed`, sums to the failure count. */
    primary: failed.filter(r => r.primaryBlocker === name).length,

    /** Files that contain it anywhere — overlapping, so it over-counts. */
    files: failed.filter(r => r.blockers?.includes(name)).length
  })).sort((a, b) => b.primary - a.primary || b.files - a.files);

  /** Failures whose give-up position matches no listed blocker. */
  const unattributed = failed.filter(r => r.primaryBlocker === undefined);

  const json = {
    generated: new Date().toISOString(),
    foundation: foundationVersion,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    parse: {
      total: parseLane.length,
      pass: parseLane.length - failed.length,
      blockerCounts: counts,
      unattributed: unattributed.map(r => r.file),
      results: parseLane
    },
    eval: {
      total: evalLane.length,
      pass: evalLane.filter(r => r.outcome === 'pass').length,
      results: evalLane
    }
  };
  writeFileSync(path.join(here, 'FOUNDATION-CORPUS-REPORT.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8');

  const l: string[] = [];
  l.push(`# Foundation for Sites ${foundationVersion} SCSS corpus report`, '');
  l.push('Generated by `foundation-corpus.test.ts` with `JESS_SCSS_CORPUS_REPORT=1`.', '');
  l.push('Reporting-only — outcomes measured, not gated. SCSS is a non-goal for feature');
  l.push('completeness; this inventory records where the eval model stands. The isolated');
  l.push('per-construct evidence is in `scss-construct-support.test.ts`.', '');
  l.push('## Run provenance', '');
  l.push(`- Generated: \`${json.generated}\``);
  l.push(`- Foundation for Sites: \`${foundationVersion}\``);
  l.push(`- Runner: \`${process.version}\` on \`${json.platform}\``, '');
  l.push('## Parse lane (all `foundation-sites/**/*.scss`)', '');
  l.push(`- files: **${json.parse.total}**, parsed: **${json.parse.pass}**, failed: **${failed.length}**`, '');
  l.push('Blocking constructs. `gives up on` counts files whose `gave up at` POSITION lands');
  l.push('on this blocker — the one the parser actually stopped at, so that column ranks');
  l.push('what to fix next. `contains` counts files holding it anywhere, which overlaps by');
  l.push('design and shows the total reach of a fix. A failure whose position matches no');
  l.push('listed blocker is counted as unattributed rather than given the nearest');
  l.push('plausible name: it means this list is missing an entry.', '');
  l.push('| blocking construct | gives up on | contains |', '|---|--:|--:|');
  counts.forEach(c => l.push(`| ${c.name} | ${c.primary} | ${c.files} |`));
  l.push(`| _unattributed — no listed blocker at the failure position_ | ${unattributed.length} | — |`);
  l.push('');
  if (unattributed.length > 0) {
    l.push('Unattributed failures:', '');
    unattributed.forEach(r => l.push(
      r.at === undefined
        ? `- \`${r.file}\` — the parser reported no position, so nothing can be attributed`
        : `- \`${r.file}\` — ${r.at} \`${(r.source ?? '').replace(/\|/g, '\\|')}\``
    ));
    l.push('');
  }
  l.push('### Parse failures', '');
  l.push('| file | gave up at | source | blocker at that position | all blockers |', '|---|---|---|---|---|');
  failed.forEach(r => l.push(
    `| \`${r.file}\` | ${r.at ?? '—'} | \`${(r.source ?? '').replace(/\|/g, '\\|')}\``
    + ` | ${r.primaryBlocker ?? '—'} | ${(r.blockers ?? []).join('; ') || '—'} |`
  ));
  l.push('');
  l.push('## Eval lane (self-contained entry points)', '');
  l.push(`- entries: **${json.eval.total}**, evaluated: **${json.eval.pass}**, failed: **${json.eval.total - json.eval.pass}**`, '');
  l.push('| entry | outcome | detail |', '|---|---|---|');
  evalLane.forEach(r => l.push(
    `| \`${r.file}\` | ${r.outcome} | ${r.detail ?? (r.bytes ? `${r.bytes}B css` : '—')} |`
  ));
  l.push('');
  l.push(...STANDING_SECTIONS);
  writeReportPreservingTail(path.join(here, 'FOUNDATION-CORPUS-REPORT.md'), l.join('\n'));
}
