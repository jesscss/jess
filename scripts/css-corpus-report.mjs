/**
 * Measure the external CSS parse corpus against all four dialect grammars and
 * print a triage report.
 *
 * A corpus is a MEASUREMENT before it is a gate. This script gates nothing: it
 * prints pass rates per dialect and buckets the failures, so the buckets can be
 * read before anyone argues about a ratchet.
 *
 * The standing ruling it exists to check: **valid CSS is valid in all four
 * dialects**, one-way. A construct that parses in `scss` but not in `css` is a
 * defect in `css`, not a dialect feature.
 *
 * Requires built parsers (`lib/grammar/ast.js`) — see the repo build order.
 *
 *   node scripts/materialize-css-corpus.mjs
 *   node scripts/css-corpus-report.mjs [--json <file>] [--source csstree,wpt,real-world]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'parseman';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestFile = path.join(root, '.cache', 'css-corpus', 'manifest.json');

if (!fs.existsSync(manifestFile)) {
  throw new Error(
    `[css-corpus] no manifest at ${manifestFile}. Run \`node scripts/materialize-css-corpus.mjs\` first.`
  );
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (manifest.entries.length !== manifest.total) {
  throw new Error(
    `[css-corpus] manifest says ${manifest.total} entries but carries ${manifest.entries.length}.`
  );
}

const DIALECTS = ['css', 'less', 'scss', 'jess'];

const GRAMMAR_PATHS = {
  css: 'packages/syntax/css/css-parser/lib/grammar/ast.js',
  less: 'packages/syntax/less/less-parser/lib/grammar/ast.js',
  scss: 'packages/syntax/scss/scss-parser/lib/grammar/ast.js',
  jess: 'packages/syntax/jess/jess-parser/lib/grammar/ast.js'
};

const GRAMMAR_EXPORTS = {
  css: 'cssGrammar',
  less: 'lessGrammar',
  scss: 'scssGrammar',
  jess: 'jessGrammar'
};

async function loadGrammar(dialect) {
  const file = path.join(root, GRAMMAR_PATHS[dialect]);
  if (!fs.existsSync(file)) {
    throw new Error(
      `[css-corpus] ${dialect} grammar not built at ${file}. Build parser-shared first, then the parsers.`
    );
  }
  const module = await import(`file://${file}`);
  const grammar = module[GRAMMAR_EXPORTS[dialect]];
  if (grammar === undefined || grammar.Stylesheet === undefined) {
    throw new Error(`[css-corpus] ${dialect} grammar has no Stylesheet entry`);
  }
  return grammar;
}

/**
 * The parse verdict.
 *
 * `ok` alone is not it: parseman reports `ok` for a run that consumed nothing,
 * which made 1,467 non-consuming parses read as successes in the sass-spec
 * baseline. `span.end === source.length` is not it either — whether the root
 * span covers trailing trivia is a per-dialect convention, and it differs on
 * two of the four. `ok && unconsumedFrom === null` is the one formulation that
 * means the same thing in every dialect; recovery errors are excluded on top of
 * it because the public `parse()` throws on the first one.
 *
 * This MUST stay identical to `parseVerdict` in `test/dialects.ts`. The two
 * exist because this script measures built `lib` and the test measures `src`;
 * a divergence in the definition alone would read as a src/lib divergence.
 */
function parses(grammar, source) {
  let result;
  try {
    result = run(grammar.Stylesheet, source, { trivia: grammar.whitespace });
  } catch (error) {
    /* A reducer invariant that blew up rather than declining the input. */
    return { ok: false, crashed: String(error && error.message).slice(0, 160), expected: [] };
  }
  return {
    ok: result.ok && result.unconsumedFrom === null && result.errors.length === 0,
    recovered: result.errors.length,
    unconsumedFrom: result.unconsumedFrom,
    expected: result.ok ? [] : (result.expected ?? []).slice(0, 6)
  };
}

/**
 * Bucket a failing entry by the construct that most likely caused it.
 *
 * Buckets are matched in order and the first hit wins, so a percentage keyframe
 * selector is reported as `@keyframes`, not as `percentage`. The useful output
 * is "N failures, of which M are one missing construct" — a percentage tells
 * nobody what to fix.
 */
const BUCKETS = [
  ['@keyframes', s => /@(-\w+-)?keyframes\b/i.test(s)],
  ['@supports', s => /@supports\b/i.test(s)],
  ['@container', s => /@container\b/i.test(s)],
  ['@layer', s => /@layer\b/i.test(s)],
  ['@scope', s => /@scope\b/i.test(s)],
  ['@property', s => /@property\b/i.test(s)],
  ['@font-feature-values', s => /@(font-feature-values|swash|annotation|ornaments|stylistic|styleset|character-variant)\b/i.test(s)],
  ['@position-try', s => /@position-try\b/i.test(s)],
  ['@page', s => /@page\b/i.test(s)],
  ['@media', s => /@media\b/i.test(s)],
  ['@import', s => /@import\b/i.test(s)],
  ['@namespace', s => /@namespace\b/i.test(s)],
  ['@charset', s => /@charset\b/i.test(s)],
  ['@font-face', s => /@font-face\b/i.test(s)],
  ['@counter-style', s => /@counter-style\b/i.test(s)],
  ['at-rule (other)', s => /@[-\w\\]/.test(s)],
  ['custom-property', s => /--[\w-]*\s*:/.test(s)],
  ['nth / an+b', s => /:nth-[\w-]+\(/i.test(s)],
  ['attribute selector', s => /\[[^\]]*[~|^$*]?=/.test(s)],
  ['functional pseudo', s => /:(is|where|not|has|dir|lang|host|host-context|nth-child|state|active-view-transition)\(/i.test(s)],
  ['pseudo-element', s => /::/.test(s)],
  ['unicode-range', s => /\bU\+[0-9a-f?]/i.test(s)],
  ['escape sequence', s => /\\[0-9a-f]{1,6}|\\./i.test(s)],
  ['url()', s => /\burl\(/i.test(s)],
  ['calc / math fn', s => /\b(calc|min|max|clamp|round|mod|rem|abs|sign|sin|cos|tan|pow|sqrt|hypot|log|exp)\(/i.test(s)],
  ['color function', s => /\b(color|color-mix|rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|light-dark|device-cmyk|contrast-color)\(/i.test(s)],
  ['var() / fallback', s => /\bvar\(/i.test(s)],
  ['anchor / position', s => /\b(anchor|anchor-size|position-area)\(/i.test(s)],
  ['grid template', s => /\b(repeat|minmax|fit-content)\(|\[[\w-]+\]\s/i.test(s)],
  ['string value', s => /["']/.test(s)],
  ['percentage', s => /\d%/.test(s)],
  ['dimension / number', s => /\d/.test(s)]
];

function bucketOf(source) {
  for (const [name, test] of BUCKETS) {
    if (test(source)) {
      return name;
    }
  }
  return 'other';
}

function pct(part, whole) {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(2)}%`;
}

async function main() {
  const jsonFlag = process.argv.indexOf('--json');
  const sourceFlag = process.argv.indexOf('--source');
  const onlySources = sourceFlag === -1
    ? undefined
    : new Set(process.argv[sourceFlag + 1].split(','));

  const entries = onlySources === undefined
    ? manifest.entries
    : manifest.entries.filter(entry => onlySources.has(entry.source_name));

  if (entries.length === 0) {
    throw new Error('[css-corpus] source filter selected 0 entries');
  }

  console.log(
    `[css-corpus] corpus: ${entries.length} entries `
    + `(${entries.filter(e => e.expect === 'accept').length} accept, `
    + `${entries.filter(e => e.expect === 'reject').length} reject) `
    + `from ${new Set(entries.map(e => e.source_name)).size} sources`
  );

  const results = {};
  for (const dialect of DIALECTS) {
    const grammar = await loadGrammar(dialect);
    const failures = [];
    const crashes = [];
    let correct = 0;
    for (const entry of entries) {
      const verdict = parses(grammar, entry.source);
      const wanted = entry.expect === 'accept';
      if (verdict.crashed !== undefined) {
        crashes.push({ id: entry.id, source: entry.source.slice(0, 120), message: verdict.crashed });
      }
      if (verdict.ok === wanted) {
        correct++;
      } else {
        failures.push({ entry, verdict });
      }
    }
    results[dialect] = { correct, failures, crashes };
    console.log(
      `[css-corpus] ${dialect.padEnd(5)} ${String(correct).padStart(6)}/${entries.length} `
      + `= ${pct(correct, entries.length)}  (${failures.length} failing, ${crashes.length} crashed)`
    );
  }

  /*
   * Reducer crashes first. A grammar declining input it should accept is a gap;
   * a reducer throwing an internal `Error` where the public `parse()` contract
   * promises a `SyntaxError` is a defect of a different kind, and summing the
   * two into one failure count is how the second one stays invisible.
   */
  const crashing = DIALECTS.flatMap(
    dialect => results[dialect].crashes.map(crash => ({ dialect, ...crash }))
  );
  console.log(`\n### reducer crashes (internal Error, not SyntaxError): ${crashing.length}`);
  for (const crash of crashing) {
    console.log(`  ${crash.dialect.padEnd(5)} ${JSON.stringify(crash.source)}\n        -> ${crash.message}`);
  }

  /* Per-dialect triage. */
  for (const dialect of DIALECTS) {
    const { failures } = results[dialect];
    if (failures.length === 0) {
      console.log(`\n### ${dialect}: 0 failures`);
      continue;
    }
    const buckets = new Map();
    for (const failure of failures) {
      const key = `${failure.entry.expect === 'accept' ? 'false-reject' : 'false-accept'} / ${bucketOf(failure.entry.source)}`;
      const bucket = buckets.get(key) ?? { count: 0, sample: failure };
      bucket.count++;
      buckets.set(key, bucket);
    }
    const ordered = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
    console.log(`\n### ${dialect}: ${failures.length} failures, ${ordered.length} buckets`);
    for (const [name, bucket] of ordered) {
      const source = bucket.sample.entry.source.replace(/\s+/g, ' ').slice(0, 88);
      console.log(
        `  ${String(bucket.count).padStart(6)}  ${pct(bucket.count, failures.length).padStart(7)}  ${name}`
        + `\n            e.g. ${source}`
      );
    }
  }

  /*
   * The one-way ruling: valid CSS is valid in all four dialects. Anything the
   * base rejects and a dialect accepts is a defect in the base.
   */
  const cssFailed = new Set(
    results.css.failures.filter(f => f.entry.expect === 'accept').map(f => f.entry.id)
  );
  const supersetViolations = [];
  for (const entry of entries) {
    if (!cssFailed.has(entry.id)) {
      continue;
    }
    const acceptedBy = DIALECTS.slice(1).filter(
      dialect => !results[dialect].failures.some(f => f.entry.id === entry.id)
    );
    if (acceptedBy.length > 0) {
      supersetViolations.push({ id: entry.id, source: entry.source, acceptedBy });
    }
  }
  console.log(
    `\n### superset violations (css rejects, a dialect accepts): ${supersetViolations.length}`
  );
  const violationBuckets = new Map();
  for (const violation of supersetViolations) {
    const key = bucketOf(violation.source);
    violationBuckets.set(key, (violationBuckets.get(key) ?? 0) + 1);
  }
  for (const [name, count] of [...violationBuckets].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${name}`);
  }

  if (jsonFlag !== -1) {
    const file = path.resolve(process.argv[jsonFlag + 1]);
    fs.writeFileSync(file, JSON.stringify({
      total: entries.length,
      dialects: Object.fromEntries(
        DIALECTS.map(dialect => [dialect, {
          correct: results[dialect].correct,
          crashes: results[dialect].crashes,
          failures: results[dialect].failures.map(f => ({
            id: f.entry.id,
            expect: f.entry.expect,
            bucket: bucketOf(f.entry.source),
            source: f.entry.source.slice(0, 400),
            origin: f.entry.origin,
            expected: f.verdict.expected,
            unconsumedFrom: f.verdict.unconsumedFrom
          }))
        }])
      ),
      supersetViolations
    }, null, 1));
    console.log(`\n[css-corpus] json written: ${file}`);
  }
}

await main();
