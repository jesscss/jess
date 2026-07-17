/**
 * PLAN — walk the parsed AST, recording each rule's ancestor path + at-rule
 * (media) scope, its own-local selector branches, and each `:extend()`
 * instruction (target branch, partial flag, the extender rule's ancestor path,
 * scope, document order).
 */

import { branchFromComplex, collectBranchAtoms, levelFromSelectorList } from './ir.js';
import type { Branch, Level } from './ir.js';
import type { ExtendInstruction, Root, Rule, Statement } from '../nodes.js';

export interface PlanInstruction {
  target: Branch;
  partial: boolean;
  extenderPath: Level[];
  scope: number[];
  order: number;
}

export interface PlanSubject {
  rule: Rule;
  path: Level[];
  scope: number[];
  /** The authored own-local selector level (last entry of `path`). */
  ownLocal: Level;
  /** The enclosing authored subject rule, or null at the top level. */
  parent: PlanSubject | null;
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
        const subject: PlanSubject = { rule, path: rulePath, scope, ownLocal: own, parent };
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
  return { subjects, instructions, targetAtoms };
}

/** Reachability: an instruction reaches a subject iff the subject scope is the
 * same as, or a descendant of, the instruction scope. */
export function reaches(instScope: number[], subjScope: number[]): boolean {
  if (instScope.length > subjScope.length) return false;
  for (let i = 0; i < instScope.length; i++) if (instScope[i] !== subjScope[i]) return false;
  return true;
}
