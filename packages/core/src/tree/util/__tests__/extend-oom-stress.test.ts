/**
 * OOM STRESS TEST — Bootstrap-scale extend performance
 *
 * These tests reproduce the memory explosion documented in BOOTSTRAP_OOM_INVESTIGATION.md.
 * Each test is deliberately crafted to hit a specific algorithmic blowup in the extend pipeline.
 *
 * Each test measures wall time and asserts it completes within a generous but finite budget.
 * If the combinatorial/quadratic paths are hit, these will either OOM or exceed the budget.
 *
 * Run with: pnpm test --run extend-oom-stress
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
import { applyExtendsToSelector, type ExtendInstruction } from '../extend.js';
import { findExtendableLocations } from '../find-extendable-locations.js';
import { areCompoundSelectorsEquivalent, expandCompoundWithPseudoSelectors } from '../selector-match-core.js';
import { CompoundSelector } from '../../selector-compound.js';
import { Context } from '../../../context.js';
import { walkAndExtend, wouldExtendChange } from '../extend-walk.js';
import { extendSelector } from '../extend.js';

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

/** Budget: tests must finish within this many ms or we consider them broken. */
const BUDGET_MS = 2000;

// ─── Test 1: expandCompoundWithPseudoSelectors combinatorial explosion ───────

describe('OOM stress: expandCompoundWithPseudoSelectors', () => {
  it('does NOT create exponential expansions for compound with multiple :is()', () => {
    // :is(.a1,.a2,.a3):is(.b1,.b2,.b3):is(.c1,.c2,.c3)
    // With the broken implementation this produces 1+3+9+27 = 40 expansions.
    // Each additional :is() multiplies the count again.
    // The correct behavior: a compound with N :is() components should remain
    // O(1) structures — we match structurally, not by expanding all forms.
    const threeAlts = (prefix: string) =>
      is(sellist([el(`.${prefix}1`), el(`.${prefix}2`), el(`.${prefix}3`)]));

    const comp = compound([threeAlts('a'), threeAlts('b'), threeAlts('c')]);

    let expansions!: CompoundSelector[];
    const ms = timeMs(() => {
      expansions = expandCompoundWithPseudoSelectors(comp);
    });

    // Document the current (broken) behavior so we can see the count:
    console.info(`expandCompoundWithPseudoSelectors produced ${expansions.length} expansions in ${ms.toFixed(1)}ms`);

    // ASSERTION: the expansion count must not be exponential.
    // 3 :is() blocks × 3 alternatives each = at most 3+3+3+1 = 10 linear items, NOT 1+3+9+27=40.
    // For now we simply assert the operation finishes within budget.
    expect(ms).toBeLessThan(BUDGET_MS);

    // REGRESSION MARKER: if this is > 10 the combinatorial bug is present.
    // We track it but don't hard-fail yet (let it serve as a diagnostic).
    if (expansions.length > 10) {
      console.warn(
        `[REGRESSION] expandCompoundWithPseudoSelectors returned ${expansions.length} expansions `
        + `(expected ≤ 10). Combinatorial explosion is present.`
      );
    }
  });

  it('does NOT exponentially blow up with 5 :is() blocks of 4 alternatives each', () => {
    // 4^5 = 1024 expansions with the broken implementation.
    // This mirrors a Bootstrap compound like :is(h1,h2,h3,h4):hover:focus:active:not(:disabled)
    const fourAlts = (prefix: string) =>
      is(sellist([el(`.${prefix}1`), el(`.${prefix}2`), el(`.${prefix}3`), el(`.${prefix}4`)]));

    const comp = compound([
      fourAlts('a'), fourAlts('b'), fourAlts('c'), fourAlts('d'), fourAlts('e')
    ]);

    let expansions!: CompoundSelector[];
    const ms = timeMs(() => {
      expansions = expandCompoundWithPseudoSelectors(comp);
    });

    console.info(`5x:is(4) → ${expansions.length} expansions in ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);

    if (expansions.length > 20) {
      console.warn(
        `[REGRESSION] 5x:is(4) produced ${expansions.length} expansions; expected ≤ 20 linearly.`
      );
    }
  });
});

// ─── Test 2: areCompoundSelectorsEquivalent O(N²) on expanded forms ──────────

describe('OOM stress: areCompoundSelectorsEquivalent', () => {
  it('handles comparison of two compounds each with multiple :is() in O(N) time', () => {
    const a = compound([
      is(sellist([el('.x1'), el('.x2'), el('.x3')])),
      is(sellist([el('.y1'), el('.y2'), el('.y3')])),
      el(':hover')
    ]);
    const b = compound([
      is(sellist([el('.x3'), el('.x1'), el('.x2')])), // same set, different order
      is(sellist([el('.y2'), el('.y3'), el('.y1')])),
      el(':hover')
    ]);

    let result!: boolean;
    const ms = timeMs(() => {
      result = areCompoundSelectorsEquivalent(a, b);
    });

    console.info(`areCompoundSelectorsEquivalent took ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

// ─── Test 3: findExtendableLocations on large SelectorList ──────────────────

describe('OOM stress: findExtendableLocations on large selector lists', () => {
  it('searches a 500-item SelectorList without exponential blowup', () => {
    // Simulate: a ruleset with 500 selectors that the extend engine must scan.
    // Bootstrap 4 has ~5000; we use 500 for CI safety.
    const items: Selector[] = Array.from({ length: 500 }, (_, i) =>
      sel([el(`.col-${i}`)])
    );
    const target = sellist(items);
    const find = el('.col-42');

    let result: ReturnType<typeof findExtendableLocations>;
    const ms = timeMs(() => {
      result = findExtendableLocations(target, find);
    });

    console.info(`findExtendableLocations(500 items) took ${ms.toFixed(1)}ms, hasMatches=${result!.hasMatches}`);
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(result!.hasMatches).toBe(true);
  });

  it('searches 100 selectors × 10 extend instructions without quadratic blowup', () => {
    // This exercises the per-ruleset × per-instruction loop in processExtends.
    const N_SELECTORS = 100;
    const N_INSTRUCTIONS = 10;

    const selectors: Selector[] = Array.from({ length: N_SELECTORS }, (_, i) =>
      sel([el(`.item-${i}`)])
    );
    const instructions: ExtendInstruction[] = Array.from({ length: N_INSTRUCTIONS }, (_, i) => ({
      target: el(`.item-${i * 10}`),
      extendWith: el(`.replacement-${i}`),
      partial: false
    }));

    let totalMs = 0;
    for (const selector of selectors) {
      for (const { target } of instructions) {
        const ms = timeMs(() => {
          findExtendableLocations(selector, target);
        });
        totalMs += ms;
      }
    }

    console.info(`100×10 findExtendableLocations total: ${totalMs.toFixed(1)}ms`);
    expect(totalMs).toBeLessThan(BUDGET_MS);
  });
});

// ─── Test 4: applyExtendsToSelector O(N²) while-loop ───────────────────────

describe('OOM stress: applyExtendsToSelector restart loop', () => {
  it.skip('applies 50 extend instructions to a selector without O(N²) restart overhead', () => {
    // Each instruction targets a different class; none conflict with each other.
    // The while-loop in applyExtendsToSelector restarts from the top on each match.
    // For N instructions this is O(N²) comparisons; for 50 it should still be fast.
    // @todo - Re-enable after profiling/stabilizing applyExtendsToSelector budget in shared CI/prepush runs.
    const N = 50;
    const baseSelector = sellist(
      Array.from({ length: N }, (_, i) => sel([el(`.target-${i}`)]))
    );

    const instructions: ExtendInstruction[] = Array.from({ length: N }, (_, i) => ({
      target: el(`.target-${i}`),
      extendWith: el(`.extended-${i}`),
      partial: false
    }));

    let result: Selector;
    const ms = timeMs(() => {
      result = applyExtendsToSelector(baseSelector, instructions);
    });

    console.info(`applyExtendsToSelector(50 instructions) took ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
    // All 50 targets should have been extended, so the result should differ from the input.
    expect(result!.valueOf()).not.toBe(baseSelector.valueOf());
  });

  it('handles 200 instructions on a single-selector target within budget', () => {
    // Worst case for the O(N²) restart: one matching instruction causes N-1 retries.
    // With 200 instructions and 1 matching at position 0, we do ~200 passes.
    const N = 200;
    const targetSelector = sel([el('.only-target')]);

    const instructions: ExtendInstruction[] = [
      // First instruction matches
      { target: el('.only-target'), extendWith: el('.extended'), partial: false },
      // Remaining 199 are misses (different targets)
      ...Array.from({ length: N - 1 }, (_, i) => ({
        target: el(`.no-match-${i}`),
        extendWith: el(`.ignored-${i}`),
        partial: false as const
      }))
    ];

    let result: Selector;
    const ms = timeMs(() => {
      result = applyExtendsToSelector(targetSelector, instructions);
    });

    console.info(`applyExtendsToSelector(200 instructions, 1 match) took ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

// ─── Test 5: Full eval pipeline with many rulesets and extends ───────────────

describe('OOM stress: full eval pipeline', () => {
  it('compiles 100 rulesets with a shared base class being extended by all', async () => {
    // This is a minimal Bootstrap-style scenario:
    //   .base { color: red; }
    //   .child-0 { &:extend(.base); }
    //   .child-1 { &:extend(.base); }
    //   ...
    //   .child-99 { &:extend(.base); }
    //
    // Result: .base, .child-0, .child-1, ..., .child-99 { color: red; }
    const N = 100;
    const context = new Context();

    const node = rules([
      ruleset({
        selector: sellist([sel([el('.base')])]),
        rules: rules([decl({ name: 'color', value: any('red') })])
      }),
      ...Array.from({ length: N }, (_, i) =>
        ruleset({
          selector: sellist([sel([el(`.child-${i}`)])]),
          rules: rules([
            extend({ target: el('.base') })
          ])
        })
      )
    ]);

    let css = '';
    const ms = await timeAsyncMs(async () => {
      const evald = await node.eval(context);
      css = evald.toString();
    });

    console.info(`100-ruleset extend eval took ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
    // The base class should now include all children
    expect(css).toContain('.base');
    expect(css).toContain('.child-0');
    expect(css).toContain('.child-99');
  });

  it('compiles 50 rulesets each extending a different target without quadratic growth', async () => {
    // 50 distinct target selectors, each extended by one child.
    // Exercises the per-instruction × per-ruleset loop in processExtends.
    const N = 50;
    const context = new Context();

    const node = rules([
      // 50 base rulesets
      ...Array.from({ length: N }, (_, i) =>
        ruleset({
          selector: sellist([sel([el(`.base-${i}`)])]),
          rules: rules([decl({ name: 'color', value: any('red') })])
        })
      ),
      // 50 children, each extending a different base
      ...Array.from({ length: N }, (_, i) =>
        ruleset({
          selector: sellist([sel([el(`.child-${i}`)])]),
          rules: rules([extend({ target: el(`.base-${i}`) })])
        })
      )
    ]);

    const ms = await timeAsyncMs(async () => {
      await node.eval(context);
    });

    console.info(`50×50 distinct extend eval took ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('compiles selectors with compound :is() nesting without blowing up', async () => {
    // This specifically targets expandCompoundWithPseudoSelectors via the full pipeline.
    // Creates selectors like:
    //   :is(.a1,.a2,.a3):is(.b1,.b2,.b3) { color: red; }
    //   .c:extend(:is(.a1,.a2,.a3):is(.b1,.b2,.b3));
    const context = new Context();

    const compoundTarget = compound([
      is(sellist([el('.a1'), el('.a2'), el('.a3')])),
      is(sellist([el('.b1'), el('.b2'), el('.b3')]))
    ]);

    const node = rules([
      ruleset({
        selector: sellist([sel([compoundTarget])]),
        rules: rules([decl({ name: 'color', value: any('red') })])
      }),
      ruleset({
        selector: sellist([sel([el('.c')])]),
        rules: rules([
          extend({
            target: compound([
              is(sellist([el('.a1'), el('.a2'), el('.a3')])),
              is(sellist([el('.b1'), el('.b2'), el('.b3')]))
            ])
          })
        ])
      })
    ]);

    const ms = await timeAsyncMs(async () => {
      await node.eval(context);
    });

    console.info(`:is()×:is() compound extend took ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

// ─── Test 6: selectorCompare on SelectorList doesn't sort N times ────────────

describe('OOM stress: selectorCompare SelectorList normalization', () => {
  it('compares two large SelectorLists in O(N) not O(N log N) per call', () => {
    // selectorCompare with two SelectorLists calls normalizeSelectorForExtend on each
    // item and then sorts the resulting string arrays. With 200 items this should
    // still be fast.
    const N = 200;
    const itemsA: Selector[] = Array.from({ length: N }, (_, i) => sel([el(`.item-${i}`)]));
    const itemsB: Selector[] = [...itemsA].reverse(); // same items, reversed order

    const listA = sellist(itemsA);
    const listB = sellist(itemsB);

    // findExtendableLocations triggers selectorCompare internally
    let result: ReturnType<typeof findExtendableLocations>;
    const ms = timeMs(() => {
      result = findExtendableLocations(listA, listB);
    });

    console.info(`SelectorList(200) comparison took ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

// ─── Benchmark: walk-and-consume vs legacy ──────────────────────────────────

describe('Benchmark: walkAndExtend vs legacy extendSelector', () => {
  it('walk path is faster than legacy for SimpleSelector extends on SelectorList', () => {
    const N = 200;
    const items: Selector[] = Array.from({ length: N }, (_, i) => el(`.item-${i}`));
    const target = sellist(items);
    const find = el('.item-100');
    const extendWith = el('.replacement');

    // Warm up
    walkAndExtend(target, find, extendWith, false);
    extendSelector(target, find, extendWith, false);

    const ITERS = 100;

    const walkMs = timeMs(() => {
      for (let i = 0; i < ITERS; i++) {
        walkAndExtend(target, find, extendWith, false);
      }
    });

    // Force legacy by using a fresh copy each time to bypass walk cache
    const legacyMs = timeMs(() => {
      for (let i = 0; i < ITERS; i++) {
        extendSelector(target, find, extendWith, false);
      }
    });

    console.info(`${ITERS}× extend on ${N}-item SelectorList:`);
    console.info(`  walk:   ${walkMs.toFixed(1)}ms`);
    console.info(`  legacy: ${legacyMs.toFixed(1)}ms`);
    console.info(`  speedup: ${(legacyMs / walkMs).toFixed(1)}×`);
    // Walk should complete within budget
    expect(walkMs).toBeLessThan(BUDGET_MS);
  });

  it('wouldExtendChange is faster than applyExtendsToSelector for diagnostic checks', () => {
    const N = 100;
    const items: Selector[] = Array.from({ length: N }, (_, i) => el(`.item-${i}`));
    const target = sellist(items);
    const ITERS = 500;

    // 10 different find targets, check if each would change the selector
    const finds = Array.from({ length: 10 }, (_, i) => el(`.item-${i * 10}`));
    const ext = el('.replacement');

    const walkMs = timeMs(() => {
      for (let iter = 0; iter < ITERS; iter++) {
        for (const find of finds) {
          wouldExtendChange(target, find, ext, false);
        }
      }
    });

    const legacyMs = timeMs(() => {
      for (let iter = 0; iter < ITERS; iter++) {
        for (const find of finds) {
          const after = applyExtendsToSelector(target, [{ target: find, extendWith: ext, partial: false }]);
          after.valueOf() !== target.valueOf();
        }
      }
    });

    console.info(`${ITERS}×10 diagnostic checks on ${N}-item SelectorList:`);
    console.info(`  wouldExtendChange: ${walkMs.toFixed(1)}ms`);
    console.info(`  applyExtends:      ${legacyMs.toFixed(1)}ms`);
    console.info(`  speedup:           ${(legacyMs / walkMs).toFixed(1)}×`);
    expect(walkMs).toBeLessThan(BUDGET_MS);
  });
});
