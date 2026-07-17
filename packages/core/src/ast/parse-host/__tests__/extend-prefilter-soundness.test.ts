import { describe, it, expect, afterEach } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from '../../functions/index.js';
import { setExtendPrefilterEnabled } from '../../extend.js';

/**
 * Soundness gate for the target-atom SOLVE PREFILTER in `extend.ts`. The prefilter
 * skips `solveComposed` for any subject whose composed seed shares no individual
 * simple atom with any instruction target — a provably byte-identical optimization.
 *
 * The naive version (extracting subject atoms WITHOUT recursing into `:is()` grafts,
 * or at compound rather than per-simple granularity, or with any normalization drift)
 * is UNSOUND: it would wrongly skip a subject that matches only via a graft atom, and
 * silently drop the extend. These 6 adversarial shapes each exercise a distinct trap;
 * every one asserts the render is byte-IDENTICAL with the prefilter ON vs OFF, in BOTH
 * flat and nested output modes. A `fired` check on each proves the case is live (the
 * extend actually applies), so ON == OFF is not a vacuous both-empty pass.
 */

async function render(src: string, collapseNesting: boolean): Promise<string> {
  const root = bridgeToAst(parseLessFn(src).tree, src);
  const evaluator = buildEvaluator(makeBuiltinRegistry());
  return (await serialize(root, { evaluator, collapseNesting })).css;
}

/** Render `src` with the prefilter OFF then ON, in both output modes. */
async function renderToggled(src: string): Promise<{
  flatOn: string;
  flatOff: string;
  nestedOn: string;
  nestedOff: string;
}> {
  setExtendPrefilterEnabled(false);
  const flatOff = await render(src, true);
  const nestedOff = await render(src, false);
  setExtendPrefilterEnabled(true);
  const flatOn = await render(src, true);
  const nestedOn = await render(src, false);
  return { flatOn, flatOff, nestedOn, nestedOff };
}

afterEach(() => setExtendPrefilterEnabled(true));

interface Case {
  name: string;
  src: string;
  /** Substrings that MUST appear in the (ON) flat render — proves the extend fired. */
  firedFlat: string[];
}

const CASES: Case[] = [
  {
    // 1. Graft-only partial overlap. `.c`'s seed is `:is(.p1, .p2) .c`; the target
    // atom `.p1` lives ONLY inside the `:is()` graft. Shallow (textSimples-style)
    // extraction would see `{.c}`, miss `.p1`, wrongly SKIP, and drop `.foo`.
    name: 'graft-only partial overlap',
    src: `.p1, .p2 {\n  .c { color: red; }\n}\n.foo:extend(.p1 all) { color: blue; }`,
    // `.foo` is grafted into the `:is()` alongside `.p1` — the exact atom a shallow
    // (graft-dropping) extraction would miss, wrongly skipping the subject.
    firedFlat: [':is(.p1, .p2, .foo) .c'],
  },
  {
    // 2. Graft-only whole-branch overlap. The multi-segment target `.a .x .y`
    // matches `.c`'s branch only via `branchExpansions` of `:is(.a, .b) .x .y`.
    name: 'graft-only whole-branch overlap',
    src: `.a, .b {\n  .x .y { color: red; }\n}\n.z:extend(.a .x .y) { color: blue; }`,
    firedFlat: ['.z'],
  },
  {
    // 3. Transitive chain `.a:extend(.b); .b:extend(.c); .c{}` plus a bystander that
    // shares NO seed atom (must stay untouched) and a sibling sharing only `.c`.
    name: 'transitive chain with bystander',
    src:
      `.a:extend(.b) { color: 1; }\n` +
      `.b:extend(.c) { color: 2; }\n` +
      `.c { color: 3; }\n` +
      `.bystander { color: 4; }\n` +
      `.d:extend(.c) { color: 5; }`,
    firedFlat: ['.c', '.a', '.b', '.d'],
  },
  {
    // 4. `all` sub-part with `:is()` substitution introducing atoms mid-fixpoint:
    // `.wrap:extend(.box all)` then `.deep:extend(.wrap all)` chains through the
    // `:is()` the first extend produces.
    name: 'all sub-part with :is() substitution mid-fixpoint',
    src:
      `.box { .inner { color: red; } }\n` +
      `.wrap:extend(.box all) { color: blue; }\n` +
      `.deep:extend(.wrap all) { color: green; }`,
    firedFlat: ['.wrap', '.deep'],
  },
  {
    // 5. Multi-target `:extend(.a, .b)` (union across BOTH target branches) plus an
    // attribute/pseudo target `[data-x]` — non-class atoms must be extracted too.
    name: 'multi-target + attribute/pseudo atoms',
    src:
      `.a { color: 1; }\n` +
      `.b { color: 2; }\n` +
      `.foo:extend(.a, .b) { color: 3; }\n` +
      `[data-x]:hover { color: 4; }\n` +
      `.g:extend([data-x]) { color: 5; }`,
    firedFlat: ['.foo', '.g'],
  },
  {
    // 6. Normalization: `.A` must NOT be conflated with `.a` (case-sensitive), and a
    // `.a.b` sub-compound target still matches the `.a.b.c` superset compound.
    name: 'case-sensitivity + compound superset',
    src:
      `.A { color: 1; }\n` +
      `.a { color: 2; }\n` +
      `.x:extend(.a) { color: 3; }\n` +
      `.a.b.c { color: 4; }\n` +
      `.y:extend(.a.b) { color: 5; }`,
    firedFlat: ['.x', '.y'],
  },
];

describe('extend target-atom prefilter — adversarial soundness (ON == OFF)', () => {
  for (const c of CASES) {
    it(`${c.name}: byte-identical prefilter ON vs OFF (flat + nested)`, async () => {
      const r = await renderToggled(c.src);
      expect(r.flatOn, 'flat render: prefilter ON must equal OFF').toBe(r.flatOff);
      expect(r.nestedOn, 'nested render: prefilter ON must equal OFF').toBe(r.nestedOff);
      // Liveness: the extend actually applied, so ON == OFF is not vacuous.
      for (const needle of c.firedFlat) {
        expect(r.flatOn, `expected fired extend fragment ${needle}`).toContain(needle);
      }
    });
  }

  it('case 6 keeps `.A` distinct from `.a` (no case-fold conflation)', async () => {
    const src = CASES[5]!.src;
    setExtendPrefilterEnabled(true);
    const flat = await render(src, true);
    // `.x:extend(.a)` must NOT reach the `.A` rule — `.A` stays a lone selector.
    for (const line of flat.split('}')) {
      if (line.includes('.A') && !line.includes('.a')) {
        expect(line.includes('.x'), '`.A` must not gain `.x` from a `.a` extend').toBe(false);
      }
    }
  });
});
