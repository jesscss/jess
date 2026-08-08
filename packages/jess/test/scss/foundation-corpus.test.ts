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
 * FOUNDATION-CORPUS-REPORT.md next to this file.
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
 * several, so these counts overlap by design. The report additionally ranks
 * by the EARLIEST blocker in each file, which is the one the parser actually
 * gave up on.
 *
 * An entry is REMOVED when the construct starts parsing, not left at zero: the
 * match is a presence regex, so a construct that parses would keep attracting
 * files that fail for an unrelated reason and would keep ranking as the
 * "earliest blocker" it no longer is. Closed so far: `@return` nested inside
 * `@if`/`@else`, `@include` with a trailing content block, and `@content`.
 */
const BLOCKERS: Array<[string, RegExp]> = [
  // `$x: f($lightness: 1);`
  ['keyword argument ($name: v) in a function-call argument list', /[a-z][\w.-]*\(\s*(?:[^()]*?,\s*)?\$[\w-]+\s*:/],

  // `$x: if($a == b, 1, 2);` — the same `==` parses fine in an @if condition.
  ['comparison (== / !=) inside a function-call argument list', /[a-z][\w.-]*\([^()]*(?:==|!=)/],

  // `@mixin m { @error "boom"; }`
  ['@error / @warn / @debug', /@(?:error|warn|debug)\b/],

  /*
   * `$m: (a, b, c,);` — a trailing comma in a parenthesized list. Surfaced by
   * closing the `@include`-content-block blocker: files now parse far enough to
   * reach it.
   */
  ['trailing comma in a parenthesized list', /,\s*\)/],

  // `.a:nth-child(#{$i}) { color: red; }`
  ['interpolation inside a pseudo-class argument list', /:{1,2}[\w-]+\([^()]*#\{/],

  // `@mixin m { @while $r { a: b; } }`
  ['@while', /@while\b/],

  // `.a { @at-root .b { color: red; } }` — bare `@at-root { … }` does parse.
  ['@at-root with a selector prelude', /@at-root\s+[^{\s]/],

  // `@function f($l, $v) { @return not not index($l, $v); }`
  ['chained unary `not not`', /\bnot\s+not\b/],

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
   * The blocker that occurs EARLIEST in the source — the one the parser
   * actually gave up on. `blockers` over-counts by design; this does not.
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

/** The blocker with the lowest match index — i.e. the first one the parser meets. */
const primaryBlockerIn = (src: string): string | undefined => {
  let best: string | undefined;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const [name, re] of BLOCKERS) {
    const match = src.match(re);
    if (match?.index !== undefined && match.index < bestAt) {
      bestAt = match.index;
      best = name;
    }
  }
  return best;
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
  try {
    parse(source);
  } catch (error) {
    if (
      typeof error === 'object' && error !== null
      && 'offset' in error && typeof error.offset === 'number'
    ) {
      ({ at, source: sourceLine } = locate(source, error.offset));
    }
  }
  return {
    file,
    outcome: 'fail',
    at,
    source: sourceLine,
    blockers: blockersIn(source),
    primaryBlocker: primaryBlockerIn(source),
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
  '_vendor/sassy-lists/stylesheets/functions/_purge.scss',
  '_vendor/sassy-lists/stylesheets/functions/_remove.scss',
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
  'scss/util/_selector.scss',
  'scss/util/_typography.scss',
  'scss/util/_util.scss',
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
  '',
  'Recorded against the ranked table above. These decide WHAT each construct lowers',
  'to. Rows marked LANDED are implemented; the rest are still design-only.',
  '',
  '| # | blocker | ruling |',
  '| --- | --- | --- |',
  '| 1 | keyword arg `$name: v` in a call arg list | **Real gap — OPEN, and it is an AST change, not a grammar change.** Less v5, Sass+ and Jess all admit direct assignment, keyed on what `defineFunction` exposes on the returned function object (`params`, each with a `name`). Not a Sass-only affordance. **No new AST kind is owed**: `.less` `.m(@a: 1)` already lowers to `MixinCall.args = [{name:\'a\', value}]`, i.e. `CallArg` (`packages/core/src/ast/mixin-dispatch.ts:30`), and `$name: value` is the same `.jess` spelling in either call — §12.0\'s first test makes them the SAME node. What blocks it is that `FunctionCall.args` is `ValueSlot[]` (`nodes.ts:277`) and cannot carry a name. Converting it to `CallArg[]` is a hidden-class change to the hottest value node in the tree and touches ~65 read sites (43 `.args` in `serialize.ts`, 22 in `packages/fns/src`) plus 29 `funcCall(` construction sites across all four grammars. Sized, designed, not started. |',
  '| 2 | `@include` with a trailing content block | **LANDED.** Lowers to `.jess` `$ > m(): @{ … }` — a `MixinCall` carrying the block on a `content` slot, with Sass `using (…)` becoming that block AnonymousMixin `params`. The block is NOT an argument: it binds the callee-visible `content` variable that #6 reads. No new AST kind. |',
  '| 3 | `@error` / `@warn` / `@debug` | **They do not become NODES.** That is the operative point — not that they are no-ops. They are compile-time diagnostics with no `.jess` spelling, so by §12.0\'s law no AST kind is owed one. Plugin *visitor* support for specific cases is worth reasoning about separately; it does not require a node. |',
  '| 4 | `==` / `!=` inside a call arg list | **LANDED for `.scss`.** Becomes an `Expression` over a `Condition`, per §4.5.2: a call argument is value position, so a comparison there needs the `$( … )` boundary, and the lowering supplies it because Sass source has no `$( … )` to write. Neither kind is new. Implemented as the single `CallArgument` const in `scss-parser/src/grammar.ts`, referenced by both argument sites (`Call`\'s head and `ArgumentPair`\'s tail). `==` / `!=` lower to the `sass-equal` primitive, the same lowering `IfComparison` already performs, so a comparison cannot mean one thing in a guard and another in an argument. **`.jess` needs no change, and that is the rule rather than a gap**: §4.5.2 says "if it computes, it is inside `$( )` — no exceptions". Sass has no `$( … )` to write, so the lowering must supply the boundary; `.jess` HAS the marker, so a bare `f($x == 1)` must stay a parse error and the author writes `f($($x == 1))` — which already parses. `.less` already routes `if(@x = 1, …)` through `FunctionCondition` (§4.5.3a). So this blocker was only ever `.scss`. |',
  '| 5 | `@return` nested inside `@if`/`@else` | **LANDED.** Only top-level `@return` parsing was the bug: `ReturnRule` is now an `IfBody` arm too, building the same `result:` Declaration §4.5.3b already used — verified byte-equal to the tree a top-level `@return` builds. No new AST kind. |',
  '| 6 | `@content` | **LANDED (bare form).** Lowers to the documented built-in `$content()` — a `Reference` on a live `content` `Lookup` with one `Call` step, asserted EQUAL to the tree the Jess grammar builds for `$content()`. No new AST kind. The parameterised `$content($type)` form PARSES but does not EVALUATE: a statement-position call WITH arguments to a variable-bound `AnonymousMixin` is a pre-existing core gap that `.jess` own `$m: @($c) { … }` spelling cannot reach either. Foundation uses only the bare form. |',
  '| 7 | `@while` | Gets a **`$while`**, alongside `$if` / `$for`. |',
  '| 8 | chained unary `not not` | Sass `not not $x` lowers to `.jess` `not(not($x))`. Falls out of §4.5.4\'s rule that `not` always takes parens. |',
  '| 9 | nested selector list `type:pseudo, .class` | **A grammar defect, and the rule is fully specified — see below.** |',
  '| 10 | interpolation in a pseudo-class arg | Not yet ruled on. |',
  '| 11 | `@at-root` with a selector prelude | **Needs a decision.** Bare `@at-root { … }` already parses. |',
  '',
  '**Sequencing note:** #2, #5 and #6 are LANDED, together — #6 IS the lowering',
  'target for #2, so neither closes alone. #1 and #9 are defects. #10 and #11 are',
  'the only ones still needing a ruling. Closing these three surfaced one new entry',
  'in the ranked table above: a trailing comma in a parenthesized list, which files',
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
  'The peek is therefore the NARROW case, not the default. Today the parser does',
  'the opposite: a leading `div:` commits to the declaration path unconditionally,',
  'which is why `div:hover, span` and `div:hover, [a]` parse while `div:hover, .b`',
  'does not — the difference is only what may follow in a VALUE, nothing about',
  'selectors.',
  '',
  '**Spell the colon condition with parseman\'s adjacency combinators, not a',
  'hand-rolled lookahead.** `adjacent()` / `notAdjacent()` are exported from',
  '`parseman` (`src/combinators/adjacency.ts`) and carry a real `AdjacencyDef` with',
  'polarity, so "colon not followed by a space" is a first-class grammar fact rather',
  'than a regex — and it keeps adjacency spelled negatively, per ledger G24.',
  '',
  '**It belongs in the CSS base and the supersets must REUSE it.** This is ordinary',
  'CSS disambiguation; every dialect reimplementing its own is how they drifted',
  'apart in the first place.'
];

function writeReport(parseLane: LaneResult[], evalLane: LaneResult[]) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const failed = parseLane.filter(r => r.outcome === 'fail');

  const counts = BLOCKERS.map(([name]) => ({
    name,

    /** Files whose FIRST blocker this is — sums to the failure count. */
    primary: failed.filter(r => r.primaryBlocker === name).length,

    /** Files that contain it anywhere — overlapping, so it over-counts. */
    files: failed.filter(r => r.blockers?.includes(name)).length
  })).sort((a, b) => b.primary - a.primary || b.files - a.files);

  const json = {
    generated: new Date().toISOString(),
    foundation: foundationVersion,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    parse: {
      total: parseLane.length,
      pass: parseLane.length - failed.length,
      blockerCounts: counts,
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
  l.push('Blocking constructs. `first` counts files where this is the EARLIEST blocker —');
  l.push('the one the parser actually gave up on, so that column sums to the failure');
  l.push('count and ranks what to fix next. `contains` counts files holding it anywhere,');
  l.push('which overlaps by design and shows the total reach of a fix.', '');
  l.push('| blocking construct | first | contains |', '|---|--:|--:|');
  counts.forEach(c => l.push(`| ${c.name} | ${c.primary} | ${c.files} |`));
  l.push('');
  l.push('### Parse failures', '');
  l.push('| file | gave up at | source | first blocker | all blockers |', '|---|---|---|---|---|');
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
  l.push('');
  writeFileSync(path.join(here, 'FOUNDATION-CORPUS-REPORT.md'), l.join('\n'), 'utf8');
}
