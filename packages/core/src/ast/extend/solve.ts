/**
 * SOLVE — for every rule (subject), gather the instructions that REACH it
 * (same-or-descendant scope) and drive a fixpoint over its composed selector
 * branches: exact/whole-branch matches APPEND the extender branches; `all`
 * sub-matches substitute the matched span IN PLACE with `:is(<span>, <ext>)`;
 * produced branches re-route so a transitive/chained extend drains as more work.
 * Fire-once + value dedup terminate; a branch equal to an extender is never
 * self-wrapped.
 */

import { branchSharesAtom, branchText, cloneBranch, collectBranchAtoms } from './ir.js';
import type { Branch } from './ir.js';
import { composePath } from './compose.js';
import { applyInstruction } from './match.js';
import { reaches } from './plan.js';
import type { Plan, PlanInstruction, PlanSubject } from './plan.js';

/** An instruction's precomputed composed extender branches + their text keys. */
export interface Contrib {
  extenders: Branch[];
  keys: Set<string>;
  /** The graft-recursive union of the TARGET's individual simple atoms. A branch
   * disjoint from this set provably cannot whole-subset-match, sub-substitute, or
   * chain against the target (every such event needs a shared atom), so the
   * per-branch `all`-rewrite is skipped — the fixpoint's dominant fast-reject. */
  targetAtoms: Set<string>;
}
export type ContribMap = Map<PlanInstruction, Contrib>;

function instKey(inst: PlanInstruction): string {
  return `${inst.partial ? 1 : 0}|${branchText(inst.target)}|${inst.order}`;
}

/** Precompute each instruction's composed extender branches (+ their text keys)
 * for the fixpoint. */
export function buildContribs(instructions: PlanInstruction[]): ContribMap {
  const contribs: ContribMap = new Map();
  for (const inst of instructions) {
    const extenders = composePath(inst.extenderPath);
    // [import:reference] tag each composed extender as an extend PRODUCT (`ext`) and
    // stamp its extender rule's visibility, in the SAME pass that keys them (no extra
    // iteration). `ext` lets the matcher tell a chained extend off a hidden extender
    // (→ hidden) from an extend off an original hidden seed; `hidden` keeps a branch
    // pulled from a hidden `(reference)` rule invisible.
    const keys = new Set<string>();
    for (const e of extenders) {
      e.ext = true;
      if (inst.extenderHidden) {
        e.hidden = true;
      }
      keys.add(branchText(e));
    }
    const targetAtoms = new Set<string>();
    collectBranchAtoms(inst.target, targetAtoms);
    contribs.set(inst, { extenders, keys, targetAtoms });
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
export interface SolveResult {
  /** The (possibly extended) branch list. When `changed` is false this is the
   * RAW seed, untouched — the caller keeps its authored/raw form. */
  list: Branch[];
  /** Whether the fixpoint actually changed the seed (drives `flatByRule`). */
  changed: boolean;
}

/**
 * Solve a subject over its already-composed seed. The seed (`composePath(path)`)
 * is passed in so `computeExtends` composes it at most ONCE (lazy + memoized);
 * this never recomposes. Returns the RAW seed with `changed: false` on a prefilter
 * miss or a no-op fixpoint, else the extended list with `changed: true`.
 */
export function solveComposed(seed: Branch[], subject: PlanSubject, plan: Plan): SolveResult {
  // Target-atom PREFILTER: the fixpoint can only ever change a subject whose
  // composed seed shares at least one individual simple atom with some instruction
  // target — a whole-branch/all/sub-part match and every transitive chain step all
  // require a common atom. A seed disjoint from `plan.targetAtoms` (both sides
  // extracted graft-recursively at the same per-simple granularity/normalization)
  // provably never matches nor chains, so skip solve and keep the RAW seed. This
  // prunes the ~92% of subjects that no target touches without running the fixpoint.
  if (!seed.some(b => branchSharesAtom(b, plan.targetAtoms))) {
    return { list: seed, changed: false };
  }
  const reachable = plan.instructions.filter(i =>
    // A visible instruction may pull a reference subject into output. A hidden
    // instruction is confined to the reference document that defined it, so it
    // never aliases authored siblings outside that import boundary.
    (i.referenceBoundary === null || i.referenceBoundary === subject.referenceBoundary)
    && reaches(i.scope, subject.scope)
  );
  if (reachable.length === 0) {
    return { list: seed, changed: false };
  }
  return runFixpoint(seed.map(cloneBranch), reachable, buildContribs(reachable));
}

export function runFixpoint(seed: Branch[], reachable: PlanInstruction[], contribs: ContribMap): SolveResult {
  let list = seed;

  // Fire-once GLOBALLY per instruction: an instruction that has already CHANGED
  // the subject never fires again (re-appending an extender each round is
  // impossible — the source of the transitive-chaining duplication). An
  // instruction that does not yet match (its target not present) stays UNFIRED
  // so a later chained change can still trigger it. The outer loop re-passes
  // until a full pass changes nothing.
  //
  // `applyInstruction` returns null EXACTLY when it changed nothing (an append
  // only counts a genuinely-new branch key; a partial rewrite only returns
  // non-null when `branchText` differs), so a non-null result IS the change
  // signal — no per-round `listKey` serialization is needed to detect it. This is
  // the single-materialization property: the IR is threaded through every step and
  // only the final branch list is serialized to strings by the emit layer.
  const fired = new Set<string>();
  const guardMax = (reachable.length + 2) * (reachable.length + 2);
  let rounds = 0;
  let ever = false;
  let roundChanged = true;
  while (roundChanged && rounds <= guardMax) {
    roundChanged = false;
    rounds++;
    for (const inst of reachable) {
      const key = instKey(inst);
      if (fired.has(key)) {
        continue;
      }
      const c = contribs.get(inst)!;
      if (c.extenders.length === 0 && !inst.partial) {
        continue;
      }
      const next = applyInstruction(
        list,
        inst.target,
        c.extenders,
        inst.partial,
        c.keys,
        c.targetAtoms,
        inst.extenderHidden
      );
      if (next) {
        list = next;
        fired.add(key);
        roundChanged = true;
        ever = true;
        break;
      }
    }
  }
  return { list, changed: ever };
}
