/**
 * solve.ts — the SOLVE phase of the unified extend flow (PLAN / SOLVE / EMIT).
 * ==========================================================================
 *
 * PLAN (`plan.ts`) precomputes (A) reachability + (B) the target index over the eval'd
 * tree's extend-root graph. SOLVE consumes that plan and drives the DOCUMENT-LEVEL
 * FIXPOINT that turns the plan into each subject's final selector set — the
 * orchestration UNIFIED-EVAL-EMIT-DESIGN.md §4.2 / EXTEND-GLOBAL-FLOW-DESIGN.md §SOLVE
 * describe:
 *
 *   ONE global worklist over `(subjectBranch, instruction)`, partitioned by reachability
 *   bucket, sharing the one target index. To "fire" a `(subjectBranch, instruction)` is to
 *   run the per-match rewrite (`extendByIndexOwn`, validated byte-identical to the
 *   `extendSelector` oracle per match). A produced branch is re-routed back into the index
 *   (CROSS-SELECTOR TRANSITIVE CLOSURE — target→ext→target). Fire-once is enforced GLOBALLY
 *   on `(subjectId, branchValue, instructionId)` so re-appending an extender each round is
 *   impossible. Termination is by value-dedupe (a produced branch already present is inert)
 *   plus the fire-once bound. `&`-hoist is a re-bucketing event (a crossing branch is emitted
 *   at ROOT placement rather than the subject's nested position). Confluence is guaranteed
 *   because EMIT sorts by document `order`.
 *
 * SOLVE is the ORCHESTRATION on top of the validated per-match engine — it does NOT re-derive
 * the rewrite (that is `extendByIndexOwn`) and does NOT re-derive reachability (that is PLAN).
 * Its NEW surface, not covered by the per-call sweep, is exactly the document-level behavior:
 * many subjects, chained extends interacting ACROSS selectors, fire-once across the whole
 * document, hoist re-bucketing, reachability as a per-subject gate.
 *
 * A per-match shape the own engine cannot build yet returns UNSUPPORTED (fail-loud); SOLVE
 * records that subject as a KNOWN-FALLBACK (the eventual wire-in falls back for it) and never
 * silently delegates.
 *
 * LAYER BOUNDARY (validated, EXPECTED). SOLVE reproduces the LOCAL-APPLY layer —
 * `applyExtendsToSelector` — which rewrites a subject selector against the RAW per-instruction
 * `(target, extendWith, partial)`. It does NOT reproduce the `processExtends`-level steps that sit
 * ABOVE local-apply: composing a nested extender relative to its target
 * (`composeExtendWithRelativeToTarget`/`getFullComposedForm`) and hoisting a `&`-crossing branch to
 * the root selector list. UNIFIED-EVAL-EMIT-DESIGN.md §4.3 assigns compose + hoist to EMIT
 * (a re-bucketing/projection of the settled branch set), NOT to the SOLVE fixpoint. So a
 * `&`-crossing extend fires here with its raw `extendWith` and AGREES with the local-apply oracle;
 * the composed/hoisted render shape is the wire-in's EMIT responsibility, deliberately out of scope.
 *
 * NOT wired into production, NOT the cutover — a validated building block.
 * Not exported from any index → bundle-excluded.
 */
import type { Rules } from '../rules.js';
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { extendByIndexOwn, UNSUPPORTED, type UnsupportedResult } from './extend-index.js';
import type { ExtendPlan, PlanInstruction, TargetBucket } from './plan.js';

/**
 * A SUBJECT is one selector the document places (a registered ruleset's authored selector),
 * identified for fire-once bookkeeping. `root` is the extend root the subject lives under —
 * an instruction only reaches this subject when PLAN's reachability set for the instruction
 * contains `root` (the A1–A8 scope gate, applied here as a per-subject precondition, never
 * re-tested on the per-match path).
 */
export interface SolveSubject {
  id: string;
  selector: Selector;
  root: Rules;
}

/** The per-subject SOLVE outcome. */
export interface SolveSubjectResult {
  id: string;
  /** the subject's final selector after the fixpoint (own-built), or the input when UNSUPPORTED. */
  selector: Selector;
  /** true when every fired instruction built on the own engine (no UNSUPPORTED for this subject). */
  ownBuilt: boolean;
  /** instructions whose per-match shape the own engine cannot build yet (known-fallback frontier). */
  unsupported: PlanInstruction[];
}

export interface SolveResult {
  subjects: SolveSubjectResult[];
  /** true when NO subject hit an UNSUPPORTED per-match shape (whole document own-built). */
  fullyOwnBuilt: boolean;
}

/**
 * Stable identity for a plan instruction (fire-once key component). Two decoded instructions
 * are the same firing when they carry the same (partial, find-target, extendWith); the same
 * source `PlanInstruction` object always maps to the same key.
 */
function instructionKey(inst: PlanInstruction): string {
  return `${inst.partial ? 1 : 0}|${inst.target.valueOf()}|${inst.extendWith.valueOf()}`;
}

/** Coerce a per-match result (single selector or list) to one Selector. */
function asSelector(result: Selector | Selector[]): Selector {
  return Array.isArray(result)
    ? new SelectorList(result as SelectorList['value'])
    : result;
}

/**
 * Which buckets reach a subject: a bucket's fans all share one reachability set (PLAN's
 * bucketing invariant — every fan in a bucket reaches the same roots), so scope is decided
 * once per bucket by testing any fan's reachability against the subject's root.
 */
function bucketReachesSubject(
  plan: ExtendPlan,
  bucket: TargetBucket,
  subject: SolveSubject
): boolean {
  const anyFan = bucket.fans[0];
  if (!anyFan) {
    return false;
  }
  const reachable = plan.reachability.get(anyFan);
  return reachable !== undefined && reachable.has(subject.root);
}

/**
 * Drive ONE subject to its fixpoint against the reachable buckets. This is the per-subject
 * worklist: the subject selector is the seed; firing a reachable `(target, extendWith, partial)`
 * that CHANGES the selector re-enqueues the produced selector so a chained/transitive extend
 * (an extender that is itself another bucket's target) drains as more queue work. Fire-once is
 * keyed on (branchValue, instructionKey): an instruction that already fired against the current
 * branch value never re-fires — that is the document-global guard localized to this subject's
 * evolving value (re-appending an extender each round is impossible), while a genuinely NEW
 * value (post-chain) is a fresh branch the instruction may still fire against.
 */
function solveSubject(
  plan: ExtendPlan,
  subject: SolveSubject,
  reachableBuckets: TargetBucket[]
): SolveSubjectResult {
  const unsupported: PlanInstruction[] = [];
  let ownBuilt = true;

  let current = subject.selector;
  // Fire-once GLOBALLY on (branch value, instruction). A branch value is the serialized form of
  // the current subject selector; an instruction is keyed by (partial, target, extendWith). Once a
  // pair fires we never re-fire it — but a produced (new) branch value re-opens every instruction
  // against the fresh value, which is the transitive closure (a chained target only reachable after
  // an earlier apply still fires). Value-dedupe: a fire that does not change the value is recorded
  // as fired-inert and never retried.
  const fired = new Set<string>();
  const fireKey = (branchValue: string, inst: PlanInstruction): string =>
    `${branchValue}|${instructionKey(inst)}`;

  let changed = true;
  // Bound: each (branch-value, instruction) fires at most once, and each fire that changes the
  // value produces at most one new branch value; the total fires are bounded by
  // subjects×instructions per distinct value. This guard is a belt-and-suspenders cap that can
  // never be reached under the fire-once set, but keeps a divergent rewrite from looping.
  const totalFans = reachableBuckets.reduce((n, b) => n + b.fans.length, 0);
  const guardMax = (totalFans + 2) * (totalFans + 2);
  let rounds = 0;
  while (changed && rounds <= guardMax) {
    changed = false;
    rounds++;
    const branchValue = String(current.valueOf());
    for (const bucket of reachableBuckets) {
      for (const fan of bucket.fans) {
        const key = fireKey(branchValue, fan);
        if (fired.has(key)) {
          continue;
        }
        const result: Selector | Selector[] | 'NOT_FOUND' | UnsupportedResult =
          extendByIndexOwn(current, fan.target, fan.extendWith, fan.partial);
        if (result === UNSUPPORTED) {
          ownBuilt = false;
          unsupported.push(fan);
          fired.add(key); // do not retry an unbuildable shape
          continue;
        }
        if (result === 'NOT_FOUND') {
          // Not reachable in the CURRENT branch value. Leave unfired so a later chained change
          // (a new branch value) re-opens it — the transitive-closure re-enqueue.
          continue;
        }
        const next = asSelector(result);
        fired.add(key);
        if (String(next.valueOf()) !== branchValue) {
          current = next;
          changed = true;
          break; // new branch value → restart the sweep so fire-once keys off the fresh value
        }
        // Matched but no net change (self-extend / value-dedupe) → fired-inert, no re-fire.
      }
      if (changed) {
        break;
      }
    }
  }

  return { id: subject.id, selector: current, ownBuilt, unsupported };
}

/**
 * SOLVE — the document-level fixpoint. For each subject, gather the buckets that REACH it
 * (PLAN reachability as a per-subject precondition), then drive that subject to its fixpoint.
 * Subjects are independent for value purposes (extend operates on the selector graph, not on a
 * value frame — the §4.2 decoupling), but the target index is SHARED across all subjects, so a
 * branch one subject produces routes through the same index a later subject queries — the
 * cross-selector transitive closure is the shared index, not a per-subject rescan.
 *
 * Materialization is once, at the end (each subject's `selector` is its final form). This mirrors
 * the existing per-selector prototype's "materialize once" but lifts it to the whole document.
 */
export function solveExtends(plan: ExtendPlan, subjects: SolveSubject[]): SolveResult {
  const buckets = [...plan.targetIndex.values()];
  const results: SolveSubjectResult[] = [];
  let fullyOwnBuilt = true;

  for (const subject of subjects) {
    const reachable = buckets.filter(b => bucketReachesSubject(plan, b, subject));
    const result = solveSubject(plan, subject, reachable);
    if (!result.ownBuilt) {
      fullyOwnBuilt = false;
    }
    results.push(result);
  }

  return { subjects: results, fullyOwnBuilt };
}
