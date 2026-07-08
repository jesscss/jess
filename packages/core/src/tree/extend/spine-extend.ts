/**
 * spine-extend.ts — the EXTEND-WORK GATE for the single downward pass (P3, increment 0).
 * =====================================================================================
 *
 * This module owns the §4.0 EXTEND-WORK GATE: the decision, made ONCE at spine entry,
 * of whether the pass must engage the extend layer (PLAN / SOLVE / buffer-then-flush)
 * at all. It is the FAST-PATH guard the whole extend fold hangs off:
 *
 *   - NO `:extend` anywhere in the tree  → `engageExtendLayer` returns false and the
 *     pass stays a PURE STREAMING SPINE (design §2): every ruleset header is final the
 *     moment the walk reaches it, so headers emit inline with ZERO deferral, ZERO
 *     per-subject buffering, ZERO PLAN/SOLVE. This is the COMMON case and it must cost
 *     nothing — the buffer/flush machinery of §4.4 (added in later increments) exists
 *     solely to serve extend deferral, and deferral only arises from a reaching extend.
 *
 *   - `:extend` present → the extend layer engages for the reaching subjects only
 *     (later increments; increment 0 wires ONLY the gate + its zero-cost lock).
 *
 * INCREMENT 0 SCOPE (this file today). The spine has no PLAN/SOLVE/buffering yet, and
 * `isSpineEligibleRoot`/`hasExtendedTopLevelSelector` already keep every extend-bearing
 * root OFF the spine (`emit-walk.ts` extend gate). So the invariant this module LOCKS is
 * the safety floor for the riskiest phase: *a render whose tree carries no `:extend`
 * performs zero extend-layer work.* The counters below are the instrument the ratchet
 * reads to prove it (all zero for an extend-free render). As later increments add PLAN,
 * SOLVE, and per-subject buffering, each bumps its counter through THIS module, so the
 * zero-extend ratchet keeps guarding that the fast path never silently starts paying.
 *
 * KEYING — STATIC TREE PRESENCE, not `context.extends`. The design §4.0 phrases the gate
 * as `context.extends empty`, but `context.extends` is populated by the EVAL gather
 * (`extend.ts:341`), which the spine SKIPS. The spine's honest, eval-free signal is the
 * STATIC presence of an `:extend` selector on the source tree (`F_EXTENDED`), read by
 * `treeHasExtend`. This is the same predicate `isSpineEligibleRoot` already trusts to
 * route extend-bearing roots to the eval path — reused here as the gate key so the two
 * decisions cannot diverge.
 *
 * NOT the render cutover's whole extend fold — increment 0 is the gate + lock only. Not
 * exported from `index.ts` beyond what the ratchet needs → minimal bundle surface.
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.0 (extend-work gate), §4.4 (flush discipline)
 * @see CUTOVER-CHECKLIST.md P3 — "Extend-work gate (§4.0) — the fast path"
 */
import { Ruleset } from '../ruleset.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import type { Rules } from '../rules.js';
import type { Node } from '../node.js';

/**
 * Instrument for the zero-extend ratchet (metric axis (b): the fast path pays nothing).
 * Every unit of extend-layer work bumps exactly one of these counters as later
 * increments wire it, so a standing test can assert ALL THREE stay 0 across an
 * extend-free render. A regression that starts running PLAN/SOLVE or buffering a subject
 * on the extend-free fast path trips that test RED.
 *
 * - `planRuns`     — PLAN (reachability + target index) built for a document.
 * - `solveRuns`    — SOLVE fixpoint driven for a document.
 * - `subjectBuffers` — subjects whose header was DEFERRED into a per-subject buffer
 *                      (the §4.4 buffer-then-flush; a streamed-inline subject does NOT
 *                      bump this).
 */
export const extendLayerCounter = {
  planRuns: 0,
  solveRuns: 0,
  subjectBuffers: 0
};

/** Reset the extend-layer instrument (test harness / per-render measurement). */
export function resetExtendLayerCounter(): void {
  extendLayerCounter.planRuns = 0;
  extendLayerCounter.solveRuns = 0;
  extendLayerCounter.subjectBuffers = 0;
}

/**
 * STATIC: does this source subtree carry ANY `:extend` selector (an `F_EXTENDED`
 * top-level selector on a ruleset, at any depth)? Pure, eval-free, side-effect-free —
 * reads only source flags. This is the gate key (see module note): the same predicate
 * `isSpineEligibleRoot` uses to route extend-bearing roots, so the gate and the
 * eligibility check agree by construction.
 *
 * Increment 0 detects the EXTENDER side (`&:extend()` / a selector flagged `F_EXTENDED`),
 * which is how jess marks a ruleset that participates in extend. A bare `:extend()`
 * target with no extender is inert (nothing to apply), so extender-presence is the sound
 * "is there real extend work" signal.
 */
export function treeHasExtend(node: Node): boolean {
  let rules: Node[] | undefined;
  if (isNode(node, N.Ruleset)) {
    const selector = node.selector;
    if (selector !== undefined && Ruleset.hasExtendedTopLevelSelector(selector)) {
      return true;
    }
    rules = node.rules;
  } else if (isNode(node, N.Rules)) {
    rules = node.rules;
  } else if (isNode(node, N.AtRule)) {
    rules = node.rules;
  }
  if (rules) {
    for (const child of rules) {
      if (treeHasExtend(child)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * THE GATE (design §4.0). Decide, once at spine entry, whether the pass must engage the
 * extend layer. Returns false — the pure-streaming fast path — when the tree carries no
 * `:extend`; true when there is real extend work to do.
 *
 * Load-bearing invariant: when this returns false, the pass MUST NOT run PLAN, MUST NOT
 * run SOLVE, and MUST NOT buffer any subject header — `extendLayerCounter` stays all-zero
 * for the render. This is what the zero-extend ratchet locks. Callers on the false branch
 * simply stream (today's behavior, byte-identical).
 */
export function engageExtendLayer(root: Rules): boolean {
  return treeHasExtend(root);
}
