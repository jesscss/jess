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
import type { Node } from '../node.js';
import { type MaybePromise } from '@jesscss/awaitable-pipe';
import { projectSubject, type BucketPath, type EmitContribution, type EmitSubject } from './emit.js';
import type { OutputWriter } from '../util/print.js';
import type { Selector } from '../selector.js';
import { Nil } from '../nil.js';
import { SelectorList } from '../selector-list.js';
import { spanStartOf } from '../util/provenance.js';
import { asExtendSelectorNode } from '../util/extend-roots.js';
import { Extend, ExtendFlag } from '../extend.js';
import { ExtendList } from '../extend-list.js';
import { runSubjectProjection, type PipelineInstruction, type PipelineSubject } from './pipeline.js';

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
  instructions: PipelineInstruction[]
): Map<Ruleset, Selector> {
  extendLayerCounter.planRuns++;
  const headers = new Map<Ruleset, Selector>();
  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i]!;
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
    if (projection.hoistToRoot) {
      throw new Error(
        'spine extend: hoistToRoot not wired (crossing is a later increment; the gate excludes it)'
      );
    }
    // Only override when the subject actually gained a branch (else stream authored header).
    if (projection.branches.length > 1) {
      // Build the multi-branch header NODE so the normal serializer emits `,\n` (the
      // eval-path byte shape) — never a re-parsed string. The projected branches are the
      // authored own form + composed contributions, document-order sorted + deduped (EMIT).
      // NOTE: `projection.branches[0]` is the subject's OWN composed form (its full bucket
      // path composed); for a nested subject the normal serializer would ALSO compose the
      // parent frame, so we install ONLY the subject's LOCAL branch shape — handled by the
      // caller keying the override to the subject's local emit position.
      headers.set(subject.ruleset, new SelectorList(projection.branches as SelectorList['value']));
    }
  }
  return headers;
}

/**
 * Extract a ruleset's local selector as a Selector NODE for a flat bucket path, or undefined.
 * At the spine's pre-eval stage a plain selector is a raw STRING (strings-not-nodes model),
 * so a string is materialized to a Selector node (`asExtendSelectorNode`, the same
 * materializer the eval gather uses for string targets, `extend.ts:157`). A Nil / array
 * (multi-selector list surface) / undefined selector returns undefined → the subject stays
 * on the eval path (increment 1 is single-selector root subjects only).
 */
export function flatLocalSelector(ruleset: Ruleset): Selector | undefined {
  const sel = ruleset.selector;
  if (sel === undefined || sel instanceof Nil || Array.isArray(sel)) {
    return undefined;
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
 * True when an extend's TARGET is a SIMPLE find the flat single-subject override handles:
 * a single compound selector against a ROOT-LEVEL subject — NO descendant/child/sibling
 * combinator (a target like `.a .b` matches a NESTED subject the root-child override cannot
 * reach), NO selector-list (`,`) target (multi-subject), NO pseudo/`:is()` graft. Increment 1
 * routes only these; any richer target keeps the whole root on the eval path (byte-identical).
 * Conservative string check on the target's `valueOf` — a combinator/comma/paren disqualifies.
 */
function extendTargetIsSimple(node: Extend): boolean {
  const target = node.target;
  if (target === undefined || target === null) {
    return false;
  }
  const text = String(target.valueOf());
  // Reject descendant/child/sibling combinators, selector-list commas, and grafts.
  return !/[ >+~,()]/.test(text.trim());
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
 * A shape passing this gate is own-buildable by the pipeline with a root-level subject header
 * override; anything else routes to eval.
 */
export function isSpineExtendTopology(root: Rules): boolean {
  const targets = new Set<string>();
  const rootLevelSelectors = new Set<string>();
  const extenderSelectors = new Set<string>();
  let ok = true;

  // Root-level subject selectors (targets must resolve to one of these).
  for (const child of root.rules) {
    if (isNode(child, N.Ruleset)) {
      const local = flatLocalSelector(child);
      if (local !== undefined) {
        rootLevelSelectors.add(String(local.valueOf()));
      }
    }
  }

  // Document-wide walk: collect every extend target (checking simplicity) + every
  // extend-BEARING ruleset's selector (chain detection). At-rule bodies bearing extends
  // disqualify (clause 4).
  const walk = (node: Node, ancestorAmp: boolean): void => {
    if (!ok) {
      return;
    }
    if (isNode(node, N.AtRule) && 'rules' in node && Array.isArray(node.rules) && treeHasExtend(node)) {
      ok = false;
      return;
    }
    let rules: readonly Node[] | undefined;
    let amp = ancestorAmp;
    if (isNode(node, N.Ruleset)) {
      rules = node.rules;
      const local = flatLocalSelector(node);
      // An `&`-bearing local selector (`&.sidebar4`, `&:hover`) needs frame `&`-resolution
      // the direct bucket-path capture does NOT perform — so an extender ON such a path
      // composes wrong. Track amp-ness down the path; disqualify only when it actually bears
      // an extend (a plain `&` ancestor with no extend below is harmless).
      if (local !== undefined && String(local.valueOf()).includes('&')) {
        amp = true;
      }
      const extendNodes = rulesetExtendNodes(node);
      if (extendNodes.length > 0) {
        if (amp) {
          ok = false; // extender on an `&`-bearing path — direct capture can't compose it
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
            targets.add(String(ext.target.valueOf()));
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
        walk(child, amp);
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

  // STRICT SUBJECT CORRESPONDENCE (clauses 2 + 3). Each target must be a ROOT-LEVEL subject, not
  // shadowed by a nested ruleset of the same selector, and not itself an extender (no chaining).
  for (const target of targets) {
    if (!rootLevelSelectors.has(target)) {
      return false; // target's subject is nested / cross-scope — override can't reach it
    }
    if (anyNestedRulesetMatchesSelector(root, target)) {
      return false; // a deeper ruleset shares the target selector — override would miss it
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
export function wireSpineExtends(root: Rules): Map<Ruleset, Selector> {
  const subjects: SpineSubject[] = [];
  const instructions: PipelineInstruction[] = [];

  // Recursive document-wide gather: descend rulesets, tracking the ancestor Selector `path`
  // (the extender's full bucket path — parse-tree nodes carry no `.parent`, so the walk is the
  // only source of ancestry). Collect each ruleset as a candidate subject with its path, and
  // each Extend it bears as an instruction whose `path` is the EXTENDER's bucket path — EMIT
  // composes that relative to the target (`[.type1, .sidebar3]` → `.type1 .sidebar3`), which is
  // exactly why the composed contribution is correct WITHOUT relying on a pre-composed
  // `extendWith` (the flat-only `runEffect` extendWith is bare `.sidebar3` for a nested extender).
  const gatherRuleset = (ruleset: Ruleset, parentPath: readonly Selector[]): void => {
    const local = flatLocalSelector(ruleset);
    const path: readonly Selector[] = local !== undefined ? [...parentPath, local] : parentPath;
    // SUBJECTS are ROOT-LEVEL only (the gate guarantees every target resolves to a root-level
    // subject). A NESTED subject/target is NOT collected: its header composes from its parent's
    // (possibly overridden) header via the existing `&`-composition flow-through — exactly how
    // `extend-clearfix`'s `:is(.clearfix, .foo, .bar):after` falls out of the `.clearfix` header
    // override with NO nested-subject machinery. (EXTENDERS, by contrast, ARE gathered at any
    // depth below — that is the document-wide widening this increment adds.)
    if (local !== undefined && parentPath.length === 0) {
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
      instructions.push({
        target,
        // `extendWith` (SOLVE local-apply) is the extender's OWN local selector; `path` (EMIT
        // compose-relative-to-target) is the full ancestor chain — EMIT owns the composition.
        extendWith: local ?? target,
        partial: ext.flag === ExtendFlag.All,
        path: [...path],
        order: orderOf(ruleset)
      });
    }
    descendChildren(ruleset.rules, path);
  };

  const descendChildren = (children: readonly Node[], path: readonly Selector[]): void => {
    for (const child of children) {
      if (isNode(child, N.Ruleset)) {
        gatherRuleset(child, path);
      }
      // At-rules / nested Rules bearing extends are excluded by the eligibility gate, so no
      // descent into them (defensive omission; the gate guarantees none reach us).
    }
  };

  descendChildren(root.rules, []);
  return composeSpineSubjectHeaders(subjects, instructions);
}

/** Document order of a ruleset = its source span start offset (matches the extend tuple's docOrder). */
function orderOf(ruleset: Ruleset): number {
  const span = spanStartOf(ruleset);
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
