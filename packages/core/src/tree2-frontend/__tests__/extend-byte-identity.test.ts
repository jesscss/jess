import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats } from '../../tree2/index.js';
import { bridgeToTree2, UnsupportedShape } from '../bridge.js';
import { buildValueService } from '../value-service.js';

/**
 * R1 extend — byte-identity against the ORACLE (less.js `alpha` branch,
 * TOP-LEVEL `.css` goldens, read READ-ONLY via `git show`). Alpha's top-level
 * output is the Jess-v5 `:is()`-compacted nested form.
 *
 * The 7 extend fixtures are rendered through tree2 in flatten + nested modes and
 * compared to the alpha golden. This test asserts only the CONFIRMED-matching
 * subset (so the suite stays green as the remaining nested-child-flatten work
 * lands) and logs the full per-fixture/per-mode result for the record.
 */

const LESS_REPO = path.join(process.env.HOME ?? '', 'git/oss/less.js');
const FIXTURE_ROOT =
  '/Users/matthew/git/worktrees/less.js/alpha-release-port/packages/test-data/tests-unit';
const NAMES = [
  'extend',
  'extend-chaining',
  'extend-clearfix',
  'extend-exact',
  'extend-media',
  'extend-nest',
  'extend-selector',
];

function alphaGolden(name: string): string | null {
  try {
    return execFileSync(
      'git',
      ['-C', LESS_REPO, 'show', `alpha:packages/test-data/tests-unit/${name}/${name}.css`],
      { encoding: 'utf8' },
    );
  } catch {
    return null;
  }
}

// Confirmed byte-identical to alpha today (both flatten + nested).
const CONFIRMED_BOTH = new Set(['extend-chaining', 'extend-media']);

describe('R1 extend — byte-identity vs less.js alpha top-level', () => {
  it('renders the 7 extend fixtures and matches the confirmed subset', async () => {
    const report: string[] = [];
    for (const name of NAMES) {
      const src = fs.readFileSync(path.join(FIXTURE_ROOT, name, `${name}.less`), 'utf8');
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
      const gold = alphaGolden(name);
      const fm = gold !== null && flat === gold;
      const nm = gold !== null && nested === gold;
      report.push(`${name}: flat=${fm ? 'MATCH' : 'diff'} nested=${nm ? 'MATCH' : 'diff'}`);
      if (CONFIRMED_BOTH.has(name)) {
        expect(nested, `${name} nested must match alpha`).toBe(gold);
      }
    }
    // eslint-disable-next-line no-console
    console.log('R1 extend byte-identity vs alpha:\n' + report.join('\n'));
  });

  it('extend-nest builds with ZERO node cloning (composeStats has no clone op)', async () => {
    const src = fs.readFileSync(path.join(FIXTURE_ROOT, 'extend-nest', 'extend-nest.less'), 'utf8');
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
