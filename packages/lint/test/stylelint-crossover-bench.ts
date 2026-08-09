/**
 * Stylelint-vs-jess CROSSOVER benchmark.
 *
 * ## What question this instrument answers
 *
 * The hypothesis under test is NOT "jess is faster". It is a structural claim:
 *
 * > postcss is fast because it is SHALLOW — declaration values and selectors
 * > stay raw strings. stylelint pays that back repeatedly, because each rule
 * > re-parses: `postcss-value-parser` per value-touching rule,
 * > `postcss-selector-parser` per selector-touching rule, once per node. A
 * > large config re-parses the same value many times. jess parses deeply ONCE,
 * > so a lint rule reading the existing tree is a walk with no re-parse.
 *
 * If that is true, stylelint's cost grows with RULE COUNT and jess's does not,
 * so there is a crossover: below some rule count postcss+stylelint wins on the
 * shallower parse, above it jess wins on the absent re-parse. This script
 * measures where that crossover is, and it is built to be able to REFUTE the
 * hypothesis — see "how this can come back negative" below.
 *
 * ## Why the cases are shaped the way they are
 *
 * The re-parse claim is about a PER-RULE unit cost, so the instrument measures
 * that unit directly instead of inferring it from stylelint's total. Cases
 * `pc-values-1x` and `pc-selectors-1x` each do exactly what ONE value-touching
 * or ONE selector-touching stylelint rule does to the whole corpus: walk the
 * already-parsed postcss tree and re-parse every `decl.value` /
 * `rule.selector`. Multiplying those by the rule count of a config predicts
 * stylelint's growth, and `stylelint-full` is the independent check on that
 * prediction. A model with no check on it is an assertion.
 *
 * The postcss modules are resolved through stylelint's OWN resolution root, so
 * the timed re-parse uses the exact instances stylelint uses (postcss 8.5.23,
 * postcss-value-parser 4.2.0, postcss-selector-parser 7.1.4 in this lockfile).
 * Resolving them from this package instead would silently time a DIFFERENT
 * copy — pnpm's store has three postcss majors in it.
 *
 * ## How this can come back negative, which is the point
 *
 * Two ways the hypothesis dies, and both are measured rather than assumed:
 *
 *  - **The deep parse is too expensive.** If `jess-parse` alone exceeds
 *    stylelint's whole run at a realistic rule count, "parse once" never pays
 *    back and the crossover is off the right edge. That is why `jess-parse` is
 *    timed BARE, with no lint work in it.
 *  - **The tree is not actually free to read.** `jess-walk` is a full traversal
 *    of the parsed CST that touches every node and leaf. If a walk is itself
 *    expensive, "a lint rule is just a tree walk" is not the cheap operation
 *    the hypothesis needs it to be.
 *
 * `node-counts` reports the structural facts the ratios have to be read
 * against: declarations, selectors, postcss nodes, and jess CST nodes. jess's
 * CST is PLAIN EAGER DATA — `CssCstNode` in `css-parser/src/cst-host.ts` is a
 * frozen-shape record of `rules`/`children` arrays with no getters and no
 * proxy — so there is no lazy-structure fraction to discount on this path. The
 * lazy materialization in AST v2 is VALUE-domain typing at eval time
 * (`ast/literal-tag.ts`, `ast/value-eval.ts`), which the lint path never
 * enters. The fraction that matters here is therefore how much of an eager
 * tree a config TOUCHES, which is what `jess-walk` bounds from above.
 *
 * ## Measurement discipline
 *
 * Interleaved rounds, not blocked: every round runs every case, in a rotated
 * order, so a thermal or JIT drift during the run hits all cases rather than
 * whichever one ran last. Reported as median with p05/p95 and min/max — a mean
 * alone hides exactly the spread that has produced retracted findings in this
 * repo. Defaults are 5 warmups and 15 rounds; n=3 is not a measurement.
 *
 * Everything is measured in ONE process against ONE checkout. Comparing across
 * git worktrees is not available to this instrument by construction, because a
 * cross-worktree comparison in this repo has already produced a 56% "finding"
 * that was pure directory bias and had to be retracted.
 *
 * Usage:
 *   node --expose-gc packages/lint/test/stylelint-crossover-bench.ts
 *   ... --rounds 25 --warmups 8 --only jess-parse,stylelint-full
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const requireHere = createRequire(import.meta.url);

/*
 * Resolve postcss and its two satellite parsers through STYLELINT's resolution
 * root rather than this package's. The re-parse cost being attributed to
 * stylelint has to be the cost of the code stylelint actually runs; this
 * lockfile carries postcss 6, 8.5.6 and 8.5.23 simultaneously, so resolving
 * from here would time a copy nothing under test uses.
 */
const stylelintEntry = requireHere.resolve('stylelint');
const fromStylelint = createRequire(stylelintEntry);

const postcss = fromStylelint('postcss') as typeof import('postcss');
const valueParser = fromStylelint('postcss-value-parser') as (v: string) => unknown;
const selectorParser = fromStylelint('postcss-selector-parser') as (
  fn?: (root: unknown) => void
) => { processSync: (sel: string) => unknown };

type CorpusEntry = { id: string; bucket: string; path: string };

/** Anything the timed body produces is folded here so V8 cannot dead-code it. */
let sink = 0;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function intArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(`--${name} must be a non-negative integer`);
    process.exit(2);
  }
  return value;
}

const ROUNDS = intArg('rounds', 15);
const WARMUPS = intArg('warmups', 5);
const only = arg('only')?.split(',').map(s => s.trim()).filter(Boolean);

function maybeGc(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === 'function') {
    gc();
  }
}

/* ------------------------------------------------------------------ corpus */

/*
 * The corpus is the committed render-differential one, imported rather than
 * re-globbed. Forking it would let this benchmark's population drift away from
 * the one the differential gates on, and a corpus that quietly shrinks yields a
 * smaller-but-plausible number rather than a failure.
 */
const CORPUS_MODULE =
  '../../syntax/css/css-parser/test/render-differential/corpus.mjs';

type CorpusModule = {
  buildCorpus: () => { entries: CorpusEntry[]; buckets: Record<string, number>; bootstrapVersion: string };
  readEntry: (entry: CorpusEntry) => string;
};

const corpusModule = await import(
  new URL(CORPUS_MODULE, import.meta.url).href
) as CorpusModule;

const corpus = corpusModule.buildCorpus();

/*
 * Sources are read ONCE, up front. File IO inside a timed batch would measure
 * the page cache, and it would measure it differently for whichever case ran
 * first.
 */
const allSources: Array<{ id: string; source: string }> = corpus.entries.map(entry => ({
  id: entry.id,
  source: corpusModule.readEntry(entry)
}));

/* --------------------------------------------------------------- rule order */

/**
 * The rule order both sweeps take a prefix of.
 *
 * ONE list, used to build both the stylelint config and the jess config, so
 * `stylelint-K` and `jess-lint-K` are always running the same K checks. Two
 * lists would let the configs drift and turn an architectural comparison into a
 * workload comparison. Every name here exists in both tools — jess deliberately
 * mirrors stylelint's rule names (`packages/lint/src/rules.ts`), which is what
 * makes this benchmark possible.
 *
 * The order interleaves the expensive kinds with the cheap ones. Front-loading
 * the value-touching and selector-touching rules would manufacture a steep
 * early slope and flatter the hypothesis; sorting them to the back would hide
 * it. A prefix of this order is meant to read as a plausible config someone
 * would actually adopt at that size.
 */
const SHARED_RULE_ORDER: readonly string[] = [
  'block-no-empty',
  'color-no-invalid-hex',
  'selector-pseudo-class-no-unknown',
  'length-zero-no-unit',
  'property-no-unknown',
  'selector-pseudo-element-no-unknown',
  'unit-no-unknown',
  'at-rule-no-unknown',
  'function-no-unknown',
  'selector-type-no-unknown',
  'declaration-block-no-duplicate-properties',
  'font-family-no-duplicate-names',
  'selector-anb-no-unmatchable',
  'declaration-no-important',
  'custom-property-no-missing-var-function',
  'media-feature-name-no-unknown',
  'declaration-block-no-shorthand-property-overrides',
  'named-grid-areas-no-invalid',
  'keyframe-declaration-no-important',
  'no-duplicate-at-import-rules',
  'font-family-no-missing-generic-family-keyword',
  'function-linear-gradient-no-nonstandard-direction',
  'declaration-block-no-duplicate-custom-properties',
  'keyframe-block-no-duplicate-selectors',
  'at-rule-descriptor-no-unknown',
  'media-feature-name-value-no-unknown',
  'no-invalid-position-at-import-rule'
];

/* -------------------------------------------------------------------- jess */

/*
 * `@jesscss/css-parser` is not a direct dependency of this package — the lint
 * path reaches it THROUGH `@jesscss/diagnostics-core`. Resolving it from
 * diagnostics-core's root rather than adding a dependency here keeps the timed
 * parser the same instance `collectTolerantDiagnostics` uses; a second copy
 * would have its own JIT state and its own compiled parseman table.
 */
const fromDiagnostics = createRequire(requireHere.resolve('@jesscss/diagnostics-core'));

const { parseCssCst } = await import(
  fromDiagnostics.resolve('@jesscss/css-parser/cst/positions')
) as {
  parseCssCst: (source: string) => { tree: unknown; errors: unknown[] };
};

/*
 * Built output, not `src/`. Everything else in this repo that measures jess
 * measures `lib/`, and a type-stripped `src/` run would be timing a different
 * artifact than the one the gates and the published package use. Requires
 * `pnpm --filter @jesscss/lint build` first — a stale `lib/` fails silently as
 * a plausible-looking number.
 */
const { lintText, STYLELINT_COMPARISON_LINT_CONFIG } = await import('../lib/index.js') as {
  lintText: (input: unknown, options: unknown) => Promise<{ diagnostics: unknown[] }>;
  STYLELINT_COMPARISON_LINT_CONFIG: { reportSyntax: boolean; rules: Record<string, unknown> };
};

/**
 * A jess lint config restricted to the first K rules of the shared order.
 *
 * jess names its rules the same as stylelint does, which is what makes the two
 * sweeps comparable at all: `stylelint-K` and `jess-lint-K` run the SAME K
 * checks, so any difference in slope is a difference in architecture rather
 * than in workload.
 *
 * Rules outside the prefix are set to `false` rather than deleted. The config
 * enumerates all 72 known rules and an absent key is not the same as a disabled
 * one; deleting would let a default policy silently switch a rule back on and
 * flatten the very slope this sweep exists to measure.
 */
function jessConfig(ruleCount: number): { reportSyntax: boolean; rules: Record<string, unknown> } {
  const keep = new Set(SHARED_RULE_ORDER.slice(0, ruleCount));
  const rules: Record<string, unknown> = {};
  for (const [name, setting] of Object.entries(STYLELINT_COMPARISON_LINT_CONFIG.rules)) {
    rules[name] = keep.has(name) ? setting : false;
  }
  return { reportSyntax: false, rules };
}

type CstChild = {
  _tag: 'node' | 'leaf' | 'error';
  rules?: CstChild[];
  children?: CstChild[];
  value?: string;
};

/**
 * Full traversal of a jess CST, touching every node and every leaf value.
 *
 * This is the UPPER BOUND on what a lint rule reading the tree can cost, which
 * is the quantity the hypothesis needs: if the maximal walk is already cheap
 * relative to one re-parse pass, then adding lint rules to jess is close to
 * free regardless of what any individual rule looks at. A walk that visited
 * only part of the tree would flatter the result.
 *
 * ONLY `children` is descended, deliberately. `CssCstNode` exposes both `rules`
 * and `children`, and they are not two halves of the tree — they hold the SAME
 * child references (`assertRulesAliasChildren` below proves it over the whole
 * corpus). Descending both multiplies every subtree by two per level, which is
 * not a slow walk but an exponential one: the first version of this function
 * did exactly that and reported 15.1 BILLION nodes for a corpus whose real node
 * count is five orders of magnitude smaller. It did not crash and it did not
 * look wrong in the timings — it simply made `jess-parse+walk` meaningless.
 */
function walkCst(node: CstChild): number {
  let count = 1;
  if (node._tag === 'leaf') {
    sink += node.value === undefined ? 0 : node.value.length;
    return count;
  }
  const children = node.children;
  if (children !== undefined) {
    for (let i = 0; i < children.length; i++) {
      count += walkCst(children[i]!);
    }
  }
  return count;
}

/**
 * Prove the aliasing the walk depends on, rather than trusting the sample that
 * first revealed it. If a CST node ever carries a `rules` entry that is not
 * also in `children`, `walkCst` is silently skipping part of the tree and every
 * ratio below it is understated — so this throws instead of warning.
 */
function assertRulesAliasChildren(node: CstChild, id: string): void {
  if (node._tag === 'leaf') {
    return;
  }
  const rules = node.rules;
  const children = node.children;
  if (rules !== undefined && rules.length > 0) {
    const set = new Set(children ?? []);
    for (const rule of rules) {
      if (!set.has(rule)) {
        throw new Error(
          `${id}: CST node has a \`rules\` child absent from \`children\`; `
          + 'walkCst would undercount. Fix the walk before trusting any number here.'
        );
      }
    }
  }
  for (const child of children ?? []) {
    assertRulesAliasChildren(child, id);
  }
}

/* -------------------------------------------------------------- population */

/*
 * The corpus deliberately contains sources that are NOT valid CSS — the
 * `fixture/calc-rejects.css` entry exists so the render differential can hash a
 * REJECTION, and postcss throws a `CssSyntaxError` on it. Timing a case that
 * throws would compare a parse against an exception unwind.
 *
 * So the timed population is the INTERSECTION: files both postcss and jess
 * parse without throwing. The exclusions are reported by id rather than as a
 * count, because "we dropped some files" is exactly the kind of quiet shrink
 * that turns a smaller corpus into a confident wrong answer.
 */
const excluded: Array<{ id: string; by: string; reason: string }> = [];

const sources = allSources.filter(({ id, source }) => {
  try {
    postcss.parse(source, { from: `${id}.css` });
  } catch (error) {
    excluded.push({ id, by: 'postcss', reason: (error as Error).name });
    return false;
  }
  try {
    parseCssCst(source);
  } catch (error) {
    excluded.push({ id, by: 'jess', reason: (error as Error).name });
    return false;
  }
  return true;
});

for (const { id, source } of sources) {
  assertRulesAliasChildren(parseCssCst(source).tree as CstChild, id);
}

/* ---------------------------------------------------------------- stylelint */

const stylelint = (await import('stylelint')).default as {
  lint: (opts: unknown) => Promise<{ results: Array<{ warnings: unknown[] }> }>;
};

function stylelintConfig(ruleCount: number): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  for (const name of SHARED_RULE_ORDER.slice(0, ruleCount)) {
    rules[name] = true;
  }
  return rules;
}

async function runStylelint(ruleCount: number): Promise<void> {
  for (const { id, source } of sources) {
    const result = await stylelint.lint({
      code: source,
      codeFilename: `${id}.css`,
      disableDefaultIgnores: true,
      quietDeprecationWarnings: true,
      config: { rules: stylelintConfig(ruleCount) }
    });
    sink += result.results[0]?.warnings.length ?? 0;
  }
}

/*
 * A third exclusion pass, for files stylelint itself CRASHES on. This is not a
 * hypothetical: stylelint 17.14.1's `declaration-no-important` throws
 * `TypeError: Cannot read properties of undefined (reading 'index')` at
 * `lib/rules/declaration-no-important/index.mjs:39` on
 * `css-parser/test/css/important.css`, whose exotic `!` / comment / `important`
 * spellings defeat its `!important` index search.
 *
 * The crash is reported rather than routed around silently, because "stylelint
 * cannot lint this file at all" is a result about the comparison, not noise to
 * be swallowed. The alternative — dropping `declaration-no-important` from the
 * config — would quietly make the config less realistic to protect the number.
 */
for (let i = sources.length - 1; i >= 0; i--) {
  const { id, source } = sources[i]!;
  try {
    await stylelint.lint({
      code: source,
      codeFilename: `${id}.css`,
      disableDefaultIgnores: true,
      quietDeprecationWarnings: true,
      config: { rules: stylelintConfig(SHARED_RULE_ORDER.length) }
    });
  } catch (error) {
    excluded.push({ id, by: 'stylelint', reason: (error as Error).message });
    sources.splice(i, 1);
  }
}

/*
 * Floor on the surviving population.
 *
 * The three exclusion passes above are each a way for this benchmark to end up
 * timing almost nothing while still printing a complete, plausible-looking
 * report. That is not hypothetical: a refactor briefly left the stylelint
 * preflight referencing a renamed constant, every file landed in its `catch`,
 * and the run reported a tidy `0.03ms` for a 27-rule lint of an EMPTY corpus.
 * Nothing about the output looked wrong.
 *
 * So the population is asserted, not inspected. 100 of the declared 119 is well
 * clear of the dozen genuinely-unparseable entries and nowhere near the total.
 */
const MINIMUM_TIMED_FILES = 100;

if (sources.length < MINIMUM_TIMED_FILES) {
  throw new Error(
    `only ${sources.length} of ${allSources.length} corpus files survived preflight `
    + `(floor ${MINIMUM_TIMED_FILES}). Every timing below would be measuring a corpus `
    + `that quietly shrank. Exclusions: ${JSON.stringify(excluded, null, 2)}`
  );
}

const totalBytes = sources.reduce((sum, s) => sum + Buffer.byteLength(s.source, 'utf8'), 0);

/* ------------------------------------------------------------------- cases */

type Case = { name: string; run: () => Promise<void> | void; samples: number[] };

/*
 * `postcss.parse` is lazy about NOTHING structurally, but its `Root` does defer
 * some work to first access, so each parsed tree is walked to `nodes.length` —
 * enough to force the tree without doing the re-parse the next case measures.
 */
function postcssParseAll(): Array<{ root: unknown; decls: string[]; selectors: string[] }> {
  const out: Array<{ root: unknown; decls: string[]; selectors: string[] }> = [];
  for (const { id, source } of sources) {
    const root = postcss.parse(source, { from: `${id}.css` });
    const decls: string[] = [];
    const selectors: string[] = [];
    root.walkDecls((decl) => {
      decls.push(decl.value);
    });
    root.walkRules((rule) => {
      selectors.push(rule.selector);
    });
    out.push({ root, decls, selectors });
    sink += decls.length + selectors.length;
  }
  return out;
}

/* Parsed once outside the timed batches, so the re-parse cases time re-parsing
 * and not parsing. */
const parsedPostcss = postcssParseAll();
const allDecls = parsedPostcss.flatMap(p => p.decls);
const allSelectors = parsedPostcss.flatMap(p => p.selectors);

const cases: Case[] = [
  {
    name: 'postcss-parse',
    run: () => {
      for (const { id, source } of sources) {
        const root = postcss.parse(source, { from: `${id}.css` });
        sink += root.nodes.length;
      }
    },
    samples: []
  },
  {
    name: 'pc-values-1x',
    run: () => {
      for (let i = 0; i < allDecls.length; i++) {
        sink += (valueParser(allDecls[i]!) as { nodes: unknown[] }).nodes.length;
      }
    },
    samples: []
  },
  {
    name: 'pc-selectors-1x',
    run: () => {
      const proc = selectorParser();
      for (let i = 0; i < allSelectors.length; i++) {
        try {
          sink += (proc.processSync(allSelectors[i]!) as { length?: number }).length ?? 1;
        } catch {
          sink += 1;
        }
      }
    },
    samples: []
  },
  {
    name: 'jess-parse',
    run: () => {
      for (const { source } of sources) {
        const result = parseCssCst(source);
        sink += result.errors.length;
      }
    },
    samples: []
  },
  {
    name: 'jess-parse+walk',
    run: () => {
      for (const { source } of sources) {
        const result = parseCssCst(source);
        sink += walkCst(result.tree as CstChild);
      }
    },
    samples: []
  }
];

async function runJessLint(ruleCount: number): Promise<void> {
  const config = jessConfig(ruleCount);
  for (const { id, source } of sources) {
    const result = await lintText(
      { source, filePath: `${id}.css`, language: 'css' },
      { stylesConfig: { lint: config } }
    );
    sink += result.diagnostics.length;
  }
}

/*
 * The rule-count sweep — the whole experiment.
 *
 * The hypothesis predicts two different SLOPES, not two different totals:
 * stylelint should climb with rule count because each added rule re-parses,
 * while jess should stay flat because each added rule is another read of a tree
 * that already exists. A crossover exists only if those slopes actually differ.
 *
 * Running BOTH sweeps is what makes this able to refute rather than confirm. A
 * single fixed `jess-lint` number compared against a stylelint sweep would show
 * a crossover no matter what jess's slope is — including the case where jess
 * climbs just as fast and the "parse once" advantage is imaginary.
 */
const SWEEP = [1, 2, 4, 8, 16, 27];
for (const k of SWEEP) {
  cases.push({ name: `stylelint-${k}`, run: () => runStylelint(k), samples: [] });
  cases.push({ name: `jess-lint-${k}`, run: () => runJessLint(k), samples: [] });
}

const selected = only === undefined
  ? cases
  : cases.filter(c => only.includes(c.name));

if (selected.length === 0) {
  console.error(`--only matched no cases. Available: ${cases.map(c => c.name).join(', ')}`);
  process.exit(2);
}

/* ------------------------------------------------------------------ timing */

async function timeOnce(run: () => Promise<void> | void): Promise<number> {
  const start = process.hrtime.bigint();
  await run();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function summarize(samples: number[]): {
  median: number; mean: number; p05: number; p95: number; min: number; max: number; spreadPct: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))]!;
  const median = at(0.5);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  return {
    median,
    mean,
    p05: at(0.05),
    p95: at(0.95),
    min,
    max,

    /* Reported because a ratio between two cases is only meaningful if it is
     * larger than the noise floor of the cases it divides. */
    spreadPct: median === 0 ? 0 : ((max - min) / median) * 100
  };
}

for (const c of selected) {
  for (let i = 0; i < WARMUPS; i++) {
    await c.run();
  }
}

for (let round = 0; round < ROUNDS; round++) {
  for (let i = 0; i < selected.length; i++) {
    /* Rotate the order every round so drift is not systematically charged to
     * whichever case is scheduled last. */
    const c = selected[(round + i) % selected.length]!;
    maybeGc();
    c.samples.push(await timeOnce(c.run));
  }
}

/* ------------------------------------------------------------------ report */

const nodeCounts = (() => {
  let postcssNodes = 0;
  for (const { source } of sources) {
    const root = postcss.parse(source);
    root.walk(() => {
      postcssNodes++;
    });
  }
  let cstNodes = 0;
  for (const { source } of sources) {
    cstNodes += walkCst(parseCssCst(source).tree as CstChild);
  }
  return { postcssNodes, cstNodes };
})();

console.log(JSON.stringify({
  meta: {
    node: process.version,
    rounds: ROUNDS,
    warmups: WARMUPS,
    gc: typeof (globalThis as { gc?: unknown }).gc === 'function',
    corpusFilesDeclared: allSources.length,
    corpusFilesTimed: sources.length,
    excluded,
    corpusBuckets: corpus.buckets,
    bootstrapVersion: corpus.bootstrapVersion,
    corpusBytes: totalBytes,
    postcssVersion: fromStylelint('postcss/package.json').version,
    valueParserVersion: fromStylelint('postcss-value-parser/package.json').version,
    selectorParserVersion: fromStylelint('postcss-selector-parser/package.json').version,
    stylelintPath: path.relative(process.cwd(), stylelintEntry)
  },
  structure: {
    declarations: allDecls.length,
    selectors: allSelectors.length,
    postcssNodes: nodeCounts.postcssNodes,
    jessCstNodes: nodeCounts.cstNodes
  },
  cases: Object.fromEntries(
    selected.map(c => [c.name, { ...summarize(c.samples), n: c.samples.length }])
  ),
  sink
}, null, 2));
