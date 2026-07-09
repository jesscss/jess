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
import { Selector } from '../selector.js';
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
        { id: `p${i}`, path: parentPath, order: subject.order },
        instructions
      );
      if (
        parentProjection.ownBuilt
        && parentProjection.projection
        && !parentProjection.projection.hoistToRoot
        && parentProjection.projection.branches.length > 1
      ) {
        const folded = foldNestedChildHeaderNode(parentProjection.projection, childLocal, true);
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
            { id: `x${i}`, path: subject.path, order: subject.order },
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
        { id: `n${i}`, path: [bareLocal], order: subject.order },
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
      order: subject.order
    };
    extendLayerCounter.solveRuns++;
    const { projection, ownBuilt } = runSubjectProjection(pipelineSubject, instructions);
    if (!ownBuilt || !projection) {
      // A shape the own engine can't build — leave the subject on its authored header; the
      // eval-path fallback (still live in P3) covers it.
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
 * (`.a`, `.a.b`) matching a ROOT-LEVEL subject, OR a DESCENDANT compound (`.header .header-nav`)
 * matching a NESTED subject's composed path (the crossing/hoist case, increment 3). Still EXCLUDED
 * (a richer shape keeps the whole root on eval): child/sibling combinators (`>`, `+`, `~`),
 * selector-list commas (multi-subject), and `:is()`/pseudo grafts. The caller separately verifies
 * the target resolves to a real subject (root selector or nested composed path).
 */
function extendTargetIsSimple(node: Extend): boolean {
  const target = node.target;
  if (target === undefined || target === null) {
    return false;
  }
  const text = String(target.valueOf()).trim();
  // Reject selector-list commas and grafts. Descendant space (crossing) AND child/sibling
  // combinators (`>`/`+`/`~`) are now allowed — the subject-correspondence check confirms the target
  // maps to a real subject (a combinator target like `.ext8 + .ext9` must equal a combinator subject
  // selector; the matcher + EMIT build the append/wrap oracle-identically, `corpus-combinator-cases`).
  return !/[,()]/.test(text);
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
export function isSpineExtendTopology(root: Rules, collapseNesting: boolean): boolean {
  // A tree with IMPORTS can introduce subjects (and extend targets) the static gather never sees, so
  // the structural inert-nomatch + pseudo-base admissions below are unsound (a target that matches no
  // VISIBLE subject may match an IMPORTED one at eval time). Disable both when any import is present.
  // (The other admit clauses only rewrite statically-visible root/nested subjects, so they stay sound.)
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
  const extenderSelectors = new Set<string>();
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
    if (isNode(node, N.AtRule) && 'rules' in node && Array.isArray(node.rules) && treeHasExtend(node)) {
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
        if (local !== undefined) {
          extenderSelectors.add(String(local.valueOf()));
        }
        for (const ext of extendNodes) {
          if (!extendTargetIsSimple(ext)) {
            ok = false;
            return;
          }
          if (ext.target !== undefined && ext.target !== null) {
            const targetKey = String(ext.target.valueOf());
            // An INTERPOLATED target (`:extend(.@{name})`) is resolved against the LIVE value frame
            // at capture — the OQ-A EVAL-PATH fix (`Extend.runEffect`), not reproducible by the
            // eval-free static gather. Its parse node is an `InterpolatedSelector` whose `valueOf`
            // is a `%%`-placeholder (not raw `@{…}` text). Keep the whole root on eval so it resolves.
            if (targetKey.includes('@{') || targetKey.includes('${') || targetKey.includes('%%')) {
              ok = false;
              return;
            }
            targets.add(targetKey);
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

  // STRICT SUBJECT CORRESPONDENCE. Each target must resolve to a subject the override can rewrite:
  //  - a ROOT-LEVEL subject (plain target, increment 2 path), unshadowed by a nested ruleset of the
  //    same selector; OR
  //  - a NESTED subject's COMPOSED PATH (a descendant target like `.header .header-nav`, the
  //    crossing/hoist case) — admitted; the hoist path rewrites it verbatim at collapsed-root.
  // A target that is itself an extender's subject is CHAINING (deferred).
  for (const target of targets) {
    const isRootTarget = rootLevelSelectors.has(target) && !anyNestedRulesetMatchesSelector(root, target);
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
    // TRANSITIVE CHAIN (`.g.h` ← `.i.j` ← `.k`) — the header override does not build the transitive
    // closure, so keep the whole root on eval. The exact-equality chaining guard below (`.i.j`) misses
    // a SUB-COMPOUND chain target (`.i`), so exclude it from this admission explicitly.
    const chainsIntoExtender = [...extenderSelectors].some((extSel) => {
      const et = descendantCompoundTokens(extSel);
      const tt = descendantCompoundTokens(target);
      return et !== undefined && et.length === 1 && tt !== undefined && tt.length === 1
        && compoundMultisetSubset(tt[0]!, et[0]!);
    });
    const isMatchableCompoundTarget = !treeHasImport
      && !target.includes(' ')
      && !chainsIntoExtender
      && descendantCompoundTokens(target) !== undefined
      && [...cleanSubjectPaths].some(p => compoundMatchesRootSubjectStrict(target, p, !collapseNesting));
    // COMBINATOR SUBJECT (`.ext6 > .ext5`, `.ext8 + .ext9`). A single plain compound target that
    // sub-matches a compound WITHIN a root-level combinator subject is a PARTIAL in-place `:is`-wrap
    // the matcher builds preserving the combinator (`.ext6 > :is(.ext5, .ext7)`), oracle-identical
    // (`corpus-combinator-cases`). An EXACT extend of such a sub-position correctly fires nothing
    // (the matcher returns the subject unchanged → EMIT's no-change guard streams the authored
    // header). Excludes an import tree. Single-compound target only (a descendant/combinator target
    // is a distinct richer shape).
    const isCombinatorSubjectTarget = !treeHasImport
      && !/[>+~ ,]/.test(target)
      && combinatorCompoundTokens(target)?.length === 1
      && [...combinatorSubjectSelectors].some((subjSel) => {
        const tokens = combinatorCompoundTokens(subjSel);
        const tt = combinatorCompoundTokens(target);
        if (tokens === undefined || tt === undefined || tt.length !== 1) {
          return false;
        }
        return tokens.some(level => compoundMultisetSubset(tt[0]!, level));
      });
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
    const isInertNomatch = !treeHasImport
      && !isRootTarget && !isNestedComposedTarget && !isLeadingCompoundTarget
      && !isPseudoCompoundOfRootSubject && !isMatchableCompoundTarget && !isCombinatorSubjectTarget
      && descendantCompoundTokens(target) !== undefined
      && ![...cleanSubjectPaths].some(p => targetCouldMatchPath(target, p))
      && !rootLevelSelectors.has(target);
    if (!isRootTarget && !isNestedComposedTarget && !isLeadingCompoundTarget
      && !isPseudoCompoundOfRootSubject && !isMatchableCompoundTarget
      && !isCombinatorSubjectTarget && !isInertNomatch) {
      return false; // target maps to no addressable subject (root selector or crossing nested path)
    }
    if (extenderSelectors.has(target)) {
      return false; // chaining — deferred to a later increment
    }
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
export function wireSpineExtends(root: Rules, context: Context, collapseNesting: boolean): { headers: Map<Ruleset, Selector>; hoisted: Set<Ruleset> } {
  const subjects: SpineSubject[] = [];
  const instructions: PipelineInstruction[] = [];
  const frameBaseline = context.rulesetFrames.length;

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
    if (local !== undefined && resolved?.ampResolved !== true && !String(local.valueOf()).includes('&')) {
      subjects.push({ ruleset, path, order: orderOf(ruleset) });
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
      instructions.push({
        target,
        // `extendWith` (SOLVE local-apply, fire-detection ONLY — EMIT composes from `path`) is the
        // extender's RESOLVED + NORMALIZED own local (`&.sidebar4` → clean-atom `.type2.sidebar4`),
        // so the produced branch is amp-free and the round-2 fixpoint dedups (no amp-target trap).
        extendWith: extenderLocal ?? target,
        partial: ext.flag === ExtendFlag.All,
        path: [...extenderPath],
        order: orderOf(ruleset)
      });
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
    instructions.push({
      target,
      extendWith: extenderLocal,
      partial: ext.flag === ExtendFlag.All,
      path: [...path],
      order: orderOf(ext)
    });
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
      } else if (isNode(child, N.Rules) && Array.isArray((child as { rules?: Node[] }).rules)) {
        // A nested `Rules` container (the empty-body selector-list-extend surface) — descend so its
        // standalone `Extend` children are gathered. Its own selector (if any) is empty (no output).
        descendChildren((child as { rules: Node[] }).rules, path);
      }
      // At-rules bearing extends are excluded by the eligibility gate, so no descent into them.
    }
  };

  descendChildren(root.rules, []);
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
