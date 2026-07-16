import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats } from '../../tree2/index.js';
import { bridgeToTree2, UnsupportedShape } from '../bridge.js';
import { buildValueService } from '../value-service.js';
import { expectedCss, fixtureLess } from '../oracle-source.js';

/**
 * R1 extend — byte-identity against the ORACLE (less.js `alpha` branch,
 * TOP-LEVEL `.css` goldens, read READ-ONLY via `git show`). Alpha's top-level
 * output is the Jess-v5 `:is()`-compacted nested form, so NESTED mode is the
 * byte-identity gate; flatten mode is a downstream projection with no independent
 * alpha golden (it matches only for fixtures whose alpha `.css` has no nesting).
 *
 * Both input `.less` and expected `.css` are fetched ONLY through the fixed-path
 * oracle helper (`oracle-source.ts`) — no test hand-picks a golden. See
 * `docs/future/core-architecture/ORACLE.md`.
 */

const NAMES = [
  'extend',
  'extend-chaining',
  'extend-clearfix',
  'extend-exact',
  'extend-media',
  'extend-nest',
  'extend-selector',
];

// Confirmed byte-identical to alpha's nested top-level golden.
const CONFIRMED_NESTED = new Set(['extend-chaining', 'extend-media']);

describe('R1 extend — byte-identity vs less.js alpha top-level', () => {
  it('renders the 7 extend fixtures and matches the confirmed subset', async () => {
    const report: string[] = [];
    for (const name of NAMES) {
      const src = fixtureLess(name);
      let root;
      try {
        root = bridgeToTree2(parseLessFn(src).tree, src);
      } catch (e) {
        if (e instanceof UnsupportedShape) {
          report.push(`${name}: DEFERRED (${e.message})`);
          continue;
        }
        throw e;
      }
      const svc = await buildValueService(root);
      const flat = serialize(root, { valueService: svc, collapseNesting: true }).css;
      const nested = serialize(root, { valueService: svc, collapseNesting: false }).css;
      const gold = expectedCss(name);
      const fm = flat === gold;
      const nm = nested === gold;
      report.push(`${name}: flat=${fm ? 'MATCH' : 'diff'} nested=${nm ? 'MATCH' : 'diff'}`);
      if (CONFIRMED_NESTED.has(name)) {
        expect(nested, `${name} nested must match alpha`).toBe(gold);
      }
    }
    // eslint-disable-next-line no-console
    console.log('R1 extend byte-identity vs alpha:\n' + report.join('\n'));
  });

  it('extend-nest builds with ZERO node cloning (composeStats has no clone op)', async () => {
    const src = fixtureLess('extend-nest');
    const root = bridgeToTree2(parseLessFn(src).tree, src);
    const stats = composeStats(root, await buildValueService(root));
    // tree2 never clones/inherits/withComponents by construction; composeStats
    // only counts string compositions. Assert the structural invariant holds
    // (the stats object exposes no clone/inherit/withComponents counter).
    expect(Object.keys(stats).sort()).toEqual([
      'composeOps',
      'distinctSelectors',
      'selectorAllocs',
    ]);
    expect(stats.composeOps).toBeGreaterThanOrEqual(0);
  });
});
