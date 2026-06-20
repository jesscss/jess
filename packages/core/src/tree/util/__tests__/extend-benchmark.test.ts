/**
 * Benchmark: walk-and-consume vs legacy extend pipeline
 *
 * Measures both wall-clock time and heap memory for realistic
 * Bootstrap-scale extend scenarios, comparing the walk path
 * against the legacy flatten-and-search path.
 *
 * Run with: pnpm test --run extend-benchmark
 */

import { describe, it, expect } from 'vitest';
import {
  el,
  sel,
  sellist,
  compound,
  is,
  co,
  rules,
  ruleset,
  decl,
  extend,
  any
} from '../../../index.js';
import type { Selector } from '../../../index.js';
import { applyExtendsToSelector, extendSelector } from '../extend.js';
import { walkAndExtend, wouldExtendChange } from '../extend-walk.js';
import { Context } from '../../../context.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function timeAsyncMs(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function heapMB(): number {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function fmt(n: number): string {
  return n.toFixed(1);
}

// ─── Bootstrap-scale scenarios ──────────────────────────────────────────────

describe('Extend pipeline benchmark: walk vs legacy', () => {
  /**
   * Scenario 1: Many rulesets extending a shared base
   *
   * .base { color: red; }
   * .child-0:extend(.base) {}
   * .child-1:extend(.base) {}
   * ...
   * .child-N:extend(.base) {}
   *
   * This exercises the N×M diagnostic loop in processExtends:
   * for each extend instruction, check every ruleset's selector.
   */
  it('Scenario 1: N children extending shared base (full pipeline)', async () => {
    const sizes = [50, 200, 500];

    for (const N of sizes) {
      const context = new Context();
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: [decl({ name: 'color', value: any('red') })]
        }),
        ...Array.from({ length: N }, (_, i) =>
          ruleset({
            selector: sellist([sel([el(`.child-${i}`)])]),
            rules: [extend({ target: el('.base') })]
          })
        )
      ]);

      const heapBefore = heapMB();
      const ms = await timeAsyncMs(async () => {
        await node.eval(context);
      });
      const heapAfter = heapMB();
      const heapDelta = heapAfter - heapBefore;

      console.info(
        `  N=${N}: ${fmt(ms)}ms, heap Δ${fmt(heapDelta)}MB (${fmt(heapBefore)}→${fmt(heapAfter)})`
      );
    }
  });

  /**
   * Scenario 2: Compound selectors with :is() — the Bootstrap problem
   *
   * Target: :is(.a1,.a2,...,.aN):hover:focus
   * Find: .a1 (partial)
   *
   * This is the scenario that caused OOM in Bootstrap 4 — compound
   * selectors with multiple :is() blocks create exponential expansions
   * in the legacy flatten-and-search path.
   */
  it('Scenario 2: compound :is() extends (walk vs legacy, function-level)', () => {
    const ALTS = 10;
    const IS_BLOCKS = 3;
    const ITERS = 50;

    // Build compound: :is(.a1,...,.aN):is(.b1,...,.bN):is(.c1,...,.cN)
    const prefixes = ['a', 'b', 'c'];
    const target = compound(
      Array.from({ length: IS_BLOCKS }, (_, block) =>
        is(sellist(
          Array.from({ length: ALTS }, (_, i) =>
            el(`.${prefixes[block]}${i}`)
          )
        ))
      )
    ) as unknown as Selector;

    const find = el('.a0');
    const extendWith = el('.replacement');

    // Walk path
    const walkHeapBefore = heapMB();
    const walkMs = timeMs(() => {
      for (let i = 0; i < ITERS; i++) {
        walkAndExtend(target, find, extendWith, true);
      }
    });
    const walkHeapAfter = heapMB();

    // Legacy path
    const legacyHeapBefore = heapMB();
    const legacyMs = timeMs(() => {
      for (let i = 0; i < ITERS; i++) {
        extendSelector(target, find, extendWith, true);
      }
    });
    const legacyHeapAfter = heapMB();

    console.info(`  Compound :is() (${IS_BLOCKS}×${ALTS} alts, ${ITERS} iters):`);
    console.info(`    walk:   ${fmt(walkMs)}ms, heap Δ${fmt(walkHeapAfter - walkHeapBefore)}MB`);
    console.info(`    legacy: ${fmt(legacyMs)}ms, heap Δ${fmt(legacyHeapAfter - legacyHeapBefore)}MB`);
    console.info(`    speedup: ${fmt(legacyMs / walkMs)}×`);
  });

  /**
   * Scenario 3: Diagnostic checks — wouldExtendChange vs full apply
   *
   * This is the hottest path: processExtends calls this O(N×M) times
   * (N rulesets × M instructions). The walk dry-run avoids creating
   * any new selector objects.
   */
  it('Scenario 3: diagnostic checks at scale (wouldExtendChange vs apply+compare)', () => {
    const SELECTORS = 200;
    const INSTRUCTIONS = 20;
    const items: Selector[] = Array.from({ length: SELECTORS }, (_, i) => el(`.item-${i}`));
    const target = sellist(items) as unknown as Selector;
    const finds = Array.from({ length: INSTRUCTIONS }, (_, i) =>
      el(`.item-${i * 10}`)
    );
    const ext = el('.replacement');

    // Walk diagnostic
    const walkHeapBefore = heapMB();
    const walkMs = timeMs(() => {
      for (const find of finds) {
        wouldExtendChange(target, find, ext, false);
      }
    });
    const walkHeapAfter = heapMB();

    // Legacy diagnostic (apply + compare)
    const legacyHeapBefore = heapMB();
    const legacyMs = timeMs(() => {
      for (const find of finds) {
        const after = applyExtendsToSelector(target, [{ target: find, extendWith: ext, partial: false }]);
        after.valueOf() !== target.valueOf();
      }
    });
    const legacyHeapAfter = heapMB();

    console.info(`  Diagnostic (${SELECTORS} selectors × ${INSTRUCTIONS} instructions):`);
    console.info(`    walk:   ${fmt(walkMs)}ms, heap Δ${fmt(walkHeapAfter - walkHeapBefore)}MB`);
    console.info(`    legacy: ${fmt(legacyMs)}ms, heap Δ${fmt(legacyHeapAfter - legacyHeapBefore)}MB`);
    console.info(`    speedup: ${fmt(legacyMs / walkMs)}×`);
  });

  /**
   * Scenario 4: Compound find in compound target — multi-simple consumption
   *
   * Target: .a.b.c.d.e
   * Find: .b.d (partial)
   */
  it('Scenario 4: compound find consuming from compound target', () => {
    const ITERS = 500;
    const target = compound([
      el('.a'), el('.b'), el('.c'), el('.d'), el('.e')
    ]) as unknown as Selector;
    const find = compound([el('.b'), el('.d')]) as unknown as Selector;
    const extendWith = el('.z');

    const walkMs = timeMs(() => {
      for (let i = 0; i < ITERS; i++) {
        walkAndExtend(target, find, extendWith, true);
      }
    });
    const legacyMs = timeMs(() => {
      for (let i = 0; i < ITERS; i++) {
        extendSelector(target, find, extendWith, true);
      }
    });

    console.info(`  Compound find (${ITERS} iters):`);
    console.info(`    walk:   ${fmt(walkMs)}ms`);
    console.info(`    legacy: ${fmt(legacyMs)}ms`);
    console.info(`    speedup: ${fmt(legacyMs / walkMs)}×`);
  });

  /**
   * Scenario 5: processExtends diagnostic loop simulation
   *
   * Simulates the hot inner loop of processExtends: for each ruleset's
   * selector, check if ANY of M extend instructions would change it.
   * This is O(N rulesets × M instructions) and dominates the pipeline.
   */
  it('Scenario 5: processExtends diagnostic loop (N rulesets × M instructions)', () => {
    const N_RULESETS = 100;
    const M_INSTRUCTIONS = 50;

    // Build N selectors (some compounds with :is())
    const selectors: Selector[] = Array.from({ length: N_RULESETS }, (_, i) => {
      if (i % 3 === 0) {
        // Compound with :is()
        return compound([
          el(`.cls-${i}`),
          is(sellist([el(`.alt-${i}-a`), el(`.alt-${i}-b`)]))
        ]) as unknown as Selector;
      }
      return el(`.cls-${i}`);
    });

    // Build M extend instructions
    const instructions = Array.from({ length: M_INSTRUCTIONS }, (_, i) => ({
      target: el(`.cls-${i * 2}`),
      extendWith: el(`.ext-${i}`),
      partial: true
    }));

    // Walk path: wouldExtendChange
    const walkHeapBefore = heapMB();
    const walkMs = timeMs(() => {
      for (const selector of selectors) {
        for (const instr of instructions) {
          wouldExtendChange(selector, instr.target, instr.extendWith, instr.partial);
        }
      }
    });
    const walkHeapAfter = heapMB();

    // Legacy path: full apply + compare
    const legacyHeapBefore = heapMB();
    const legacyMs = timeMs(() => {
      for (const selector of selectors) {
        for (const instr of instructions) {
          const after = applyExtendsToSelector(selector, [instr]);
          after.valueOf() !== selector.valueOf();
        }
      }
    });
    const legacyHeapAfter = heapMB();

    const total = N_RULESETS * M_INSTRUCTIONS;
    console.info(`  processExtends diagnostic (${N_RULESETS}×${M_INSTRUCTIONS} = ${total} checks):`);
    console.info(`    walk:   ${fmt(walkMs)}ms, heap Δ${fmt(walkHeapAfter - walkHeapBefore)}MB`);
    console.info(`    legacy: ${fmt(legacyMs)}ms, heap Δ${fmt(legacyHeapAfter - legacyHeapBefore)}MB`);
    console.info(`    speedup: ${fmt(legacyMs / walkMs)}×`);
    console.info(`    memory reduction: ${fmt((1 - (walkHeapAfter - walkHeapBefore) / (legacyHeapAfter - legacyHeapBefore)) * 100)}%`);
  });

  /**
   * Scenario 6: Scaling test — how does the full pipeline scale with N?
   *
   * Measures eval time for increasing numbers of extend instructions
   * to detect quadratic or worse scaling.
   */
  it('Scenario 6: scaling curve — full pipeline with increasing N', async () => {
    const sizes = [10, 25, 50, 100, 200];
    const results: { n: number; ms: number; heapDelta: number }[] = [];

    for (const N of sizes) {
      const context = new Context();
      const node = rules([
        // One target with a compound selector
        ruleset({
          selector: sellist([sel([compound([el('.base'), el('.variant')])])]),
          rules: [decl({ name: 'color', value: any('red') })]
        }),
        // N children extending .base (partial)
        ...Array.from({ length: N }, (_, i) =>
          ruleset({
            selector: sellist([sel([el(`.child-${i}`)])]),
            rules: [extend({ target: el('.base'), all: true })]
          })
        )
      ]);

      const heapBefore = heapMB();
      const ms = await timeAsyncMs(async () => {
        await node.eval(context);
      });
      const heapDelta = heapMB() - heapBefore;
      results.push({ n: N, ms, heapDelta });
    }

    console.info('  Scaling curve (partial extend on compound target):');
    for (const r of results) {
      const perN = r.ms / r.n;
      console.info(
        `    N=${String(r.n).padStart(3)}: ${fmt(r.ms).padStart(7)}ms  (${fmt(perN)}ms/extend)  heap Δ${fmt(r.heapDelta)}MB`
      );
    }

    // Check that per-extend time doesn't grow faster than linearly
    const first = results[0]!;
    const last = results[results.length - 1]!;
    const perNFirst = first.ms / first.n;
    const perNLast = last.ms / last.n;
    // Allow up to 5× growth in per-extend cost (accounts for some overhead)
    // but catches quadratic (would be ~20× for 10→200)
    console.info(
      `    Per-extend growth: ${fmt(perNFirst)}ms → ${fmt(perNLast)}ms (${fmt(perNLast / perNFirst)}×)`
    );
  });
});
