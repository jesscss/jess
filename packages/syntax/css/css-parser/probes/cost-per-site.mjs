/*
 * WHAT DOES ADDING COVERAGE COST? — measured independently of Candidate A,
 * on the real css grammar, by patching / building / measuring / restoring.
 *
 * The decision this feeds: 99 coverage gaps remain against 39,442 B of budget.
 * At ~3.2 KB per site that is ~316 KB and goal 2 is unreachable by writing
 * grammar; at ~950 B it closes. Those two models differ by 3.4x and the whole
 * question rides on which applies to the REMAINING work.
 *
 * HYPOTHESIS UNDER TEST (mine, not A's — deliberately not reading A's method
 * first, because four of this session's nine contamination filters came from
 * two counts disagreeing, and converging the methods removes the instrument):
 *
 *   Marginal cost is NOT a property of "a call site". It is a property of the
 *   INLINE MULTIPLICITY of the production the site is added to. A site added
 *   inside a production that is itself inlined at N places is emitted N times.
 *
 * So the same site costs ~950 B in a new named rule (multiplicity 1, emitted
 * once, referenced via `g.`) and several KB inside a hot inlined production.
 * If that holds, "cost per site" is the wrong unit and the answer to the
 * budget question depends on WHERE the remaining 99 cases go, not on how many
 * sites they are.
 *
 * DESIGN. Two variants, each measured at two sizes so the SLOPE cancels fixed
 * cost — a single delta cannot separate per-site cost from one-off overhead.
 *
 *   NAMED  K new productions in the rules map, each referenced once via `g.`
 *          from the stylesheet item choice. This is what new COVERAGE looks
 *          like: a new at-rule is a new named production.
 *   INLINE K new call sites added INSIDE an existing production, referenced by
 *          bare const. This is what A's trivia fix looked like.
 *
 * The probe at-keywords (`@zzz-probe-N`) appear in no corpus input, so every
 * variant is tree-identical to the baseline by construction.
 *
 * Usage: node cost-per-site.mjs        (restores the grammar on exit, always)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const SRC = resolve(pkg, 'src/grammar.ts');
const BACKUP = resolve(here, '.grammar.ts.costprobe-backup');
const ART = resolve(pkg, 'lib/grammar/ast.js');

const COMB = /\b(sequence|choice|literal|regex|word|keywords|many|oneOrMore|oneOrMoreSep|optional|not|peek|node|token|noTrivia|scanTo|balanced|dispatch|when|otherwise|routed|expect|field|label|ref|skip|transform|sepBy|parser)\(/g;

function sites(text) {
  return (text.match(COMB) ?? []).length;
}

/** Build and return artifact bytes, refusing a stale artifact. */
function buildAndMeasure(tag) {
  const before = statSync(ART).mtimeMs;
  try {
    execSync('pnpm build', { cwd: pkg, encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    throw new Error(`${tag}: build failed\n${String(e.stdout ?? '')}\n${String(e.stderr ?? '')}`.slice(-2500));
  }
  const after = statSync(ART);
  if (after.mtimeMs <= before) {
    throw new Error(`${tag}: artifact not rewritten — the build did not run or failed silently`);
  }
  const src = readFileSync(SRC, 'utf8');
  return { bytes: after.size, sites: sites(src) };
}

/* ---- patch generators --------------------------------------------------- */

/*
 * A realistic new at-rule: routed opener, prelude, stylesheet body. Same shape
 * as the descriptor/layer blocks the grammar already carries, so the closure
 * being emitted is representative rather than a toy.
 */
function namedProductions(k, kind) {
  const decls = [];
  const cases = [];
  const mapKeys = [];
  for (let i = 0; i < k; i++) {
    decls.push(`  const ZzzProbe${i} = node(
    'ZzzProbe${i}',
    ${kind === 'heavy' ? 'sequence(routed(), g.AtRulePrelude, stylesheetBodyBlock)' : 'sequence(routed(), g.AtRulePrelude, literal(\';\'))'},
    ${kind === 'heavy'
      ? `(children, _fields, _span, rawChildren) => withBlockBody(atRuleBlock(tokenText(children[0]!), optionalValue(children[1]), blockStatements(children)), rawChildren)`
      : `children => atRuleStatement(tokenText(children[0]!), optionalValue(children[1]))`}
  );`);
    cases.push(`    cssCase('@zzz-probe-${i}', g.ZzzProbe${i}),`);
    mapKeys.push(`    ZzzProbe${i},`);
  }
  const unionKeys = Array.from({ length: k }, (_, i) => `  | 'ZzzProbe${i}'`).join('\n');
  return { decls: decls.join('\n'), cases: cases.join('\n'), mapKeys: mapKeys.join('\n'), unionKeys };
}

function applyNamed(raw, k, kind) {
  if (k === 0) {
    return raw;
  }
  const p = namedProductions(k, kind);
  return raw
    .replace('  const StylesheetAtRule = dispatch(', `${p.decls}\n  const StylesheetAtRule = dispatch(`)
    .replace('    unknownAtRuleOtherwise\n  );', `${p.cases}\n    unknownAtRuleOtherwise\n  );`)
    .replace('\n  return {\n', `\n  return {\n${p.mapKeys}\n`)
    .replace('type GrammarRuleName =\n', `type GrammarRuleName =\n${p.unionKeys}\n`);
}

/*
 * INLINE: add k call sites inside CompoundSelector, the production A's trivia
 * fix touched. `optional(not(literal(...)))` is zero-width on every real input
 * (the literal never matches a selector), so the tree cannot move.
 */
function applyInline(raw, k) {
  if (k === 0) {
    return raw;
  }
  const added = Array.from({ length: k }, (_, i) => `optional(not(literal('\\u0000${i}')))`).join(',\n        ');
  return raw.replace(
    '  const CompoundSelector = node(\n    \'CompoundSelector\',\n    noTrivia(parser(',
    `  const CompoundSelector = node(\n    'CompoundSelector',\n    sequence(\n        ${added},\n      noTrivia(parser(`
  ).replace(
    /(\n  const ComplexSelector)/,
    ')$1'
  );
}

/* ---- run ---------------------------------------------------------------- */

copyFileSync(SRC, BACKUP);
const ORIGINAL = readFileSync(BACKUP, 'utf8');
const results = [];

try {
  writeFileSync(SRC, ORIGINAL);
  const base = buildAndMeasure('baseline');
  results.push({ variant: 'baseline', k: 0, ...base });
  console.log(`baseline           ${base.bytes.toLocaleString()} B   ${base.sites} sites`);

  for (const k of [4, 8]) {
    writeFileSync(SRC, applyNamed(ORIGINAL, k, 'heavy'));
    const r = buildAndMeasure(`heavy k=${k}`);
    results.push({ variant: 'heavy', k, ...r });
    console.log(`heavy  k=${String(k).padEnd(2)}        ${r.bytes.toLocaleString()} B   ${r.sites} sites   (+${(r.bytes - base.bytes).toLocaleString()} B, +${r.sites - base.sites} sites)`);
  }
  for (const k of [4, 8]) {
    writeFileSync(SRC, applyNamed(ORIGINAL, k, 'light'));
    const r = buildAndMeasure(`light k=${k}`);
    results.push({ variant: 'light', k, ...r });
    console.log(`light  k=${String(k).padEnd(2)}        ${r.bytes.toLocaleString()} B   ${r.sites} sites   (+${(r.bytes - base.bytes).toLocaleString()} B, +${r.sites - base.sites} sites)`);
  }
} finally {
  copyFileSync(BACKUP, SRC);
  console.log('\ngrammar restored from backup');
}

/* Slope between the two sizes cancels one-off overhead. */
for (const variant of ['heavy', 'light']) {
  const a = results.find(r => r.variant === variant && r.k === 4);
  const b = results.find(r => r.variant === variant && r.k === 8);
  if (a && b) {
    const dB = b.bytes - a.bytes;
    const dS = b.sites - a.sites;
    console.log(`${variant.padEnd(6)} marginal: ${dB.toLocaleString()} B over ${dS} sites = ${Math.round(dB / dS).toLocaleString()} B/site, ${Math.round(dB / 4).toLocaleString()} B per production`);
  }
}
