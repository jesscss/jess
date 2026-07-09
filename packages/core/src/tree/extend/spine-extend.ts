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
import { Node } from '../node.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { projectSubject, type BucketPath, type EmitContribution, type EmitSubject } from './emit.js';
import type { OutputWriter } from '../util/print.js';
import type { Context } from '../../context.js';
import type { Selector } from '../selector.js';
import { Nil } from '../nil.js';
import { SelectorList } from '../selector-list.js';
import { CompoundSelector, type CompoundSelectorComponent } from '../selector-compound.js';
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
): { headers: Map<Ruleset, Selector>; hoisted: Set<Ruleset> } {
  extendLayerCounter.planRuns++;
  const headers = new Map<Ruleset, Selector>();
  const hoisted = new Set<Ruleset>();
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
    // Only override when the subject actually gained a branch (else stream authored header).
    if (projection.branches.length <= 1) {
      continue;
    }
    const isNested = subject.path.length > 1;
    // A NESTED subject may be overridden ONLY when its projection HOISTS (crossing). A non-hoisted
    // nested subject that gained a same-parent branch is left to the `&`-composition flow-through
    // (an override would double-compose the parent) — the gate keeps such shapes off the spine, so
    // this is a defensive skip.
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

/**
 * Normalize an `&`-resolved selector into CLEAN ATOMS by replacing each `Ampersand` component with
 * its `getResolvedSelector()` components — `[Ampersand→.type2, .sidebar4]` → `[.type2, .sidebar4]`.
 *
 * WHY (the fixpoint amp-target trap — diagnosed 2026-07-08). `Ampersand.eval` (non-append) does NOT
 * structurally substitute `&`; it stores the frame selector on the Ampersand's `_selectorContainer`
 * and returns the node with the AMPERSAND STILL IN THE COMPOUND (its `valueOf` renders `.type2.sidebar4`
 * but the first atom is an `Ampersand`). Round 1 of the extend fixpoint handles that amp fine, but the
 * PRODUCED Or-branch (`.sidebar, .type2.sidebar4`) then carries the amp — and the fixpoint's round-2
 * self-re-application treats that amp-bearing branch as an amp TARGET, tripping `extendAmpersandTarget`
 * → UNSUPPORTED → the whole subject is dropped. Flattening the amp to its resolved atoms HERE (before
 * the pipeline) makes the produced branch amp-free, so round 2 dedups cleanly and the fixpoint
 * terminates. PURE: operates on the `&`-eval COPY this module produced (no source mutation); the
 * validated `extendByIndexOwn` engine is untouched.
 */
function normalizeResolvedAmpersand(selector: Selector): Selector {
  if (!isNode(selector, N.CompoundSelector)) {
    return selector;
  }
  let changed = false;
  const flat: CompoundSelectorComponent[] = [];
  for (const component of selector.value) {
    if (typeof component !== 'string' && isNode(component, N.Ampersand)) {
      const resolved = component.getResolvedSelector?.();
      if (resolved && !(resolved instanceof Nil)) {
        if (isNode(resolved, N.CompoundSelector)) {
          flat.push(...resolved.value);
        } else if (isSimpleOrString(resolved)) {
          flat.push(resolved);
        } else {
          return selector; // resolved to a shape we can't flatten cleanly — leave amp as-is
        }
        changed = true;
        continue;
      }
      // Unresolved amp — leave as-is (the gate/ownBuilt path handles it).
      flat.push(component);
    } else {
      flat.push(component);
    }
  }
  if (!changed) {
    return selector;
  }
  return new CompoundSelector(flat);
}

/** A value usable as a `CompoundSelectorComponent` (a SimpleSelector node or a string). */
function isSimpleOrString(value: unknown): value is CompoundSelectorComponent {
  return typeof value === 'string' || (value instanceof Node && isNode(value, N.SimpleSelector));
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
  // Reject child/sibling combinators, selector-list commas, and grafts. Descendant space is now
  // allowed (crossing) — the subject-correspondence check confirms it maps to a nested subject.
  return !/[>+~,()]/.test(text);
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
export function isSpineExtendTopology(root: Rules, collapseNesting: boolean): boolean {
  const targets = new Set<string>();
  const rootLevelSelectors = new Set<string>();
  const extenderSelectors = new Set<string>();
  // Composed-path strings of EVERY subject (root: local; nested: `.header .header-nav`). A crossing
  // target (`.header .header-nav`) resolves to a NESTED subject's composed path — admitted so the
  // hoist path (`collapseNesting:true`, verbatim override) can rewrite it (increment 3).
  const subjectComposedPaths = new Set<string>();
  let ok = true;

  // Root-level subject selectors (a plain target resolves to one of these — increment 2 path).
  for (const child of root.rules) {
    if (isNode(child, N.Ruleset)) {
      const local = flatLocalSelector(child);
      if (local !== undefined) {
        rootLevelSelectors.add(String(local.valueOf()));
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
      // A COMBINATOR `&` local (`&.sidebar4`, `&:hover`) is now RESOLVED + NORMALIZED by the
      // gather's scoped `&`-eval (increment 7) → clean-atom `.type2.sidebar4`, so an extender under
      // it composes correctly (round 1 AND the round-2 fixpoint) and is ADMITTED. An `&`-APPEND
      // local (`&-modifier`) still DISQUALIFIES: its anonymous suffix materializes only via
      // `Ampersand.evalNode`'s `appendValue` path (eval-pass frame state the gather does not fully
      // reproduce). Track APPEND-ness only.
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
    // It is admitted ONLY under `collapseNesting:true` — the hoist verbatim-override PRECONDITION
    // is that the nested block already emits at ROOT (which holds only under collapse). In expanded
    // mode the block stays nested and hoist would need block relocation (deferred) → stays on eval.
    const isNestedComposedTarget = collapseNesting && subjectComposedPaths.has(target) && target.includes(' ');
    if (!isRootTarget && !isNestedComposedTarget) {
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
export function wireSpineExtends(root: Rules, context: Context): { headers: Map<Ruleset, Selector>; hoisted: Set<Ruleset> } {
  const subjects: SpineSubject[] = [];
  const instructions: PipelineInstruction[] = [];
  const frameBaseline = context.rulesetFrames.length;

  // Recursive document-wide gather: descend rulesets, tracking the ancestor Selector `path`
  // (the extender's full bucket path — parse-tree nodes carry no `.parent`, so the walk is the
  // only source of ancestry).
  //
  // SCOPED `&`-EVAL + NORMALIZE (increment 7). An `&`-bearing local (`&.sidebar4`, `&:hover`) is NOT
  // substituted by the pure structural compose. So PUSH each ancestor ruleset onto
  // `context.rulesetFrames` as the walk descends (save/restore, exactly the spine's own descent) and
  // RESOLVE an `&`-bearing local via `selector.eval(context)` (P1's `&`-resolution — reads the live
  // frame, returns a COPY, no source mutation), then NORMALIZE the resolved amp to clean atoms
  // (`normalizeResolvedAmpersand`) so the fixpoint's produced branch is amp-free (the round-2
  // amp-target trap). The resolved+normalized compound (`.type2.sidebar4`) is the full composed
  // form, so its bucket path is `[resolved]` (it REPLACES the ancestor chain, not appends).
  const resolveLocal = (ruleset: Ruleset): { selector: Selector; ampResolved: boolean } | undefined => {
    const local = flatLocalSelector(ruleset);
    if (local === undefined) {
      return undefined;
    }
    if (!String(local.valueOf()).includes('&')) {
      return { selector: local, ampResolved: false };
    }
    const evaled = local.eval(context);
    if (isThenable(evaled) || evaled instanceof Nil) {
      return undefined; // async / nil `&`-resolution — exclude (gate/ownBuilt handles it)
    }
    return { selector: normalizeResolvedAmpersand(evaled), ampResolved: true };
  };

  const gatherRuleset = (ruleset: Ruleset, parentPath: readonly Selector[]): void => {
    // Resolve THIS ruleset's local against the ALREADY-pushed ancestors. An `&`-resolved local is
    // the FULL composed form (ancestor INCLUDED), so it REPLACES the ancestor chain — its path is
    // `[resolvedLocal]`, NOT `parentPath + resolvedLocal` (that would double `.type2`). A structural
    // (non-`&`) local APPENDS to the ancestor path.
    const resolved = resolveLocal(ruleset);
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
      instructions.push({
        target,
        // `extendWith` (SOLVE local-apply, fire-detection ONLY — EMIT composes from `path`) is the
        // extender's RESOLVED + NORMALIZED own local (`&.sidebar4` → clean-atom `.type2.sidebar4`),
        // so the produced branch is amp-free and the round-2 fixpoint dedups (no amp-target trap).
        extendWith: local ?? target,
        partial: ext.flag === ExtendFlag.All,
        path: [...path],
        order: orderOf(ruleset)
      });
    }
    // Push this ruleset's frame for its subtree's `&`-resolution, descend, then pop (save/restore).
    context.rulesetFrames.push(ruleset);
    descendChildren(ruleset.rules, path);
    context.rulesetFrames.length = Math.max(frameBaseline, context.rulesetFrames.length - 1);
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
  context.rulesetFrames.length = frameBaseline; // restore (belt-and-suspenders)
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
