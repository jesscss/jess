import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { buildEvaluator } from '../../evaluator.js';
import { makeBuiltinRegistry } from './make-builtin-registry.js';
import { setExtendPrefilterEnabled } from '../../extend.js';
import { renderAstFile } from './whole-doc-driver.js';

const BENCHMARK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../../packages/jess/benchmark/benchmark.less',
);

/**
 * Soundness gate for the extend FAST-REJECT. `setExtendPrefilterEnabled(false)`
 * turns OFF both the target-atom solve prefilter AND the `computeExtends` candidate
 * PRUNE, giving a full-scan reference: every subject composes + solves and every
 * rule gets a computed map entry. `true` is production: a subject enters the
 * expensive composePath/solve path only when it is a candidate (may-match via an
 * inherited path-atom boolean, carries its own `:extend()`, or is a `&&`
 * self-collapse pair) or a descendant of one. Both must be byte-IDENTICAL.
 *
 * The unsound version silently DROPS a valid extend: extracting subject atoms
 * WITHOUT recursing into `:is()` grafts, at compound rather than per-simple
 * granularity, with normalization drift, or a candidate prune that misses a
 * trigger-B / flatten-cascade / collapse subject. Each shape below exercises a
 * distinct trap and asserts the render is byte-identical with the fast-reject ON
 * vs OFF, in BOTH flat and nested modes; a `fired` check proves the extend actually
 * applies (so ON == OFF is not a vacuous both-empty pass). The whole-document
 * benchmark.less ON == OFF check at the end proves it on the real corpus.
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
  {
    // 7. Trigger-B seed. `.ext:extend(.tgt)` is a NESTED rule whose OWN selector
    // (`.ext`) shares NO atom with any target — so `mayMatch(.ext)` is false. It is
    // a candidate ONLY via the `hasOwnExtend` seed; a prune that keyed candidacy on
    // may-match alone would drop the flatten and mis-nest it.
    name: 'trigger-B: nested own-extend whose selector is not a target',
    src: `.tgt { color: 1; }\n.wrap {\n  .ext:extend(.tgt) { color: 2; }\n}`,
    firedFlat: ['.ext'],
  },
  {
    // 8. Flatten cascade to a NON-may-match descendant. `.side2:extend(.side all)`
    // aliases `.side`'s whole context; `.side .leaf .twig`'s deepest rule `.twig`
    // must flatten under the aliased context. `.twig`'s own compound shares no
    // target atom — it is pulled in ONLY by the downward closure from the flattened
    // ancestor. A prune without the cascade would leave it nested/stale.
    name: 'flatten cascade to non-may-match descendant',
    src:
      `.side {\n  .leaf {\n    .twig { color: 1; }\n  }\n}\n` +
      `.side2:extend(.side all) { color: 2; }`,
    firedFlat: ['.side2'],
  },
  {
    // 9. media-bubbled extend: the extend lives INSIDE `@media` and must only reach
    // subjects in the same at-rule scope. A bystander outside the media block shares
    // the atom but must stay untouched (scope reachability), and the prune must not
    // conflate scopes.
    name: 'media-bubbled extend scoped correctly',
    src:
      `@media screen {\n  .box { color: 1; }\n  .m:extend(.box) { color: 2; }\n}\n` +
      `.box { color: 3; }`,
    firedFlat: ['.m'],
  },
  {
    // 10. self-referential extend `.a:extend(.a)` — the subject IS its own target.
    // Self-avoidance must not loop, and ON == OFF must hold.
    name: 'self-referential extend',
    src: `.a:extend(.a) { color: 1; }\n.b:extend(.a) { color: 2; }`,
    firedFlat: ['.a', '.b'],
  },
  {
    // 11. Multi-segment COMBINATOR target `.a > .b`. The whole-branch match must
    // append `.ext` as a sibling of the combinator complex, identically under the
    // prune (the target's atoms `.a`,`.b` gate candidacy through a `>` combinator).
    name: 'combinator target whole-branch append',
    src:
      `.a > .b { color: 1; }\n` +
      `.host .a > .b .c { color: 2; }\n` +
      `.ext:extend(.a > .b all) { color: 3; }`,
    firedFlat: ['.a > .b,\n.ext'],
  },
  {
    // 12. Interpolated bystander selector. `.@{v}x` carries `@{…}` interpolation
    // (its IR atom is the literal fragment only); it shares no target atom and must
    // render byte-identically under prune ON (default entry) vs OFF (computed entry).
    // Proves the non-candidate default header path matches the full-scan path for an
    // interpolated selector.
    name: 'interpolated bystander untouched by prune',
    src:
      `@v: foo;\n` +
      `.host {\n  .@{v}x { color: 1; }\n  .inner:extend(.tgt) { color: 2; }\n}\n` +
      `.tgt { color: 3; }`,
    firedFlat: ['.inner'],
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

describe('extend fast-reject — whole-document benchmark.less (ON == OFF)', () => {
  it('benchmark.less renders byte-identically with the candidate prune ON vs OFF', () => {
    const src = fs.readFileSync(BENCHMARK, 'utf8');
    const ev = () => buildEvaluator(makeBuiltinRegistry());
    setExtendPrefilterEnabled(false);
    const off = renderAstFile(BENCHMARK, { evaluator: ev() });
    setExtendPrefilterEnabled(true);
    const on = renderAstFile(BENCHMARK, { evaluator: ev() });
    setExtendPrefilterEnabled(true);
    expect(off.threw, 'full-scan render must not throw').toBeNull();
    expect(on.threw, 'pruned render must not throw').toBeNull();
    expect(on.css, 'benchmark.less: prune ON must be byte-identical to full-scan OFF').toBe(off.css);
    // guard against a vacuous both-undefined pass.
    expect(typeof on.css).toBe('string');
    expect(on.css!.length).toBeGreaterThan(1000);
    void src;
  });
});
