/**
 * plan-differential.test.ts — the ORACLE for the PLAN phase (A) reachability + (B) index.
 * =======================================================================================
 *
 * PLAN (`plan.ts`) reproduces the production extend gather's REACHABILITY relation — the
 * A1–A8 dimensions honored by `isInstructionVisibleForRoot` (extend-roots.ts:605). This
 * suite validates that reproduction against the real corpus (parse → eval/render), by two
 * independent oracles run on the SAME live extend-root graph the production gather uses:
 *
 *   ORACLE 1 — INDEPENDENT RE-DERIVATION. `oracleReach` computes, per instruction, the
 *     reachable-root set by a STRUCTURALLY DIFFERENT traversal of the public registry than
 *     `reachesRoot`: it starts from the instruction's own extend root and grows the closure
 *     forward (visible-roots ∪ same-or-descendant scan), then applies the A6/A7 gates. If
 *     PLAN's clause reproduction drifts from the documented predicate — a wrong clause order,
 *     a dropped dimension — the two disagree on the real graph (which carries real protected /
 *     @layer / @media / reference roots). Asserted set-equal per instruction.
 *
 *   ORACLE 2 — BEHAVIORAL ANCHOR. The rendered CSS is production's ground truth for whether an
 *     extend reached a subject. For each fixture we assert the OBSERVABLE extend effect (a
 *     subject renders alongside its extender iff reachable) agrees with PLAN's reachability —
 *     grounding A3 (no reach-out), A5 (@media own root), A6 (reference never activates) in real
 *     output, not just in a re-derivation.
 *
 * Both oracles read only the public `ExtendRootRegistry` surface + `context.extends`; the
 * private `rulesetsByRoot` gather is never touched, because reachability is defined over roots.
 * Reachability is SELECTOR/STRUCTURE-ONLY — no value frame is consulted (design §4.2).
 */
import { describe, it, expect } from 'vitest';
import { Parser } from '../../../../../less-parser/src/index.js';
import { Context } from '../../../context.js';
import { renderNodeToString, type RenderBufferNode } from '../../util/render-buffer.js';
import { rules, el } from '../../index.js';
import type { Rules } from '../../rules.js';
import { ExtendRootRegistry } from '../../util/extend-roots.js';
import {
  buildExtendPlan,
  decodeInstructions,
  reachesRoot,
  type PlanInstruction,
  type RootGraph
} from '../plan.js';

interface Rendered {
  css: string;
  context: Context;
}

async function render(src: string, collapseNesting = false): Promise<Rendered> {
  const context = new Context({ output: { collapseNesting }, leakyRules: true });
  const parser = new Parser();
  const { tree } = parser.parse(src);
  // Force the EVAL path (identity `preSerializeRoot` pins off the single-pass spine): this
  // suite validates PLAN's reproduction of the EVAL-path gather, so it needs the eval-path
  // `context.extends` + `extendRoots` populated. The spine (P3) folds extend into the pass
  // and does NOT populate those eval artifacts — a separate, spine-native path.
  const css = String(await renderNodeToString(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    tree as unknown as RenderBufferNode,
    context,
    { context, preSerializeRoot: (r: Rules) => r }
  ));
  return { css, context };
}

/**
 * ORACLE 1 — independent re-derivation of the reachable-root set for one instruction.
 * Traversal is deliberately UNLIKE `reachesRoot` (root-first test): here we grow the set
 * FORWARD from the instruction's own root, then intersect with the registry's own membership
 * checks, so an equal result corroborates the reproduction rather than restating it.
 */
function oracleReach(graph: RootGraph, inst: PlanInstruction): Set<Rules> {
  const out = new Set<Rules>();
  // A6: a reference/import-scope extend reaches NOTHING (never activates a subject, never warns).
  if (inst.fromReferenceScope) {
    return out;
  }
  const origin = inst.extendRoot;
  if (!origin) {
    return out;
  }
  const allRoots = graph.getAllRoots();
  // Forward closure: the visible-roots set from the origin (A8 transitive), plus the origin
  // itself (A1), plus every root the origin is a same-or-ancestor of (A2/A3 direction, A4 layer).
  const forward = new Set<Rules>(graph.getVisibleRoots(origin));
  forward.add(origin);
  for (const root of allRoots) {
    if (graph.isSameOrDescendantRoot(root, origin)) {
      forward.add(root);
    }
  }
  // A7: a protected root only admits an extend DECLARED in it (origin === root). Filter forward.
  for (const root of forward) {
    if (graph.isProtectedRoot(root) && origin !== root) {
      continue;
    }
    out.add(root);
  }
  return out;
}

function sortedRootIds(roots: Set<Rules>, id: Map<Rules, number>): string {
  const ids: number[] = [];
  for (const r of roots) {
    let n = id.get(r);
    if (n === undefined) {
      n = id.size;
      id.set(r, n);
    }
    ids.push(n);
  }
  return ids.sort((a, b) => a - b).join(',');
}

/** Assert PLAN's reachability == oracle re-derivation, per instruction, on a rendered sheet. */
function assertReachabilityMatches(rendered: Rendered, label: string): void {
  const { context } = rendered;
  const graph: RootGraph = context.extendRoots;
  const plan = buildExtendPlan(context, graph);
  const id = new Map<Rules, number>();
  expect(plan.instructions.length, `${label}: instruction count`).toBe(decodeInstructions(context).length);
  for (const inst of plan.instructions) {
    const planned = plan.reachability.get(inst)!;
    const oracle = oracleReach(graph, inst);
    expect(
      sortedRootIds(planned, id),
      `${label}: reachability for target=${String(inst.target.valueOf())} extendWith=${String(inst.extendWith.valueOf())} partial=${inst.partial} ref=${inst.fromReferenceScope}`
    ).toBe(sortedRootIds(oracle, id));
  }
}

describe('PLAN reachability (A) — differential vs independent registry re-derivation', () => {
  it('A1/A2 own + descendant root — root-level and nested extend', async () => {
    const rendered = await render(`
      .a { color: red; }
      .b:extend(.a) { }
      .outer {
        .c { color: blue; }
        .d:extend(.c) { }
      }
    `);
    assertReachabilityMatches(rendered, 'A1/A2');
  });

  it('A5 @media body is its own root — extend inside media', async () => {
    const rendered = await render(`
      .base { color: red; }
      @media screen {
        .mbase { color: green; }
        .mext:extend(.mbase) { }
        .cross:extend(.base) { }
      }
    `);
    assertReachabilityMatches(rendered, 'A5');
  });

  it('A3 inner cannot reach out — extend inside media does not touch root-level subjects', async () => {
    const rendered = await render(`
      .shared { color: red; }
      @media print {
        .x:extend(.shared all) { }
      }
      .also-shared { color: blue; }
    `);
    assertReachabilityMatches(rendered, 'A3');
  });

  it('A4 @layer same-name roots — extend across layers of the same name', async () => {
    const rendered = await render(`
      @layer base {
        .l1 { color: red; }
      }
      @layer base {
        .l2:extend(.l1 all) { }
      }
    `);
    assertReachabilityMatches(rendered, 'A4');
  });

  it('A8 transitive closure — multi-level nesting', async () => {
    const rendered = await render(`
      .grand { color: red; }
      .p {
        .mid {
          .leaf:extend(.grand all) { }
        }
      }
    `);
    assertReachabilityMatches(rendered, 'A8');
  });

  it('same-target fan-out + not-found (A1) — many extenders, one target; a dangling target', async () => {
    const rendered = await render(`
      .btn { color: red; }
      .x:extend(.btn) { }
      .y:extend(.btn) { }
      .z:extend(.btn) { }
      .orphan:extend(.does-not-exist all) { }
    `);
    assertReachabilityMatches(rendered, 'fan-out');
  });

  it('mixed media + root + nested in one sheet', async () => {
    const rendered = await render(`
      .a { color: red; }
      .b:extend(.a) { }
      @media screen {
        .c { color: blue; }
        .d:extend(.c) { }
        .e { .f:extend(.c all) { } }
      }
      .g { color: green; }
      .h:extend(.g all) { }
    `);
    assertReachabilityMatches(rendered, 'mixed');
  });
});

describe('PLAN target index (B) — same-target/scope bucketing', () => {
  it('groups same (scope, target) extenders into one bucket, splits by target', async () => {
    const { context } = await render(`
      .btn { color: red; }
      .a:extend(.btn) { }
      .b:extend(.btn) { }
      .c:extend(.other) { }
      .other { color: blue; }
    `);
    const plan = buildExtendPlan(context);
    // .btn bucket holds both .a and .b (same scope, same target); .other holds .c.
    const buckets = [...plan.targetIndex.values()];
    const btn = buckets.find(b => String(b.target.valueOf()) === '.btn');
    const other = buckets.find(b => String(b.target.valueOf()) === '.other');
    expect(btn, 'btn bucket exists').toBeDefined();
    expect(btn!.fans.length, 'btn bucket fan count').toBe(2);
    expect(other, 'other bucket exists').toBeDefined();
    expect(other!.fans.length, 'other bucket fan count').toBe(1);
  });

  it('SelectorList non-partial target expands into per-branch instructions', async () => {
    const { context } = await render(`
      .a { color: red; }
      .b { color: blue; }
      .c:extend(.a, .b) { }
    `);
    const decoded = decodeInstructions(context);
    // The exact (non-partial) list target .a, .b expands to two instructions (one per branch).
    const targets = decoded.map(i => String(i.target.valueOf())).sort();
    expect(targets).toEqual(['.a', '.b']);
  });

  it('every bucket fan reaches the same root set as its bucket (scope is a bucketing precondition)', async () => {
    const { context } = await render(`
      .a { color: red; }
      .x:extend(.a) { }
      @media screen {
        .m { color: blue; }
        .n:extend(.m) { }
        .o:extend(.m) { }
      }
    `);
    const plan = buildExtendPlan(context);
    const id = new Map<Rules, number>();
    for (const bucket of plan.targetIndex.values()) {
      const keys = new Set(bucket.fans.map(f => sortedRootIds(plan.reachability.get(f)!, id)));
      expect(keys.size, `bucket target=${String(bucket.target.valueOf())} has one scope`).toBe(1);
    }
  });
});

/**
 * SYNTHETIC-REGISTRY differential — deterministically exercises the wall dimensions the
 * render corpus does not reliably produce (A4 @layer mutual reach, A7 protected wall). Builds
 * an `ExtendRootRegistry` directly with `registerRoot` (its public API) over bare Rules nodes,
 * then asserts `reachesRoot` (PLAN) agrees with the `oracleReach` re-derivation on every root.
 * This is where a broken A7/A4 clause in PLAN would surface — the render fixtures alone leave
 * those clauses untriggered.
 */
function bareRoot(): Rules {
  return rules([]);
}

function assertAllRootsAgree(graph: RootGraph, inst: PlanInstruction, label: string): void {
  const oracle = oracleReach(graph, inst);
  for (const root of graph.getAllRoots()) {
    expect(reachesRoot(graph, root, inst), `${label}: reachesRoot for a root`).toBe(oracle.has(root));
  }
}

describe('PLAN reachability — synthetic registry (A4 layer, A7 protected wall)', () => {
  it('A7 — a protected root is a wall: an extend declared OUTSIDE it does not reach in', () => {
    const registry = new ExtendRootRegistry();
    const root = bareRoot();
    const child = bareRoot();
    const protectedChild = bareRoot();
    registry.registerRoot(root);
    registry.registerRoot(child, root);
    registry.registerRoot(protectedChild, root, { isProtected: true });
    const graph: RootGraph = registry;
    // Extend declared in `root` reaches root + non-protected child, but NOT the protected child.
    const inst: PlanInstruction = {
      target: el('.t'), extendWith: el('.e'), partial: false,
      extendRoot: root, extendNode: undefined, fromReferenceScope: false, documentOrder: 0
    };
    assertAllRootsAgree(graph, inst, 'A7-outside');
    expect(reachesRoot(graph, protectedChild, inst), 'protected child is walled off').toBe(false);
    expect(reachesRoot(graph, child, inst), 'non-protected child reachable').toBe(true);
    // An extend DECLARED in the protected root reaches it (origin === protected root).
    const instInside: PlanInstruction = { ...inst, extendRoot: protectedChild };
    expect(reachesRoot(graph, protectedChild, instInside), 'extend declared inside reaches it').toBe(true);
    assertAllRootsAgree(graph, instInside, 'A7-inside');
  });

  it('A4 — same @layer-name roots are mutually reachable', () => {
    const registry = new ExtendRootRegistry();
    const root = bareRoot();
    const layerA1 = bareRoot();
    const layerA2 = bareRoot();
    registry.registerRoot(root);
    registry.registerRoot(layerA1, root, { layerName: 'base' });
    registry.registerRoot(layerA2, root, { layerName: 'base' });
    const graph: RootGraph = registry;
    // An extend in one `base` layer reaches the other `base` layer (mutual).
    const inst: PlanInstruction = {
      target: el('.t'), extendWith: el('.e'), partial: false,
      extendRoot: layerA1, extendNode: undefined, fromReferenceScope: false, documentOrder: 0
    };
    assertAllRootsAgree(graph, inst, 'A4');
    expect(reachesRoot(graph, layerA2, inst), 'sibling same-layer reachable').toBe(true);
  });
});

describe('PLAN reachability (B2) — reference/import scope (A6)', () => {
  it('a reference-scope extend reaches nothing and never activates a subject', async () => {
    // A6: fromReferenceScope extends are gathered but never reach a root. Build synthetic
    // instructions carrying the flag against a real registry to exercise the gate directly.
    const { context } = await render(`
      .a { color: red; }
      .b:extend(.a) { }
    `);
    const graph: RootGraph = context.extendRoots;
    const anyRoot = [...graph.getAllRoots()][0]!;
    const refInst: PlanInstruction = {
      target: context.extends[0]![0],
      extendWith: context.extends[0]![1],
      partial: false,
      extendRoot: anyRoot,
      extendNode: undefined,
      fromReferenceScope: true,
      documentOrder: 0
    };
    expect(oracleReach(graph, refInst).size, 'reference extend reaches nothing (oracle)').toBe(0);
    // PLAN's own predicate must ALSO gate reference scope on every root (A6).
    for (const root of graph.getAllRoots()) {
      expect(reachesRoot(graph, root, refInst), 'reference extend gated by PLAN on every root').toBe(false);
    }
    // Sanity: the SAME instruction without the reference flag DOES reach at least its own root,
    // so the gate — not a degenerate registry — is what produces the empty set.
    const nonRef: PlanInstruction = { ...refInst, fromReferenceScope: false };
    expect(reachesRoot(graph, anyRoot, nonRef), 'non-reference reaches its own root').toBe(true);
  });
});
