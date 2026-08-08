/**
 * CSS render differential — CLI entry, over the BUILT artifact.
 *
 *   node packages/syntax/css/css-parser/test/render-differential.mjs
 *       compare against the committed baseline; exit 1 if any emitted byte moved
 *
 *   node .../render-differential.mjs --write
 *       rewrite the committed baseline (deliberate rebaseline only)
 *
 *   node .../render-differential.mjs --snapshot <dir>
 *       additionally write every entry's emitted CSS under <dir>
 *
 *   node .../render-differential.mjs --snapshot <dir> --against <dir>
 *       ...and print a unified diff for every entry whose bytes differ from the
 *       earlier snapshot. This is the A/B loop: snapshot, change the grammar,
 *       rebuild, snapshot again against the first.
 *
 * ## Why this entry uses `lib` and the vitest twin uses `src`
 *
 * This file imports the package's built output, so it measures the artifact
 * that actually ships — the discipline `parseman/oracle` documents ("digest the
 * BUILT artifact and rebuild between edits"). `render-differential.test.ts`
 * binds the SAME `runDifferential` to `src` through vitest's workspace aliases,
 * so the everyday test run needs no rebuild. Neither is a reimplementation of
 * the other: the definition lives in `./render-differential/differential.mjs`
 * and both entries pass it a surface.
 *
 * If the two ever disagree, `lib` is stale. That is a real finding, not noise.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorpus, readEntry, REPO_ROOT } from './render-differential/corpus.mjs';
import { compareReports, formatReport, runDifferential, unifiedDiff } from './render-differential/differential.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, 'render-differential.baseline.json');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const value = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

const write = flag('--write');
const snapshotDir = value('--snapshot');
const againstDir = value('--against');

const pkgRoot = resolve(here, '..');
const libIndex = join(pkgRoot, 'lib/index.js');
if (!existsSync(libIndex)) {
  console.error(
    `[css-render-diff] ${libIndex} is missing. Build first:\n`
    + '  pnpm --filter @jesscss/css-parser build'
  );
  process.exit(2);
}

const { parse } = await import(libIndex);
const { serialize } = await import('@jesscss/core');

const corpus = buildCorpus();

const snapshotPath = id => join(resolve(snapshotDir), `${id.replace(/[/\\]/g, '__')}.css`);
if (snapshotDir) {
  mkdirSync(resolve(snapshotDir), { recursive: true });
}

const report = await runDifferential({
  parse,
  serialize,
  corpus,
  read: readEntry,
  repoRoot: REPO_ROOT,
  onEmit: snapshotDir ? (id, css) => writeFileSync(snapshotPath(id), css) : undefined
});

console.log(formatReport(report));

if (write) {
  writeFileSync(BASELINE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[css-render-diff] baseline rewritten: ${BASELINE}`);
  process.exit(0);
}

/*
 * Snapshot-vs-snapshot is the A/B mode and does NOT consult the committed
 * baseline: the whole point of an A/B run is to measure a change the baseline
 * has not been updated for yet.
 */
if (snapshotDir && againstDir) {
  let moved = 0;
  for (const entry of corpus.entries) {
    const before = join(resolve(againstDir), `${entry.id.replace(/[/\\]/g, '__')}.css`);
    const after = snapshotPath(entry.id);
    const hadBefore = existsSync(before);
    const hasAfter = existsSync(after);
    if (!hadBefore && !hasAfter) {
      continue;
    }
    if (hadBefore !== hasAfter) {
      moved += 1;
      console.log(`\n### ${entry.id}: ${hadBefore ? 'emitted before, not now' : 'emits now, did not before'}`);
      continue;
    }
    const a = readFileSync(before, 'utf8');
    const b = readFileSync(after, 'utf8');
    if (a !== b) {
      moved += 1;
      console.log(`\n### ${entry.id}`);
      console.log(unifiedDiff(a, b, entry.id));
    }
  }
  console.log(`\n[css-render-diff] A/B: ${moved} of ${corpus.entries.length} entries moved`);
  process.exit(moved === 0 ? 0 : 1);
}

if (!existsSync(BASELINE)) {
  console.error(`[css-render-diff] no baseline at ${BASELINE}. Create it with --write.`);
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const comparison = compareReports(baseline, report);

if (comparison.corpusIssues.length > 0) {
  console.error('[css-render-diff] INCOMPARABLE — the corpus itself moved:');
  for (const issue of comparison.corpusIssues) {
    console.error(`  - ${issue}`);
  }
  process.exit(2);
}

if (comparison.verdict === 'identical') {
  console.log('[css-render-diff] IDENTICAL — no emitted byte moved.');
  process.exit(0);
}

console.error(`[css-render-diff] MOVED — ${comparison.moved.length} entries differ from the baseline:`);
for (const { id, before, after } of comparison.moved) {
  console.error(
    `  ${id}: ${before.status}/${before.fingerprint}/${before.bytes} -> ${after.status}/${after.fingerprint}/${after.bytes}`
  );
}
console.error(
  '\nTo see the bytes, run the A/B loop:\n'
  + '  node .../render-differential.mjs --snapshot /tmp/before   # on the unchanged tree\n'
  + '  <make the change, then `pnpm --filter @jesscss/css-parser build`>\n'
  + '  node .../render-differential.mjs --snapshot /tmp/after --against /tmp/before'
);
process.exit(1);
