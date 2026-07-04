/**
 * Real-world baseline: the functional css parser (parseCssFn) on bootstrap4.css
 * (~156KB of compiled Bootstrap CSS).
 *
 * Purpose:
 *  - CORRECTNESS regression guard (machine-independent): a real, large stylesheet
 *    must parse with ZERO syntax errors and a stable top-level rule count. This is
 *    what catches an error-net change (removed catch-alls, expect()/leftover) that
 *    starts false-positiving on valid CSS, or a grammar change that drops rules.
 *  - A coarse perf sanity FLOOR: parsing must stay well under a generous ceiling.
 *    This only trips on a catastrophic (≥10×) regression; the precise, machine-robust
 *    perf comparison lives in scripts/bench-compare-ref.mjs (same-machine A/B vs a
 *    git ref) — an absolute-ms threshold is intentionally NOT a tight perf guard
 *    because absolute timings are machine-dependent.
 *
 * The fixture is resolved from the less.js test-data the rest of the suite already
 * uses; the test self-skips where it isn't present rather than failing.
 */
import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseCssFn } from '../src/functional-parser.js';
import { Node } from '@jesscss/core';

function resolveBootstrap(): string | null {
  const home = process.env.HOME ?? '';
  const candidates = [
    path.resolve(__dirname, '../../../node_modules/@less/test-data/tests-config/3rd-party/bootstrap4.css'),
    path.join(home, 'git/oss/less.js/packages/test-data/tests-config/3rd-party/bootstrap4.css'),
    path.join(home, 'git/worktrees/less.js/less-4x/packages/test-data/tests-config/3rd-party/bootstrap4.css')
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

const bootstrapPath = resolveBootstrap();

describe.skipIf(!bootstrapPath)('parseCssFn — bootstrap4.css baseline', () => {
  const src = bootstrapPath ? fs.readFileSync(bootstrapPath, 'utf8') : '';

  test('parses ~156KB of real Bootstrap CSS with zero errors', () => {
    const r = parseCssFn(src);
    expect(src.length).toBeGreaterThan(100_000);
    expect(r.tree).toBeInstanceOf(Node);
    // Zero false positives from the error net on real-world valid CSS.
    expect(r.errors).toHaveLength(0);
    // Structural sanity: Bootstrap is ~1078 top-level rules; guard against a
    // grammar change silently dropping large chunks. Loose bound, not brittle.

    const rules = r.tree.rules.length;
    expect(rules).toBeGreaterThan(1000);
  });

  test('parse time stays under a catastrophic-regression ceiling', () => {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      parseCssFn(src);
      best = Math.min(best, performance.now() - t0);
    }
    // ~50ms on dev hardware; 1500ms only trips a ~30× cliff (robust to CI load).
    // Precise perf tracking is scripts/bench-compare-ref.mjs, not this number.
    expect(best).toBeLessThan(1500);
  });
});
