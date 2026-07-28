/**
 * plan.ts — the PLAN phase of the unified extend flow (PLAN / SOLVE / EMIT).
 * ==========================================================================
 *
 * PLAN is pure precompute over the eval'd tree's extend-root graph + the extend
 * instruction list. It is OFF the hot path and — per UNIFIED-EVAL-EMIT-DESIGN.md
 * §4.1 and EXTEND-GLOBAL-FLOW-DESIGN.md §4 — survives the eventual eval/emit cutover
 * UNCHANGED. It builds two immutable structures:
 *
 *   (A) REACHABILITY — for each extend instruction, the transitive-closure set of
 *       extend roots (`Rules` scopes) whose subject selectors that instruction may
 *       touch. This reproduces every scope dimension the production gather
 *       (`extend-roots.ts`'s `isInstructionVisibleForRoot`) honors — see the A1–A8
 *       table in EXTEND-GLOBAL-FLOW-DESIGN.md §"(A) REACHABILITY":
 *
 *         A1 own root                         (isInstructionVisibleForRoot:624)
 *         A2 descendant roots (nesting/at-rule)(:627 → isSameOrDescendantRoot:555)
 *         A3 inner cannot reach OUT           (child-edge direction of the graph)
 *         A4 same @layer-name roots mutual    (layerName reg; getAccessibleRoots:537)
 *         A5 @media body is its own root      (at-rule.ts:1192/1290)
 *         A6 reference/import-scope never activate a subject (fromReferenceScope:618)
 *         A7 protected root is a wall         (isProtected:621; getAccessibleRoots:523)
 *         A8 transitive closure               (getVisibleRoots:508)
 *
 *   (B) TARGET INDEX — all extend rules grouped by (scope, find-target) into a bucket
 *       of `(extendWith, mode)` rewrites, so one match against a target-satisfying
 *       compound fires the whole same-target bucket. This reuses the Set-Trie /
 *       match-bitset bucketing already prototyped in `process-extends-by-index.ts`'s
 *       `buildTargetIndex` + the interned `keySetLibrary`/`selectorBits` fingerprints.
 *
 * SCOPE REACHABILITY IS SELECTOR/STRUCTURE-ONLY. It reads the extend-root graph (a
 * structural artifact of eval) and instruction identity; it never consults a value
 * frame. This is the decoupling UNIFIED-EVAL-EMIT-DESIGN.md §4.2 turns on: extend
 * closure is a selector-graph fixpoint, value resolution is a per-leaf frame lookup.
 *
 * NOT wired into production, NOT the cutover — a validated building block. Not
 * exported from any index → bundle-excluded.
 */
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { Node } from '../node.js';
import type { Selector } from '../selector.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector } from '../selector-complex.js';

/**
 * One extend instruction as PLAN sees it, decoded from a `context.extends` tuple.
 * `documentOrder` is retained for SOLVE's confluence sort (EMIT sorts by order);
 * PLAN itself does not order.
 */
export interface PlanInstruction {
  target: Selector;
  extendWith: Selector;
  partial: boolean;
  extendRoot: Rules | undefined;
  extendNode: Node | undefined;
  fromReferenceScope: boolean;
  documentOrder: number | undefined;
}

/** A target bucket: one (scope, find-target), many `(extendWith, mode)` rewrites. */
export interface TargetBucket {
  scopeKey: string;
  target: Selector;
  partial: boolean;
  fans: PlanInstruction[];
}

export interface ExtendPlan {
  instructions: PlanInstruction[];

  /**
   * (A) reachability: per instruction, the set of extend roots whose subjects it may
   * touch. Keyed by instruction identity (the PlanInstruction object).
   */
  reachability: Map<PlanInstruction, Set<Rules>>;

  /** (B) target index: (scope, partial, target-value) → bucket of same-target fans. */
  targetIndex: Map<string, TargetBucket>;

  /** every extend root the graph knows about (A8 closure domain). */
  allRoots: Set<Rules>;
}

/**
 * Read-only projection of the extend-root registry PLAN needs. The production
 * `ExtendRootRegistry` (`extend-roots.ts`) exposes exactly this public surface, so
 * PLAN reproduces the visibility predicate without touching the private
 * `rulesetsByRoot` gather — reachability is defined over roots, not over rulesets.
 */
export interface RootGraph {
  getAllRoots(): Set<Rules>;
  isProtectedRoot(rules: Rules): boolean;
  isSameOrDescendantRoot(rulesetRoot: Rules, extendRoot: Rules): boolean;
  getVisibleRoots(root: Rules): Set<Rules>;
}

/**
 * Reproduce `isInstructionVisibleForRoot` (extend-roots.ts:605) EXACTLY. This is the
 * A1–A8 predicate: does `instruction` reach subjects registered under `rootRules`?
 *
 * The clauses map 1:1 to the production gather:
 *   - no extendRoot            → not reachable                      (:615)
 *   - fromReferenceScope       → NEVER reachable (A6)               (:618)
 *   - protected root, foreign  → wall (A7)                          (:621)
 *   - own root                 → reachable (A1)                     (:624)
 *   - same-or-descendant root  → reachable (A2/A3/A4)               (:627 → :555)
 *   - visible-roots membership → reachable (A8 transitive closure)  (:633 → :508)
 */
export function reachesRoot(
  graph: RootGraph,
  rootRules: Rules,
  instruction: Pick<PlanInstruction, 'extendRoot' | 'fromReferenceScope'>
): boolean {
  if (!instruction.extendRoot) {
    return false;
  }
  if (instruction.fromReferenceScope === true) {
    return false;
  }
  if (graph.isProtectedRoot(rootRules) && instruction.extendRoot !== rootRules) {
    return false;
  }
  if (instruction.extendRoot === rootRules) {
    return true;
  }
  if (graph.isSameOrDescendantRoot(rootRules, instruction.extendRoot)) {
    return true;
  }
  return graph.getVisibleRoots(instruction.extendRoot).has(rootRules);
}

function complexOf(item: SelectorList['value'][number]): Selector {
  return typeof item === 'string' ? new ComplexSelector([item]) : item;
}

/**
 * Decode `context.extends` tuples into PlanInstructions, reproducing the production
 * gather's SelectorList target-expansion (extend-roots.ts:696): a NON-partial extend
 * whose target is a SelectorList expands into one instruction per branch — an exact
 * extend fires per-branch, so reachability + indexing must see each branch as its own
 * target. Partial targets stay whole.
 */
export function decodeInstructions(context: Context): PlanInstruction[] {
  const out: PlanInstruction[] = [];
  for (const [target, extendWith, partial, extendRoot, extendNode, documentOrder, fromReferenceScope] of context.extends) {
    const base = {
      extendWith,
      partial,
      extendRoot,
      extendNode,
      fromReferenceScope: fromReferenceScope === true,
      documentOrder
    };
    if (!partial && isNode(target, N.SelectorList)) {
      for (const item of target.value) {
        out.push({ ...base, target: complexOf(item) });
      }
    } else {
      out.push({ ...base, target });
    }
  }
  return out;
}

/**
 * Stable scope key for an instruction's reachability. Two instructions share the same
 * (B) bucket only when they reach the SAME set of roots — otherwise a fan-out would
 * fire an extender into a subject it cannot reach. The key is the sorted identity list
 * of reachable roots (interned to small ids), so it is a precise partition of the
 * A1–A8 reachability, not an opaque approximation.
 */
function scopeKeyOf(reachable: Set<Rules>, rootId: Map<Rules, number>): string {
  const ids: number[] = [];
  for (const r of reachable) {
    let id = rootId.get(r);
    if (id === undefined) {
      id = rootId.size;
      rootId.set(r, id);
    }
    ids.push(id);
  }
  ids.sort((a, b) => a - b);
  return ids.join(',');
}

/**
 * Build the (B) target index. Instructions with an IDENTICAL reachability set AND the
 * same (partial, target-value) share a bucket; one match fires every fan. This is the
 * indexed generalization of `applyExtendsToSelector`'s same-target batch, with scope
 * folded in as a bucketing precondition (design §4.1 / EXTEND-INDEX-DESIGN.md §"Global
 * flow" step 3) so the per-match hot path never re-tests scope.
 */
function buildTargetIndex(
  instructions: PlanInstruction[],
  reachability: Map<PlanInstruction, Set<Rules>>,
  rootId: Map<Rules, number>
): Map<string, TargetBucket> {
  const index = new Map<string, TargetBucket>();
  for (const inst of instructions) {
    const reachable = reachability.get(inst)!;
    const scopeKey = scopeKeyOf(reachable, rootId);
    const key = `${scopeKey}|${inst.partial ? 1 : 0}|${inst.target.valueOf()}`;
    let bucket = index.get(key);
    if (!bucket) {
      bucket = { scopeKey, target: inst.target, partial: inst.partial, fans: [] };
      index.set(key, bucket);
    }
    bucket.fans.push(inst);
  }
  return index;
}

/**
 * PLAN — build (A) reachability + (B) target index over the eval'd tree's extend
 * roots + instruction list. Pure precompute; no frame, no mutation, no output.
 *
 * `graph` defaults to `context.extendRoots` (the production registry, which satisfies
 * RootGraph via its public surface). Pass an explicit graph only for isolated tests.
 */
export function buildExtendPlan(context: Context, graph: RootGraph = context.extendRoots): ExtendPlan {
  const instructions = decodeInstructions(context);
  const allRoots = graph.getAllRoots();

  /*
   * (A) reachability: for each instruction, the roots it reaches (A1–A8). This is the
   * graph-reachability closure — computed once, off the hot path.
   */
  const reachability = new Map<PlanInstruction, Set<Rules>>();
  for (const inst of instructions) {
    const reachable = new Set<Rules>();
    for (const root of allRoots) {
      if (reachesRoot(graph, root, inst)) {
        reachable.add(root);
      }
    }
    reachability.set(inst, reachable);
  }

  const rootId = new Map<Rules, number>();
  const targetIndex = buildTargetIndex(instructions, reachability, rootId);

  return { instructions, reachability, targetIndex, allRoots };
}
