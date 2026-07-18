/**
 * PLAN — walk the parsed AST, recording each rule's ancestor path + at-rule
 * (media) scope, its own-local selector branches, and each `:extend()`
 * instruction (target branch, partial flag, the extender rule's ancestor path,
 * scope, document order).
 */

import { branchFromComplex, branchSharesAtom, collectBranchAtoms, levelFromSelectorList } from './ir.js';
import type { Branch, Level } from './ir.js';
import type { ExtendInstruction, Root, Rule, Statement } from '../nodes.js';

export interface PlanInstruction {
  target: Branch;
  partial: boolean;
  extenderPath: Level[];
  scope: number[];
  order: number;
  /** [import:reference] The extender rule came from a `(reference)` import — its
   * folded-in branches are HIDDEN. False for the ordinary (visible) extend. */
  extenderHidden: boolean;
}

export interface PlanSubject {
  rule: Rule;
  path: Level[];
  scope: number[];
  /** The authored own-local selector level (last entry of `path`). */
  ownLocal: Level;
  /** The enclosing authored subject rule, or null at the top level. */
  parent: PlanSubject | null;
  /** [import:reference] The subject rule came from a `(reference)` import — its own
   * seed branches are HIDDEN (emit nothing unless a visible extender folds in). */
  hidden: boolean;
  /**
   * FAST-REJECT: true when some level on this subject's ancestor path (own-local ∪
   * ancestors) contains an atom that is also an instruction-target atom. Computed
   * as an inherited boolean — O(own-local atoms) per subject, no `composePath`.
   * A subject with `mayMatch === false` provably cannot match or chain any extend
   * (its composed seed's atoms ⊆ the per-level atom union; see EXTEND-REDESIGN.md),
   * so it keeps its raw form and needs no expensive solve. Only meaningful when
   * `targetAtoms` is populated (i.e. the document has extends).
   */
  mayMatch: boolean;
}

export interface Plan {
  subjects: PlanSubject[];
  instructions: PlanInstruction[];
  /**
   * The UNION of every instruction target's individual simple atoms (graft-
   * recursive; see `collectBranchAtoms`), across ALL instructions and ALL branches
   * of a multi-target `:extend(.a, .b)`. A subject whose composed seed shares none
   * of these atoms provably cannot match or chain — the solve prefilter skips it.
   */
  targetAtoms: Set<string>;
}

function instructionTargets(inst: ExtendInstruction): Branch[] {
  return inst.target.selectors.map(branchFromComplex);
}

export function collectPlan(root: Root): Plan {
  const subjects: PlanSubject[] = [];
  const instructions: PlanInstruction[] = [];
  const targetAtoms = new Set<string>();
  let order = 0;
  let scopeCounter = 0;

  const walk = (
    statements: Statement[],
    path: Level[],
    scope: number[],
    parent: PlanSubject | null,
  ): void => {
    for (const st of statements) {
      if (st.type === 'Rule') {
        const rule = st;
        const own = levelFromSelectorList(rule.selector);
        const rulePath = [...path, own];
        const subject: PlanSubject = {
          rule,
          path: rulePath,
          scope,
          ownLocal: own,
          parent,
          mayMatch: false,
          hidden: rule.reference === true,
        };
        subjects.push(subject);
        if (rule.extendInstructions) {
          for (const inst of rule.extendInstructions) {
            for (const targetBranch of instructionTargets(inst)) {
              instructions.push({
                target: targetBranch,
                partial: inst.partial,
                extenderPath: rulePath,
                scope,
                order: order++,
                extenderHidden: rule.reference === true,
              });
              collectBranchAtoms(targetBranch, targetAtoms);
            }
          }
        }
        walk(rule.body, rulePath, scope, subject);
      } else if (st.type === 'AtRuleBlock') {
        const inner = [...scope, scopeCounter++];
        walk(st.body, path, inner, parent);
      }
      // MixinDef / MixinCall / declarations / at-rule statements: no extend surface.
    }
  };

  walk(root.children, [], [], null);

  // FAST-REJECT boolean, computed as an inherited flag over subjects in document
  // (pre-)order — a parent always precedes its descendants, so one forward pass
  // suffices. `own || parent.mayMatch`: no `composePath`, O(own-local atoms).
  for (const s of subjects) {
    s.mayMatch =
      (s.parent !== null && s.parent.mayMatch) ||
      s.ownLocal.some((b) => branchSharesAtom(b, targetAtoms));
  }

  return { subjects, instructions, targetAtoms };
}

/**
 * Allocation-free pre-scan: does the document contain ANY `:extend()` instruction?
 * The common case (no extends) returns false without building the subject/instruction
 * plan at all — the serializer's true zero-cost gate.
 */
export function documentHasExtend(root: Root): boolean {
  const scan = (statements: Statement[]): boolean => {
    for (const st of statements) {
      if (st.type === 'Rule') {
        if (st.extendInstructions && st.extendInstructions.length > 0) return true;
        if (scan(st.body)) return true;
      } else if (st.type === 'AtRuleBlock') {
        if (scan(st.body)) return true;
      }
    }
    return false;
  };
  return scan(root.children);
}

/** Reachability: an instruction reaches a subject iff the subject scope is the
 * same as, or a descendant of, the instruction scope. */
export function reaches(instScope: number[], subjScope: number[]): boolean {
  if (instScope.length > subjScope.length) return false;
  for (let i = 0; i < instScope.length; i++) if (instScope[i] !== subjScope[i]) return false;
  return true;
}
