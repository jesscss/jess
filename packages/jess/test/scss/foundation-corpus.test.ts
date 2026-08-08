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
 */
const BLOCKERS: Array<[string, RegExp]> = [
  // `$x: f($lightness: 1);`
  ['keyword argument ($name: v) in a function-call argument list', /[a-z][\w.-]*\(\s*(?:[^()]*?,\s*)?\$[\w-]+\s*:/],

  // `.a { @include m { color: red; } }`
  ['@include with a trailing content block', /@include[^;{}]*\{[ \t]*(?:\/\/.*)?$/m],

  // `$x: if($a == b, 1, 2);` — the same `==` parses fine in an @if condition.
  ['comparison (== / !=) inside a function-call argument list', /[a-z][\w.-]*\([^()]*(?:==|!=)/],

  // `@mixin m { @error "boom"; }`
  ['@error / @warn / @debug', /@(?:error|warn|debug)\b/],

  /*
   * `@function f($v) { @if $v { @return 1; } @return 2; }` — only a @return
   * directly in the @function body parses.
   */
  ['@return nested inside @if/@else', /@(?:if|else)[^{}]*\{[^{}]*@return/],

  // `@mixin m { @content; }`
  ['@content', /@content\b/],

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
  'docs/assets/scss/examples/_off-canvas.scss',
  'docs/assets/scss/examples/_orbit.scss',
  'docs/assets/scss/examples/_responsive-embed.scss',
  'docs/assets/scss/examples/_reveal.scss',
  'scss/components/_accordion-menu.scss',
  'scss/components/_accordion.scss',
  'scss/components/_badge.scss',
  'scss/components/_card.scss',
  'scss/components/_dropdown.scss',
  'scss/components/_flex-video.scss',
  'scss/components/_float.scss',
  'scss/components/_label.scss',
  'scss/components/_menu-icon.scss',
  'scss/components/_orbit.scss',
  'scss/components/_progress-bar.scss',
  'scss/components/_responsive-embed.scss',
  'scss/components/_sticky.scss',
  'scss/components/_thumbnail.scss',
  'scss/components/_title-bar.scss',
  'scss/components/_tooltip.scss',
  'scss/forms/_checkbox.scss',
  'scss/forms/_error.scss',
  'scss/forms/_fieldset.scss',
  'scss/forms/_forms.scss',
  'scss/forms/_help-text.scss',
  'scss/forms/_label.scss',
  'scss/forms/_meter.scss',
  'scss/forms/_progress.scss',
  'scss/forms/_range.scss',
  'scss/forms/_select.scss',
  'scss/forms/_text.scss',
  'scss/foundation.scss',
  'scss/grid/_grid.scss',
  'scss/grid/_size.scss',
  'scss/prototype/_arrow.scss',
  'scss/prototype/_box.scss',
  'scss/prototype/_prototype.scss',
  'scss/prototype/_rotate.scss',
  'scss/typography/_helpers.scss',
  'scss/typography/_print.scss',
  'scss/typography/_typography.scss',
  'scss/util/_selector.scss',
  'scss/util/_typography.scss',
  'scss/util/_util.scss',
  'scss/xy-grid/_layout.scss',
  'scss/xy-grid/_xy-grid.scss'
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
  writeFileSync(path.join(here, 'FOUNDATION-CORPUS-REPORT.md'), l.join('\n'), 'utf8');
}
