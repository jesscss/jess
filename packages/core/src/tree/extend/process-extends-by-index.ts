/**
 * process-extends-by-index.ts — PROTOTYPE of the global "lift once → fixpoint in IR →
 * materialize once" extend flow (GUARDRAIL 2). See EXTEND-INDEX-DESIGN.md §"Global flow".
 *
 * WHAT THE CURRENT ENGINE DOES (extend-roots.ts:processExtends + extend.ts:applyExtendsToSelector)
 * ------------------------------------------------------------------------------------------------
 * - `processExtends` gathers `context.extends` into `instructions`, buckets registered rulesets
 *   by root (`rulesetsByRoot`) and filters instructions per root by scope
 *   (`isInstructionVisibleForRoot` — media / import / `&`-boundary / reference scope).
 * - Per ruleset it classifies + APPLIES instructions by MUTATING the selector node in place via
 *   `tryExtendSelector` → `extendSelector`, then re-discovers CHAINED extends off the *produced*
 *   selector's node tree (`findChainedExtends`). `applyExtendsToSelector` is already a worklist
 *   (an `instructions` queue drained to a `changed`-fixpoint), and a pass-scoped memo
 *   (`beginExtendMatchPass`) collapses the chained re-matching from O(I²).
 * - The cost this design removes: every applied extend ROUND-TRIPS to nodes (build a new selector
 *   node, re-serialize for `valueOf()` compares, re-lift for chained discovery). N applied extends
 *   ⇒ N node materializations per selector.
 *
 * WHAT THIS PROTOTYPE DOES INSTEAD
 * --------------------------------
 * - LIFT ONCE: each in-scope selector is lifted to IR a single time (here, reusing the own
 *   engine's lift by threading Selector nodes; a production version lifts to a persistent IR
 *   `Or`-set — see extendByIndexOwn, whose construction is cloning-free and node-reusing).
 * - TARGET INDEX: instructions are grouped by find-target value into a bucket of
 *   `(extendWith, partial)` — the indexed generalization of applyExtendsToSelector's same-target
 *   batch. One match against a target-satisfying compound fires the whole bucket.
 * - WORKLIST FIXPOINT IN IR: the queue is seeded with the lifted selector; applying an
 *   instruction that CHANGES the selector re-enqueues the produced selector so chained/transitive
 *   extends (target→ext→target) drain as more queue work — no per-extend node round-trip beyond
 *   the (currently reused) construction step. A produced branch re-enters the queue exactly as
 *   the landed memo's chained job would.
 * - MATERIALIZE ONCE: the final selector is the output; no intermediate re-serialization drives
 *   control flow (the fixpoint compares IR-derived values, not re-parsed nodes).
 * - SCOPE AS A PRECONDITION: `bucketByScope` partitions (selector, instruction) by an opaque
 *   scope key BEFORE the hot loop, so a target only ever queries in-scope selectors — scope is
 *   never re-tested on the per-match path. Here the scope key is supplied by the caller (in
 *   production it is the `rulesetsByRoot` root + `isInstructionVisibleForRoot` verdict).
 *
 * SCOPE OF THE PROTOTYPE: the per-selector multi-extend + chained fixpoint is prototyped and
 * tested (the tractable, load-bearing core). The full `context`/`rulesetsByRoot` wiring +
 * `&`-boundary hoist-to-root routing is DESIGNED here but not wired, because the own construction
 * engine does not yet build `&`/`:is`-graft outputs (it returns UNSUPPORTED) — wiring the global
 * flow before the construction covers those shapes would just relay UNSUPPORTED. The honest
 * gate: this prototype drives ONLY instructions the own engine can build, and reports when a
 * bucket hits UNSUPPORTED.
 */
import type { Selector } from '../selector.js';
import { extendByIndexOwn, UNSUPPORTED, type UnsupportedResult } from './extend-index.js';
import { SelectorList } from '../selector-list.js';

export interface IndexExtendInstruction {
  target: Selector;
  extendWith: Selector;
  partial: boolean;

  /** opaque scope key; in production = root identity + isInstructionVisibleForRoot verdict */
  scope?: unknown;
}

/** A target bucket: one find-target, many `(extendWith, partial)` rewrites (same-target fan-out). */
interface TargetBucket {
  target: Selector;
  fans: Array<{ extendWith: Selector; partial: boolean }>;
}

/** Group instructions by (scope, target-value) so one match fires the whole bucket. */
function buildTargetIndex(instructions: IndexExtendInstruction[]): Map<string, TargetBucket> {
  const index = new Map<string, TargetBucket>();
  for (const inst of instructions) {
    const key = `${scopeKey(inst.scope)}|${inst.partial ? 1 : 0}|${inst.target.valueOf()}`;
    let bucket = index.get(key);
    if (!bucket) {
      bucket = { target: inst.target, fans: [] };
      index.set(key, bucket);
    }
    bucket.fans.push({ extendWith: inst.extendWith, partial: inst.partial });
  }
  return index;
}

function scopeKey(scope: unknown): string {
  if (scope === undefined || scope === null) {
    return '';
  }
  if (typeof scope === 'string' || typeof scope === 'number') {
    return String(scope);
  }
  return '#obj';
}

export interface ProcessResult {
  selector: Selector;

  /** true if every applied instruction built on the own engine (no UNSUPPORTED encountered). */
  fullyOwnBuilt: boolean;

  /** instructions whose bucket hit UNSUPPORTED (frontier). */
  unsupported: IndexExtendInstruction[];
}

/**
 * Apply all `instructions` (grouped, fanned-out, chained) to `selector` via an IR worklist,
 * materializing once. Chained/transitive extends drain as queue work: a produced selector is
 * re-driven against every instruction whose target its content routes to.
 *
 * `partial` self-extends and non-matching instructions are inert (own engine returns the target
 * unchanged / NOT_FOUND). An instruction whose shape the own engine cannot build yet
 * (`UNSUPPORTED`) is recorded and SKIPPED (never silently delegated).
 */
export function processExtendsByIndex(
  selector: Selector,
  instructions: IndexExtendInstruction[]
): ProcessResult {
  const index = buildTargetIndex(instructions);
  const buckets = [...index.values()];
  const unsupported: IndexExtendInstruction[] = [];
  let fullyOwnBuilt = true;

  let current = selector;

  /*
   * Each (target, extendWith, partial) fires AT MOST ONCE (mirrors the oracle's splice-on-apply):
   * re-applying an already-applied instruction would re-append its extender every round. A fan is
   * marked applied when it first CHANGES the selector; the worklist keeps draining while any new
   * change lands, so a chained target that only becomes reachable after an earlier apply still
   * fires (transitive closure) — that is the worklist, not a re-scan.
   */
  const applied = new Set<string>();
  const fanKey = (t: Selector, e: Selector, p: boolean): string =>
    `${p ? 1 : 0}|${t.valueOf()}|${e.valueOf()}`;

  let changed = true;
  const guardMax = instructions.length + 2;
  let rounds = 0;
  while (changed && rounds <= guardMax) {
    changed = false;
    rounds++;
    for (const bucket of buckets) {
      for (const fan of bucket.fans) {
        const key = fanKey(bucket.target, fan.extendWith, fan.partial);
        if (applied.has(key)) {
          continue;
        }
        const result: Selector | Selector[] | 'NOT_FOUND' | UnsupportedResult =
          extendByIndexOwn(current, bucket.target, fan.extendWith, fan.partial);
        if (result === UNSUPPORTED) {
          fullyOwnBuilt = false;
          unsupported.push({ target: bucket.target, extendWith: fan.extendWith, partial: fan.partial });
          applied.add(key); // do not retry an unbuildable shape every round
          continue;
        }
        if (result === 'NOT_FOUND') {
          // Not reachable YET — leave unapplied so a later chained change can enable it.
          continue;
        }
        const next = Array.isArray(result) ? new SelectorList(result as SelectorList['value']) : result;
        if (next.valueOf() !== current.valueOf()) {
          current = next;
          applied.add(key);
          changed = true;
        } else {
          // Matched but no net change (e.g. self-extend) → applied, no re-fire.
          applied.add(key);
        }
      }
    }
  }

  return { selector: current, fullyOwnBuilt, unsupported };
}
