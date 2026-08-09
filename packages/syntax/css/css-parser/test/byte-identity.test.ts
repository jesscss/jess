/**
 * CSS byte-identity oracle — vitest entry, over `src`.
 *
 * `GRAMMAR-REVIEW-STANDARD.md` item 15 asks "if changed, does the AST stay
 * byte-identical?" and §4 records that the answer only exists for Less: *"A
 * `css-parser` change is not covered by the Less oracle … an unchanged oracle
 * on a `css-parser` change is a null result, not a pass."* This is the missing
 * instrument. The definition is `./byte-identity/oracle.ts`; this file binds it
 * to the source-side surface, so a grammar edit is measured with no rebuild.
 *
 * ## It is absolute, which is the whole point
 *
 * `test/render-differential.test.ts` compares against a committed baseline: it
 * detects MOVEMENT, cannot say whether either side was correct, and is green
 * again the moment someone rebaselines. Here the input IS the expected output.
 * There is no state in which a wrong answer passes, and `--write` does not
 * exist because there is nothing to write.
 *
 * ## The negative controls are not decoration
 *
 * A green run from an oracle that visited zero files looks exactly like a green
 * run from an oracle that visited all of them, and this repo has both receipts:
 * a vitest path filter that ran 5458 files and none of the intended suites while
 * reporting success, and a detector that scored every case as failing until a
 * control showed the instrument itself was broken. So four controls run on every
 * invocation:
 *
 *  1. the corpus is non-empty and every named file was visited;
 *  2. a surface that DROPS a nested rule — the exact ident-start defect shape,
 *     where a `Declaration` swallows the block that follows it — is caught;
 *  3. a surface that changes ONE byte of trivia is caught, so the oracle is
 *     shown to be byte-sensitive and not merely structure-sensitive;
 *  4. a surface that round-trips perfectly is NOT reported as failing, so the
 *     controls above are not passing because everything fails.
 *
 * Controls 2 and 3 mutate the SURFACE, never the grammar: this is a test
 * harness, and a control that edits a production would be a grammar change
 * wearing a test's name.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@jesscss/css-parser';
import { serialize } from '@jesscss/core';
import { buildCorpus, readEntry } from './render-differential/corpus.mjs';
import {
  AUTHORED_FILES, loadAuthoredCorpus, loadEmittedCorpus
} from './byte-identity/corpus.js';
import { formatOracle, runOracle, type RoundTripSurface } from './byte-identity/oracle.js';
import divergencesJson from './byte-identity.divergences.json' with { type: 'json' };

/*
 * Imported, not `JSON.parse`d, for the reason `test/css-corpus/corpus.test.ts`
 * spells out: the import carries the file's literal types, so a record that
 * loses a field is a COMPILE error rather than a confident `undefined`.
 */
const divergences = divergencesJson satisfies {
  note: string;
  open: Record<string, { construct: string; detail: string }>;
  settled: Record<string, { construct: string; detail: string; citation: string; consequence: string }>;
};

/**
 * `collapseNesting: false` — see `byte-identity/oracle.ts`. The default `true`
 * flattens authored blocks into composed selectors, a deliberate semantic
 * transform under which byte-identity is not a meaningful question.
 */
const roundTrip: RoundTripSurface = async source =>
  (await serialize(parse(source), { collapseNesting: false })).css;

const authored = loadAuthoredCorpus();

/**
 * The ids the oracle is currently expected NOT to reproduce, named one by one.
 *
 * Both sections count as failing bytes — the assertion below is about what the
 * round trip DOES, and a settled transform loses the byte exactly as an open
 * defect does. They are separate keys so the record says which is which: an
 * `open` entry is an unruled finding, a `settled` entry is deliberate behaviour
 * carrying a citation. Keeping settled entries in the set is what makes the
 * "a file that STOPS diverging also fails" property cover them too, so silently
 * dropping empty-block elision cannot go unnoticed.
 */
const KNOWN_DIVERGENT: readonly string[] = [
  ...Object.keys(divergences.open),
  ...Object.keys(divergences.settled)
].map(name => `authored/${name}`).sort();

describe('CSS byte-identity oracle', () => {
  describe('negative controls', () => {
    it('control 0: the corpus is non-empty and every named file was visited', async () => {
      expect(AUTHORED_FILES.length).toBeGreaterThanOrEqual(17);
      expect(authored.map(e => e.id)).toEqual(AUTHORED_FILES.map(n => `authored/${n}`).sort());
      for (const entry of authored) {
        expect(entry.source.length, entry.id).toBeGreaterThan(0);
      }
      const report = await runOracle(authored, roundTrip);
      expect(report.results.length).toBe(authored.length);
    });

    it('control 1: a surface that swallows a nested rule is CAUGHT', async () => {
      /* The ident-start defect's signature: the nested block vanishes from the output. */
      const swallowNested: RoundTripSurface = async source =>
        (await roundTrip(source)).replace(/\n\s*div \{[^}]*\}/, '');
      const report = await runOracle(authored, swallowNested);
      expect(report.failing).toContain('authored/nesting-qualified-rule.css');
      const caught = report.results.find(r => r.id === 'authored/nesting-qualified-rule.css');
      expect(caught?.status).toBe('divergent');
      expect(caught?.detail).toMatch(/at byte \d+/);
    });

    it('control 2: a surface that moves ONE byte of trivia is CAUGHT', async () => {
      const dropOneSpace: RoundTripSurface = async source => (await roundTrip(source)).replace('  ', ' ');
      const report = await runOracle(authored, dropOneSpace);
      expect(report.failing.length).toBeGreaterThan(0);
      expect(report.counts.divergent).toBeGreaterThan(0);
    });

    it('control 3: a surface that reproduces the input exactly is NOT reported as failing', async () => {
      const perfect: RoundTripSurface = async source => source;
      const report = await runOracle(authored, perfect);
      expect(report.failing).toEqual([]);
      expect(report.counts.identical).toBe(authored.length);
    });
  });

  it('authored CSS round-trips byte for byte', async () => {
    const report = await runOracle(authored, roundTrip);
    console.log(formatOracle('authored', report));
    for (const result of report.results) {
      if (result.status !== 'identical') {
        console.error(`[css-byte-identity] ${result.id}: ${result.detail}`);
      }
    }
    /*
     * A NAMED set, not a count. A file that starts diverging fails here; so does
     * a file that stops, which forces the record to be deleted rather than left
     * to rot. `byte-identity.divergences.json` splits the set: `open` entries are
     * parser findings nobody has ruled on, `settled` entries are deliberate
     * behaviour with a citation. Neither is an allowlist for new divergence.
     */
    expect(report.failing).toEqual(KNOWN_DIVERGENT);
  });

  it('emitted CSS is a fixed point: real-world stylesheets round-trip byte for byte', async () => {
    const real = buildCorpus().entries.map((entry: { id: string; path: string }) => ({
      id: entry.id,
      source: readEntry(entry)
    }));
    const { entries, rejected } = await loadEmittedCorpus(real, roundTrip);
    console.log(
      `[css-byte-identity:emitted] real files=${real.length} emitted=${entries.length} `
      + `rejected-by-grammar=${rejected.length}`
    );
    /* Breadth is the point of this channel; a shrunken corpus is a silent pass. */
    expect(entries.length).toBeGreaterThanOrEqual(60);

    const report = await runOracle(entries, roundTrip);
    console.log(formatOracle('emitted', report));
    for (const result of report.results) {
      if (result.status !== 'identical') {
        console.error(`[css-byte-identity] ${result.id}: ${result.detail}`);
      }
    }
    expect(report.failing).toEqual([]);
  });
});
