/**
 * Standalone extend pipeline benchmark.
 *
 * Builds realistic Bootstrap-scale ASTs and measures the full eval pipeline
 * (time + memory). Designed to run against any commit — no dependency on
 * walk-specific imports.
 *
 * Usage:
 *   npx tsx packages/core/src/tree/util/__tests__/extend-pipeline-bench.ts
 *
 * With accurate heap measurement:
 *   node --expose-gc node_modules/.bin/tsx packages/core/src/tree/util/__tests__/extend-pipeline-bench.ts
 */

import {
  el,
  sel,
  sellist,
  compound,
  is,
  rules,
  ruleset,
  decl,
  extend,
  any
} from '../../../index.js';
import { Context } from '../../../context.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toFixed(1);
}

function heapMB(): number {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

async function bench(
  label: string,
  fn: () => Promise<void>
): Promise<{ ms: number; heapDelta: number }> {
  // Warm up GC
  heapMB();
  const heapBefore = heapMB();
  const start = performance.now();
  await fn();
  const ms = performance.now() - start;
  const heapAfter = heapMB();
  const heapDelta = heapAfter - heapBefore;
  console.log(`  ${label}: ${fmt(ms)}ms, heap Δ${fmt(heapDelta)}MB (${fmt(heapBefore)}→${fmt(heapAfter)})`);
  return { ms, heapDelta };
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

async function scenario1(N: number) {
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

  await bench(`N=${N}`, async () => {
    await node.eval(context);
  });
}

async function scenario2(N: number) {
  const context = new Context();
  const node = rules([
    ruleset({
      selector: sellist([sel([compound([el('.base'), el('.variant')])])]),
      rules: [decl({ name: 'color', value: any('red') })]
    }),
    ...Array.from({ length: N }, (_, i) =>
      ruleset({
        selector: sellist([sel([el(`.child-${i}`)])]),
        rules: [extend({ target: el('.base'), all: true })]
      })
    )
  ]);

  await bench(`N=${N}`, async () => {
    await node.eval(context);
  });
}

async function scenario3(N: number) {
  const context = new Context();
  // Target with :is() compound — the Bootstrap pattern
  const ALTS = 4;
  const IS_BLOCKS = 3;
  const prefixes = ['a', 'b', 'c'];
  const targetSel = compound(
    Array.from({ length: IS_BLOCKS }, (_, block) =>
      is(sellist(
        Array.from({ length: ALTS }, (_, i) =>
          el(`.${prefixes[block]}${i}`)
        )
      ))
    )
  );

  const node = rules([
    ruleset({
      selector: sellist([sel([targetSel])]),
      rules: [decl({ name: 'color', value: any('red') })]
    }),
    ...Array.from({ length: N }, (_, i) =>
      ruleset({
        selector: sellist([sel([el(`.child-${i}`)])]),
        rules: [extend({ target: el('.a0'), all: true })]
      })
    )
  ]);

  await bench(`N=${N} (${IS_BLOCKS}×${ALTS} :is())`, async () => {
    await node.eval(context);
  });
}

async function scenario4(N: number) {
  // Many targets, many extends — N×N cross-product
  const context = new Context();
  const node = rules([
    ...Array.from({ length: N }, (_, i) =>
      ruleset({
        selector: sellist([sel([el(`.target-${i}`)])]),
        rules: [decl({ name: 'color', value: any('red') })]
      })
    ),
    ...Array.from({ length: N }, (_, i) =>
      ruleset({
        selector: sellist([sel([el(`.ext-${i}`)])]),
        rules: [extend({ target: el(`.target-${i}`) })]
      })
    )
  ]);

  await bench(`N=${N} (N×N)`, async () => {
    await node.eval(context);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const hasGC = typeof globalThis.gc === 'function';
  console.log(`\nExtend Pipeline Benchmark`);
  console.log(`GC exposed: ${hasGC}`);
  console.log(`Node: ${process.version}`);
  console.log(`─────────────────────────────────────────\n`);

  console.log('Scenario 1: N children extending shared base (exact match)');
  for (const N of [50, 100, 200, 500]) {
    await scenario1(N);
  }

  console.log('\nScenario 2: N children extending partial compound (.base.variant)');
  for (const N of [10, 25, 50, 100, 200]) {
    await scenario2(N);
  }

  console.log('\nScenario 3: N children extending into :is() compound target');
  for (const N of [10, 25, 50, 100]) {
    await scenario3(N);
  }

  console.log('\nScenario 4: N×N cross-product (N targets, N extends)');
  for (const N of [10, 25, 50, 100]) {
    await scenario4(N);
  }

  console.log('\n─────────────────────────────────────────');
  console.log('Done.\n');
}

main().catch(console.error);
