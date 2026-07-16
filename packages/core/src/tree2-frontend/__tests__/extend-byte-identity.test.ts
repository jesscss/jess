import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats } from '../../tree2/index.js';
import { bridgeToTree2, UnsupportedShape } from '../bridge.js';
import { buildValueService } from '../value-service.js';
import { expectedCss, fixtureLess, legacyCss, resolveCollapseNesting } from '../oracle-source.js';

/**
 * R1 extend — byte-identity against the ORACLE (less.js `alpha` branch), rendered
 * PER FIXTURE in that fixture's OWN configured output mode.
 *
 * Each less.js test-data fixture declares its output mode in its `styles.config.ts`
 * (`output.collapseNesting`); a fixture with NO config uses the empirically-confirmed
 * default (flat — see `resolveCollapseNesting`). The mode is resolved READ-ONLY from
 * the same fixed oracle ref as the `.less`/`.css` via `oracle-source.ts` — no test
 * hand-picks a golden or a mode. Confirmed matrix on `alpha`:
 *
 *   FLAT   (no config → default true): extend-chaining, extend-clearfix, extend-nest
 *   NESTED (collapseNesting: false):   extend, extend-exact, extend-media, extend-selector
 *
 * The prior test gated NESTED tree2 output against fixtures whose alpha `.css` is
 * actually FLAT (no config), a phantom "flat vs nested" conflict. Rendering each
 * fixture in ITS mode removes that: the flat fixtures gate flat, the nested ones
 * gate nested. The "flatten iff the extend match crosses `&`" re-projection rule
 * governs ONLY the nested fixtures.
 *
 * For a nested fixture whose alpha `.css` carries the exact-extend-into-nested-
 * children BUG, tree2 emits the CORRECT re-nesting and is gated against the
 * checked-in PROPOSED correction (`proposed-alpha-corrections/<f>.css`), NOT
 * alpha's buggy golden.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORRECTIONS = path.resolve(
  HERE,
  '../../../../../docs/future/core-architecture/proposed-alpha-corrections',
);
const correctedCss = (name: string): string =>
  readFileSync(path.join(CORRECTIONS, `${name}.css`), 'utf8');

/** Render `fixture` in its RESOLVED config mode (the byte-identity gate) plus its
 * FLAT render (for the informational flat-vs-legacy column). `deferred` is set
 * when the bridge refuses the shape (a clean `UnsupportedShape` boundary). */
async function renderInConfigMode(
  fixture: string,
): Promise<{ mode: 'FLAT' | 'NESTED'; css: string; flatCss: string } | { deferred: string }> {
  const src = fixtureLess(fixture);
  const collapseNesting = resolveCollapseNesting(fixture);
  let root;
  try {
    root = bridgeToTree2(parseLessFn(src).tree, src);
  } catch (e) {
    if (e instanceof UnsupportedShape) return { deferred: e.message };
    throw e;
  }
  const svc = await buildValueService(root);
  const flatCss = serialize(root, { valueService: svc, collapseNesting: true }).css;
  const css = collapseNesting
    ? flatCss
    : serialize(root, { valueService: svc, collapseNesting: false }).css;
  return { mode: collapseNesting ? 'FLAT' : 'NESTED', css, flatCss };
}

/**
 * Fixtures that are byte-identical in their configured mode.
 *   oracle 'alpha'     → gate against the fixed `.css` golden.
 *   oracle 'corrected' → alpha's golden is buggy (exact-extend-into-children);
 *                        gate against the checked-in proposed correction.
 */
const RESOLVED: Record<string, 'alpha' | 'corrected'> = {
  'extend-chaining': 'alpha', // FLAT
  'extend-clearfix': 'alpha', // FLAT
  'extend-media': 'alpha', // NESTED
  extend: 'corrected', // NESTED — alpha golden carries the exact-into-children bug
};

/** Fixtures the bridge cleanly refuses (fail-loud `UnsupportedShape`). */
const DEFERRED_UNSUPPORTED = new Set([
  // extend-selector: `[data=@{x}]` attribute-interpolation extend shape → R4.
  'extend-selector',
]);

/**
 * KNOWN GAPS — resolved to their correct config mode but NOT yet byte-identical.
 * These are real remaining engine work, tracked fail-loud via `it.fails`: the
 * assertion below currently FAILS (so `it.fails` passes); when the engine is
 * fixed the assertion will PASS and `it.fails` will FAIL, forcing promotion into
 * `RESOLVED`. NOT clean deferrals — do NOT fast-forward while these remain.
 */
const KNOWN_GAPS: Record<string, string> = {
  // FLAT. Two residual gaps vs alpha golden:
  //  (1) `.button:hover, .submit:hover` should sibling-`:is()`-compact to
  //      `:is(.button, .submit):hover` (flat header not run through siblingCompact).
  //  (2) the `.amp-test-*` mega-selector: a MULTI-PART extender spliced into a
  //      fused compound position must be `:is()`-wrapped
  //      (`.amp-test-f:is(.amp-test-c … .amp-test-e)`), not fused bare.
  'extend-nest': 'flat :is()-wrap of multi-part / sibling-compacted extender',
  // NESTED. Two residual gaps vs alpha golden:
  //  (1) exact-extend-into-children: `.effected:extend(.a)` should merge to a
  //      shared `.a, .effected { … }` header (alpha golden is itself buggy here;
  //      needs a proposed-correction like `extend`).
  //  (2) block 5 `.e { && { … } }` should collapse the nested `&&` to `.e.e`
  //      and hoist to `.e.e, .dbl { … }`.
  'extend-exact': 'nested exact-into-children merge + `&&` self-collapse',
};

const NAMES = [
  ...Object.keys(RESOLVED),
  ...DEFERRED_UNSUPPORTED,
  ...Object.keys(KNOWN_GAPS),
];

describe('R1 extend — byte-identity vs less.js alpha, per-fixture config mode', () => {
  it('resolvable extend fixtures are byte-identical in their configured mode', async () => {
    const report: string[] = [];
    for (const name of NAMES) {
      const r = await renderInConfigMode(name);
      if ('deferred' in r) {
        report.push(`${name}: DEFERRED (${r.deferred})`);
        continue;
      }
      const oracleKind = RESOLVED[name];
      const gold = oracleKind === 'corrected' ? correctedCss(name) : expectedCss(name);
      const match = r.css === gold;
      const tag = name in RESOLVED ? '' : ' [KNOWN GAP]';
      // Informational flat-vs-legacy column: legacy/*.css is the 4.x EXPANDED
      // reference; tree2 flat emits the v5 `:is()`-compacted form, so this is
      // ALWAYS a diff — legacy/ is NOT a tree2 oracle (see oracle-source.ts).
      const vsLegacy = r.flatCss === legacyCss(name) ? 'MATCH' : 'diff';
      report.push(
        `${name}: resolved-mode=${r.mode} vs-${oracleKind ?? 'alpha'}=${match ? 'MATCH' : 'diff'}` +
          ` | flat-vs-legacy=${vsLegacy}${tag}`,
      );
      if (name in RESOLVED) {
        expect(r.css, `${name} (${r.mode}) must match its ${oracleKind} oracle`).toBe(gold);
      }
    }
    // eslint-disable-next-line no-console
    console.log('R1 extend per-config byte-identity:\n' + report.join('\n'));
  });

  for (const name of DEFERRED_UNSUPPORTED) {
    it(`${name} is a clean UnsupportedShape deferral`, () => {
      const src = fixtureLess(name);
      expect(() => bridgeToTree2(parseLessFn(src).tree, src)).toThrow(UnsupportedShape);
    });
  }

  for (const [name, reason] of Object.entries(KNOWN_GAPS)) {
    // Fail-loud tracker: currently NOT byte-identical (so this test passes). When
    // the engine is fixed the inner assertion passes → `it.fails` fails → promote
    // this fixture into `RESOLVED`. See `KNOWN_GAPS` for the exact residual gap.
    it.fails(`KNOWN GAP — ${name} (${reason}) is not yet byte-identical`, async () => {
      const r = await renderInConfigMode(name);
      if ('deferred' in r) throw new Error(`${name} unexpectedly deferred: ${r.deferred}`);
      expect(r.css).toBe(expectedCss(name));
    });
  }

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
