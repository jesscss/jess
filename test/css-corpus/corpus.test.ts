/**
 * The external CSS parse corpus, measured against all four dialects.
 *
 * ## This is a MEASUREMENT, not a gate
 *
 * Nothing here fails on a pass rate. The corpus was added because jess's CSS
 * coverage was whatever the last fixture author happened to type — a grammar
 * that rejected every percentage keyframe selector passed the whole suite — and
 * the first job of an external corpus is to say how big the gap actually is.
 * Ratcheting comes after the buckets have been read and triaged, not in the
 * change that introduces the numbers. See `test/css-corpus/README.md` for the
 * baseline and the gating recommendation.
 *
 * What this file DOES assert is the integrity of the instrument:
 *
 * - the corpus materialises to its exact expected size, per source;
 * - every entry is evaluated in every dialect;
 * - and the measured numbers are printed, always.
 *
 * That last point is not decoration. Roughly fifteen instruments in this repo
 * were found broken in one week, and every one failed SILENTLY and read as a
 * normal result — the `@less/test-data` symlink is location-relative and
 * silently yields 196 of 714 entries under a worktree while the harness still
 * prints a confident verdict. A check that prints nothing when it passes cannot
 * be told apart from one that never ran.
 */
import { describe, expect, it } from 'vitest';
import { EXPECTED_ENTRIES, buildManifest } from '../../scripts/materialize-css-corpus.mjs';
import { DIALECTS, parseVerdict, type Dialect } from '../dialects.js';
import baselineJson from './baseline.json' with { type: 'json' };

/*
 * Imported, not `JSON.parse`d. The import carries the file's literal types, so
 * a baseline that loses a dialect or a field is a COMPILE error here — where
 * a parse-and-cast would have printed a confident `NaN` drift figure instead.
 * `satisfies` is what makes that check bite.
 */
const baseline = baselineJson satisfies {
  total: number;
  dialects: Record<Dialect, { correct: number; failing: number; crashes: number }>;
};

const expectedBySource = EXPECTED_ENTRIES;
const manifest = buildManifest();

describe('external CSS parse corpus', () => {
  it('materialises at its expected size, per source', () => {
    for (const [name, expected] of Object.entries(expectedBySource)) {
      expect(manifest.sources[name]?.entries, `source ${name}`).toBe(expected);
    }
    const sum = Object.values(expectedBySource).reduce((a, b) => a + b, 0);
    expect(manifest.total).toBe(sum);
    expect(manifest.entries).toHaveLength(sum);
    expect(new Set(manifest.entries.map(entry => entry.id)).size).toBe(sum);
    console.log(
      `[css-corpus] ${manifest.total} entries (${manifest.accept} accept, ${manifest.reject} reject) `
      + `from ${Object.keys(expectedBySource).length} sources: `
      + Object.entries(expectedBySource).map(([n, c]) => `${n}=${c}`).join(', ')
    );
  });

  it('is not silently short of the corpus the baseline was measured over', () => {
    expect(manifest.total).toBe(baseline.total);
  });

  it('measures every entry in every dialect and reports the pass rate', () => {
    const measured: Record<string, { correct: number; failing: number; crashed: number }> = {};
    const lines: string[] = [];
    const crashes: Array<{ dialect: Dialect; id: string; source: string; message: string }> = [];

    for (const dialect of DIALECTS) {
      let correct = 0;
      let evaluated = 0;
      let crashed = 0;
      for (const entry of manifest.entries) {
        evaluated++;
        const verdict = parseVerdict(dialect, entry.source);
        if (verdict.crashed !== undefined) {
          crashed++;
          crashes.push({
            dialect,
            id: entry.id,
            source: entry.source.slice(0, 120),
            message: verdict.crashed
          });
        }
        if (verdict.parses === (entry.expect === 'accept')) {
          correct++;
        }
      }
      /* The instrument's own completeness check: a short sweep is not a result. */
      expect(evaluated, `${dialect} evaluated`).toBe(manifest.total);
      measured[dialect] = { correct, failing: manifest.total - correct, crashed };

      const rate = ((correct / manifest.total) * 100).toFixed(2);
      const drift = correct - baseline.dialects[dialect].correct;
      lines.push(
        `[css-corpus] ${dialect.padEnd(5)} ${String(correct).padStart(6)}/${manifest.total} = ${rate}%`
        + `  (${manifest.total - correct} failing, ${crashed} crashed, `
        + `${drift >= 0 ? '+' : ''}${drift} vs baseline)`
      );
    }

    console.log(lines.join('\n'));
    if (crashes.length > 0) {
      /*
       * Printed in full and never truncated. A reducer invariant throwing an
       * internal `Error` on author input is a different defect from a grammar
       * gap, and it is the one that disappears when the two are summed.
       */
      console.log(`[css-corpus] ${crashes.length} REDUCER CRASHES (internal Error, not SyntaxError):`);
      for (const crash of crashes) {
        console.log(`[css-corpus]   ${crash.dialect}: ${JSON.stringify(crash.source)} -> ${crash.message}`);
      }
    }
    console.log(
      '[css-corpus] NOT A GATE — pass rates are reported, never asserted. '
      + 'Triage and the gating recommendation live in test/css-corpus/README.md; '
      + 'run `pnpm css-corpus:report` for the per-bucket breakdown.'
    );

    expect(Object.keys(measured)).toEqual([...DIALECTS]);
  });
});
