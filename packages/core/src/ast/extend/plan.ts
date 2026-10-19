/**
 * PLAN — walk the parsed AST, recording each rule's ancestor path + at-rule
 * (media) scope, its own-local selector branches, and each `:extend()`
 * instruction (target branch, partial flag, the extender rule's ancestor path,
 * scope, document order).
 */

import { branchFromSelector, branchSharesAtom, collectBranchAtoms, levelFromSelectorList } from './ir.js';
import type { Branch, Level } from './ir.js';
import { selectorBranchHasInterp } from '../nodes.js';
import type { SelectorList, Stylesheet, Ruleset, Statement } from '../nodes.js';
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
 * import placement, or a `@compose`d module. A module is ONE boundary per identity,
 * however many sheets compose it, so `parents` holds every boundary it was loaded
 * from (null for the root document's graph): the module graph is a DAG, not a tree.
 */
export interface ExtendBoundary {
  readonly parents: Array<ExtendBoundary | null>;
}

/**
 * Whether an extend written inside `inst` reaches a rule placed inside `subject`:
 * an unconfined extend reaches everything, a confined one reaches its own sheet and
 * every sheet loaded from it, through any path. So a composing sheet's extend reaches
 * its composed module's rules, while the module's own extend never reaches the
 * composing sheet (ledger X14, Sass module semantics); a `(reference)` sheet's extend
 * stays inside it.
 */
export function boundaryReaches(inst: ExtendBoundary | null, subject: ExtendBoundary | null): boolean {
  if (inst === null || inst === subject) {
    return true;
  }
  if (subject === null) {
    return false;
  }

  /* An upward search; `seen` guards a compose cycle (`a` composes `b` composes `a`). */
  const pending = [subject];
  const seen = [subject];
  while (pending.length > 0) {
    for (const parent of pending.pop()!.parents) {
      if (parent === inst) {
        return true;
      }
      if (parent !== null && !seen.includes(parent)) {
        seen.push(parent);
        pending.push(parent);
      }
    }
  }
  return false;
}

export interface PlanSubject {
  rule: Ruleset;
  path: Level[];
  scope: number[];

  /** The authored own-local selector level (last entry of `path`). */
  ownLocal: Level;

  /** The enclosing authored subject rule, or null at the top level. */
  parent: PlanSubject | null;

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

  /** [import:reference] The subject rule came from a `(reference)` import — its own
   * seed branches are HIDDEN (emit nothing unless a visible extender folds in). */
  hidden: boolean;

  /** See {@link PlanInstruction.boundary}. */
  boundary: ExtendBoundary | null;

  /** Nearest hidden at-rule occurrence, retaining its concrete placement chain. */
  referenceAtRule: PlanReferenceAtRule | null;

  /**
   * The render placement of one copy of a canonical rule: a loop iteration, a mixin
   * call, a `(reference)` or `(multiple)` import. Undefined for the static placement.
   * Every subject literal declares it, so all subjects keep one shape.
   */
  placement: object | undefined;
}

/** One hidden at-rule occurrence in the render-local reference-import plan. */
export interface PlanReferenceAtRule {
  node: AtRuleBlock;
  parent: PlanReferenceAtRule | null;
  placement?: object;
}

/**
 * An at-rule block written in a rule (`.b { @media print { y: 1; } }`): its own
 * declarations are the rule's, in the at-rule's scope. Flat output writes them in
 * a block under the rule's header (bubbling), and an extend in that scope reaches
 * them there (EXTEND-SEMANTICS §8).
 */
export interface PlanBubble {
  atRule: AtRuleBlock;
  subject: PlanSubject;
  scope: number[];
}

export interface Plan {
  subjects: PlanSubject[];
  instructions: PlanInstruction[];

  /** Every at-rule block written in a rule, in document order. */
  bubbles: PlanBubble[];

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

  /** At-rule blocks written in the overlay's rules ({@link PlanBubble}). */
  readonly bubbles?: readonly PlanBubble[];
}

/**
 * One scope id per at-rule block, shared by every planner walk of one render. The
 * import preflight and `collectPlan` walk different documents in different passes;
 * keying the id on the block lets an import nested in a root `@media` share that
 * block's scope, and keeps an imported `@media` from inheriting its parent's.
 */
export type AtRuleScopes = Map<AtRuleBlock, number>;

/**
 * `own` — the IR of `list` — without the branches whose interpolation the extend
 * pre-pass left unresolved (a lone `@{list}`, which the header expands; one that
 * failed to resolve), or null when none is left. Their IR has no text (an
 * interpolated token is `''`), so an extender built from one wrote an empty branch
 * (`.z, {`) or lost a parent (`.z, .c {` for `.c` under one), dropping or widening
 * the target's rule (ledger O17). Read from the AST's own interpolation flag, since a
 * token that resolved to empty text is `''` too. `own` itself when nothing is left out.
 */
function writableLevel(list: SelectorList, own: Level): Level | null {
  if (!list.selectors.some(selectorBranchHasInterp)) {
    return own;
  }
  const kept = own.filter((_, index) => !selectorBranchHasInterp(list.selectors[index]!));
  return kept.length > 0 ? kept : null;
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

export function collectPlan(root: Stylesheet, overlay?: PlanOverlay, resolved?: ReadonlyMap<SelectorList, SelectorList>): Plan {
  recordAstExtendProfile?.('astExtend.plan.calls');
  const subjects: PlanSubject[] = [];
  const instructions: PlanInstruction[] = [];
  const bubbles: PlanBubble[] = [];
  const targetAtoms = new Set<string>();
  let order = 0;
  const scopeIds = overlay?.atRuleScopes ?? new Map<AtRuleBlock, number>();

  /*
   * `ext` is `path` as an extender may be written from it ({@link writableLevel}): the
   * same levels unless an ancestor holds an unresolved branch, and null when one holds
   * nothing else, so no extend under it is written.
   */
  const walk = (
    statements: Statement[],
    path: Level[],
    ext: Level[] | null,
    scope: number[],
    parent: PlanSubject | null
  ): void => {
    for (const st of statements) {
      if (st.type === 'Ruleset') {
        const rule = st;

        /* An interpolated selector reads as the extend pre-pass resolved it (`resolved`), the parsed one untouched. */
        const selector = resolved?.get(rule.selector) ?? rule.selector;
        const own = levelFromSelectorList(selector);
        const rulePath = [...path, own];
        const ownExt = ext === null ? null : writableLevel(selector, own);
        const ruleExt = ext === null || ownExt === null ? null : ext === path && ownExt === own ? rulePath : [...ext, ownExt];
        const subject: PlanSubject = {
          rule,
          path: rulePath,
          scope,
          ownLocal: own,
          parent,
          mayMatch: false,
          hidden: false,
          boundary: null,
          referenceAtRule: null,
          placement: undefined
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
            const subject = inst.subject && (resolved?.get(inst.subject) ?? inst.subject);
            const extenderPath = subject
              ? ext === null || subject.selectors.some(selectorBranchHasInterp) ? null : [...ext, levelFromSelectorList(subject)]
              : ruleExt;
            if (extenderPath === null) {
              continue;
            }
            for (const sel of (resolved?.get(inst.target) ?? inst.target).selectors) {
              /* An unresolved target names nothing, and its `''` would match an unresolved subject. */
              if (selectorBranchHasInterp(sel)) {
                continue;
              }
              const targetBranch = branchFromSelector(sel);
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
        walk(rule.rules, rulePath, ruleExt, scope, subject);
      } else if (st.type === 'AtRuleBlock') {
        const inner = atRuleScope(scope, st, scopeIds);
        if (parent !== null) {
          bubbles.push({ atRule: st, subject: parent, scope: inner });
        }
        walk(st.rules, path, ext, inner, parent);
      }

      // MixinDefinition / MixinCall / declarations / at-rule statements: no extend surface.
    }
  };

  const top: Level[] = [];
  walk(root.rules, top, top, [], null);

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
    const overlayBubbles = overlay.bubbles;
    if (overlayBubbles !== undefined) {
      for (let index = 0; index < overlayBubbles.length; index++) {
        bubbles.push(overlayBubbles[index]!);
      }
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
  recordAstExtendProfile?.('astExtend.plan.bubbles', bubbles.length);
  recordAstExtendProfile?.('astExtend.plan.instructions', instructions.length);
  return { subjects, instructions, bubbles, targetAtoms };
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
