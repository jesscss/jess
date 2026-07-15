import { describe, it, expect } from 'vitest';
import {
  renderOld,
  renderNewFast,
  renderNewTracked,
  newContext,
  withLegacyOpCounters,
} from '../shapes.js';
import {
  buildFlatNew,
  buildFlatOld,
  buildCompNew,
  buildCompOld,
  countNodesNew,
} from '../generate.js';
import { Context } from '../../context.js';
import * as t2 from '../../tree2/index.js';

/**
 * AT-SCALE race (~10k+ node stylesheets). At this size the real
 * creation+serialize work dwarfs the fixed Context/resolve setup, so setup
 * contamination stops mattering and the numbers are trustworthy directly.
 *
 * Two variants, three lanes (tree2 no-tracking, tree2 with-tracking, tree),
 * creation and serialize measured separately + peak-ish heap. Byte-identity is
 * asserted (tree = oracle) before any timing. The composition-heavy variant
 * also reports composition-op counts (tree2 compositions vs legacy
 * clone/inherit/withComponents) — the scale indicator.
 *
 * Serialize isolation (stated):
 *   - tree2: pre-build the AST once; time `serialize(root)` (tree2 has no eval
 *     step — composition happens inside serialize).
 *   - legacy: pre-build once and pre-`resolve` once; time
 *     `resolvedRoot.toString(opts)` — a pure, repeatable serialize that is
 *     byte-identical to the full render (composition runs inside it).
 *
 * Gated behind TREE2_RACE=1; run with `--expose-gc` for the memory numbers.
 */

const ENABLED = process.env.TREE2_RACE === '1';
const race = ENABLED ? it : it.skip;

const FLAT_RULES = 3200; // ~10k statement nodes (~22k total incl. selectors/values)
const COMP_BLOCKS = 850; // ~10k statement nodes, ~4250 compositions
const WARMUP = 3;
const RUNS = 9;
const CN = { collapseNesting: true } as const;

const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

interface Serializable {
  toString(options: unknown): string;
}
function resolveSync(node: unknown, ctx: Context): Serializable {
  const n = node as { resolve(c: Context): unknown };
  const r = n.resolve(ctx);
  if (r && typeof (r as { then?: unknown }).then === 'function') {
    throw new Error('async resolve; harness expects sync');
  }
  return r as Serializable;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median wall-clock (ms) of a whole operation over RUNS, after WARMUP. */
function timeOp(fn: () => void): number {
  for (let w = 0; w < WARMUP; w++) fn();
  const samples: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    samples.push(t1 - t0);
  }
  return median(samples);
}

/** Approx heap growth (MB) retained by producing `fn()`'s result (gc'd first). */
function heapMB(fn: () => unknown): number {
  gc?.();
  const before = process.memoryUsage().heapUsed;
  const held = fn();
  const after = process.memoryUsage().heapUsed;
  void held;
  return (after - before) / (1024 * 1024);
}

const ms = (x: number): string => x.toFixed(3);

interface Variant {
  name: string;
  buildNew: () => t2.Root;
  buildOld: () => unknown;
  composition: boolean;
}

const variants: Variant[] = [
  {
    name: `flat (${FLAT_RULES} rules)`,
    buildNew: () => buildFlatNew(FLAT_RULES),
    buildOld: () => buildFlatOld(FLAT_RULES),
    composition: false,
  },
  {
    name: `composition-heavy (${COMP_BLOCKS} blocks)`,
    buildNew: () => buildCompNew(COMP_BLOCKS),
    buildOld: () => buildCompOld(COMP_BLOCKS),
    composition: true,
  },
];

describe('tree2 vs tree — at-scale race', () => {
  race('10k-node build + serialize, three lanes', () => {
    const out: string[] = [];
    out.push('');
    out.push(`AT-SCALE race — warmup=${WARMUP}, runs=${RUNS} (median), gc=${gc ? 'on' : 'off'}`);

    for (const v of variants) {
      const ctx = newContext();

      // --- byte-identity (tree = oracle) -----------------------------------
      const oracle = renderOld(v.buildOld(), ctx);
      const t2FastCss = renderNewFast(v.buildNew());
      const t2TrackCss = renderNewTracked(v.buildNew());
      expect(t2FastCss, `${v.name} t2-fast bytes`).toBe(oracle);
      expect(t2TrackCss, `${v.name} t2-tracked bytes`).toBe(oracle);

      const nodeCount = countNodesNew(v.buildNew());

      // --- creation timings -------------------------------------------------
      const t2Create = timeOp(() => {
        v.buildNew();
      });
      const lgCreate = timeOp(() => {
        v.buildOld();
      });

      // --- serialize timings (pre-built / pre-resolved) --------------------
      const t2Root = v.buildNew();
      const t2SerFast = timeOp(() => {
        t2.serialize(t2Root);
      });
      const t2SerTrack = timeOp(() => {
        t2.serialize(t2Root, { trackPositions: true });
      });
      const lgResolved = resolveSync(v.buildOld(), ctx);
      const lgSer = timeOp(() => {
        lgResolved.toString(CN);
      });

      // --- memory ----------------------------------------------------------
      const t2AstMB = heapMB(() => v.buildNew());
      const lgAstMB = heapMB(() => v.buildOld());
      const t2SerMB = heapMB(() => t2.serialize(t2Root).css);
      const lgSerMB = heapMB(() => resolveSync(v.buildOld(), newContext()).toString(CN));

      out.push('');
      out.push(`### ${v.name}  — tree2 nodes=${nodeCount}, output bytes=${oracle.length}`);
      out.push('  phase        tree2-fast   tree2-track  tree(legacy)   |  heap MB: t2 / legacy');
      out.push(
        `  creation     ${ms(t2Create).padStart(9)}    ${'—'.padStart(9)}    ${ms(lgCreate).padStart(9)}   |  AST ${t2AstMB.toFixed(2)} / ${lgAstMB.toFixed(2)}`,
      );
      out.push(
        `  serialize    ${ms(t2SerFast).padStart(9)}    ${ms(t2SerTrack).padStart(9)}    ${ms(lgSer).padStart(9)}   |  ser ${t2SerMB.toFixed(2)} / ${lgSerMB.toFixed(2)}`,
      );
      const t2Total = t2Create + t2SerFast;
      const lgTotal = lgCreate + lgSer;
      out.push(
        `  total(c+s)   ${ms(t2Total).padStart(9)}    ${'—'.padStart(9)}    ${ms(lgTotal).padStart(9)}   |  legacy/tree2 = ${(lgTotal / t2Total).toFixed(1)}x`,
      );

      // --- composition-op counts (scale indicator) -------------------------
      if (v.composition) {
        const t2c = t2.composeStats(v.buildNew());
        const lg = withLegacyOpCounters(() => {
          renderOld(v.buildOld(), newContext());
        });
        out.push(
          `  ops/render   tree2 compose/alloc/distinct = ${t2c.composeOps}/${t2c.selectorAllocs}/${t2c.distinctSelectors}` +
            `   |  legacy clone/inherit/withComponents = ${lg.cloneForPlacement}/${lg.inherit}/${lg.withComponents}`,
        );
        out.push(
          `               => per composition: tree2 ~1 string op; legacy ~${((lg.cloneForPlacement + lg.inherit + lg.withComponents) / Math.max(1, t2c.composeOps)).toFixed(1)} node ops`,
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
  }, 300_000);
});
