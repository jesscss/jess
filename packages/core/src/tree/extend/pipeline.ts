/**
 * pipeline.ts — the END-TO-END capstone driver that COMPOSES PLAN → SOLVE → EMIT into one
 * bundle-excluded flow and produces each subject's FINAL composed/hoisted/collapsed selector.
 * ==========================================================================================
 *
 * The three landed phases each own one layer of the extend flow and are individually validated
 * (plan-differential / solve-differential / emit-differential):
 *
 *   PLAN  (`plan.ts`)  — reachability (A1–A8) + the target index. WHICH instructions may touch
 *                        WHICH subjects. Pure precompute over the extend-root graph.
 *   SOLVE (`solve.ts`) — the document fixpoint at the LOCAL-APPLY layer. WHICH instructions
 *                        actually FIRE against a subject (match + transitive closure), using the
 *                        raw per-instruction `(target, extendWith, partial)` and the validated
 *                        `extendByIndexOwn` per-match engine.
 *   EMIT  (`emit.ts`)  — the projection ABOVE local-apply. Composes a fired extender relative to
 *                        its target from BUCKET PATHS, hoists an `&`-crossing branch to root, and
 *                        groups under `:is()` per the collapse policy.
 *
 * SOLVE deliberately stops at local-apply (raw `extendWith`, no compose/hoist) — it agrees with the
 * `applyExtendsToSelector` oracle. EMIT owns compose/hoist/collapse but is driven from explicit
 * bucket paths, not the node graph. NEITHER phase alone produces a subject's final rendered header.
 * This driver is the missing seam: it runs SOLVE to decide WHICH contributions fire (the match +
 * cross-selector transitive closure), maps each fired contribution to its EMIT bucket-path
 * contribution, then runs EMIT to produce the composed/hoisted/collapsed output. That cross-layer
 * seam (fixpoint × scope × compose × hoist × collapse) is exactly what the per-layer tests cannot
 * exercise, and what the capstone differential validates against the ratified v5 alpha `.css`.
 *
 * OWN CONSTRUCTION, FAIL-LOUD. The driver never delegates to `processExtends`/`extend-roots.ts`. A
 * per-match shape the own engine cannot build returns UNSUPPORTED (recorded as a fallback candidate,
 * never silently applied). A subject touching any UNSUPPORTED instruction is reported UNSUPPORTED.
 *
 * NOT wired into production, NOT the render cutover — a validated building block. Not exported from
 * `index.ts` → bundle-excluded.
 */
import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { asExtendSelectorNode } from '../util/extend-roots.js';
import { extendByIndexOwn, findRejectTokens, subjectPresentTokens, UNSUPPORTED, type UnsupportedResult } from './extend-index.js';
import {
  composeTargetOwn,
  projectSubject,
  emitNestedChildHeader,
  emitSubjectHeader,
  type BucketPath,
  type EmitContribution,
  type EmitSubject,
  type EmitProjection
} from './emit.js';

export { UNSUPPORTED, type UnsupportedResult };

/**
 * One extend instruction as the pipeline sees it, decoded from an authored extend. `path` is the
 * extender's ancestor selector chain (outermost → own local) — the structural artifact EMIT composes
 * from (design OQ-5(B): placement derives from the bucket path, not a stored own-selector field).
 * `target`/`partial` are the raw local-apply inputs SOLVE fires with; `order` is the document order
 * EMIT sorts branches by; `scope` is an opaque reachability key (PLAN's reachable-root set in
 * production — here supplied by the caller so scope is a bucketing precondition, never re-tested on
 * the per-match path).
 */
export interface PipelineInstruction {
  target: Selector;
  extendWith: Selector;
  partial: boolean;
  path: BucketPath;
  order: number;
  scope?: unknown;
}

/**
 * A subject to drive: its authored bucket path (the target's own ancestor chain), its document
 * order, an opaque scope key, and — when the subject is a NESTED block whose header the collapse
 * policy reshapes — the child-local selector to fold the projected parent Or-set into.
 */
export interface PipelineSubject {
  id: string;
  path: BucketPath;
  order: number;
  scope?: unknown;

  /** when set, the emitted header is this child folded into the projected parent Or-set (collapse). */
  nestedChildLocal?: Selector;
}

export interface PipelineSubjectResult {
  id: string;

  /** the subject's final composed/hoisted/collapsed header (valueOf form), or '' when UNSUPPORTED. */
  header: string;

  /** the ordered projected Or-branch set (empty when UNSUPPORTED). */
  branches: string[];

  /** true when the subject's projection crosses a parent boundary (hoist-to-root). */
  hoistToRoot: boolean;

  /** true when every fired instruction built on the own engine (no UNSUPPORTED for this subject). */
  ownBuilt: boolean;

  /** instructions whose per-match shape the own engine cannot build yet (fallback candidates). */
  unsupported: PipelineInstruction[];
}

export interface PipelineResult {
  subjects: PipelineSubjectResult[];

  /** true when NO subject hit an UNSUPPORTED per-match shape (whole document own-built). */
  fullyOwnBuilt: boolean;
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

/**
 * SCOPE REACHABILITY — does an instruction gathered in scope `instScope` reach a subject in scope
 * `subjScope`? A scope is the chain of enclosing conditional at-rule bodies (`@media` blocks),
 * outermost-first, as an ARRAY of the at-rule node identities (`readonly unknown[]`). The eval
 * oracle's rule (extend-roots §A5 "@media body is its own root", A2 "descendant roots"):
 * an extend declared inside `@media (tv)` reaches subjects in THAT media body and any media body
 * NESTED within it, but NOT subjects outside it. A root-level extend (`.all`, scope `[]`) reaches
 * everything. So `instScope` reaches `subjScope` iff `instScope` is a (possibly empty) PREFIX of
 * `subjScope` — identity-compared per level.
 *
 * BACKWARD COMPAT: an `undefined`/string scope (the flat-document path, no media gather) is handled
 * by the string-key equality below — the array path engages only when BOTH scopes are arrays.
 */
function scopeReaches(instScope: unknown, subjScope: unknown): boolean {
  const instArr = Array.isArray(instScope) ? (instScope as readonly unknown[]) : undefined;
  const subjArr = Array.isArray(subjScope) ? (subjScope as readonly unknown[]) : undefined;
  if (instArr !== undefined || subjArr !== undefined) {
    const inst = instArr ?? [];
    const subj = subjArr ?? [];
    if (inst.length > subj.length) {
      return false;
    }
    for (let i = 0; i < inst.length; i++) {
      if (inst[i] !== subj[i]) {
        return false;
      }
    }
    return true;
  }
  return scopeKey(instScope) === scopeKey(subjScope);
}

/** Compose a subject/target bucket path to its own authored selector (its full nesting composed). */
function ownComposed(path: BucketPath): Selector {
  return composeTargetOwn(path);
}

/**
 * A NESTED self-extend contribution: an extend whose bare `extendWith` textually EQUALS its
 * `target` (a self-extend, `el:extend(el)`), but whose extender is authored inside an enclosing
 * block so its COMPOSED form (`ownComposed(path)`, e.g. `.prose h1`) differs from the bare
 * `target`. At the raw local-apply layer such an extend is inert (bare `h1` added to `h1`
 * dedupes to nothing), so SOLVE's change-detection never fires it — but Less 4.x DOES add the
 * composed `.prose h1` everywhere the target appears. This predicate lets SOLVE fire it as an
 * EMIT-only contribution. A ROOT-level self-extend (composed form == bare `target`) returns
 * false and stays a genuine no-op.
 */
function isNestedSelfExtendContribution(inst: PipelineInstruction): boolean {
  if (String(inst.target.valueOf()) !== String(inst.extendWith.valueOf())) {
    return false;
  }
  return String(ownComposed(inst.path).valueOf()) !== String(inst.extendWith.valueOf());
}

function asSelector(result: Selector | Selector[]): Selector {
  return Array.isArray(result) ? new SelectorList(result as SelectorList['value']) : result;
}

/**
 * SOLVE (localized to one subject) — decide WHICH instructions FIRE against the subject and in what
 * transitive order. A subject's own composed selector is the seed; an instruction fires when
 * `extendByIndexOwn` reports a CHANGE against the current value (a real match, at the local-apply
 * layer the oracle measures). A fired change re-opens the sweep so a CHAINED extend (an extender that
 * is itself another instruction's target) fires transitively — the cross-selector closure. Fire-once
 * is keyed on (branch value, instruction) so re-appending an extender each round is impossible. Only
 * SCOPE-REACHABLE instructions (same opaque scope key as the subject) are considered — the PLAN gate,
 * applied here as a precondition. UNSUPPORTED shapes are recorded and skipped (fail-loud).
 */
function solveContributions(
  subject: PipelineSubject,
  instructions: PipelineInstruction[]
): { fired: PipelineInstruction[]; unsupported: PipelineInstruction[]; ownBuilt: boolean; solved: Selector } {
  const reachable = instructions.filter(inst => scopeReaches(inst.scope, subject.scope));
  const unsupported: PipelineInstruction[] = [];
  const fired: PipelineInstruction[] = [];
  let ownBuilt = true;

  let current = ownComposed(subject.path);
  const done = new Set<string>();
  const fireKey = (branchValue: string, inst: PipelineInstruction): string =>
    `${branchValue}|${inst.partial ? 1 : 0}|${String(inst.target.valueOf())}|${String(inst.extendWith.valueOf())}`;

  /*
   * FIRE-ONCE PER INSTRUCTION (Less semantics — an extend is NOT recursively applied to the
   * extension it just produced). The `branchValue`-keyed `done` above re-opens the sweep after ANY
   * fire (so a CHAINED extend — a DIFFERENT instruction now matching the produced branch — still
   * fires), but the SAME instruction must never re-fire on its OWN output: a partial extend wraps
   * its find in `:is(find, extendWith)`, and re-matching `find` INSIDE that graft is both wrong
   * (double-extend) and a matcher UNSUPPORTED (`.replace` inside `:is(.replace, .rep_ace)` — the
   * is-graft-target trap). So an instruction that has fired once is retired for the whole subject.
   */
  const firedInstructions = new Set<PipelineInstruction>();

  let changed = true;
  const guardMax = (reachable.length + 2) * (reachable.length + 2);
  let rounds = 0;
  while (changed && rounds <= guardMax) {
    changed = false;
    rounds++;
    const branchValue = String(current.valueOf());

    /*
     * CHEAP SOUND PRE-REJECT (root cause of the O(subjects²) fire explosion): the coarse
     * scope-key reachability leaves every instruction "reachable" in a flat document, so each
     * subject would run the full matcher against every instruction. A plain-token find can only
     * match a subject that textually carries all its tokens; computing the subject's present-token
     * set ONCE per branch value lets the loop skip the (dominant) majority of non-matching
     * instructions WITHOUT the per-fan selector re-parse. `undefined` (non-plain subject/target)
     * disables the filter for that pair — always run the matcher — so output stays byte-identical.
     */
    const subjectTokens = subjectPresentTokens(current);
    for (const inst of reachable) {
      if (firedInstructions.has(inst)) {
        continue; // already fired once against this subject — never self-re-apply
      }
      const key = fireKey(branchValue, inst);
      if (done.has(key)) {
        continue;
      }
      if (subjectTokens !== undefined) {
        const need = findRejectTokens(inst.target);
        if (need !== undefined) {
          let missing = false;
          for (const t of need) {
            if (!subjectTokens.has(t)) {
              missing = true;
              break;
            }
          }
          if (missing) {
            continue; // definitely NOT_FOUND in the current value — leave unfired (chain re-opens)
          }
        }
      }
      const result = extendByIndexOwn(current, inst.target, inst.extendWith, inst.partial);
      if (result === UNSUPPORTED) {
        ownBuilt = false;
        unsupported.push(inst);
        done.add(key);
        continue;
      }
      if (result === 'NOT_FOUND') {
        continue;
      }
      const next = asSelector(result);
      done.add(key);
      if (String(next.valueOf()) !== branchValue) {
        current = next;
        fired.push(inst);
        firedInstructions.add(inst);
        changed = true;
        break;
      }

      /*
       * MATCHED, but the RAW local-apply produced NO net change. For most instructions
       * this is a true no-op (self-extend / value-dedupe). The ONE exception is a NESTED
       * self-extend (`h1:extend(h1) {}` inside `.prose`): its bare `extendWith` equals its
       * `target`, so the local-apply layer is inert — yet its COMPOSED extender (`.prose h1`)
       * is a DISTINCT selector Less 4.x adds everywhere the target appears. SOLVE never
       * composes (that is EMIT's job), so it cannot see the difference in the raw string;
       * fire it here as an EMIT-ONLY contribution (no branch-value change, so no re-sweep)
       * and let `projectSubject` compose the `.prose`-prefixed form from `inst.path`. A ROOT
       * self-extend (`.foo:extend(.foo)`, composed form == bare form) stays genuinely inert.
       */
      if (isNestedSelfExtendContribution(inst)) {
        fired.push(inst);
        firedInstructions.add(inst);
      }
    }
  }

  return { fired, unsupported, ownBuilt, solved: current };
}

/**
 * SOLVE + EMIT for ONE subject, returning the EMIT PROJECTION (branch Selector NODES, not
 * stringified) plus own-built/unsupported status. Exposed so a live consumer (the spine's
 * flat-extend wire-in, `spine-extend.ts`) can build a `SelectorList` header NODE from the
 * projected branches — letting the normal serializer emit the multi-branch header (`,\n`)
 * rather than re-parsing a stringified header. `runSubject` (the capstone's string result)
 * is now a thin formatter over this.
 */
export function runSubjectProjection(
  subject: PipelineSubject,
  instructions: PipelineInstruction[]
): { projection: EmitProjection | undefined; ownBuilt: boolean; unsupported: PipelineInstruction[] } {
  const { fired, unsupported, ownBuilt, solved } = solveContributions(subject, instructions);
  if (!ownBuilt) {
    return { projection: undefined, ownBuilt: false, unsupported };
  }
  const contributions: EmitContribution[] = fired.map(inst => ({ path: inst.path, order: inst.order }));
  const emitSubject: EmitSubject = { path: subject.path, order: subject.order, contributions };
  const projection = projectSubject(emitSubject);

  /*
   * SHAPE 4 (partial-of-sub-compound in-place wrap). EMIT is BRANCH-APPEND: it composes each
   * extender as a NEW Or-branch. That is correct when the extend adds a sibling selector, but WRONG
   * when the extend WRAPS a sub-compound of the subject's OWN branches in place
   * (`.foo .bar` find `.foo` → `:is(.foo, .ext1 .ext2) .bar`, NOT `.foo .bar, .ext1 .ext2`). SOLVE's
   * local-apply result (`solved`) is the oracle-identical rewrite for BOTH semantics. It is
   * authoritative — no compose-from-path needed — precisely when EVERY fired extender is ROOT-LEVEL
   * (`path.length === 1`): its `extendWith` is already its full form, so SOLVE applied it verbatim
   * (a nested extender needs EMIT's compose-relative-to-target, so those keep the projection). When
   * SOLVE's result differs from the branch-append projection under that condition, an in-place wrap
   * occurred → return SOLVE's branches. (Equal results — the `.button,.submit` append — are
   * unaffected.)
   */
  const allFiredRootLevel = fired.every(inst => inst.path.length === 1);
  if (allFiredRootLevel && fired.length > 0 && !projection.hoistToRoot) {
    const solvedBranches: Selector[] = solved instanceof SelectorList
      ? solved.value.map(item => (typeof item === 'string' ? asExtendSelectorNode(item) : item))
      : [solved];
    const ownForm = composeTargetOwn(subject.path);
    const ownBranchCount = ownForm instanceof SelectorList ? ownForm.value.length : 1;

    /*
     * IN-PLACE WRAP vs APPEND. An in-place `:is`-wrap of a sub-compound REWRITES the subject's own
     * branches without adding any (`.foo .bar, .foo .baz` → `:is(.foo, …) .bar, :is(…) .baz`: 2→2).
     * A full-mode APPEND adds sibling branch(es) (`.amp-test-h` → `.amp-test-h, <composed>`: 1→2+),
     * which EMIT's `projectSubject` already builds — and dedups — from the extender path; SOLVE's raw
     * fixpoint would re-append the still-present full-match target each round (no path-dedup). So use
     * SOLVE's result ONLY for the in-place case: its branch count equals the subject's own count.
     */
    const solvedKey = solvedBranches.map(b => String(b.valueOf())).join(',');
    const projectionKey = projection.branches.map(b => String(b.valueOf())).join(',');
    if (solvedBranches.length === ownBranchCount && solvedKey !== projectionKey) {
      return { projection: { branches: solvedBranches, hoistToRoot: false }, ownBuilt: true, unsupported };
    }
  }
  return { projection, ownBuilt: true, unsupported };
}

/**
 * SOLVE-ONLY local-apply for ONE subject — the raw fixpoint rewrite of the subject's seed
 * (`ownComposed(subject.path)`) by every fired instruction's `extendWith`, with NO EMIT
 * compose-from-path. Returns the solved Or-branch NODES (split from a `SelectorList`) plus
 * own-built status, or undefined when a per-match shape is UNSUPPORTED.
 *
 * WHY (P4 expanded-mode nested in-place rewrite). A NESTED subject under `collapseNesting:false`
 * keeps its block; its header is the subject's BARE per-level local rewritten IN PLACE — the
 * `.attributes { [data="test"], .attribute-test { … } }` shape (the block wrapper supplies the
 * `.attributes` prefix). Seeding SOLVE with the BARE local and applying each SIBLING extender's
 * bare `extendWith` produces exactly that (`[data="test"], .attribute-test`), which is
 * oracle-identical (`applyExtendsToSelector`), whereas EMIT's compose-from-path would either not
 * fire (the matcher rejects a composed descendant target) or prepend the shared ancestor. So the
 * expanded-mode nested wiring calls THIS with the bare local, not `runSubjectProjection`.
 */
export function solveSubjectBranches(
  subject: PipelineSubject,
  instructions: PipelineInstruction[]
): { branches: Selector[]; ownBuilt: boolean } | undefined {
  const { ownBuilt, solved } = solveContributions(subject, instructions);
  if (!ownBuilt) {
    return undefined;
  }
  const branches: Selector[] = solved instanceof SelectorList
    ? solved.value.map(item => (typeof item === 'string' ? asExtendSelectorNode(item) : item))
    : [solved];
  return { branches, ownBuilt };
}

/**
 * Drive ONE subject end-to-end: SOLVE decides the fired contribution set; EMIT projects them from
 * bucket paths to the final composed/hoisted/collapsed header.
 */
function runSubject(subject: PipelineSubject, instructions: PipelineInstruction[]): PipelineSubjectResult {
  const { projection, unsupported, ownBuilt } = runSubjectProjection(subject, instructions);
  if (!ownBuilt || !projection) {
    return { id: subject.id, header: '', branches: [], hoistToRoot: false, ownBuilt: false, unsupported };
  }

  const branches = projection.branches.map(b => String(b.valueOf()));
  const header = subject.nestedChildLocal
    ? emitNestedChildHeader(projection, subject.nestedChildLocal, true)
    : emitSubjectHeader(projection);

  return {
    id: subject.id,
    header,
    branches,
    hoistToRoot: projection.hoistToRoot,
    ownBuilt: true,
    unsupported
  };
}

/**
 * The composed capstone flow: PLAN (the caller supplies the decoded instruction set + per-subject
 * scope keys, i.e. reachability as a precondition) → SOLVE (per-subject fixpoint deciding fired
 * contributions) → EMIT (project to the final header). Materialization is once, at the end.
 */
export function runExtendPipeline(
  subjects: PipelineSubject[],
  instructions: PipelineInstruction[]
): PipelineResult {
  const results = subjects.map(subject => runSubject(subject, instructions));
  const fullyOwnBuilt = results.every(r => r.ownBuilt);
  return { subjects: results, fullyOwnBuilt };
}
