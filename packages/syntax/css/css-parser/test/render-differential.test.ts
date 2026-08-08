/**
 * CSS render differential — vitest entry, over `src`.
 *
 * The definition is `./render-differential/differential.mjs`; this file only
 * binds it to the source-side surface (vitest's workspace aliases resolve
 * `@jesscss/css-parser` and `@jesscss/core` to `src`), so a grammar edit is
 * measured with no rebuild. `./render-differential.mjs` binds the same function
 * to built `lib`. There is one implementation, not two.
 *
 * ## What this gate is FOR
 *
 * `docs/design/RESOLVED-SEMANTICS-AND-NAMING.md` §12.1 wants the `calc()`
 * precedence ladder (`CalcValue` / `CalcProduct` / `CalcSum`) to stop
 * contributing CST node names, the way Less's `MathAtom`/`MathProduct`/
 * `MathSum` already do. It is blocked on exactly one thing:
 *
 * > Collapsing is not free: it moves the CST for every calc input … and the css
 * > differential to gate it does not exist yet.
 *
 * This is that differential. It answers ONE question — *did the emitted CSS
 * bytes move?* — over a corpus built to actually contain the construct.
 *
 * ## The instrument asserts its own sensitivity
 *
 * The first `it` is not decoration. A differential that reports "nothing moved"
 * because its corpus never exercised the construct is worse than no
 * differential: at `bb0b243f9` removing `IdentBlock` from CSS's `Value` broke 7
 * of 10 bridge fixtures while leaving BOTH Less byte-identity aggregates
 * unmoved. So this file asserts, on every run, that the corpus really does
 * carry `calc()` at the depth the ladder needs, and that a handful of ladder
 * outputs are byte-for-byte what they should be. If the emitted CSS ever stops
 * round-tripping those, the fingerprints below are measuring the wrong thing
 * and the whole baseline is void.
 *
 * ## Rebaselining
 *
 *   node packages/syntax/css/css-parser/test/render-differential.mjs --write
 *
 * A moved fingerprint is a semantics change until someone says otherwise. Do not
 * rewrite the baseline to get a green run.
 *
 * ## Seeing the bytes
 *
 * `JESS_CSS_DIFF_SNAPSHOT=<dir>` additionally writes every entry's emitted CSS
 * under `<dir>`. Snapshot before the change, snapshot after, `diff -ru` the two
 * directories. On this lane that loop needs no rebuild, which is what makes it
 * usable for A/B-ing a grammar edit.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from '@jesscss/css-parser';
import { serialize } from '@jesscss/core';
import { buildCorpus, readEntry, REPO_ROOT } from './render-differential/corpus.mjs';
import { compareReports, formatReport, runDifferential } from './render-differential/differential.mjs';
import baselineJson from './render-differential.baseline.json' with { type: 'json' };

/*
 * Imported, not `JSON.parse`d, for the reason `test/css-corpus/corpus.test.ts`
 * spells out: the import carries the file's literal types, so a baseline that
 * loses a field is a COMPILE error rather than a confident `undefined`.
 */
const baseline = baselineJson satisfies {
  format: string;
  corpus: { total: number; buckets: Record<string, number>; bootstrapVersion: string };
  counts: { ok: number; reject: number; emitError: number };
  aggregate: string;
  entries: Record<string, { bucket: string; status: string; bytes: number | null; fingerprint: string }>;
};

const corpus = buildCorpus();

/**
 * Emitted-byte spot checks. These are the ladder's own output, written out in
 * full: precedence, left-associative folding, explicit grouping, nesting, a §10
 * function, an at-rule prelude and a custom property. If a change makes any of
 * these emit something else, the fingerprint comparison below is comparing two
 * wrong answers.
 */
const LADDER_ORACLE: Array<[string, string]> = [
  ['a { width: calc(1px + 2px * 3) }', 'a {\n  width: calc(1px + 2px * 3);\n}\n'],
  ['a { width: calc(10px - 2px - 3px) }', 'a {\n  width: calc(10px - 2px - 3px);\n}\n'],
  ['a { width: calc((1px + 2px)*3) }', 'a {\n  width: calc((1px + 2px) * 3);\n}\n'],
  ['a { width: calc(1px + calc(2px * 3)) }', 'a {\n  width: calc(1px + calc(2px * 3));\n}\n'],
  ['a { width: min(1rem, calc(2rem + 1vw)) }', 'a {\n  width: min(1rem, calc(2rem + 1vw));\n}\n'],
  ['a { width: calc(100% - 1px) }', 'a {\n  width: calc(100% - 1px);\n}\n'],
  ['a { width: calc(1px*-2) }', 'a {\n  width: calc(1px * -2);\n}\n']
];

/** Floors, not equalities — the corpus may grow; it may not silently shrink. */
const MIN_CALC_SITES = 250;
const MIN_FIXTURE_CALC_SITES = 120;

describe('CSS render differential', () => {
  it('is sensitive: the corpus carries the construct the ladder governs', () => {
    let total = 0;
    let fixture = 0;
    let fixtureFilesWithCalc = 0;
    for (const entry of corpus.entries) {
      const hits = (readEntry(entry).match(/\bcalc\(/g) ?? []).length;
      total += hits;
      if (entry.bucket === 'fixture') {
        fixture += hits;
        if (hits > 0) {
          fixtureFilesWithCalc += 1;
        }
      }
    }
    console.log(
      `[css-render-diff] calc() sites: ${total} total, ${fixture} in ${fixtureFilesWithCalc} fixture files`
    );
    expect(total).toBeGreaterThanOrEqual(MIN_CALC_SITES);
    expect(fixture).toBeGreaterThanOrEqual(MIN_FIXTURE_CALC_SITES);
    expect(corpus.buckets.fixture ?? 0).toBeGreaterThanOrEqual(12);
    expect(corpus.buckets.bootstrap ?? 0).toBeGreaterThanOrEqual(4);
    expect(corpus.buckets.repo ?? 0).toBeGreaterThanOrEqual(20);
  });

  it('emits the ladder itself byte-for-byte, so the fingerprints mean something', async () => {
    for (const [source, expected] of LADDER_ORACLE) {
      const result = await serialize(parse(source));
      expect(result.css, source).toBe(expected);
    }
  });

  it('emits the same bytes the baseline recorded', async () => {
    const snapshotDir = process.env.JESS_CSS_DIFF_SNAPSHOT;
    if (snapshotDir) {
      mkdirSync(resolve(snapshotDir), { recursive: true });
    }
    const report = await runDifferential({
      parse,
      serialize,
      corpus,
      read: readEntry,
      repoRoot: REPO_ROOT,
      onEmit: snapshotDir
        ? (id: string, css: string) =>
            writeFileSync(join(resolve(snapshotDir), `${id.replace(/[/\\]/g, '__')}.css`), css)
        : undefined
    });
    console.log(formatReport(report));

    const comparison = compareReports(baseline, report);

    /*
     * The corpus is checked FIRST and on its own. A run over a different corpus
     * has no verdict to give, and reporting that as "output moved" is the same
     * class of lie as reporting a tool failure as a grammar rejection.
     */
    expect(comparison.corpusIssues, 'corpus itself moved').toEqual([]);

    if (comparison.verdict !== 'identical') {
      const rows = comparison.moved.map(
        ({ id, before, after }) => `  ${id}: ${before.status}/${before.fingerprint}/${before.bytes}`
          + ` -> ${after.status}/${after.fingerprint}/${after.bytes}`
      );
      console.error(
        `[css-render-diff] MOVED (${comparison.moved.length} entries):\n${rows.join('\n')}`
        + '\n\nSee the bytes with the A/B loop in test/render-differential.mjs.'
      );
    }
    expect(comparison.moved.map(m => m.id)).toEqual([]);
    expect(comparison.added).toEqual([]);
    expect(comparison.removed).toEqual([]);
    expect(report.aggregate).toBe(baseline.aggregate);
  });
});
