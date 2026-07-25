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

/** Precompute each instruction's composed extender branches (+ their text keys)
 * for the fixpoint. */
export function buildContribs(instructions: PlanInstruction[]): ContribMap {
  const contribs: ContribMap = new Map();
  for (const inst of instructions) {
    const extenders = composePath(inst.extenderPath);

    /*
     * [import:reference] tag each composed extender as an extend PRODUCT (`ext`) and
     * stamp its extender rule's visibility, in the SAME pass that keys them (no extra
     * iteration). `ext` lets the matcher tell a chained extend off a hidden extender
     * (→ hidden) from an extend off an original hidden seed; `hidden` keeps a branch
     * pulled from a hidden `(reference)` rule invisible.
     */
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
  /*
   * Target-atom PREFILTER: the fixpoint can only ever change a subject whose
   * composed seed shares at least one individual simple atom with some instruction
   * target — a whole-branch/all/sub-part match and every transitive chain step all
   * require a common atom. A seed disjoint from `plan.targetAtoms` (both sides
   * extracted graft-recursively at the same per-simple granularity/normalization)
   * provably never matches nor chains, so skip solve and keep the RAW seed. This
   * prunes the ~92% of subjects that no target touches without running the fixpoint.
   */
  if (!seed.some(b => branchSharesAtom(b, plan.targetAtoms))) {
    return { list: seed, changed: false };
  }
  const reachable = plan.instructions.filter(i =>

    /*
     * A visible instruction may pull a reference subject into output. A hidden
     * instruction is confined to the reference document that defined it, so it
     * never aliases authored siblings outside that import boundary.
     */
    (i.referenceBoundary === null || i.referenceBoundary === subject.referenceBoundary)
    && reaches(i.scope, subject.scope));
  if (reachable.length === 0) {
    return { list: seed, changed: false };
  }
  return runFixpoint(seed.map(cloneBranch), reachable, buildContribs(reachable));
}

/**
 * A fold of every reachable instruction that shares an identical match condition —
 * same `(partial, extenderHidden, targetKey)` — into ONE apply. All such
 * instructions become applicable in the exact same round (identical target/flag),
 * so folding their composed extenders (concatenated in document order) into a
 * single `applyInstruction` call reproduces firing them one-by-one, and does the
 * per-branch target comparison ONCE per group instead of once per instruction. */
export interface InstGroup {
  target: Branch;
  partial: boolean;
  extenderHidden: boolean;
  targetKey: string;
  extenders: Branch[];
  keys: Set<string>;
  targetAtoms: Set<string>;
}

/**
 * Group reachable instructions by `(partial, extenderHidden, targetKey)`. Grouping
 * on the FULL match condition — not `targetKey` alone — keeps `exact` vs `all` and
 * visible vs hidden extends with the same target text in separate folds (they apply
 * differently), per the reviewed plan (F2). Extenders concatenate in the incoming
 * (document) order so a folded append list is byte-identical to the one-per-round
 * append order. Insertion order of the returned array is each group's first-seen
 * document position, so the fixpoint visits groups in document order. */
export function groupInstructions(reachable: PlanInstruction[], contribs: ContribMap): InstGroup[] {
  const byKey = new Map<string, InstGroup>();
  for (const inst of reachable) {
    const c = contribs.get(inst)!;

    /*
     * A no-op instruction (no extenders and not a partial rewrite) never changes a
     * subject — drop it from every group exactly as the old per-instruction guard did.
     */
    if (c.extenders.length === 0 && !inst.partial) {
      continue;
    }
    const targetKey = branchText(inst.target);
    const gkey = `${inst.partial ? 1 : 0}|${inst.extenderHidden ? 1 : 0}|${targetKey}`;
    let g = byKey.get(gkey);
    if (g === undefined) {
      g = {
        target: inst.target,
        partial: inst.partial,
        extenderHidden: inst.extenderHidden,
        targetKey,
        extenders: [],
        keys: new Set<string>(),

        /*
         * Identical target text ⇒ identical graft-recursive target atoms, so the
         * first instruction's precomputed set is the group's set.
         */
        targetAtoms: c.targetAtoms
      };
      byKey.set(gkey, g);
    }
    for (const e of c.extenders) {
      g.extenders.push(e);
    }
    for (const k of c.keys) {
      g.keys.add(k);
    }
  }
  return [...byKey.values()];
}

export function runFixpoint(seed: Branch[], reachable: PlanInstruction[], contribs: ContribMap): SolveResult {
  let list = seed;

  /*
   * FOLD: collapse instructions sharing a match condition into groups, then apply
   * ALL currently-matching groups in ONE pass (no `break`), re-passing only for
   * transitive chains. Firing one group per round and re-scanning the growing
   * branch list is the source of the measured Θ(n²) (`Σk`); folding does the
   * per-branch target comparison once per GROUP per pass instead of once per
   * instruction per round, so the shared-target fixpoint is linear.
   *
   * Byte-identity to the old fire-one-per-round loop rests on TWO facts:
   * (1) every instruction in a group has the identical target/partial/hidden, so
   * they always become applicable together — folding never fires one early;
   * (2) extend application is CONFLUENT (branch-SET order independence, pinned by
   * tree/extend/__tests__/oqd-confluence-differential.test.ts), so applying
   * groups all-in-one-pass yields the same final branch set as one-at-a-time,
   * and document-ordered extender concatenation keeps the append order.
   *
   * Fire-once per GROUP: a group that has already CHANGED the subject never fires
   * again. A group whose target is not yet present stays UNFIRED so a later chained
   * change can still trigger it. `applyInstruction` returns null EXACTLY when it
   * changed nothing, so a non-null result IS the change signal — the IR is threaded
   * through every step and only the final list is serialized by the emit layer.
   */
  const groups = groupInstructions(reachable, contribs);
  const fired = new Set<InstGroup>();
  const guardMax = (groups.length + 2) * (groups.length + 2);
  let rounds = 0;
  let ever = false;
  let roundChanged = true;
  while (roundChanged && rounds <= guardMax) {
    roundChanged = false;
    rounds++;
    for (const g of groups) {
      if (fired.has(g)) {
        continue;
      }
      const next = applyInstruction(
        list,
        g.target,
        g.extenders,
        g.partial,
        g.keys,
        g.targetAtoms,
        g.extenderHidden
      );
      if (next) {
        list = next;
        fired.add(g);
        roundChanged = true;
        ever = true;
      }
    }
  }
  return { list, changed: ever };
}
