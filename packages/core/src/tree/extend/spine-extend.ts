/**
 * spine-extend.ts — the EXTEND-WORK GATE for the single downward pass (P3, increment 0).
 * =====================================================================================
 *
 * This module owns the §4.0 EXTEND-WORK GATE: the decision, made ONCE at spine entry,
 * of whether the pass must engage the extend layer (PLAN / SOLVE / buffer-then-flush)
 * at all. It is the FAST-PATH guard the whole extend fold hangs off:
 *
 *   - NO `:extend` anywhere in the tree  → `engageExtendLayer` returns false and the
 *     pass stays a PURE STREAMING SPINE (design §2): every ruleset header is final the
 *     moment the walk reaches it, so headers emit inline with ZERO deferral, ZERO
 *     per-subject buffering, ZERO PLAN/SOLVE. This is the COMMON case and it must cost
 *     nothing — the buffer/flush machinery of §4.4 (added in later increments) exists
 *     solely to serve extend deferral, and deferral only arises from a reaching extend.
 *
 *   - `:extend` present → the extend layer engages for the reaching subjects only
 *     (later increments; increment 0 wires ONLY the gate + its zero-cost lock).
 *
 * INCREMENT 0 SCOPE (this file today). The spine has no PLAN/SOLVE/buffering yet, and
 * `isSpineEligibleRoot`/`hasExtendedTopLevelSelector` already keep every extend-bearing
 * root OFF the spine (`emit-walk.ts` extend gate). So the invariant this module LOCKS is
 * the safety floor for the riskiest phase: *a render whose tree carries no `:extend`
 * performs zero extend-layer work.* The counters below are the instrument the ratchet
 * reads to prove it (all zero for an extend-free render). As later increments add PLAN,
 * SOLVE, and per-subject buffering, each bumps its counter through THIS module, so the
 * zero-extend ratchet keeps guarding that the fast path never silently starts paying.
 *
 * KEYING — STATIC TREE PRESENCE, not `context.extends`. The design §4.0 phrases the gate
 * as `context.extends empty`, but `context.extends` is populated by the EVAL gather
 * (`extend.ts:341`), which the spine SKIPS. The spine's honest, eval-free signal is the
 * STATIC presence of an `:extend` selector on the source tree (`F_EXTENDED`), read by
 * `treeHasExtend`. This is the same predicate `isSpineEligibleRoot` already trusts to
 * route extend-bearing roots to the eval path — reused here as the gate key so the two
 * decisions cannot diverge.
 *
 * NOT the render cutover's whole extend fold — increment 0 is the gate + lock only. Not
 * exported from `index.ts` beyond what the ratchet needs → minimal bundle surface.
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.0 (extend-work gate), §4.4 (flush discipline)
 * @see CUTOVER-CHECKLIST.md P3 — "Extend-work gate (§4.0) — the fast path"
 */
import { Ruleset } from '../ruleset.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import type { Rules } from '../rules.js';
import { Node, F_AMPERSAND } from '../node.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { projectSubject, foldNestedChildHeaderNode, composeTargetOwn, type BucketPath, type EmitContribution, type EmitSubject } from './emit.js';
import type { OutputWriter } from '../util/print.js';
import type { Context } from '../../context.js';
import { Selector, type SelectorLike } from '../selector.js';
import { Nil } from '../nil.js';
import { SelectorList } from '../selector-list.js';
import { spanStartOf } from '../util/provenance.js';
import { asExtendSelectorNode } from '../util/extend-roots.js';
import { Extend, ExtendFlag } from '../extend.js';
import { ExtendList } from '../extend-list.js';
import { runSubjectProjection, solveSubjectBranches, type PipelineInstruction, type PipelineSubject } from './pipeline.js';

/**
 * Instrument for the zero-extend ratchet (metric axis (b): the fast path pays nothing).
 * Every unit of extend-layer work bumps exactly one of these counters as later
 * increments wire it, so a standing test can assert ALL THREE stay 0 across an
 * extend-free render. A regression that starts running PLAN/SOLVE or buffering a subject
 * on the extend-free fast path trips that test RED.
 *
 * - `planRuns`     — PLAN (reachability + target index) built for a document.
 * - `solveRuns`    — SOLVE fixpoint driven for a document.
 * - `subjectBuffers` — subjects whose header was DEFERRED into a per-subject buffer
 *                      (the §4.4 buffer-then-flush; a streamed-inline subject does NOT
 *                      bump this).
 */
export const extendLayerCounter = {
  planRuns: 0,
  solveRuns: 0,
  subjectBuffers: 0
};

/** Reset the extend-layer instrument (test harness / per-render measurement). */
export function resetExtendLayerCounter(): void {
  extendLayerCounter.planRuns = 0;
  extendLayerCounter.solveRuns = 0;
  extendLayerCounter.subjectBuffers = 0;
}

/**
 * STATIC: does this source subtree carry ANY `:extend` selector (an `F_EXTENDED`
 * top-level selector on a ruleset, at any depth)? Pure, eval-free, side-effect-free —
 * reads only source flags. This is the gate key (see module note): the same predicate
 * `isSpineEligibleRoot` uses to route extend-bearing roots, so the gate and the
 * eligibility check agree by construction.
 *
 * Increment 0 detects the EXTENDER side (`&:extend()` / a selector flagged `F_EXTENDED`),
 * which is how jess marks a ruleset that participates in extend. A bare `:extend()`
 * target with no extender is inert (nothing to apply), so extender-presence is the sound
 * "is there real extend work" signal.
 */
export function treeHasExtend(node: Node): boolean {
  // An `:extend` lands as an invisible Extend / ExtendList body child (`.b:extend(.a)` and
  // `&:extend(.a)` both), and/or an `F_EXTENDED`-flagged selector. Detect BOTH: the body
  // effect node is the load-bearing signal (a subject's target selector is NOT flagged).
  if (node.type === 'Extend' || node.type === 'ExtendList') {
    return true;
  }
  let rules: Node[] | undefined;
  if (isNode(node, N.Ruleset)) {
    const selector = node.selector;
    if (selector !== undefined && Ruleset.hasExtendedTopLevelSelector(selector)) {
      return true;
    }
    rules = node.rules;
  } else if (isNode(node, N.Rules)) {
    rules = node.rules;
  } else if (isNode(node, N.AtRule) && 'rules' in node && Array.isArray(node.rules)) {
    rules = node.rules;
  }
  if (rules) {
    for (const child of rules) {
      if (treeHasExtend(child)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A CONDITIONAL AT-RULE whose body is its OWN extend scope AND whose reachability from an enclosing
 * scope is a plain nesting PREFIX relation: `@media`, `@supports`, `@container`. An extend declared
 * inside one reaches subjects in the same body + any such body NESTED within it, never outside — the
 * eval oracle's extend-root §A5 ("@media body is its own root") + §A2 ("descendant roots"). This is
 * exactly a scope-chain-prefix reachability, which `pipeline.ts`'s `scopeReaches` implements. NOT
 * `@layer` (§A4 same-layer-name mutual visibility is not a prefix relation) or `@scope`.
 */
function isMediaScopeAtRule(node: Node): boolean {
  if (!isNode(node, N.AtRule)) {
    return false;
  }
  const name = typeof node.name === 'string' ? node.name : String((node.name as { valueOf(): unknown })?.valueOf() ?? '');
  return name === '@media' || name === '@supports' || name === '@container';
}

/**
 * THE GATE (design §4.0). Decide, once at spine entry, whether the pass must engage the
 * extend layer. Returns false — the pure-streaming fast path — when the tree carries no
 * `:extend`; true when there is real extend work to do.
 *
 * Load-bearing invariant: when this returns false, the pass MUST NOT run PLAN, MUST NOT
 * run SOLVE, and MUST NOT buffer any subject header — `extendLayerCounter` stays all-zero
 * for the render. This is what the zero-extend ratchet locks. Callers on the false branch
 * simply stream (today's behavior, byte-identical).
 */
export function engageExtendLayer(root: Rules): boolean {
  return treeHasExtend(root);
}

/**
 * A candidate extend SUBJECT — any ruleset in the document, with its BUCKET PATH (the
 * ancestor Selector chain outermost → own local, tracked by the gather walk since parse-tree
 * nodes carry no `.parent`) and its document order. A NESTED subject's path is length > 1
 * (`[.type1, .sidebar3]`); a root subject's path is length 1 (`[.sidebar]`).
 */
export interface SpineSubject {
  ruleset: Ruleset;
  path: BucketPath;
  order: number;
  /**
   * The chain of enclosing conditional at-rule bodies (`@media` blocks), outermost-first, as an
   * array of the at-rule node identities. Used by the pipeline's scope-reachability filter: an
   * extend instruction reaches this subject iff its own scope chain is a PREFIX of this one (a
   * `@media`-scoped extend reaches subjects in the same or a NESTED media body, per the eval
   * oracle's extend-root §A5/A2). Absent (undefined) for a root-level subject — equivalent to `[]`.
   */
  scope?: readonly Node[];
  /**
   * True when this subject lives in a `@import (reference)` body: its OWN output is
   * suppressed, so its header projection DROPS branch 0 (the own form) — only the
   * extender contributions surface (the eval-path `F_EXTEND_TARGET` reference-filter).
   */
  reference?: boolean;
  /**
   * True when this subject's local originated from an `&`-composition (`.ext8 { &.ext9 {…} }` →
   * `.ext8.ext9`) whose fully-resolved compound form is ITSELF an extend target. Its `path` is the
   * fully-composed `[resolvedLocal]` (length 1, ancestor already folded in), so an override header
   * must emit VERBATIM at the nested block's collapsed-root position (like a hoisted subject), NOT
   * be re-composed under the parent frame. A header is installed ONLY when a graft fires (the
   * projection changes the composed own form); with no graft the block streams its normal `&`-flow.
   */
  ampComposed?: boolean;
  /**
   * For an {@link ampComposed} subject: the ancestor path the `&`-local composed against
   * (`[.ext8]` for `.ext8 { &.ext9 {…} }`). Used to decide override-vs-`&`-flow: when the PARENT is
   * itself an extend subject that gained a branch (`.button { &:hover {…} }` with `.button` extended),
   * the collapsed `:is(.button, …):hover` comes from the parent's `&`-flow — installing a direct
   * per-branch override on `.button:hover` here would fight it. So the ampComposed override applies
   * ONLY when the parent gained NO branch (`.ext8` is not extended → `.ext8.ext9` needs the override).
   */
  ampParentPath?: BucketPath;
}

/**
 * Import-awareness for `isSpineExtendTopology` (import-spec routing). Exactly one mode is used per call:
 *   - `speculativeImport`: SYNC gate mode — provisionally admit an extend target that maps to no VISIBLE
 *     subject (it may be imported), deferring the authoritative decision to the post-wire re-gate.
 *   - `importedRootSubjects`: RE-GATE mode — the resolved imported root-level subject selector texts,
 *     folded into the root-subject correspondence; the check is then STRICT (abort if still unmapped).
 */
export interface SpineExtendImportOptions {
  speculativeImport?: boolean;
  importedRootSubjects?: Set<string>;
}

/**
 * Compose each ROOT-LEVEL subject's FINAL Or-branch header from its bucket path + the
 * document-wide gathered `instructions` (each carrying its extender's bucket path). Runs the
 * validated pipeline per subject (`runSubjectProjection`: SOLVE fixpoint decides which
 * instructions fire, EMIT composes-relative-to-target + orders + dedups) and formats the
 * projected branch NODES into a `SelectorList` header the normal serializer emits with `,\n`.
 *
 * WHY NO DEFERRAL (design §4.4.2 baseline, degenerate). The caller gathers EVERY instruction
 * document-wide BEFORE any subject emits, so `Reaching(S)` is total at each subject's position
 * and the header is FINAL inline. Buffer-then-flush's deferral (§4.4.1) is unnecessary; the
 * `bufferSubjectDecls`/`flushBufferedSubject` unit still ASSEMBLES the block, emitted at the
 * subject's own position.
 *
 * Returns a map: subject ruleset → its composed header. ONLY subjects that gained ≥1 extra
 * branch appear; a subject with no reaching extend is absent (streams its authored header — the
 * §4.0 `Reaching(S)=∅` inline case). A projection that HOISTS (crossing) throws fail-loud —
 * crossing is a later increment, and the eligibility gate excludes it (descendant-target +
 * `&`-path exclusion), so this throw is an unreachable invariant guard.
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.0 §4.2 §4.3 §4.4.2
 */
export function composeSpineSubjectHeaders(
  subjects: SpineSubject[],
  instructions: PipelineInstruction[],
  collapseNesting: boolean
): { headers: Map<Ruleset, Selector>; hoisted: Set<Ruleset> } {
  extendLayerCounter.planRuns++;
  const headers = new Map<Ruleset, Selector>();
  const hoisted = new Set<Ruleset>();
  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i]!;
    const isNested = subject.path.length > 1;

    // NESTED-CHILD `:is()`-COLLAPSE (§5 collapse policy, `collapseNesting:true`). A nested subject
    // (`.sidebar { .box { … } }`) does NOT project its OWN path — that would seed `.sidebar .box` and
    // treat the PARENT's extenders as crossing (a bogus hoist). Instead project the PARENT path
    // (`[.sidebar]`) to the parent's Or-set, then FOLD this child's local into it —
    // `:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box` — the exact EMIT
    // `foldNestedChildHeaderNode` primitive (SAME `Ruleset.composeSelector` as authored nesting).
    // Only when the parent actually gained a branch (else the child streams its authored header via
    // the normal `&`-flow). The folded header ALREADY contains the full parent path, so it emits
    // VERBATIM at the child's collapsed-root position (added to `hoisted` → skip parent compose).
    if (isNested && collapseNesting) {
      const parentPath = subject.path.slice(0, -1);
      const childLocal = subject.path[subject.path.length - 1]!;
      extendLayerCounter.solveRuns++;
      const parentProjection = runSubjectProjection(
        { id: `p${i}`, path: parentPath, order: subject.order, scope: subject.scope },
        instructions
      );
      if (
        parentProjection.ownBuilt
        && parentProjection.projection
        && !parentProjection.projection.hoistToRoot
        && parentProjection.projection.branches.length > 1
      ) {
        // NESTED-CHILD GRAFT. An extender targeting the nested child ITSELF (`.ee:extend(.dd all)`
        // where `.dd` is nested under `.aa`) must add a SIBLING child branch under the SAME
        // (overridden) parent context: `:is(.aa, .cc) .dd, :is(.aa, .cc) .ee`. Project the bare child
        // local against the instructions to gather those grafts, then fold EACH resulting child
        // branch into the parent Or-set. An EXACT extend of the child must NOT match the bare sub-
        // compound (same full-path filter the expanded-mode nested path uses) — only PARTIAL (`all`)
        // and full-composed-path instructions apply in place. With no child graft this reduces to the
        // single-child fold (byte-identical to before).
        const fullChildOwn = String(composeTargetOwn(subject.path).valueOf());
        const childInstructions = instructions.filter(inst =>
          inst.partial || String(inst.target.valueOf()) === fullChildOwn);
        extendLayerCounter.solveRuns++;
        const childSolved = solveSubjectBranches(
          { id: `c${i}`, path: [childLocal], order: subject.order, scope: subject.scope },
          childInstructions
        );
        const childBranches: Selector[] = childSolved && childSolved.branches.length > 0
          ? childSolved.branches
          : [childLocal];
        const foldedBranches = childBranches.map(cb =>
          foldNestedChildHeaderNode(parentProjection.projection!, cb, true));
        const folded = foldedBranches.length === 1
          ? foldedBranches[0]!
          : new SelectorList(foldedBranches as SelectorList['value']);
        headers.set(subject.ruleset, folded);
        hoisted.add(subject.ruleset);
        continue;
      }
    }

    // EXPANDED-MODE NESTED IN-PLACE REWRITE (`collapseNesting:false`). A nested subject keeps its
    // block; its header is the subject's BARE per-level local rewritten IN PLACE (`.attributes {
    // [data="test"], .attribute-test { … } }` — the block wrapper supplies `.attributes`). SOLVE
    // seeded with the BARE local + each fired SIBLING extender's bare `extendWith` produces exactly
    // that (oracle-identical); EMIT's compose-from-path would not fire (the matcher rejects a
    // composed descendant target) or prepend the shared ancestor. Install the bare multi-branch
    // header — NOT hoisted, so the normal expanded-mode nested-header path emits it (composing the
    // parent frame like an authored nested selector). Only when it gained a branch.
    if (isNested && !collapseNesting) {
      // #4a EXPANDED-MODE `&`-CROSSING HOIST. A crossing contribution (`.footer .footer-nav`
      // reaching a subject nested under a DIFFERENT parent, `.header .header-nav`) does NOT match
      // the bare local (`.header-nav`), so the bare-local SOLVE below fires nothing. Instead run the
      // FULL-path projection: its target is the subject's COMPOSED path (`.header .header-nav`),
      // which the crossing extender's composed contribution (`.footer .footer-nav`) joins as a
      // hoisted root branch. When the projection HOISTS, install the composed 2-branch header and
      // add the subject to `hoisted` — the `spineExtendHoisted` verbatim-emit + `Ruleset.isHoisted`
      // relocation then place the block at ROOT (the expanded-mode analogue of the collapse-mode
      // verbatim override; block relocation the collapse mode gets free from flattening). The
      // bare-local in-place path (below) still owns the NON-crossing expanded case (attributes,
      // `.replace` inner) — only a genuine hoist diverts here.
      // ONLY a genuine `&`-crossing HOIST diverts here: the subject's own composed form must be a
      // plain DESCENDANT path (`.header .header-nav`) whose branch-0 own form remains intact and a
      // crossing (nested-extender) contribution joins as a hoisted root sibling. A NESTED subject
      // reached by a ROOT-level extender (`.rep_ace` extends the nested `.replace`) also reports
      // `hoistToRoot` via `composeContribution` (a root extender does not share the target's parent),
      // but that is an IN-PLACE append (`.replace, .c, .rep_ace`), NOT a relocation — its composed
      // own form is a compound (`.replace.replace`), not a descendant path. Gate on the subject's own
      // form being a descendant complex AND the projection preserving that own form as branch 0.
      const ownForm = composeTargetOwn(subject.path);
      const ownIsDescendant = String(ownForm.valueOf()).includes(' ') && !String(ownForm.valueOf()).includes(':is(');
      extendLayerCounter.solveRuns++;
      const crossing = ownIsDescendant
        ? runSubjectProjection(
            { id: `x${i}`, path: subject.path, order: subject.order, scope: subject.scope },
            instructions
          )
        : undefined;
      // The crossing branch must itself be a DESCENDANT composed path (`.footer .footer-nav`) — a
      // genuine `&`-crossing from a NESTED extender. A ROOT extender doing an `all`-partial extend of
      // a nested subject (`.ee:extend(.dd all)` → the nested `.aa .dd` gains bare `.ee`) ALSO reports
      // `hoistToRoot` (a root extender shares no parent with the target), but its contribution branch
      // is a bare compound (`.ee`), an IN-PLACE sibling that stays nested — NOT a relocation. Require
      // EVERY non-branch-0 branch to be a descendant path so only the true crossing relocates.
      const crossingBranchesAreDescendant = crossing?.projection !== undefined
        && crossing.projection.branches.slice(1).every(b => String(b.valueOf()).includes(' '));
      if (
        crossing
        && crossing.ownBuilt
        && crossing.projection
        && crossing.projection.hoistToRoot
        && crossing.projection.branches.length > 1
        && crossingBranchesAreDescendant
      ) {
        headers.set(subject.ruleset, new SelectorList(crossing.projection.branches as SelectorList['value']));
        hoisted.add(subject.ruleset);
        continue;
      }
      // EXPANDED-MODE COLLAPSE-RELOCATION (descendant-nested target). A nested descendant subject
      // (`.ext8 { .ext9 {…} }` → composed `.ext8 .ext9`) whose FULL COMPOSED PATH is itself an extend
      // target reached by a ROOT extender (`.buu:extend(.ext8 .ext9 all)`) must RELOCATE to root: the
      // gained branch (`.buu`) is a bare compound with NO shared parent context, so it cannot live
      // nested under `.ext8` — the whole group hoists (`.ext8 .ext9, .buu` at root). This differs from
      // the bare-child sibling graft (`.aa { .dd {…} }` + `.ee:extend(.dd all)` → `.dd, .ee` stays
      // NESTED) precisely by the target FORM: a full-composed-path target relocates; a bare-child-local
      // target grafts in place. Gate on an instruction targeting the full composed own form EXACTLY,
      // then run the full-path projection filtered to those instructions (drops the bare-child grafts
      // the in-place path owns) and hoist the composed header verbatim (same `hoisted`-set relocation
      // the `&`-crossing path uses above).
      const relocOwn = String(ownForm.valueOf());
      const relocInstructions = ownIsDescendant
        ? instructions.filter(inst => String(inst.target.valueOf()) === relocOwn)
        : [];
      if (relocInstructions.length > 0) {
        extendLayerCounter.solveRuns++;
        const reloc = runSubjectProjection(
          { id: `r${i}`, path: subject.path, order: subject.order, scope: subject.scope },
          relocInstructions
        );
        if (reloc.ownBuilt && reloc.projection && reloc.projection.branches.length > 1) {
          headers.set(subject.ruleset, new SelectorList(reloc.projection.branches as SelectorList['value']));
          hoisted.add(subject.ruleset);
          continue;
        }
      }
      const bareLocal = subject.path[subject.path.length - 1]!;
      // FILTER for the bare-local seed. Seeding SOLVE with the BARE local (`.dd`) strips the nested
      // subject's parent context (`.aa .dd`), which over-matches an EXACT extend: `.ff:extend(.dd)`
      // (exact) matches bare `.dd` but must NOT match the nested `.aa .dd` (exact needs the full
      // selector). A PARTIAL (`all`) extend correctly matches the bare sub-compound in place. So drop
      // an EXACT instruction whose target is not the subject's FULL composed path — keep it on the
      // full-path match semantics. (Partial instructions are unaffected: the in-place wrap is exactly
      // what the bare seed produces.)
      const fullOwn = String(composeTargetOwn(subject.path).valueOf());
      const bareInstructions = instructions.filter(inst =>
        inst.partial || String(inst.target.valueOf()) === fullOwn);
      extendLayerCounter.solveRuns++;
      const solvedBare = solveSubjectBranches(
        { id: `n${i}`, path: [bareLocal], order: subject.order, scope: subject.scope },
        bareInstructions
      );
      if (solvedBare && solvedBare.branches.length > 1) {
        headers.set(subject.ruleset, new SelectorList(solvedBare.branches as SelectorList['value']));
      }
      continue;
    }

    const pipelineSubject: PipelineSubject = {
      id: `s${i}`,
      path: subject.path,
      order: subject.order,
      scope: subject.scope
    };
    extendLayerCounter.solveRuns++;
    const { projection, ownBuilt } = runSubjectProjection(pipelineSubject, instructions);
    if (!ownBuilt || !projection) {
      // A shape the own engine can't build — leave the subject on its authored header; the
      // eval-path fallback (still live in P3) covers it.
      continue;
    }
    // REFERENCE-IMPORT SUBJECT (`@import (reference)`). The subject's OWN output is suppressed,
    // so DROP branch 0 (its own form — the eval-path `F_EXTEND_TARGET` reference-filter) and
    // install ONLY the extender branches. With no extender reaching it, `branches.length` is 1
    // (own form only) → no override; the reference ruleset stays fully suppressed. When an extend
    // DID reach it, `writeHeaderSelector`/the container serializer render-enable it (a spine
    // extend header IS the reference-unlock signal — see `serialize-helper`), and it emits its
    // declarations under the extender-only header (`.ext`), byte-identical to eval.
    if (subject.reference === true) {
      const extenderBranches = projection.branches.slice(1);
      if (extenderBranches.length === 0) {
        continue; // reference subject reached by no extend — stays suppressed
      }
      headers.set(subject.ruleset, new SelectorList(extenderBranches as SelectorList['value']));
      if (projection.hoistToRoot) {
        hoisted.add(subject.ruleset);
      }
      continue;
    }
    // Only override when the projection CHANGES the authored header. Usually that means it gained a
    // branch (`.a, .b`), but a PARTIAL in-place `:is`-wrap of a sub-compound produces a SINGLE branch
    // that still differs from the authored own form (`.ext6 > .ext5` → `.ext6 > :is(.ext5, .ext7)` —
    // a combinator-subject partial extend). Keying the skip on branch count alone would silently DROP
    // that rewrite (the ownBuilt=false silent-drop failure mode, but via a count check); key it on
    // VALUE equality vs the authored own form instead, so a single-branch in-place wrap installs.
    const authoredOwn = composeTargetOwn(subject.path);
    const projectionKey = projection.branches.map(b => String(b.valueOf())).join(',');
    if (projectionKey === String(authoredOwn.valueOf())) {
      continue; // no change vs authored — stream the authored header
    }
    // AMP-COMPOSED SUBJECT that GAINED a graft (`.ext8.ext9` → `.ext8.ext9, .fuu`). Its path is the
    // fully-composed compound, so the branches ARE the final verbatim header; emit at the nested
    // block's collapsed-root position (hoisted) rather than re-composing under the parent frame.
    if (subject.ampComposed === true) {
      // A header is installed ONLY when an instruction targets the FULL composed form EXACTLY
      // (`.fuu:extend(.ext8.ext9 all)` — the composed compound itself is the target). A target that is
      // merely a PARTIAL of the PARENT (`.submit:extend(.button all)` where the block is `&:hover` →
      // `.button:hover`) is propagated by the parent's `&`-flow into the collapsed `:is(...):hover`
      // — NOT a per-branch verbatim override here. So drop any instruction whose target is not the
      // full composed own form, re-project, and override only if THAT gained a branch.
      // If the PARENT is itself an extend subject that GAINED a branch, the collapsed grouped form
      // (`:is(.button, .submit):hover`) comes from the parent's `&`-flow — defer to it (no override).
      let parentGainedBranch = false;
      if (subject.ampParentPath && subject.ampParentPath.length > 0) {
        const parentOwn = String(composeTargetOwn(subject.ampParentPath).valueOf());
        extendLayerCounter.solveRuns++;
        const parentProj = runSubjectProjection(
          { id: `ap${i}`, path: subject.ampParentPath, order: subject.order, scope: subject.scope },
          instructions
        );
        const parentKey = parentProj.projection
          ? parentProj.projection.branches.map(b => String(b.valueOf())).join(',')
          : parentOwn;
        parentGainedBranch = parentProj.ownBuilt && parentProj.projection !== undefined && parentKey !== parentOwn;
      }
      const ampFullOwn = String(composeTargetOwn(subject.path).valueOf());
      const ampInstructions = instructions.filter(inst => String(inst.target.valueOf()) === ampFullOwn);
      extendLayerCounter.solveRuns++;
      const ampProj = runSubjectProjection(pipelineSubject, ampInstructions);
      const ampKey = ampProj.projection
        ? ampProj.projection.branches.map(b => String(b.valueOf())).join(',')
        : ampFullOwn;
      // Fires in BOTH modes: the graft target is the full composed compound (`.ext8.ext9`), a ROOT
      // extender (`.fuu`) sharing no parent context, so the block RELOCATES to root as
      // `.ext8.ext9, .fuu` verbatim (hoisted) even under `collapseNesting:false`. When the parent
      // gained a branch the `&`-flow owns the collapsed grouped form (`:is(...):hover`) — deferred via
      // `!parentGainedBranch`; when no full-form target exists (`ampKey === ampFullOwn`) the block
      // keeps its authored `&`-flow output.
      if (!parentGainedBranch && ampProj.ownBuilt && ampProj.projection && ampKey !== ampFullOwn) {
        headers.set(subject.ruleset, new SelectorList(ampProj.projection.branches as SelectorList['value']));
        hoisted.add(subject.ruleset);
      }
      continue;
    }
    // A NESTED subject may be overridden ONLY when its projection HOISTS (crossing) — the
    // non-hoist collapse case is handled by the parent-projection fold above. A non-hoisted nested
    // subject reaching here has no gained parent branch, so leave it to the `&`-flow.
    if (isNested && !projection.hoistToRoot) {
      continue;
    }
    // Build the multi-branch header NODE (the normal serializer emits `,\n`). The projected
    // branches are the subject's own composed form (branch 0) + composed contributions.
    const header = new SelectorList(projection.branches as SelectorList['value']);
    headers.set(subject.ruleset, header);
    if (projection.hoistToRoot) {
      // §4.3 hoist: a crossing contribution makes branch 0 (the subject's own FULL composed
      // path, e.g. `.header .header-nav`) the whole root-composed header — so the override is
      // emitted VERBATIM at the subject's collapsed-root position (skip parent compose). The
      // gate admits this ONLY under `collapseNesting:true` (block already at root).
      hoisted.add(subject.ruleset);
    }
  }
  return { headers, hoisted };
}

/**
 * Extract a ruleset's local selector as a Selector NODE for a flat bucket path, or undefined.
 * At the spine's pre-eval stage a plain selector is a raw STRING (strings-not-nodes model),
 * so a string is materialized to a Selector node (`asExtendSelectorNode`, the same
 * materializer the eval gather uses for string targets, `extend.ts:157`). A MULTI-BRANCH LIST
 * surface (`.a, .b` — a raw `SelectorListItem[]`) is likewise materialized to a `SelectorList`
 * node (CASE 2): an extender nested under an OR-parent (`.a, .b { .c:extend(.ext all) }`) then
 * carries the list as a path level, so `composeContribution`'s `wrapIsIfMultiList` produces the
 * grouped `:is(.a, .b) .c` contribution. A Nil / undefined selector returns undefined.
 */
export function flatLocalSelector(ruleset: Ruleset): Selector | undefined {
  const sel = ruleset.selector;
  if (sel === undefined || sel instanceof Nil) {
    return undefined;
  }
  if (Array.isArray(sel)) {
    // A raw multi-branch list surface. An interpolated branch is not concrete pre-eval — defer
    // the whole list (a later increment resolves selectors at ruleset-enter).
    if (sel.some(item => typeof item === 'string' && (item.includes('@{') || item.includes('${')))) {
      return undefined;
    }
    return asExtendSelectorNode(sel);
  }
  if (typeof sel === 'string') {
    // Interpolated selectors (`@{…}`) are not concrete pre-eval — defer them (a later
    // increment resolves the selector at ruleset-enter before it participates in extend).
    if (sel.includes('@{') || sel.includes('${')) {
      return undefined;
    }
    return asExtendSelectorNode(sel);
  }
  return sel;
}

/**
 * True if `selector` contains an ampersand with an APPEND value (`&-modifier`) — the anonymous-append
 * form whose suffix materializes only via `Ampersand.evalNode`'s `appendValue` path (its `valueOf` is
 * bare `&`). A COMBINATOR `&` (`&.foo`, `&:hover`) is NOT an append and IS resolved by the gather's
 * scoped `&`-eval. Local copy of the emit-walk predicate (avoids an import cycle).
 */
function selectorHasAmpersandAppend(selector: unknown): boolean {
  if (!selector || typeof selector === 'string') {
    return false;
  }
  if (Array.isArray(selector)) {
    return selector.some(item => selectorHasAmpersandAppend(item));
  }
  const isAppendAmp = (n: { type?: string; appendValue?: unknown }): boolean =>
    n.type === 'Ampersand' && n.appendValue !== undefined;
  const node = selector as { type?: string; appendValue?: unknown; walk?: (deep: boolean) => Iterable<Node> };
  if (isAppendAmp(node)) {
    return true;
  }
  if (typeof node.walk === 'function') {
    for (const descendant of node.walk(true)) {
      if (isAppendAmp(descendant as { type?: string; appendValue?: unknown })) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Propagate `F_AMPERSAND` from leaf `Ampersand` nodes UP every container that transitively holds
 * one, returning true when the subtree contains an `&`. A PARSER-delivered (pre-eval) selector sets
 * the flag only on the leaf `Ampersand` nodes; `Ruleset.composeSelector`'s substitution dispatch
 * (`_substituteAmpInComplex`/`_substituteAmpInCompound`) tests `hasFlag(F_AMPERSAND)` on the
 * CONTAINER compound/complex to decide whether to recurse. Real eval bubbles the flag up via the
 * `Ampersand` constructor; the eager static gather must do the same so a materialized `&`-local
 * composes (substitutes) instead of taking the implicit-descendant-prepend branch. Mutates only the
 * gather's own materialized copy (a `flatLocalSelector` node), never a shared/source node.
 */
function propagateAmpersandFlag(node: unknown): boolean {
  if (!node || typeof node === 'string') {
    return false;
  }
  const n = node as { addFlag?: (f: number) => void; value?: unknown; type?: string };
  if (n.type === 'Ampersand') {
    n.addFlag?.(F_AMPERSAND);
    return true;
  }
  let has = false;
  if (Array.isArray(n.value)) {
    for (const child of n.value) {
      if (propagateAmpersandFlag(child)) {
        has = true;
      }
    }
  } else if (n.value !== undefined && propagateAmpersandFlag(n.value)) {
    has = true;
  }
  if (has) {
    n.addFlag?.(F_AMPERSAND);
  }
  return has;
}

/**
 * The `valueOf()` of a complex selector's LEADING compound when it is followed by a DESCENDANT
 * (space) combinator (`.foo .bar` → `.foo`), else undefined. Only a plain descendant lead qualifies
 * for the SHAPE-4 partial-of-leading-compound `:is`-wrap; a child/sibling combinator (`>`, `+`, `~`)
 * or a graft/`&` compound does not.
 */
function leadingDescendantCompound(sel: Selector): string | undefined {
  if (!isNode(sel, N.ComplexSelector) || sel.value.length < 3) {
    return undefined;
  }
  const lead = sel.value[0]!;
  const comb = sel.value[1]!;
  // The DESCENDANT combinator between lead and the rest must be a plain space. (A materialized
  // component may be a raw string or a node — read `valueOf()` uniformly.)
  if (typeof comb === 'string' ? comb !== ' ' : String(comb.valueOf()).trim() !== '') {
    return undefined;
  }
  const text = typeof lead === 'string' ? lead : String(lead.valueOf());
  // Reject a lead that is itself a graft / `&` / combinatorial — only a plain compound wraps cleanly.
  if (/[>+~,()&]/.test(text)) {
    return undefined;
  }
  return text;
}

/**
 * The shared leading descendant compound across ALL branches of a subject selector, or undefined
 * when the branches disagree (or a branch is not a descendant complex). `.foo .bar, .foo .baz` →
 * `.foo`; `.foo .bar, .qux .baz` → undefined. A single complex (`.foo .bar`) also qualifies.
 */
function sharedLeadingCompound(sel: Selector): string | undefined {
  const branches: Selector[] = isNode(sel, N.SelectorList)
    ? sel.value.filter((b): b is Selector => typeof b !== 'string')
    : [sel];
  if (branches.length === 0) {
    return undefined;
  }
  let shared: string | undefined;
  for (const branch of branches) {
    const lead = leadingDescendantCompound(branch);
    if (lead === undefined) {
      return undefined;
    }
    if (shared === undefined) {
      shared = lead;
    } else if (shared !== lead) {
      return undefined;
    }
  }
  return shared;
}

/**
 * The COMPOUND BASE of a pseudo-suffixed target: strip a trailing pseudo-class / pseudo-element
 * chain (`:hover`, `::before`, `:not(.x)` is excluded via the paren guard below) from a single
 * compound, returning the leading compound (`.button:hover` → `.button`), or undefined when the
 * target has no trailing pseudo or is not a single compound (a descendant space, a combinator, a
 * comma, or a leading pseudo like `:hover` alone all return undefined).
 *
 * WHY. A pseudo-compound extend target (`&:hover:extend(.button:hover)`) is handled WITHOUT a
 * dedicated subject header: the target's compound base (`.button`) is a root-level subject whose
 * header the override rewrites (`.button` → `.button, .submit`), and the nested `&:hover` under it
 * composes against that overridden list via the normal serializer `&`-flow → `:is(.button,
 * .submit):hover` (`ruleset.ts` `composeHeaderSelector`, the `&`-recompose-against-extended-parent
 * branch). So the gate admits the pseudo-compound target when its base is a root subject; the
 * pipeline produces no separate header for it (SOLVE fires nothing against a root subject that does
 * not textually contain the pseudo), and the `&`-flow does the rewrite.
 */
function pseudoCompoundBase(target: string): string | undefined {
  // Only a single compound with a trailing `:pseudo` (no descendant space, combinator, or comma).
  // A functional pseudo (`:not(...)`, `:is(...)`) carries parens — excluded (a richer find).
  if (/[>+~,() ]/.test(target)) {
    return undefined;
  }
  const idx = target.indexOf(':');
  if (idx <= 0) {
    return undefined; // no pseudo, or a leading pseudo (`:hover`) with no base compound
  }
  return target.slice(0, idx);
}

/**
 * Split a selector STRING into its descendant-combinator tokens (`.a .b` → `['.a', '.b']`), and each
 * token into its compound SIMPLES (`.a.b` → ['.a', '.b']; `[data="x"]:hover` → ['[data="x"]', ':hover']).
 * A token bearing a CHILD/SIBLING combinator or a graft paren returns undefined (not a plain
 * descendant-of-compounds shape — the inert check only reasons about those). Used to decide, purely
 * structurally, whether an extend target could POSSIBLY match a subject composed path.
 */
function descendantCompoundTokens(sel: string): string[][] | undefined {
  if (/[>+~,]/.test(sel)) {
    return undefined; // child/sibling/list — outside the descendant-of-compounds shape
  }
  const tokens = sel.trim().split(/\s+/).filter(t => t.length > 0);
  const out: string[][] = [];
  for (const token of tokens) {
    // Split a compound into simples at each `.`/`#`/`[`/`:` boundary (keep the delimiter). A functional
    // pseudo with an argument (`:not(...)`) carries a paren — reject (a richer shape the check won't reason about).
    if (/\(/.test(token)) {
      return undefined;
    }
    const simples = token.match(/[.#]?[^.#:[\]]+|\[[^\]]*\]|::?[^.#:[\]]+/g);
    if (!simples || simples.length === 0) {
      return undefined;
    }
    out.push(simples);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Split a selector STRING into its COMPOUNDS across ANY combinator (descendant space, `>`, `+`, `~`) —
 * unlike {@link descendantCompoundTokens} which rejects a child/sibling combinator. Each compound is a
 * list of simples (`.ext6 > .ext5` → `[['.ext6'], ['.ext5']]`). A graft paren / selector-list comma
 * returns undefined (a richer shape the structural check won't reason about). Used to admit a
 * COMBINATOR SUBJECT (`.p > .base`) into the partial in-place `:is`-wrap fold: the target compound
 * matches a compound WITHIN the combinator subject, which the matcher wraps in place preserving the
 * combinator (`.p > :is(.base, .ext)`), byte-identical to the oracle.
 */
function combinatorCompoundTokens(sel: string): string[][] | undefined {
  if (/[,()]/.test(sel)) {
    return undefined; // selector-list or graft — outside the plain-compounds shape
  }
  // Split on any combinator: whitespace, or a `>`/`+`/`~` (with optional surrounding space).
  const tokens = sel.trim().split(/\s*[>+~]\s*|\s+/).filter(t => t.length > 0);
  const out: string[][] = [];
  for (const token of tokens) {
    const simples = token.match(/[.#]?[^.#:[\]]+|\[[^\]]*\]|::?[^.#:[\]]+/g);
    if (!simples || simples.length === 0) {
      return undefined;
    }
    out.push(simples);
  }
  return out.length > 0 ? out : undefined;
}

/** True when every simple of compound `a` is present in compound `b` (a ⊆ b as sets of simples). */
function compoundSubset(a: string[], b: string[]): boolean {
  const set = new Set(b);
  return a.every(s => set.has(s));
}

/**
 * STRUCTURAL no-match: could the descendant target `target` match subject composed path `subjectPath`
 * (both plain descendant-of-compounds)? A match requires the target's compound tokens to appear as an
 * ORDERED (not necessarily contiguous — descendant is transitive) subsequence of the subject's tokens,
 * each target compound being a SUBSET of the aligned subject compound. Conservative: returns true on
 * any shape it cannot tokenize (so those are treated as POSSIBLE matches → NOT inert).
 */
function targetCouldMatchPath(target: string, subjectPath: string): boolean {
  const t = descendantCompoundTokens(target);
  if (t === undefined) {
    return true; // target not decomposable → assume a possible match (conservative)
  }
  // A multi-branch subject path (`.amp-test-a,.amp-test-b`) matches iff ANY branch matches — split and
  // test each. (A comma at a nested level is joined via space-join; splitting on `,` covers the common
  // root-level list.)
  for (const branch of subjectPath.split(',')) {
    const p = descendantCompoundTokens(branch);
    if (p === undefined) {
      return true; // a branch not decomposable → conservative possible-match
    }
    // Ordered subsequence match with compound-subset alignment (descendant is transitive: gaps allowed).
    let ti = 0;
    for (let pi = 0; pi < p.length && ti < t.length; pi++) {
      if (compoundSubset(t[ti]!, p[pi]!)) {
        ti++;
      }
    }
    if (ti === t.length) {
      return true;
    }
  }
  return false;
}

/**
 * STRICT ROOT-SUBJECT compound match: does the plain compound `target` genuinely match a
 * ROOT-LEVEL (single-level) subject in `subjectPath` as a compound-SUBSET? Unlike
 * {@link targetCouldMatchPath} this NEVER falls back to a conservative "couldn't tokenize → true",
 * and it requires the matched subject level to be a ROOT selector (a single compound, no descendant
 * step) — the ONLY shape the header override builds oracle-identically (an in-place `:is`-wrap of a
 * sub-compound of a root selector, `.replace` ⊆ `.replace.replace`). Two shapes it deliberately
 * REJECTS (leaving them on eval, where they render correctly):
 *   - a subject bearing a child/sibling combinator or graft (`.parent > .base`) — the pipeline
 *     produces no in-place wrap for a `>`-combinator sub-compound;
 *   - under COLLAPSE (`allowNested=false`), a DESCENDANT (nested) subject (`.one .three`) reached by
 *     a ROOT extender — the extender must be composed into the parent context (`:is(.one,.two)
 *     .theme`), which the collapse header-fold does NOT do. Under EXPANDED (`allowNested=true`) a
 *     nested subject IS admitted: the expanded-mode bare in-place rewrite (`[data="test"],
 *     .attribute-test`) is oracle-identical, the block wrapper supplying the shared parent prefix.
 * Only used by `isMatchableCompoundTarget`.
 */
function compoundMatchesRootSubjectStrict(target: string, subjectPath: string, allowNested: boolean): boolean {
  const t = descendantCompoundTokens(target);
  if (t === undefined || t.length !== 1) {
    return false; // only a single plain compound target is handled here
  }
  const targetCompound = t[0]!;
  for (const branch of subjectPath.split(',')) {
    const p = descendantCompoundTokens(branch);
    // Reject a non-tokenizable branch (combinator/graft). A DESCENDANT (nested) level is allowed only
    // under expanded mode (the bare in-place rewrite); under collapse only a single-level root
    // selector qualifies for the in-place sub-compound wrap.
    if (p === undefined) {
      continue;
    }
    // MULTISET subset (occurrence count), NOT set subset: `.replace` (1×) ⊆ `.replace.replace` (2×)
    // is a real partial match, but `.e.e` (2×.e) is NOT satisfied by `.e` (1×.e) — the `&&` exact
    // extend's subject is the `.e.e` `&`-composed block (excluded from clean paths), NOT the `.e`
    // root rule, so a set-collapse false-positive (`{.e} ⊆ {.e}`) would wrongly admit it.
    const levelsToTest = allowNested ? p : (p.length === 1 ? p : []);
    for (const level of levelsToTest) {
      if (compoundMultisetSubset(targetCompound, level)) {
        return true;
      }
      // INTERPOLATED ATTRIBUTE subject (`[data="@{attr-data}"]`). The gate reads the RAW (unresolved)
      // subject local, so a literal attribute target (`[data="test3"]`) never string-matches the raw
      // `@{…}` form — but the gather (`resolveLocal`) RESOLVES the interpolation and the extend fires.
      // When the target is a single attribute simple and the level carries a same-name attribute with
      // an interpolated value, treat it as a match (the resolution happens at gather, not the gate).
      if (targetCompound.length === 1 && attributeSameNameInterpolated(targetCompound[0]!, level)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when `targetAttr` (a single `[name=…]`/`[name]` simple) and one of `levelSimples` share the
 * same attribute NAME and the level's value carries an interpolation token (`@{…}`/`${…}`). Used so
 * the gate admits a literal attribute-target extend of an interpolated-attribute subject
 * (`[data="test3"]` ← `[data="@{attr-data}"]`), which resolves at gather time.
 */
function attributeSameNameInterpolated(targetAttr: string, levelSimples: string[]): boolean {
  const nameOf = (attr: string): string | undefined => {
    const m = /^\[\s*([^=~|^$*\]\s]+)/.exec(attr);
    return m ? m[1] : undefined;
  };
  if (!targetAttr.startsWith('[')) {
    return false;
  }
  const targetName = nameOf(targetAttr);
  if (targetName === undefined) {
    return false;
  }
  return levelSimples.some(s =>
    s.startsWith('[') && nameOf(s) === targetName && (/[@$]\{/.test(s)));
}

/** True when compound `a`'s simples are a MULTISET subset of `b`'s (occurrence counts respected). */
function compoundMultisetSubset(a: string[], b: string[]): boolean {
  const counts = new Map<string, number>();
  for (const s of b) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  for (const s of a) {
    const n = counts.get(s) ?? 0;
    if (n === 0) {
      return false;
    }
    counts.set(s, n - 1);
  }
  return true;
}

/** The Extend nodes borne by a ruleset's direct body (both `Extend` and `ExtendList.value`). */
function rulesetExtendNodes(ruleset: Ruleset): Extend[] {
  const out: Extend[] = [];
  for (const child of ruleset.rules) {
    if (child instanceof Extend) {
      out.push(child);
    } else if (child instanceof ExtendList) {
      out.push(...child.value);
    }
  }
  return out;
}

/**
 * True when an extend's TARGET is a find the header-override handles: a single compound
 * (`.a`, `.a.b`), a DESCENDANT compound (`.header .header-nav`, crossing/hoist), a combinator
 * subject/target (`.a + .b`), OR a SELECTOR-LIST of such (`.dd, .bb` — a MULTI-TARGET extend, split
 * per-branch in the gather). Still EXCLUDED (a richer shape keeps the whole root on eval): `:is()`/
 * pseudo grafts (parens). The caller separately verifies each target branch resolves to a real
 * subject (root selector, combinator subject, or nested composed path).
 */
function extendTargetIsSimple(node: Extend): boolean {
  const target = node.target;
  if (target === undefined || target === null) {
    return false;
  }
  const text = String(target.valueOf()).trim();
  // Reject only grafts (parens). Descendant space (crossing), child/sibling combinators (`>`/`+`/`~`),
  // AND selector-list commas (multi-target, split per-branch by `pushExtendInstructions`) are allowed —
  // the per-branch subject-correspondence check confirms each maps to a real subject. (Matcher + EMIT
  // build the append/wrap oracle-identically, `corpus-combinator-cases`.)
  return !/[()]/.test(text);
}

/** Collapse whitespace around child/sibling combinators (`.a > .b` → `.a>.b`) and runs of internal
 * whitespace to single spaces, so an extend TARGET string and a subject BRANCH string compare equal
 * regardless of authored spacing. Descendant whitespace is preserved (single space). */
function normalizeCombinatorSpacing(sel: string): string {
  return sel.replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ').trim();
}

/** Split a selector-list string into its top-level branches, respecting parens (`:not(.a, .b)`, an
 * `:is(...)` graft) so a comma INSIDE a paren does not split. (`.foo .bar, :is(.a, .b).c` →
 * `['.foo .bar', ':is(.a, .b).c']`.) Used for per-branch subject collection in the topology gate. */
function splitTopLevelBranches(text: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      branches.push(text.slice(start, i));
      start = i + 1;
    }
  }
  branches.push(text.slice(start));
  return branches;
}

/** Split a target selector's `valueOf()` into per-branch keys at top-level commas (`.dd,.bb` →
 * `['.dd', '.bb']`). A comma inside a graft paren cannot occur here — grafts are rejected upstream by
 * {@link extendTargetIsSimple} — so a naive split is sound for the admitted shapes. */
function targetBranchKeys(target: SelectorLike): string[] {
  return String(valueOfSelectorLike(target)).split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/** `valueOf()` a `SelectorLike` (Selector | string | array) to its serialized string. An array
 * (a selector-list surface) joins its branches with commas — the same shape a `SelectorList`'s
 * `valueOf` produces, so the comma-split in {@link targetBranchKeys} is uniform. */
function valueOfSelectorLike(sel: SelectorLike): string {
  if (typeof sel === 'string') {
    return sel;
  }
  if (Array.isArray(sel)) {
    return sel.map(s => (typeof s === 'string' ? s : String(s.valueOf()))).join(',');
  }
  return String(sel.valueOf());
}

/** A selector atom (`.class`, `#id`, or a bare type/tag) inside a selector string — the granularity
 * an append suffix concatenates onto. Combinators/whitespace/parens are NOT atoms. */
const SELECTOR_ATOM_RE = /[.#]?[A-Za-z_][A-Za-z0-9_-]*/g;

function selectorAtoms(text: string): string[] {
  return text.match(SELECTOR_ATOM_RE) ?? [];
}

/** Every `Ampersand.appendValue` (the `-modifier` suffix) reachable in a ruleset selector. */
function selectorAppendSuffixes(selector: unknown): string[] {
  const out: string[] = [];
  const push = (n: Node): void => {
    if (isNode(n, N.Ampersand) && n.appendValue !== undefined) {
      out.push(String(n.appendValue));
    }
  };
  const visit = (n: unknown): void => {
    if (!n || typeof n === 'string') {
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (!(n instanceof Node)) {
      return;
    }
    push(n);
    for (const d of n.walk(true)) {
      push(d);
    }
  };
  visit(selector);
  return out;
}

/**
 * APPEND × EXTEND gate — PRECISE. The static extend gather works over the SOURCE tree, where an
 * ampersand-APPEND-generated selector (`.component-inner` from `&-inner` inside `.component`) does
 * not yet exist. So a tree that BOTH appends AND `:extend`s an append-generated selector cannot be
 * folded (the gather misses the generated target). This predicate returns true ONLY for that genuine
 * hazard — an extend TARGET whose atom could equal an append-generated atom — instead of the former
 * whole-tree "any append + any extend → eval" over-rejection (which pinned `benchmark.less`, whose
 * appends under `.component` are never extend targets).
 *
 * SOUND over-approximation. Append-generated atoms are computed by threading the COMPOSED PARENT text
 * through the descent: a simple `&<suffix>` selector composes to `parentText + suffix` (handling
 * nested append chains like `&-body { &--large }` → `.component-body--large`); a messier append
 * (`&&-active`, `& > &-inner`, `&-header, &-footer`) contributes the coarse `parentAtom + suffix`
 * candidates. An append whose enclosing parent selector is NOT statically knowable (interpolated /
 * dynamic) sets a conservative flag → reject (that generated name is unbounded). An INTERPOLATED
 * extend target likewise cannot be excluded → reject. Reject ⇒ eval, byte-identical; the residual is
 * strictly narrower than the old gate, never wider, so no previously-folding tree regresses.
 */
export function treeHasExtendTargetableAppend(root: Rules): boolean {
  const suffixes = new Set<string>();
  const generatedAtoms = new Set<string>();
  const targetAtoms = new Set<string>();
  let hasExtend = false;
  let uncleanTarget = false;
  let uncleanAppendParent = false;

  const addTarget = (ext: Extend): void => {
    hasExtend = true;
    const t = ext.target;
    if (t === undefined || t === null) {
      uncleanTarget = true;
      return;
    }
    const key = String(t.valueOf());
    if (key.includes('@{') || key.includes('${') || key.includes('%%')) {
      uncleanTarget = true;
      return;
    }
    for (const atom of selectorAtoms(key)) {
      targetAtoms.add(atom);
    }
  };

  // `parentText` = the composed selector text of the enclosing ruleset (undefined at document root);
  // `atRoot` distinguishes "no parent" (root append `&x` has no class prefix — harmless) from an
  // enclosing parent whose text we cannot compute (unclean → conservative).
  const walk = (children: readonly Node[], parentText: string | undefined, atRoot: boolean): void => {
    for (const child of children) {
      if (child instanceof Extend) {
        addTarget(child);
      } else if (child instanceof ExtendList) {
        for (const e of child.value) {
          addTarget(e);
        }
      }
      if (!isNode(child, N.Ruleset)) {
        if (isNode(child, N.AtRule) && isNode(child, N.Rules)) {
          walk(child.rules, parentText, atRoot);
        }
        continue;
      }
      const ruleset = child;
      const localSuffixes = selectorAppendSuffixes(ruleset.selector);
      const local = flatLocalSelector(ruleset);
      const localText = local !== undefined ? String(local.valueOf()) : undefined;
      let composedText: string | undefined;
      if (localSuffixes.length > 0) {
        for (const s of localSuffixes) {
          suffixes.add(s);
        }
        // Simple single `&<suffix>` selector composes exactly to parentText + suffix. `valueOf()`
        // renders the append form as a bare `&` (the suffix rides `Ampersand.appendValue`, not the
        // serialized text), so a lone `&` local with exactly one suffix IS the simple `&<suffix>` form.
        const collapsed = localText !== undefined ? localText.replace(/\s+/g, '') : undefined;
        const isSimpleAppend = localSuffixes.length === 1 && collapsed === '&';
        if (isSimpleAppend && parentText !== undefined) {
          composedText = parentText + localSuffixes[0];
          for (const atom of selectorAtoms(composedText)) {
            generatedAtoms.add(atom);
          }
        } else if (isSimpleAppend && atRoot) {
          // Root-level `&<suffix>` — no class prefix; the suffix alone yields no class atom.
          composedText = undefined;
        } else {
          // Messier append (compound/combinator/list). Contribute coarse parentAtom+suffix candidates.
          const parentAtoms = parentText !== undefined ? selectorAtoms(parentText) : [];
          if (parentAtoms.length === 0 && !atRoot) {
            uncleanAppendParent = true;
          }
          for (const p of parentAtoms) {
            for (const s of localSuffixes) {
              generatedAtoms.add(p + s);
            }
          }
          composedText = undefined;
        }
      } else if (localText !== undefined) {
        composedText = localText;
      } else {
        composedText = undefined;
      }
      walk(ruleset.rules, composedText, false);
    }
  };

  walk(root.rules, undefined, true);

  if (suffixes.size === 0 || !hasExtend) {
    return false;
  }
  if (uncleanTarget || uncleanAppendParent) {
    return true;
  }
  for (const atom of targetAtoms) {
    if (generatedAtoms.has(atom)) {
      return true;
    }
  }
  return false;
}

/**
 * The SPINE extend topology gate (P3 increment 2) — admits NESTED EXTENDERS (whose composed
 * contribution the document-wide gather resolves against their ancestor frames) while keeping
 * the strict conservative discipline: a shape outside the proven set → false (whole root stays
 * on eval, byte-identical). Generalizes the flat gate; the widening is precisely "the EXTENDER
 * may be nested" (`.type1 { .sidebar3 { &:extend(.sidebar all) } }`).
 *
 * Admits iff:
 *   1. every extend TARGET (at any depth) is a SIMPLE find (`extendTargetIsSimple`: single
 *      compound, no combinator/list/graft) — a descendant/list/graft target matches a NESTED or
 *      MULTI subject the header-override cannot address (this also excludes most `&`-crossing,
 *      whose targets are descendant selectors);
 *   2. every target resolves to exactly one ROOT-LEVEL subject ruleset AND no NESTED ruleset
 *      shares that selector — the header override rewrites root-level subjects; a nested subject
 *      would be missed. (The EXTENDER may be nested; the TARGET/subject must be root-level.);
 *   3. NO chaining — a target that is itself an extender's subject needs the transitive
 *      cross-subject fixpoint ordering (a later increment);
 *   4. NO extend reaching INTO an at-rule body (the subject there is at-rule-scoped, not a
 *      document-root subject).
 *
 * P4 additionally admits two shapes so `extend-nest` FULLY FLIPS to the spine:
 *   5. a PSEUDO-COMPOUND target (`.button:hover`) whose compound base is a ROOT-LEVEL subject —
 *      the base's header override + the nested `&`-pseudo's serializer `&`-flow produce the grouped
 *      `:is(base, …):pseudo`, no dedicated header needed (`pseudoCompoundBase`);
 *   6. an INERT NOMATCH target that STRUCTURALLY cannot match any subject (`.button :hover`, whose
 *      ancestor `.button` has no `:hover` descendant) — SOLVE fires nothing, so admitting it keeps
 *      the whole (otherwise foldable) root on the spine (`targetCouldMatchPath` over clean paths).
 * Both P4 clauses are DISABLED when the tree has imports (an imported subject the static gather
 * can't see could match) or the target is interpolated (an eval-path resolution). Anything outside
 * this set routes to eval, byte-identical.
 */
export function isSpineExtendTopology(
  root: Rules,
  collapseNesting: boolean,
  importOpts?: SpineExtendImportOptions
): boolean {
  // A tree with IMPORTS can introduce subjects (and extend targets) the static gather never sees, so
  // the structural inert-nomatch + pseudo-base admissions below are unsound (a target that matches no
  // VISIBLE subject may match an IMPORTED one at eval time). Disable both when any import is present.
  // (The other admit clauses only rewrite statically-visible root/nested subjects, so they stay sound.)
  //
  // SPECULATIVE-ADMIT / RE-GATE (import-spec routing). `isSpineEligibleRoot` runs this SYNCHRONOUSLY,
  // before any async import resolution — so an extend TARGET that lives in an imported file is invisible
  // here. Two modes close that gap:
  //   - `speculativeImport` (sync gate): a plain simple target that maps to no VISIBLE subject is
  //     PROVISIONALLY admitted (so the extend-bearing import tree reaches `renderRootViaSpine`), where a
  //     post-wire RE-GATE re-runs this check over the RESOLVED imported subjects. The re-gate is the
  //     authority; a provisional admit that the re-gate rejects ABORTS to eval (byte-identical).
  //   - `importedRootSubjects` (re-gate): the resolved imported ROOT-LEVEL subject selectors, folded
  //     into the root-subject correspondence so `.x:extend(.a)` (with `.a` in an imported file) is
  //     addressable. When this is provided the check is STRICT (no speculation) — the caller has the
  //     resolved bodies, so any target that still maps to nothing is a genuine non-fold → abort.
  const speculativeImport = importOpts?.speculativeImport === true;
  const importedRootSubjects = importOpts?.importedRootSubjects;
  // RE-GATE mode: the caller has resolved the imported bodies and supplied their root-level subject
  // selectors (`importedRootSubjects`). The full subject universe (local + imported) is now known, so
  // a target that maps to NOTHING is genuinely inert (a no-op extend) rather than a
  // maybe-imported unknown — enabling the inert-nomatch admission below even though the tree imports.
  const reGateResolved = importedRootSubjects !== undefined;
  const treeHasImport = ((): boolean => {
    for (const node of root.walk(true)) {
      if (node.type === 'StyleImport') {
        return true;
      }
    }
    return false;
  })();
  const targets = new Set<string>();
  const rootLevelSelectors = new Set<string>();
  // Composed-path strings of EVERY subject (root: local; nested: `.header .header-nav`). A crossing
  // target (`.header .header-nav`) resolves to a NESTED subject's composed path — admitted so the
  // hoist path (`collapseNesting:true`, verbatim override) can rewrite it (increment 3).
  const subjectComposedPaths = new Set<string>();
  // Subset of `subjectComposedPaths` with NO `&` level — the paths the structural inert scan can
  // trust (a `&` level is a compound-merge the naive space-join mis-approximates; see below).
  const cleanSubjectPaths = new Set<string>();
  let ok = true;

  // The SHARED LEADING COMPOUND of every branch of a root-level subject (SHAPE 4). When a
  // root-level subject is `.foo .bar, .foo .baz`, a partial extend of the leading `.foo` wraps it
  // IN PLACE per branch (`:is(.foo, …) .bar`), so `.foo` is an addressable target even though it is
  // not itself a root-level subject selector. The matcher + SOLVE build this; the gate must admit it.
  const leadingCompoundTargets = new Set<string>();
  // Root-level COMBINATOR subject selectors (`.a > .b`, `.a + .b`) — a plain compound target that
  // sub-matches a compound WITHIN one of these is a PARTIAL in-place `:is`-wrap the matcher builds
  // preserving the combinator (`.a > :is(.b, .ext)`), byte-identical. Collected separately since the
  // descendant tokenizer rejects combinators.
  const combinatorSubjectSelectors = new Set<string>();
  // Individual DESCENDANT branches of root-level subjects, split on top-level commas (`.foo .bar,
  // .foo .baz` → `.foo .bar`, `.foo .baz`). A trailing/middle compound target (`.bar`) sub-matches
  // one of these branches as an in-place `:is`-wrap per branch — the multi-branch selector-LIST
  // subject shape the single-branch `rootDescendantSelectors` filter (below) excludes on the comma.
  const rootDescendantBranches = new Set<string>();
  // Individual COMBINATOR branches of root-level list subjects (`.ext8+.ext9` out of the 3-branch
  // `.ext8 .ext9,.ext8+.ext9,.ext8>.ext9`) — a compound target sub-matching a combinator branch is a
  // per-branch in-place `:is`-wrap preserving the combinator.
  const combinatorBranchSelectors = new Set<string>();
  // EVERY top-level branch of EVERY root-level subject (compound, descendant, combinator), normalized
  // (whitespace-collapsed). A target that EXACTLY equals a branch (`.ext8+.ext9` ≡ the `.ext8+.ext9`
  // branch of the 3-branch list subject) is an APPEND of the extender as a NEW Or-branch, which EMIT's
  // `projectSubject` builds oracle-identically (`.zap` joins `.ext8 + .ext9`).
  const rootLevelBranches = new Set<string>();
  // Root-level subject selectors (a plain target resolves to one of these — increment 2 path).
  for (const child of root.rules) {
    if (isNode(child, N.Ruleset)) {
      const local = flatLocalSelector(child);
      if (local !== undefined) {
        const localText = String(local.valueOf());
        rootLevelSelectors.add(localText);
        if (/[>+~]/.test(localText) && !/[,()&]/.test(localText)) {
          combinatorSubjectSelectors.add(localText);
        }
        // Split the (possibly multi-branch) local into per-branch selectors. A `&`/paren branch is
        // skipped (its composed form is unreachable by a plain descendant/combinator find here).
        for (const branch of splitTopLevelBranches(localText)) {
          const b = branch.trim();
          if (b === '' || /[()&]/.test(b)) {
            continue;
          }
          rootLevelBranches.add(normalizeCombinatorSpacing(b));
          if (/\s/.test(b) && !/[>+~,]/.test(b)) {
            rootDescendantBranches.add(b);
          } else if (/[>+~]/.test(b) && !/,/.test(b)) {
            combinatorBranchSelectors.add(b);
          }
        }
        const lead = sharedLeadingCompound(local);
        if (lead !== undefined) {
          leadingCompoundTargets.add(lead);
        }
      }
    }
  }
  // All subjects' composed-path strings (document-wide) — for crossing target resolution.
  const collectPaths = (node: Node, parentPath: readonly Selector[]): void => {
    if (!isNode(node, N.Ruleset)) {
      if ((isNode(node, N.Rules) || (isNode(node, N.AtRule) && 'rules' in node)) && Array.isArray((node as { rules?: Node[] }).rules)) {
        for (const c of (node as { rules: Node[] }).rules) {
          collectPaths(c, parentPath);
        }
      }
      return;
    }
    const local = flatLocalSelector(node);
    const path = local !== undefined ? [...parentPath, local] : parentPath;
    if (local !== undefined) {
      // Approximate the composed descendant path by joining each level's `valueOf` with a space
      // — a PURE string op (the gate MUST NOT mutate the source tree, so it never calls
      // `composeTargetOwn`, which reparents via `Ruleset.composeSelector`). This matches a plain
      // descendant crossing target (`.header .header-nav`); a level with `&`/combinators would not
      // string-match, which is fine — those shapes are excluded upstream anyway.
      subjectComposedPaths.add(path.map(s => String(s.valueOf())).join(' '));
      // CLEAN descendant path (no `&` level) for the structural inert scan. A `&`-bearing level
      // composes into a COMPOUND MERGE, not a descendant step, so the naive space-join
      // (`.button &:hover`) mis-approximates it as a descendant — a plain descendant target
      // (`.button :hover`) would then spuriously "match" the bogus `&`-boundary. Since a
      // descendant target can only match a genuine descendant path, exclude any `&`-bearing path
      // from the scan (its real compound form is unreachable by a descendant find anyway).
      if (!path.some(s => String(s.valueOf()).includes('&'))) {
        cleanSubjectPaths.add(path.map(s => String(s.valueOf())).join(' '));
      }
    }
    for (const c of node.rules) {
      collectPaths(c, path);
    }
  };
  for (const child of root.rules) {
    collectPaths(child, []);
  }

  // Document-wide walk: collect every extend target (checking simplicity) + every
  // extend-BEARING ruleset's selector (chain detection). At-rule bodies bearing extends
  // disqualify (clause 4).
  const walk = (node: Node, ancestorAmpAppend: boolean): void => {
    if (!ok) {
      return;
    }
    // CONDITIONAL-AT-RULE EXTEND (clause 4, RELAXED). An extend inside a `@media`/`@supports`/
    // `@container` body is FOLDABLE: the gather descends the scope chain and the pipeline's
    // scope-reachability filter (`scopeReaches`) scopes it to the same or a nested conditional body
    // (eval oracle §A5/A2). So do NOT reject those — let the walk descend and collect their targets,
    // which the per-target correspondence loop below verifies against a scope-reachable subject. A
    // NON-media-scope at-rule bearing an extend (`@layer`/`@scope`/`@keyframes`/…) still disqualifies:
    // its reachability is not a plain nesting-prefix relation, so the static gather cannot reproduce it.
    if (isNode(node, N.AtRule) && 'rules' in node && Array.isArray(node.rules) && treeHasExtend(node)
      && !isMediaScopeAtRule(node)) {
      ok = false;
      return;
    }
    let rules: readonly Node[] | undefined;
    let ampAppend = ancestorAmpAppend;
    if (isNode(node, N.Ruleset)) {
      rules = node.rules;
      const local = flatLocalSelector(node);
      // A COMBINATOR `&` local (`&.sidebar4`, `&+&`, even under a MULTI-BRANCH `.a, .b` parent) is
      // resolved by the gather's EAGER STATIC `Ruleset.composeSelector`-reduce (`resolveLocal`) into
      // the fully-composed `:is(...)`-graft — a pure function of the selector nodes, no eval/frames.
      // So the former `&`-under-multi-branch-list disqualifier is GONE (the amp-test `&+&` is now
      // admitted). An `&`-APPEND local (`&-modifier`) still DISQUALIFIES: its anonymous suffix
      // materializes only via `Ampersand.evalNode`'s `appendValue` path (composeSelector does not
      // build it), so it stays on eval.
      if (local !== undefined && selectorHasAmpersandAppend(local)) {
        ampAppend = true;
      }
      const extendNodes = rulesetExtendNodes(node);
      if (extendNodes.length > 0) {
        if (ampAppend) {
          ok = false; // extender on an `&`-APPEND path — the append suffix can't be composed here
          return;
        }
        for (const ext of extendNodes) {
          if (!extendTargetIsSimple(ext)) {
            ok = false;
            return;
          }
          if (ext.target !== undefined && ext.target !== null) {
            const fullKey = String(ext.target.valueOf());
            // An INTERPOLATED target (`:extend(.@{name})`) is resolved against the LIVE value frame
            // at capture — the OQ-A EVAL-PATH fix (`Extend.runEffect`), not reproducible by the
            // eval-free static gather. Its parse node is an `InterpolatedSelector` whose `valueOf`
            // is a `%%`-placeholder (not raw `@{…}` text). Keep the whole root on eval so it resolves.
            if (fullKey.includes('@{') || fullKey.includes('${') || fullKey.includes('%%')) {
              ok = false;
              return;
            }
            // A SELECTOR-LIST target (`.dd, .bb`) is a multi-target extend: each branch must map to a
            // real subject independently (mirrors the per-branch instruction split in the gather).
            for (const branchKey of targetBranchKeys(ext.target)) {
              targets.add(branchKey);
            }
          }
        }
      }
    } else if (isNode(node, N.Rules)) {
      rules = node.rules;
    } else if (isNode(node, N.AtRule) && 'rules' in node && Array.isArray(node.rules)) {
      rules = node.rules;
    }
    if (rules) {
      for (const child of rules) {
        walk(child, ampAppend);
        if (!ok) {
          return;
        }
      }
    }
  };
  for (const child of root.rules) {
    walk(child, false);
    if (!ok) {
      return false;
    }
  }

  // EXPANDED-MODE NESTED-TARGET COLLAPSE-RELOCATION (formerly a hard reject). A NESTED-ruleset subject
  // whose composed form is itself an extend target (`.ext8 { .ext9 {…} }` / `.ext8 { &.ext9 {…} }`,
  // composing to `.ext8 .ext9` / `.ext8.ext9` the document extends via ROOT extenders `.buu`/`.fuu`)
  // must COLLAPSE-and-group to ROOT even under `collapseNesting:false` — the gained branch shares no
  // parent context so it cannot stay nested (`.ext8 .ext9, .buu` at root). `composeSpineSubjectHeaders`
  // now BUILDS this on the SPINE: the `isNested && !collapseNesting` full-composed-path relocation
  // (descendant) and the `ampComposed` full-form relocation (amp) each hoist the composed header
  // verbatim via the `hoisted`-set (block relocation to root, the expanded-mode analogue of the
  // collapse-mode flatten). Both relocations key STRICTLY on an instruction targeting the subject's
  // FULL composed own form; a NON-relocating nested subject (bare-child graft like `.aa { .dd {…} }` +
  // `.ee:extend(.dd all)` → `.dd, .ee`, or a subject reached by no full-form target) is left to the
  // in-place bare-local / authored `&`-flow, which emits the correct NESTED block. So the whole reject
  // is gone — an unbuildable shape now streams its authored nested form rather than routing the tree to
  // eval, and every extend fixture stays byte-identical.

  // STRICT SUBJECT CORRESPONDENCE. Each target must resolve to a subject the override can rewrite:
  //  - a ROOT-LEVEL subject (plain target, increment 2 path), unshadowed by a nested ruleset of the
  //    same selector; OR
  //  - a NESTED subject's COMPOSED PATH (a descendant target like `.header .header-nav`, the
  //    crossing/hoist case) — admitted; the hoist path rewrites it verbatim at collapsed-root.
  // A target that is itself an extender's subject is CHAINING (deferred).
  for (const target of targets) {
    // A target maps to a ROOT-LEVEL subject either LOCALLY (visible in this file) or, when the re-gate
    // supplies them, in an IMPORTED file's root body. An imported subject is addressed the SAME way — its
    // Ruleset node receives a header override at emit (`_emitSpineImportFold` descends it through
    // `effectiveHeaderSelector`) — so it needs no `anyNestedRulesetMatchesSelector` shadowing check
    // (imported subjects are, by construction, root-level in their own file).
    const isImportedRootTarget = importedRootSubjects?.has(target) === true;
    const isRootTarget = (rootLevelSelectors.has(target) && !anyNestedRulesetMatchesSelector(root, target))
      || isImportedRootTarget;
    // A crossing/hoist target (`.header .header-nav`) resolves to a NESTED subject's composed path.
    // Admitted in BOTH modes (#4a): under `collapseNesting:true` the nested block already emits at
    // ROOT (verbatim-override precondition holds trivially); under `collapseNesting:false` the
    // crossing subject is diverted to the composed-hoist projection and its block RELOCATES to root
    // (`composeSpineSubjectHeaders`'s crossing branch + the `spineExtendHoisted` verbatim-emit +
    // `Ruleset.isHoisted`'s hoisted-set relocation). Both produce the ratified composed 2-branch
    // header (`.header .header-nav, .footer .footer-nav`).
    const isNestedComposedTarget = subjectComposedPaths.has(target) && target.includes(' ');
    // SHAPE 4: the target is the shared leading compound of a root-level subject's branches — a
    // partial-of-leading-compound in-place `:is`-wrap. Addressable by the root-level header override
    // (the SOLVE local-apply rewrites the subject's own branches; not a nested subject).
    const isLeadingCompoundTarget = leadingCompoundTargets.has(target)
      && !anyNestedRulesetMatchesSelector(root, target);
    // MATCHABLE COMPOUND TARGET (`.replace`). A plain compound target that genuinely matches a
    // ROOT-LEVEL subject as a compound-SUBSET (`.replace` ⊆ `.replace.replace`) — an in-place
    // `:is`-wrap of the matched sub-compound, which SOLVE's local-apply produces oracle-identically
    // (`spine-wire-selector-shapes` #2/#3). STRICTLY root-level (`compoundMatchesRootSubjectStrict`):
    // a `>`-combinator subject (`.parent > .base`) or a nested descendant subject (`.one .three`
    // reached by a ROOT extender needing parent-context composition) is NOT admitted here — those
    // render correctly on eval and the override cannot build them. Subsumes the single-token slice of
    // SHAPE 4. Excludes an import tree (an imported subject the static gather never sees).
    // A target that sub-compound-matches an EXTENDER's own selector (`.i` ⊆ the extender `.i.j`) is a
    // TRANSITIVE CHAIN (`.g.h` ← `.i.j` ← `.k`), drained by SOLVE's document-level fixpoint through the
    // SHARED target index (a branch one subject produces routes through the same index a later subject
    // queries — `solve.ts`), so a sub-compound chain target is addressable here (no eval deferral).
    const isMatchableCompoundTarget = !treeHasImport
      && !target.includes(' ')
      && descendantCompoundTokens(target) !== undefined
      && [...cleanSubjectPaths].some(p => compoundMatchesRootSubjectStrict(target, p, !collapseNesting));
    // COMBINATOR SUBJECT (`.ext6 > .ext5`, `.ext8 + .ext9`). A single plain compound target that
    // sub-matches a compound WITHIN a root-level combinator subject is a PARTIAL in-place `:is`-wrap
    // the matcher builds preserving the combinator (`.ext6 > :is(.ext5, .ext7)`), oracle-identical
    // (`corpus-combinator-cases`). An EXACT extend of such a sub-position correctly fires nothing
    // (the matcher returns the subject unchanged → EMIT's no-change guard streams the authored
    // header). Excludes an import tree. Single-compound target only (a descendant/combinator target
    // is a distinct richer shape).
    // PARTIAL-WRAP OF A COMPOUND AT ANY LEVEL of a clean ROOT-LEVEL DESCENDANT subject (`.foo .bar`).
    // A single-compound target (`.bar`) that compound-subset-matches ANY descendant level of a
    // root-level subject selector is a PARTIAL in-place `:is`-wrap the pipeline builds at that level
    // (`.foo :is(.bar, .ext3, .ext4)`), oracle-identical (probe-verified + `emit-differential`). This
    // GENERALIZES the leading-compound (SHAPE 4) + root-single-compound (`isMatchableCompoundTarget`)
    // clauses to a TRAILING/middle compound. Restricted to a root-level DESCENDANT selector (the
    // subject is `.foo .bar` on ONE ruleset, path length 1 — NOT a nested `.foo { .bar {} }`, whose
    // header the collapse-fold composes differently). An EXACT extend of a sub-position fires nothing
    // (matcher NOT_FOUND → EMIT no-change guard). Single-compound target only.
    // Single-branch root descendant subjects PLUS per-branch descendants split out of a multi-branch
    // selector-LIST subject (`.foo .bar,.foo .baz` → `.foo .bar`, `.foo .baz`). A trailing/middle
    // compound target sub-matches ANY branch; SOLVE's local-apply rewrites each branch in place per
    // branch (`:is(.foo, …) .bar, :is(…) .baz`), oracle-identical (force-A/B verified on `extend.less`).
    const rootDescendantSelectors = [
      ...[...rootLevelSelectors].filter(s => /\s/.test(s.trim()) && !/[>+~,()&]/.test(s)),
      ...rootDescendantBranches
    ];
    const isPartialWrapOfDescendantLevel = !treeHasImport
      && !/[>+~ ,]/.test(target)
      && descendantCompoundTokens(target)?.length === 1
      && rootDescendantSelectors.some(subjSel =>
        !anyNestedRulesetMatchesSelector(root, subjSel) && targetCouldMatchPath(target, subjSel));
    const isCombinatorSubjectTarget = !treeHasImport
      && !/[>+~ ,]/.test(target)
      && combinatorCompoundTokens(target)?.length === 1
      && [...combinatorSubjectSelectors, ...combinatorBranchSelectors].some((subjSel) => {
        const tokens = combinatorCompoundTokens(subjSel);
        const tt = combinatorCompoundTokens(target);
        if (tokens === undefined || tt === undefined || tt.length !== 1) {
          return false;
        }
        return tokens.some(level => compoundMultisetSubset(tt[0]!, level));
      });
    // EXACT ROOT-BRANCH TARGET. A descendant/combinator target (`.ext8 + .ext9`, `.ext8 .ext9`) that
    // EXACTLY equals a top-level branch of a root-level subject (a branch of the 3-branch list subject
    // `.ext8 .ext9,.ext8+.ext9,.ext8>.ext9`) is an APPEND of the extender as a new Or-branch — EMIT's
    // `projectSubject` builds it (`.zap` joins the `.ext8 + .ext9` branch). Shadowed by a nested
    // ruleset of the same composed form is possible, but that case still resolves at root (the branch
    // is a root-level subject); the SOLVE local-apply targets the composed own form.
    const isExactRootBranchTarget = !treeHasImport
      && rootLevelBranches.has(normalizeCombinatorSpacing(target));
    // PARTIAL-WRAP OF A NESTED SUBJECT'S COMPOUND (`.dd` targets the nested `.aa { .dd {} }`, composed
    // path `.aa .dd`). A single-compound target that compound-subset-matches ANY level of a NESTED
    // clean subject path (length > 1 descendant path) is an in-place graft into that nested subject's
    // composed header — the nested-child-graft the collapse-mode `composeSpineSubjectHeaders` builds
    // (`.ee:extend(.dd all)` → `:is(.aa, .cc) .dd, :is(.aa, .cc) .ee`; an EXACT `.dd` fires nothing via
    // the full-path filter). Force-A/B verified on `extend.less`. Restricted to a genuinely NESTED path
    // (` `-joined, no combinators/graft) so it does not overlap the root-level clauses above.
    // COLLAPSE-MODE ONLY. A NESTED-ruleset subject renders differently per mode: under collapse it is
    // flattened to root (`composeSpineSubjectHeaders`'s nested-child fold builds `:is(.aa, .cc) .dd`
    // + the nested-child graft), so the projection is placement-correct. Under EXPANDED mode a nested
    // extend TARGET must COLLAPSE-and-group to root to carry its extender branches (`.ext8 { .ext9 {…}}`
    // extended → `.ext8 .ext9, .buu`), a relocation the expanded spine path does not reproduce — that
    // shape stays eval-owned (precise residual, IOU: expanded-mode nested-target collapse-relocation).
    const isPartialWrapOfNestedLevel = collapseNesting
      && !treeHasImport
      && !/[>+~ ,]/.test(target)
      && descendantCompoundTokens(target)?.length === 1
      && [...cleanSubjectPaths].some(p =>
        p.includes(' ') && !/[>+~,()&]/.test(p) && targetCouldMatchPath(target, p));
    // PSEUDO-COMPOUND TARGET (`.button:hover`, `.button2:hover`): its compound base (`.button`) is a
    // root-level subject. The extend needs NO dedicated header — the base's override + the nested
    // `&`-pseudo's serializer `&`-flow produce the `:is(.base, …):pseudo` shape (or, for a genuine
    // nomatch like `.button2:hover` where the base is not textually a `:hover` compound, the pipeline
    // fires nothing and the base's `:pseudo` child streams unchanged). Requires the base to be a root
    // subject; a pseudo on a NON-subject base is a nomatch handled by the inert clause below.
    const pseudoBase = pseudoCompoundBase(target);
    const isPseudoCompoundOfRootSubject = !treeHasImport
      && pseudoBase !== undefined
      && rootLevelSelectors.has(pseudoBase)
      && !anyNestedRulesetMatchesSelector(root, pseudoBase);
    // INERT NOMATCH (STRUCTURAL, sound-by-over-rejection): a target that CANNOT possibly match any
    // subject in the document — it extends nothing (`.button :hover`: a descendant find whose ancestor
    // compound `.button` has no `:hover` descendant subject; the only `:hover`-descendant subject is
    // under `.button2`). SOLVE fires nothing, so no header is built and every authored selector streams
    // unchanged; admitting it keeps the whole (otherwise foldable) root on the spine.
    //
    // WHY NOT THE MATCHER. `extendByIndexOwn` (the spine matcher) reports NOT_FOUND for several shapes
    // the EVAL path DOES extend — a `:is(...)`-graft branch, a whole-descendant crossing target
    // (`.header .header-nav`), an attribute compound — so matcher-NOT_FOUND does NOT prove inertness.
    // Instead reason PURELY STRUCTURALLY: the target could match subject path `P` iff the target's
    // descendant compound tokens are an ordered compound-SUBSET subsequence of `P`'s tokens
    // (`targetCouldMatchPath`). Inert iff the target could match NONE. The tokenizer is conservative —
    // any shape it cannot decompose (child/sibling combinator, graft paren) returns "could match" →
    // NOT inert — so it never admits a target it cannot fully reason about.
    const isInertNomatch = (!treeHasImport || reGateResolved)
      && !isRootTarget && !isNestedComposedTarget && !isLeadingCompoundTarget
      && !isPseudoCompoundOfRootSubject && !isMatchableCompoundTarget && !isCombinatorSubjectTarget
      && !isPartialWrapOfDescendantLevel && !isExactRootBranchTarget && !isPartialWrapOfNestedLevel
      && descendantCompoundTokens(target) !== undefined
      && ![...cleanSubjectPaths].some(p => targetCouldMatchPath(target, p))
      && !rootLevelSelectors.has(target)
      // In re-gate mode, the target must also be inert against the RESOLVED imported subjects — it is
      // neither an imported root subject nor a compound-subset of one (a plain reference-body selector
      // is matched only by exact equality, already handled by `isImportedRootTarget`).
      && (importedRootSubjects === undefined
        || (!importedRootSubjects.has(target)
          && ![...importedRootSubjects].some(p => targetCouldMatchPath(target, p))));
    if (!isRootTarget && !isNestedComposedTarget && !isLeadingCompoundTarget
      && !isPseudoCompoundOfRootSubject && !isMatchableCompoundTarget
      && !isCombinatorSubjectTarget && !isPartialWrapOfDescendantLevel
      && !isExactRootBranchTarget && !isPartialWrapOfNestedLevel && !isInertNomatch) {
      // SPECULATIVE ADMIT (sync gate, imports present). A plain SIMPLE target (single compound, no
      // combinator/descendant/list) that maps to no VISIBLE subject may resolve to an IMPORTED root
      // subject the sync gather can't see. Provisionally admit it so the tree reaches the post-wire
      // re-gate (which re-runs this STRICT, with `importedRootSubjects` populated, and aborts to eval
      // if the resolved shape still maps to nothing). A NON-simple target (descendant/combinator/list/
      // pseudo) is NOT speculatively admitted — those shapes stay eval-owned exactly as today.
      if (speculativeImport && treeHasImport && !/[>+~ ,]/.test(target)
        && descendantCompoundTokens(target)?.length === 1) {
        continue;
      }
      return false; // target maps to no addressable subject (root selector or crossing nested path)
    }
    // A target that is itself an EXTENDER's subject (`.b:extend(.a)` where `.b` is `.c`'s target) is a
    // TRANSITIVE CHAIN. SOLVE's document-level fixpoint (`solveSubject`) re-enqueues each produced branch
    // value and re-queries the SHARED target index, so a chained/circular/`all`-partial chain drains to
    // its fixed point on the spine byte-identically (verified: whole `extend-chaining.less` folds). No
    // eval deferral needed.
  }
  return true;
}

/**
 * True if any ruleset NESTED below the root's direct children has a local selector equal to
 * `selector` — i.e. a subject the root-level header override would fail to rewrite. Walks the
 * subtree of each root child (not the root children themselves).
 */
function anyNestedRulesetMatchesSelector(root: Rules, selector: string): boolean {
  const walk = (node: Node): boolean => {
    let rules: readonly Node[] | undefined;
    if (isNode(node, N.Ruleset)) {
      rules = node.rules;
    } else if (isNode(node, N.Rules)) {
      rules = node.rules;
    } else if (isNode(node, N.AtRule) && 'rules' in node && Array.isArray(node.rules)) {
      rules = node.rules;
    }
    if (!rules) {
      return false;
    }
    for (const child of rules) {
      if (isNode(child, N.Ruleset)) {
        const local = flatLocalSelector(child);
        if (local !== undefined && String(local.valueOf()) === selector) {
          return true;
        }
      }
      if (walk(child)) {
        return true;
      }
    }
    return false;
  };
  // Start one level DOWN (inside each root child), so a root-child match does not count.
  for (const child of root.rules) {
    if (walk(child)) {
      return true;
    }
  }
  return false;
}

/**
 * SPINE extend wire-in (P3 increment 2) — the DOCUMENT-WIDE gather generalizing increment 1's
 * flat root-child pre-scan.
 *
 * GATHER (document-wide, eval-free, PURE STRUCTURAL). WALK the whole source tree, tracking the
 * ancestor Selector `path` (parse-tree nodes carry no `.parent`, so the walk is the sole source
 * of ancestry). For each Extend a ruleset bears, record a `PipelineInstruction` whose `path` is
 * the EXTENDER's full bucket path — so a NESTED extender (`.type1 { .sidebar3 { &:extend } }`)
 * carries `[.type1, .sidebar3]`, and EMIT's `composeContribution` composes it relative to the
 * target → `.type1 .sidebar3` (NOT the bare `.sidebar3` the eval engine's node-graph
 * re-derivation gets wrong — the extend-nest bug). Composing from EXPLICIT bucket paths is why
 * this is correct WITHOUT resolving `&`/parent-composition against live frames — that is the
 * OQ-5(B) design (placement derives from the path, not a stored own-selector / `.parent` walk).
 *
 * Because the gather completes BEFORE any subject emits, every instruction is known at every
 * subject's position — `Reaching(S)` is total, so the header is final inline: NO deferral
 * (§4.4.2 degenerate), even for nested extenders (decider #2: a document-wide pre-scan sees ALL
 * instructions, so no genuinely-later contribution exists — the ONLY exception is `&`-hoist
 * re-bucketing, excluded by the gate via descendant-target + `&`-path exclusion).
 *
 * SUBJECTS are ROOT-LEVEL only (the gate guarantees targets resolve to root-level subjects); a
 * nested subject's header composes via the existing `&`-flow from its parent's override (§ the
 * `extend-clearfix` `:is(...):after` case). `composeSpineSubjectHeaders` projects each.
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.0 §4.2 §4.3 §4.4.2
 */
export function wireSpineExtends(
  root: Rules,
  context: Context,
  collapseNesting: boolean,
  importedBodies?: readonly Rules[],
  referenceBodies?: ReadonlySet<Rules>
): { headers: Map<Ruleset, Selector>; hoisted: Set<Ruleset> } {
  const subjects: SpineSubject[] = [];
  const instructions: PipelineInstruction[] = [];
  const frameBaseline = context.rulesetFrames.length;
  // Set while descending a `@import (reference)` body so gathered subjects are tagged
  // reference (own-form dropped from the header projection — reference output suppressed).
  let gatheringReference = false;
  // The chain of enclosing conditional at-rule bodies (`@media` blocks), outermost-first, tracked
  // as we descend. A subject/instruction gathered here is tagged with a SNAPSHOT of this chain so
  // the pipeline's scope-reachability filter can scope a `@media`-declared extend to the same or a
  // nested media body (eval oracle §A5/A2). Empty at root — root-level extends reach everywhere.
  let currentScope: readonly Node[] = [];

  // Recursive document-wide gather: descend rulesets, tracking the ancestor Selector `path`
  // (the extender's full bucket path — parse-tree nodes carry no `.parent`, so the walk is the
  // only source of ancestry).
  //
  // EAGER STATIC `&`-COMPOSITION. An `&`-bearing local (`&.sidebar4`, `&+&`, even under a MULTI-BRANCH
  // `.a, .b` parent) is resolved by a PURE `Ruleset.composeSelector`-reduce over the ancestor `path`
  // (`resolveLocal` below) — no eval, no frames, no registration. The resulting fully-composed form
  // (`.type2.sidebar4`, or the amp-test `:is`-graft) REPLACES the ancestor chain, so its bucket path
  // is `[resolved]` (not appended). composeSelector returns amp-free atoms, so the fixpoint's produced
  // branch carries no amp (the former round-2 amp-target trap cannot arise — no normalize step needed).
  const resolveLocal = (ruleset: Ruleset, parentPath: readonly Selector[]): { selector: Selector; ampResolved: boolean } | undefined => {
    let local = flatLocalSelector(ruleset);
    if (local === undefined) {
      return undefined;
    }
    // ATTRIBUTE-VALUE INTERPOLATION (`[data=@{attr-data}]`). A raw `@{…}` token in an
    // `AttributeSelector` value must resolve against the enclosing scope BEFORE it participates in
    // extend — else the raw subject (`[data="@{attr-data}"]`) never matches a literal target
    // (`[data="test3"]`) and the extend silently no-ops. The ancestor frames are already pushed on
    // `context.rulesetFrames` by the enclosing `gatherRuleset`, and `AttributeSelector.eval` now
    // resolves the token via that frame stack (no `.parent` needed — the spine `.parent`-free path).
    // A SYNC resolution only (the corpus's attr interpolation binds a literal string); a thenable
    // (async binding) is left raw and defers to eval. Class/`&` interpolation is handled elsewhere.
    if (!String(local.valueOf()).includes('&') && /[@$]\{/.test(String(local.valueOf()))) {
      const evaluated = local.eval(context);
      if (!isThenable(evaluated) && evaluated instanceof Selector && !(evaluated instanceof Nil)) {
        local = evaluated;
      }
    }
    if (!String(local.valueOf()).includes('&')) {
      return { selector: local, ampResolved: false };
    }
    // EAGER STATIC `&`-COMPOSITION (Case 3). Resolve the `&`-bearing local by composing it against
    // the already-resolved ancestor chain via the PURE `Ruleset.composeSelector` — the SAME graft
    // primitive the render uses, but a pure function of two selector NODES: it wraps a multi-branch
    // (`SelectorList`) parent as `:is(...)` in `_substituteAmpInComplex`/`_substituteAmpInCompound`
    // with NO reads of `ownSelector`/`composedSelectorStack`/frames/registration. A parser-delivered
    // selector flags only its leaf `Ampersand` nodes, so PROPAGATE `F_AMPERSAND` up the container
    // chain first (real eval bubbles it via the `Ampersand` ctor) — otherwise composeSelector takes
    // the implicit-descendant-prepend branch and leaves literal `&`s. No eval, no frames, no source
    // mutation (operates on the `flatLocalSelector` copy; composeSelector returns fresh nodes).
    propagateAmpersandFlag(local);
    if (parentPath.length === 0) {
      return undefined; // a root-level `&` has no parent to resolve against — defer to eval
    }
    const parent = composeTargetOwn(parentPath);
    const composed = Ruleset.composeSelector(local, parent);
    const composedNode = Array.isArray(composed) ? SelectorList.create(composed) : composed;
    if (typeof composedNode === 'string') {
      return undefined; // unexpected string surface — defer to eval
    }
    return { selector: composedNode, ampResolved: true };
  };

  // Push extend instruction(s) for one (target, extendWith, path) tuple. A SELECTOR-LIST target
  // (`:extend(.dd, .bb)` / `:extend(.dd, .bb all)`) is a MULTI-TARGET extend — the extender extends
  // EACH branch independently, so split it into one instruction PER branch. `decodeInstructions`
  // (the eval PLAN) splits only NON-partial lists; the spine matcher handles each split branch as an
  // independent find regardless of mode, so split BOTH — a partial list-target then folds byte-
  // identically (each branch is the plain per-target extend the pipeline already builds).
  const pushExtendInstructions = (
    target: Selector,
    extendWith: Selector,
    partial: boolean,
    instPath: readonly Selector[],
    order: number
  ): void => {
    const targetBranches = isNode(target, N.SelectorList)
      ? target.value.map(item => (typeof item === 'string' ? asExtendSelectorNode(item) : item))
      : [target];
    const scope = currentScope.length > 0 ? [...currentScope] : undefined;
    for (const branchTarget of targetBranches) {
      instructions.push({
        target: branchTarget,
        extendWith,
        partial,
        path: [...instPath],
        order,
        scope
      });
    }
  };

  const gatherRuleset = (ruleset: Ruleset, parentPath: readonly Selector[]): void => {
    // Resolve THIS ruleset's local against the ALREADY-pushed ancestors. An `&`-resolved local is
    // the FULL composed form (ancestor INCLUDED), so it REPLACES the ancestor chain — its path is
    // `[resolvedLocal]`, NOT `parentPath + resolvedLocal` (that would double `.type2`). A structural
    // (non-`&`) local APPENDS to the ancestor path.
    const resolved = resolveLocal(ruleset, parentPath);
    const local = resolved?.selector;
    const path: readonly Selector[] = local === undefined
      ? parentPath
      : resolved!.ampResolved
        ? [local]
        : [...parentPath, local];
    // Collect a ruleset as a candidate SUBJECT only when its local is a plain (non-`&`) selector.
    // An `&`-originated local — whether still-amp (bare `&`, `&:after`) or resolved
    // (`&.sidebar4` → `.type2.sidebar4`) — is NOT a standalone subject: it emits its own block AND
    // receives any `all`-propagated extend via the existing `&`-composition from its parent's
    // (possibly overridden) header (the `extend-clearfix` `:is(.clearfix,.foo,.bar):after` case).
    // Making it a subject would install a header override that double-composes / drops the
    // `&`-flow. Its role as an EXTENDER (bearing `:extend`) is still captured below as an
    // instruction with its resolved path — that is the increment-7 win, independent of subjecthood.
    const subjectScope = currentScope.length > 0 ? [...currentScope] : undefined;
    if (local !== undefined && resolved?.ampResolved !== true && !String(local.valueOf()).includes('&')) {
      subjects.push({ ruleset, path, order: orderOf(ruleset), reference: gatheringReference, scope: subjectScope });
    } else if (
      local !== undefined
      && resolved?.ampResolved === true
      && !String(local.valueOf()).includes('&')
    ) {
      // AMP-COMPOSED SUBJECT (`.ext8 { &.ext9 {…} }` → `.ext8.ext9`). The resolved compound is an
      // addressable target (`.fuu:extend(.ext8.ext9 all)` must graft `.fuu` here too). Register it
      // as a subject on its fully-composed path (`[.ext8.ext9]`, ancestor already folded). A header
      // installs ONLY if the projection changes the composed own form (a graft fired); otherwise the
      // block keeps its normal `&`-flow output (the `extend-clearfix` `&:after` case — no target
      // `.clearfix:after` exists, so no override, `&`-flow untouched).
      subjects.push({ ruleset, path, order: orderOf(ruleset), reference: gatheringReference, ampComposed: true, ampParentPath: [...parentPath], scope: subjectScope });
    }
    for (const ext of rulesetExtendNodes(ruleset)) {
      const rawTarget = ext.target;
      if (rawTarget === undefined || rawTarget === null || path.length === 0) {
        continue;
      }
      const target = typeof rawTarget === 'string' || Array.isArray(rawTarget)
        ? asExtendSelectorNode(rawTarget)
        : rawTarget;
      // An Extend node carrying its OWN branch selector (`.should-not-exist-in-output, .ext7 {
      // &:extend(.ext5) }` where the Extend's `.selector` is `.ext7`) extends via THAT branch only —
      // NOT the ruleset's whole selector-list. Use the Extend's `.selector` as the extender local so
      // a decoy sibling branch (`.should-not-exist-in-output`) never leaks into the target's Or-set.
      // (The empty-body parsed form routes through `gatherStandaloneExtend`; this covers the
      // Ruleset-shaped construction where the Extend is a body child with its own branch selector.)
      const branchSel = ext.selector;
      const extenderLocal: Selector | undefined = branchSel === undefined || branchSel === null
        ? local
        : typeof branchSel === 'string' || Array.isArray(branchSel)
          ? asExtendSelectorNode(branchSel)
          : branchSel;
      const extenderPath: readonly Selector[] = branchSel === undefined || branchSel === null
        ? path
        : extenderLocal !== undefined && !String(extenderLocal.valueOf()).includes('&')
          ? [...parentPath, extenderLocal]
          : path;
      // `extendWith` (SOLVE local-apply, fire-detection ONLY — EMIT composes from `path`) is the
      // extender's RESOLVED + NORMALIZED own local (`&.sidebar4` → clean-atom `.type2.sidebar4`),
      // so the produced branch is amp-free and the round-2 fixpoint dedups (no amp-target trap).
      pushExtendInstructions(
        target,
        extenderLocal ?? target,
        ext.flag === ExtendFlag.All,
        extenderPath,
        orderOf(ruleset)
      );
    }
    // Push this ruleset's frame for its subtree's `&`-resolution, descend, then pop (save/restore).
    context.rulesetFrames.push(ruleset);
    descendChildren(ruleset.rules, path);
    context.rulesetFrames.length = Math.max(frameBaseline, context.rulesetFrames.length - 1);
  };

  // A STANDALONE `Extend` (`.a, .b:extend(.x) {}`) — an empty-body selector-list block whose only
  // effect is the extend — parses as a bare `Rules` container holding an `Extend` node that carries
  // its OWN branch selector (`ext.selector` = `.ext7`), NOT a `Ruleset` whose selector is the
  // extender (the normal case, where `ext.selector` is absent). Gather it as an instruction with the
  // extender path `[...parentPath, ext.selector]` — the extender own IS the Extend's branch selector.
  const gatherStandaloneExtend = (ext: Extend, parentPath: readonly Selector[]): void => {
    const rawTarget = ext.target;
    const branchSel = ext.selector;
    if (rawTarget === undefined || rawTarget === null || branchSel === undefined || branchSel === null) {
      return;
    }
    // The branch selector materializes like any string/array target surface (same as `asExtendSelectorNode`).
    const extenderLocal: Selector | undefined = typeof branchSel === 'string' || Array.isArray(branchSel)
      ? asExtendSelectorNode(branchSel)
      : branchSel;
    if (extenderLocal === undefined || String(extenderLocal.valueOf()).includes('&')) {
      return; // an `&`-branch standalone extend needs eval-composition — defer (not in the corpus)
    }
    const path: readonly Selector[] = [...parentPath, extenderLocal];
    const target = typeof rawTarget === 'string' || Array.isArray(rawTarget)
      ? asExtendSelectorNode(rawTarget)
      : rawTarget;
    pushExtendInstructions(target, extenderLocal, ext.flag === ExtendFlag.All, path, orderOf(ext));
  };

  const descendChildren = (children: readonly Node[], path: readonly Selector[]): void => {
    for (const child of children) {
      if (isNode(child, N.Ruleset)) {
        gatherRuleset(child, path);
      } else if (child instanceof Extend) {
        // A standalone `Extend` directly under a `Rules` container (`.a, .b:extend(.x) {}` → the
        // empty-body block parses as `Rules`, not `Ruleset`). Its extender own is its branch selector.
        gatherStandaloneExtend(child, path);
      } else if (child instanceof ExtendList) {
        for (const ext of child.value) {
          gatherStandaloneExtend(ext, path);
        }
      } else if (isNode(child, N.AtRule) && isMediaScopeAtRule(child) && Array.isArray((child as { rules?: Node[] }).rules)) {
        // CONDITIONAL AT-RULE SCOPE (`@media`, `@supports`, `@container`). Descend into the body,
        // pushing THIS at-rule node onto the scope chain. Subjects and extend instructions gathered
        // inside are tagged with the snapshotted chain so the pipeline's scope-reachability filter
        // scopes a media-declared extend to the same or a NESTED conditional body (eval oracle §A5/A2):
        // `.tv-lowres:extend(.ext1 all)` inside `@media (tv)` reaches `.ext1` targets in `@media (tv)`
        // and its nested `@media (hires)`, but NOT `.ext1` outside; a root extend (`.all`) reaches all.
        // A `path` reset is NOT needed — the at-rule interposes no selector level (its body children
        // compose against the SAME ancestor selector path). `@layer`/`@scope` are NOT descended (their
        // reachability is not a plain nesting-prefix relation) — the gate keeps those on eval.
        const saved = currentScope;
        currentScope = [...currentScope, child];
        descendChildren((child as { rules: Node[] }).rules, path);
        currentScope = saved;
      } else if (isNode(child, N.Rules) && Array.isArray((child as { rules?: Node[] }).rules)) {
        // A nested `Rules` container (the empty-body selector-list-extend surface) — descend so its
        // standalone `Extend` children are gathered. Its own selector (if any) is empty (no output).
        descendChildren((child as { rules: Node[] }).rules, path);
      }
      // Other at-rules bearing extends are excluded by the eligibility gate, so no descent into them.
    }
  };

  descendChildren(root.rules, []);
  // EXTEND-THROUGH-IMPORT (import-spec routing). Gather subjects from RESOLVED imported bodies too, so an
  // imported ROOT-LEVEL subject (`.a` in `lib.less`) becomes an addressable subject: its Ruleset node
  // gets a header override, applied when `_emitSpineImportFold` descends the placement body through
  // `effectiveHeaderSelector`. Extenders in the imported body are gathered the same way (an imported
  // `:extend` contributes its instruction). The resolved bodies are the SAME node instances the emit
  // fold descends (cached in `spineImportPlacements`), so the override lands on the emitted ruleset.
  if (importedBodies) {
    for (const body of importedBodies) {
      gatheringReference = referenceBodies?.has(body) === true;
      descendChildren(body.rules, []);
    }
    gatheringReference = false;
  }
  context.rulesetFrames.length = frameBaseline; // restore (belt-and-suspenders)
  return composeSpineSubjectHeaders(subjects, instructions, collapseNesting);
}

/** Document order of a node = its source span start offset (matches the extend tuple's docOrder). */
function orderOf(node: Node): number {
  const span = spanStartOf(node);
  return typeof span === 'number' ? span : 0;
}

/**
 * A reaching-extend SUBJECT captured for buffer-then-flush (design §4.4.1). Its two parts
 * have OPPOSITE dependencies (§4.4.1):
 *
 *   - `decls` — the subject's body bytes, ALREADY RESOLVED against the live value-frame
 *     during the descent (via `bufferSubjectDecls` below). Byte-final the instant the walk
 *     leaves the subject; they wait at flush only because they follow a not-yet-final
 *     header in output order, NOT because any value work remains.
 *   - `targetPath` / `contributions` — the HEADER inputs. The header is a function of the
 *     structural stack (`targetPath`, fixed on descent) PLUS the extend contributions the
 *     subject gains during SOLVE — not final until the fixpoint settles (§4.2). So the
 *     header is the ONLY deferred part.
 */
export interface BufferedSubject {
  /** the target's own bucket path (ancestor Selector chain, outermost → own local). */
  targetPath: BucketPath;
  /** document order of the subject's authored selector (branch-0 order, EMIT sort key). */
  order: number;
  /** the extend contributions SOLVE routed to this subject (extender bucket paths + order). */
  contributions: EmitContribution[];
  /** the subject body bytes, resolved live during descent (everything between `{` and `}`). */
  decls: string;
  /** the raw block-opening (` {\n` etc.) and closing (`}\n`) framing captured at the subject. */
  open: string;
  close: string;
}

/**
 * Capture a subject's body bytes into a buffer DURING the descent — the value half of
 * §4.4.1. Runs `emitBody` (which resolves the subject's leaves against the LIVE
 * value-frame and writes them to `writer`), but via `writer.preview`, which MARKS the
 * writer, lets `emitBody` write, captures the produced bytes with `getSince`, then ROLLS
 * THE WRITER BACK. So the decls are byte-final and parked, and NOTHING lands in the real
 * output stream for this subject yet (its header is still a hole).
 *
 * ASYNC-SAFE FLUSH INVARIANT (LOAD-BEARING — the B1s discipline, design §2.3/§4.4.1).
 * A declaration value can resolve ASYNC (`calc()`, an async less-compat `alpha()`), so
 * `emitBody` may return a promise that writes into the writer in a LATER microtask. The
 * capture MUST NOT roll the writer back until that async write has completed — otherwise
 * the rolled-back writer receives the async bytes at the wrong position (the exact
 * wrong-place-bytes bug the P1 frame-pop guard prevents). `writer.preview` already honors
 * this: it chains `getSince`+`restore` on the thenable (`print.ts:660` —
 * `isThenable(out) ? out.then(finish) : finish(out)`), so the rollback runs only AFTER
 * the async body settles. We therefore MUST return `preview`'s MaybePromise unchanged and
 * never wrap it in a synchronous `finally` that would roll back early.
 */
export function bufferSubjectDecls(
  writer: OutputWriter,
  emitBody: () => MaybePromise<string | void>
): MaybePromise<string> {
  return writer.preview(emitBody);
}

/**
 * Compose the subject's FINAL header from its settled contributions (the header half of
 * §4.4.1 / the EMIT projection §4.3), joined in the byte shape the serializer emits: one
 * Or-branch per line, `,\n`-separated (matching the eval-path `.a,\n.b` output). Reuses
 * the validated EMIT `projectSubject` (compose-relative-to-target + document-order sort +
 * dedup); this unit only formats the projected branches into header text.
 *
 * Returns the branches' header text AND `hoistToRoot` — the caller (the reaching-subject
 * routing) decides placement. Increment 1 handles only `hoistToRoot === false`.
 */
export function composeSubjectHeader(subject: BufferedSubject): { header: string; hoistToRoot: boolean } {
  const emitSubject: EmitSubject = {
    path: subject.targetPath,
    order: subject.order,
    contributions: subject.contributions
  };
  const projection = projectSubject(emitSubject);
  const header = projection.branches.map(b => String(b.valueOf())).join(',\n');
  return { header, hoistToRoot: projection.hoistToRoot };
}

/**
 * FLUSH one buffered subject to its final block text: `header ++ open ++ decls ++ close`
 * (design §4.4.2 baseline splice — compose the header ONCE from the settled, sorted branch
 * set, then splice the parked decl bytes). This is a pure string assembly; the caller
 * writes the result to the real writer at the subject's document position.
 *
 * Increment 1 asserts `hoistToRoot === false` (root-level, non-crossing shape); a crossing
 * subject is a later increment (it emits at root placement, not the subject's position).
 */
export function flushBufferedSubject(subject: BufferedSubject): string {
  const { header, hoistToRoot } = composeSubjectHeader(subject);
  if (hoistToRoot) {
    throw new Error('spine extend flush: hoistToRoot not wired (P3 increment 1 handles non-crossing only)');
  }
  return header + subject.open + subject.decls + subject.close;
}
