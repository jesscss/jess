/**
 * SOLVE — for every rule (subject), gather the instructions that REACH it
 * (same-or-descendant scope) and drive a fixpoint over its composed selector
 * branches: exact/whole-branch matches APPEND the extender branches; `all`
 * sub-matches substitute the matched span IN PLACE with `:is(<span>, <ext>)`;
 * produced branches re-route so a transitive/chained extend drains as more work.
 * Fire-once + value dedup terminate; a branch equal to an extender is never
 * self-wrapped.
 */

import { branchSharesAtom, branchText, cloneBranch } from './ir.js';
import type { Branch } from './ir.js';
import { composePath } from './compose.js';
import { applyInstruction } from './match.js';
import { reaches } from './plan.js';
import type { Plan, PlanInstruction, PlanSubject } from './plan.js';

/** An instruction's precomputed composed extender branches + their text keys. */
export interface Contrib {
  extenders: Branch[];
  keys: Set<string>;
}
export type ContribMap = Map<PlanInstruction, Contrib>;

/**
 * The target-atom solve prefilter is ON in production — it is a provably byte-
 * identical optimization (a skipped subject cannot match/chain). Tests flip it OFF
 * via {@link setExtendPrefilterEnabled} to assert ON == OFF byte-identity across
 * adversarial shapes; never disable it outside tests.
 */
let prefilterEnabled = true;

/** TEST-ONLY toggle for the target-atom solve prefilter (see {@link prefilterEnabled}). */
export function setExtendPrefilterEnabled(on: boolean): void {
  prefilterEnabled = on;
}

export function listKey(list: Branch[]): string {
  return list.map(branchText).join(',');
}

function instKey(inst: PlanInstruction): string {
  return `${inst.partial ? 1 : 0}|${branchText(inst.target)}|${inst.order}`;
}

/** Precompute each instruction's composed extender branches (+ their text keys)
 * for the fixpoint. */
export function buildContribs(instructions: PlanInstruction[]): ContribMap {
  const contribs: ContribMap = new Map();
  for (const inst of instructions) {
    const extenders = composePath(inst.extenderPath);
    contribs.set(inst, { extenders, keys: new Set(extenders.map(branchText)) });
  }
  return contribs;
}

/**
 * Solve a subject over its FLAT (fully composed) selector branches. This is the
 * definitive model: extend operates on fully-qualified selectors, so a whole-
 * complex match expands to sibling branches and a proper sub-part match (a
 * compound or sub-run inside a longer complex) compacts to `:is(span, ext)`.
 * Exact (flag=1) matches ONLY the whole complex (never leaks into children);
 * `all` (flag=0) additionally matches sub-parts. Each rule solves INDEPENDENTLY
 * over its own composed form, so no separate child-parent propagation is needed.
 */
export function solveComposed(subject: PlanSubject, plan: Plan): Branch[] {
  const seed = composePath(subject.path);
  // Target-atom PREFILTER: the fixpoint can only ever change a subject whose
  // composed seed shares at least one individual simple atom with some instruction
  // target — a whole-branch/all/sub-part match and every transitive chain step all
  // require a common atom. A seed disjoint from `plan.targetAtoms` (both sides
  // extracted graft-recursively at the same per-simple granularity/normalization)
  // provably never matches nor chains, so skip solve and keep the RAW seed. This
  // prunes the ~92% of subjects that no target touches without running the fixpoint.
  if (prefilterEnabled && !seed.some((b) => branchSharesAtom(b, plan.targetAtoms))) {
    return seed;
  }
  const reachable = plan.instructions.filter((i) => reaches(i.scope, subject.scope));
  if (reachable.length === 0) return seed;
  return runFixpoint(seed.map(cloneBranch), reachable, buildContribs(reachable));
}

export function runFixpoint(seed: Branch[], reachable: PlanInstruction[], contribs: ContribMap): Branch[] {
  let list = seed;

  // Fire-once GLOBALLY per instruction: an instruction that has already CHANGED
  // the subject never fires again (re-appending an extender each round is
  // impossible — the source of the transitive-chaining duplication). An
  // instruction that does not yet match (its target not present) stays UNFIRED
  // so a later chained change can still trigger it. The outer loop re-passes
  // until a full pass changes nothing.
  const fired = new Set<string>();
  const guardMax = (reachable.length + 2) * (reachable.length + 2);
  let rounds = 0;
  let changed = true;
  while (changed && rounds <= guardMax) {
    changed = false;
    rounds++;
    for (const inst of reachable) {
      const key = instKey(inst);
      if (fired.has(key)) continue;
      const c = contribs.get(inst)!;
      if (c.extenders.length === 0 && !inst.partial) continue;
      const value = listKey(list);
      const next = applyInstruction(list, inst.target, c.extenders, inst.partial, c.keys);
      if (next && listKey(next) !== value) {
        list = next;
        fired.add(key);
        changed = true;
        break;
      }
    }
  }
  return list;
}
