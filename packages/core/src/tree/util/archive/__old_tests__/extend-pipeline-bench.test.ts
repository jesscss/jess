/**
 * Pipeline-only benchmark — no walk-specific imports.
 * Can run against any commit.
 */
import { describe, it } from 'vitest';
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

function fmt(n: number): string {
  return n.toFixed(1);
}

function heapMB(): number {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

describe('Pipeline benchmark', () => {
  it('Scenario 1: N children extending shared base', async () => {
    for (const N of [50, 100, 200, 500]) {
      const context = new Context();
      const node = rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([decl({ name: 'color', value: any('red') })])
        }),
        ...Array.from({ length: N }, (_, i) =>
          ruleset({
            selector: sellist([sel([el(`.child-${i}`)])]),
            rules: rules([extend({ target: el('.base') })])
          })
        )
      ]);

      heapMB();
      const heapBefore = heapMB();
      const start = performance.now();
      await node.eval(context);
      const ms = performance.now() - start;
      const heapAfter = heapMB();

      console.info(`  N=${N}: ${fmt(ms)}ms, heap Δ${fmt(heapAfter - heapBefore)}MB (${fmt(heapBefore)}→${fmt(heapAfter)})`);
    }
  });

  it('Scenario 2: N children extending partial compound', async () => {
    for (const N of [10, 25, 50, 100, 200]) {
      const context = new Context();
      const node = rules([
        ruleset({
          selector: sellist([sel([compound([el('.base'), el('.variant')])])]),
          rules: rules([decl({ name: 'color', value: any('red') })])
        }),
        ...Array.from({ length: N }, (_, i) =>
          ruleset({
            selector: sellist([sel([el(`.child-${i}`)])]),
            rules: rules([extend({ target: el('.base') })])
          })
        )
      ]);

      heapMB();
      const heapBefore = heapMB();
      const start = performance.now();
      await node.eval(context);
      const ms = performance.now() - start;
      const heapAfter = heapMB();

      console.info(`  N=${N}: ${fmt(ms)}ms, heap Δ${fmt(heapAfter - heapBefore)}MB`);
    }
  });

  it('Scenario 3: N children extending into :is() compound', async () => {
    for (const N of [10, 25, 50, 100]) {
      const context = new Context();
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
          rules: rules([decl({ name: 'color', value: any('red') })])
        }),
        ...Array.from({ length: N }, (_, i) =>
          ruleset({
            selector: sellist([sel([el(`.child-${i}`)])]),
            rules: rules([extend({ target: el('.a0') })])
          })
        )
      ]);

      heapMB();
      const heapBefore = heapMB();
      const start = performance.now();
      await node.eval(context);
      const ms = performance.now() - start;
      const heapAfter = heapMB();

      console.info(`  N=${N} (${IS_BLOCKS}×${ALTS} :is()): ${fmt(ms)}ms, heap Δ${fmt(heapAfter - heapBefore)}MB`);
    }
  });

  it('Scenario 4: N×N cross-product', async () => {
    for (const N of [10, 25, 50, 100]) {
      const context = new Context();
      const node = rules([
        ...Array.from({ length: N }, (_, i) =>
          ruleset({
            selector: sellist([sel([el(`.target-${i}`)])]),
            rules: rules([decl({ name: 'color', value: any('red') })])
          })
        ),
        ...Array.from({ length: N }, (_, i) =>
          ruleset({
            selector: sellist([sel([el(`.ext-${i}`)])]),
            rules: rules([extend({ target: el(`.target-${i}`) })])
          })
        )
      ]);

      heapMB();
      const heapBefore = heapMB();
      const start = performance.now();
      await node.eval(context);
      const ms = performance.now() - start;
      const heapAfter = heapMB();

      console.info(`  N=${N}: ${fmt(ms)}ms, heap Δ${fmt(heapAfter - heapBefore)}MB`);
    }
  });
});
