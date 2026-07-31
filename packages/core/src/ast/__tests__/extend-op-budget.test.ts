import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Extend operation-counter budgets (V8 mechanical gate #3 + #4).
 *
 * Byte-identity and wall-time are BLIND to two extend regressions:
 *   (#3) a matcher that walks work it should have gated away, and
 *   (#4) the O(subjects·instructions·branches) fixpoint growing worse.
 *
 * We assert them structurally with the opt-in extend profile counters
 * (`__JESS_EXTEND_PROFILE_COUNTERS__`, captured at core import time — undefined
 * and zero-cost in production). The bag must be installed BEFORE the extend
 * modules load, so every test re-imports through `vi.resetModules()`.
 *
 *   (a) an extend-FREE document does ZERO matcher work: the allocation-free
 *       presence pre-scan fires, and neither the planner nor the matcher runs.
 *   (b) doubling the selector count must not multiply the matcher's core
 *       comparison count by ~4 (quadratic). The current implementation's growth
 *       is measured and pinned as a CEILING (see GROWTH_CEILING), so the gate
 *       fails on any WORSE-than-today complexity.
 */

const PROFILE_KEY = '__JESS_EXTEND_PROFILE_COUNTERS__';

type CoreAst = typeof import('../nodes.js');
type Serialize = typeof import('../serialize.js')['serialize'];

let ast: CoreAst;
let serialize: Serialize;
let counters: Record<string, number>;

/**
 * Clear counts in place. The profile bag is captured by reference at core import
 * time, so it must NOT be reassigned between measurements (that would strand the
 * captured writer on a dead object) — only mutated.
 */
const resetCounters = (): void => {
  for (const key of Object.keys(counters)) {
    delete counters[key];
  }
};

beforeEach(async () => {
  vi.resetModules();
  counters = {};
  (globalThis as typeof globalThis & { [PROFILE_KEY]?: Record<string, number> })[PROFILE_KEY] = counters;
  ast = await import('../nodes.js');
  ({ serialize } = await import('../serialize.js'));
});

afterEach(() => {
  delete (globalThis as typeof globalThis & { [PROFILE_KEY]?: Record<string, number> })[PROFILE_KEY];
});

/**
 * A matcher-exercising fixture: one shared target `.base` and `n` extender rules
 * each `:extend(.base)`. All n instructions share the same `(partial, hidden,
 * target)` match condition, so the fixpoint folds them into ONE apply and appends
 * every extender in a single scan of `.base`'s seed. Before the fold each of the n
 * instructions re-scanned the growing branch list (Σk = Θ(n²)); this fixture pins
 * that the fold keeps the per-branch comparison count from re-growing with n.
 */
const sharedTargetDoc = (n: number): ReturnType<CoreAst['stylesheet']> => {
  const rules = [ast.rule('.base', [ast.decl('color', ast.keyword('red'))])];
  for (let i = 0; i < n; i++) {
    rules.push(ast.rule(`.x${i}`, [], [{ target: ast.selist(ast.sel('.base')), partial: false }]));
  }
  return ast.stylesheet(rules);
};

const comparisonsFor = (n: number): number => {
  resetCounters();
  serialize(sharedTargetDoc(n), { collapseNesting: true });
  return counters['astExtend.match.branchComparisons'] ?? 0;
};

/**
 * A CONTRIB-composition fixture: a FIXED instruction count (one `.x:extend(.base)`)
 * against a GROWING number of admitted subjects — `n` rules nested inside `.base`.
 * `.base` itself may-matches the target, and `mayMatch` is an INHERITED flag, so the
 * emit candidate prune admits the whole nested subtree and every child runs the solve
 * fixpoint. The instruction is EXACT (not `partial`), so emit's per-nested-subject
 * `relativizeExtender` path — whose instructions are rebuilt per subject and are
 * therefore genuinely not memoizable — contributes no compositions here, leaving the
 * count a clean measure of the solve-side memo alone.
 */
const manySubjectDoc = (n: number): ReturnType<CoreAst['stylesheet']> => {
  const children = [];
  for (let i = 0; i < n; i++) {
    children.push(ast.rule(`.s${i}`, [ast.decl('color', ast.keyword('blue'))]));
  }
  return ast.stylesheet([
    ast.rule('.base', [ast.decl('color', ast.keyword('red')), ...children]),
    ast.rule('.x', [], [{ target: ast.selist(ast.sel('.base')), partial: false }])
  ]);
};

const contribComposesFor = (n: number): number => {
  resetCounters();
  serialize(manySubjectDoc(n), { collapseNesting: true });
  return counters['astExtend.buildContribs.instructionsComposed'] ?? 0;
};

const DISCOVER = process.env.EXTEND_BUDGET_DISCOVER === 'true';

describe('extend operation-counter budgets', () => {
  it('does ZERO matcher work on an extend-free document (#3 gate)', () => {
    const document = ast.stylesheet([
      ast.rule('.plain', [ast.decl('color', ast.keyword('red'))]),
      ast.rule('.other', [ast.rule('.nested', [ast.decl('x', ast.keyword('1'))])])
    ]);

    expect(serialize(document, { collapseNesting: true }).css).toContain('.plain');

    /*
     * The allocation-free presence pre-scan ran and every call was a no-feature
     * MISS (no `:extend()` anywhere in the document)...
     */
    const calls = counters['astExtend.documentHasExtend.calls'] ?? 0;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(counters['astExtend.documentHasExtend.noFeatureMisses'] ?? 0).toBe(calls);
    expect(counters['astExtend.documentHasExtend.featureBearingCalls'] ?? 0).toBe(0);

    // ...so the planner never built a subject/instruction plan...
    expect(counters['astExtend.plan.calls'] ?? 0).toBe(0);

    // ...and the matcher performed zero branch comparisons.
    expect(counters['astExtend.match.branchComparisons'] ?? 0).toBe(0);
  });

  it('runs the matcher only when an extend is present', () => {
    const document = sharedTargetDoc(4);
    expect(serialize(document, { collapseNesting: true }).css).toContain('.x0');
    expect(counters['astExtend.documentHasExtend.featureBearingCalls'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(counters['astExtend.documentHasExtend.noFeatureMisses'] ?? 0).toBe(0);
    expect(counters['astExtend.plan.calls'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(counters['astExtend.match.branchComparisons'] ?? 0).toBeGreaterThan(0);
  });

  if (DISCOVER) {
    it('reports the matcher comparison growth exponent', () => {
      const points = [40, 80, 160, 320];
      const rows = points.map(n => ({ n, c: comparisonsFor(n) }));
      const lines = rows.map(r => `  n=${r.n}: ${r.c} comparisons`);
      let prev: { n: number; c: number } | undefined;
      for (const row of rows) {
        if (prev) {
          const ratio = row.c / prev.c;

          // exponent p where ratio = 2^p (each step doubles n)
          const exponent = Math.log2(ratio);
          lines.push(`  ${prev.n}->${row.n}: x${ratio.toFixed(2)} (exponent ${exponent.toFixed(2)})`);
        }
        prev = row;
      }
      console.log('\n=== extend matcher comparison growth ===\n' + lines.join('\n'));
      expect(rows.every(r => r.c > 0)).toBe(true);
    });
    return;
  }

  it('does not regress the matcher comparison complexity (#4 gate)', () => {
    /*
     * The fixpoint folds every instruction sharing a `(partial, hidden, target)`
     * match condition into ONE apply, so a shared-target subject does its per-branch
     * target comparison ONCE per group per pass instead of once per instruction per
     * round. That turns the old Θ(n²) re-scan (doubling n → ~4× comparisons) into
     * linear-or-better: on this shared-target fixture the `.base` subject folds all n
     * extenders in a single scan of its one-branch seed, so the comparison count is
     * effectively CONSTANT in n (measured x1.0 at every doubling). The ceiling is
     * pinned just above that: a regression back to per-instruction re-scanning would
     * reintroduce ~4× growth and trip this gate.
     */
    const GROWTH_CEILING = 2.5; // measured ~1.0 (constant, post-fold); << the 4× quadratic signal.

    const base = comparisonsFor(80);
    const doubled = comparisonsFor(160);
    const ratio = doubled / base;

    expect(base).toBeGreaterThan(0);
    expect(
      ratio,
      `matcher comparison count grew x${ratio.toFixed(2)} from n=80 (${base}) to n=160 (${doubled}); `
      + `ceiling is x${GROWTH_CEILING}. A larger factor means the extend fixpoint stopped `
      + `folding same-target instructions and went back to re-scanning per instruction.`
    ).toBeLessThanOrEqual(GROWTH_CEILING);
  });

  it('composes each instruction contrib ONCE per render, not once per subject (#4 gate)', () => {
    /*
     * `buildContribs` runs `composePath(inst.extenderPath)` + `collectBranchAtoms(
     * inst.target)`, both of which depend ONLY on the instruction. Calling it per
     * ADMITTED SUBJECT recomputed the identical result for every subject that cleared
     * the prefilter — measured on benchmark.less as 3,414 compositions for 26
     * instructions (131 admitted subjects x 26), 1.1-1.5% of the render profile. The
     * render-scoped contrib memo makes it once per instruction.
     *
     * This fixture holds the instruction count FIXED at 1 while doubling the admitted
     * subject count, so the composition count must stay CONSTANT at 1. Without the memo
     * it is measured at n+1 (51 and 101 at these two sizes) — linear in the subject
     * count — so a regression to per-subject construction trips this gate.
     */
    const base = contribComposesFor(50);
    const doubled = contribComposesFor(100);

    expect(base).toBe(1);
    expect(
      doubled,
      `contrib compositions grew from ${base} (50 admitted subjects) to ${doubled} (100); `
      + `the document has ONE instruction, so both must equal it. A larger count means `
      + `buildContribs went back to recomposing per subject instead of using the render memo.`
    ).toBe(base);
  });
});
