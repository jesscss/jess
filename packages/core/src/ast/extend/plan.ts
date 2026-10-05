/**
 * PLAN — walk the parsed AST, recording each rule's ancestor path + at-rule
 * (media) scope, its own-local selector branches, and each `:extend()`
 * instruction (target branch, partial flag, the extender rule's ancestor path,
 * scope, document order).
 */

import { branchFromSelector, branchSharesAtom, collectBranchAtoms, levelFromSelectorList } from './ir.js';
import type { Branch, Level } from './ir.js';
import type { ExtendInstruction, Stylesheet, Ruleset, Statement } from '../nodes.js';
import type { AtRuleBlock } from '../at-rule.js';

/**
 * Opt-in, import-time-captured counters for the AST extend planner. Production
 * renders pay no counter lookup when the bag was not installed before core was
 * loaded. The names deliberately describe facts already carried by this planner;
 * they are evidence only, never an execution-mode switch.
 */
const AST_EXTEND_PROFILE_COUNTERS_KEY = '__JESS_EXTEND_PROFILE_COUNTERS__';
type AstExtendProfileGlobals = typeof globalThis & {
  [AST_EXTEND_PROFILE_COUNTERS_KEY]?: Record<string, number>;
};
const astExtendProfileCounters = (globalThis as AstExtendProfileGlobals)[AST_EXTEND_PROFILE_COUNTERS_KEY];
export const recordAstExtendProfile = astExtendProfileCounters
  ? (event: string, amount = 1): void => {
      astExtendProfileCounters[event] = (astExtendProfileCounters[event] ?? 0) + amount;
    }
  : undefined;

export interface PlanInstruction {
  target: Branch;
  partial: boolean;
  extenderPath: Level[];
  scope: number[];
  order: number;

  /** [import:reference] The extender rule came from a `(reference)` import — its
   * folded-in branches are HIDDEN. False for the ordinary (visible) extend. */
  extenderHidden: boolean;

  /** The sheet boundary that confines this extend; see {@link boundaryReaches}. */
  boundary: ExtendBoundary | null;
}

/**
 * A sheet whose extends do not reach the rest of the import graph: a `(reference)`
 * import, or a `@compose`d module. `parent` is the boundary the sheet was loaded
 * from (null for the root document's graph).
 */
export interface ExtendBoundary {
  readonly parent: ExtendBoundary | null;
}

/**
 * Whether an extend written inside `inst` reaches a rule placed inside `subject`:
 * an unconfined extend reaches everything, a confined one reaches its own sheet and
 * the sheets loaded from it. So a composing sheet's extend reaches its composed
 * module's rules, while the module's own extend never reaches the composing sheet
 * (ledger X14, Sass module semantics); a `(reference)` sheet's extend stays inside it.
 */
export function boundaryReaches(inst: ExtendBoundary | null, subject: ExtendBoundary | null): boolean {
  for (let cursor = subject; inst !== cursor; cursor = cursor.parent) {
    if (cursor === null) {
      return false;
    }
  }
  return true;
}

export interface PlanSubject {
  rule: Ruleset;
  path: Level[];
  scope: number[];

  /** The authored own-local selector level (last entry of `path`). */
  ownLocal: Level;

  /** The enclosing authored subject rule, or null at the top level. */
  parent: PlanSubject | null;

  /** [import:reference] The subject rule came from a `(reference)` import — its own
   * seed branches are HIDDEN (emit nothing unless a visible extender folds in). */
  hidden: boolean;

  /** See {@link PlanInstruction.boundary}. */
  boundary: ExtendBoundary | null;

  /** Concrete render placement for a repeated canonical body (`$for`/`each`). */
  placement?: object;

  /** Nearest hidden at-rule occurrence, retaining its concrete placement chain. */
  referenceAtRule: PlanReferenceAtRule | null;

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

/** One hidden at-rule occurrence in the render-local reference-import plan. */
export interface PlanReferenceAtRule {
  node: AtRuleBlock;
  parent: PlanReferenceAtRule | null;
  placement?: object;
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

/** Typed facts produced by a render-local preflight (currently imported loop bodies). */
export interface PlanOverlay {
  readonly subjects: readonly PlanSubject[];
  readonly instructions: readonly PlanInstruction[];

  /** Render-scoped at-rule scope ids the preflight assigned; see {@link atRuleScope}. */
  readonly atRuleScopes: AtRuleScopes | null;
}

/**
 * One scope id per at-rule block, shared by every planner walk of one render. The
 * import preflight and `collectPlan` walk different documents in different passes;
 * keying the id on the block lets an import nested in a root `@media` share that
 * block's scope, and keeps an imported `@media` from inheriting its parent's.
 */
export type AtRuleScopes = Map<AtRuleBlock, number>;

function instructionTargets(inst: ExtendInstruction): Branch[] {
  return inst.target.selectors.map(branchFromSelector);
}

/** The scope of the statements inside `node`, entered from `scope`. */
export function atRuleScope(scope: number[], node: AtRuleBlock, ids: AtRuleScopes): number[] {
  let id = ids.get(node);
  if (id === undefined) {
    id = ids.size;
    ids.set(node, id);
  }
  return [...scope, id];
}

export function collectPlan(root: Stylesheet, overlay?: PlanOverlay): Plan {
  recordAstExtendProfile?.('astExtend.plan.calls');
  const subjects: PlanSubject[] = [];
  const instructions: PlanInstruction[] = [];
  const targetAtoms = new Set<string>();
  let order = 0;
  const scopeIds = overlay?.atRuleScopes ?? new Map<AtRuleBlock, number>();

  const walk = (
    statements: Statement[],
    path: Level[],
    scope: number[],
    parent: PlanSubject | null
  ): void => {
    for (const st of statements) {
      if (st.type === 'Ruleset') {
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
          hidden: false,
          boundary: null,
          referenceAtRule: null
        };
        subjects.push(subject);
        if (rule.extendInstructions) {
          for (const inst of rule.extendInstructions) {
            /*
             * [extend] An INLINE extend binds to its own complex (`inst.subject`), not
             * the whole rule selector — its extender path narrows the own-local level to
             * that one branch so a comma-sibling is never folded into the target. A
             * body-form `&:extend` (no subject) keeps the whole rule selector.
             */
            const extenderPath = inst.subject
              ? [...path, levelFromSelectorList(inst.subject)]
              : rulePath;
            for (const targetBranch of instructionTargets(inst)) {
              instructions.push({
                target: targetBranch,
                partial: inst.partial,
                extenderPath,
                scope,
                order: order++,
                extenderHidden: false,
                boundary: null
              });
              collectBranchAtoms(targetBranch, targetAtoms);
            }
          }
        }
        walk(rule.rules, rulePath, scope, subject);
      } else if (st.type === 'AtRuleBlock') {
        walk(st.rules, path, atRuleScope(scope, st, scopeIds), parent);
      }

      // MixinDefinition / MixinCall / declarations / at-rule statements: no extend surface.
    }
  };

  walk(root.rules, [], [], null);

  if (overlay) {
    /*
     * Do not spread planner overlays: a large, finite imported-loop overlay
     * becomes call arguments and hits V8's stack/argument limit before solving.
     * Indexed append preserves source order without a temporary copy.
     */
    for (let index = 0; index < overlay.subjects.length; index++) {
      subjects.push(overlay.subjects[index]!);
    }
    for (let index = 0; index < overlay.instructions.length; index++) {
      instructions.push(overlay.instructions[index]!);
    }
    for (const instruction of overlay.instructions) {
      collectBranchAtoms(instruction.target, targetAtoms);
    }
    recordAstExtendProfile?.('astExtend.plan.overlaySubjects', overlay.subjects.length);
    recordAstExtendProfile?.('astExtend.plan.overlayInstructions', overlay.instructions.length);
  }

  /*
   * FAST-REJECT boolean, computed as an inherited flag over subjects in document
   * (pre-)order — a parent always precedes its descendants, so one forward pass
   * suffices. `own || parent.mayMatch`: no `composePath`, O(own-local atoms). A
   * subject with no parent subject reads its whole path: a rule the render walk
   * reached through a mixin or loop body carries its ancestors as levels only.
   */
  const levelShares = (level: Level): boolean => level.some(b => branchSharesAtom(b, targetAtoms));
  for (const s of subjects) {
    s.mayMatch = s.parent !== null
      ? s.parent.mayMatch || levelShares(s.ownLocal)
      : s.path.some(levelShares);
  }

  recordAstExtendProfile?.('astExtend.plan.subjects', subjects.length);
  recordAstExtendProfile?.('astExtend.plan.instructions', instructions.length);
  return { subjects, instructions, targetAtoms };
}

/**
 * Allocation-free pre-scan: does the document contain ANY `:extend()` instruction?
 * The common case (no extends) returns false without building the subject/instruction
 * plan at all — the serializer's true zero-cost gate.
 */
export function documentHasExtend(root: Stylesheet): boolean {
  recordAstExtendProfile?.('astExtend.documentHasExtend.calls');
  const scan = (statements: Statement[]): boolean => {
    for (const st of statements) {
      if (st.type === 'Ruleset') {
        if (st.extendInstructions && st.extendInstructions.length > 0) {
          return true;
        }
        if (scan(st.rules)) {
          return true;
        }
      } else if (st.type === 'AtRuleBlock') {
        if (scan(st.rules)) {
          return true;
        }
      }
    }
    return false;
  };
  const found = scan(root.rules);
  recordAstExtendProfile?.(found
    ? 'astExtend.documentHasExtend.featureBearingCalls'
    : 'astExtend.documentHasExtend.noFeatureMisses');
  return found;
}

/** Reachability: an instruction reaches a subject iff the subject scope is the
 * same as, or a descendant of, the instruction scope. */
export function reaches(instScope: number[], subjScope: number[]): boolean {
  if (instScope.length > subjScope.length) {
    return false;
  }
  for (let i = 0; i < instScope.length; i++) {
    if (instScope[i] !== subjScope[i]) {
      return false;
    }
  }
  return true;
}
