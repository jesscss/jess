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
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { projectSubject, type BucketPath, type EmitContribution, type EmitSubject } from './emit.js';
import type { OutputWriter } from '../util/print.js';
import type { Context } from '../../context.js';
import type { Selector } from '../selector.js';
import { Nil } from '../nil.js';
import { SelectorList } from '../selector-list.js';
import { spanStartOf } from '../util/provenance.js';
import { asExtendSelectorNode } from '../util/extend-roots.js';
import { Extend } from '../extend.js';
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

/** A root-direct-child subject ruleset + its document order (span-start offset). */
export interface FlatSubject {
  ruleset: Ruleset;
  localSelector: Selector;
  order: number;
}

/**
 * The FLAT (root-direct-child) extend orchestration — increment 1's live path. Given the
 * document root's SUBJECT children (each a root-level ruleset with a concrete local
 * selector) and the instructions ALREADY gathered into `context.extends` by the descent's
 * pre-scan (`Extend.runEffect` at each extender's ruleset-enter — the validated eval
 * gather, reused not reimplemented), decide each subject's FINAL Or-branch header.
 *
 * WHY NO DEFERRAL for the flat case (design §4.4.2 baseline, degenerate). The caller
 * PRE-SCANS all root children before emitting any, so every instruction is gathered before
 * any subject emits — `Reaching(S)` is fully known at each subject's emit position, so the
 * header is FINAL inline. Buffer-then-flush's deferral (§4.4.1) is unnecessary here; the
 * `bufferSubjectDecls`/`flushBufferedSubject` unit still ASSEMBLES the block, we just emit
 * it at the subject's own position. (A NESTED subject whose contribution comes from a
 * later-emitting extender is the case that genuinely needs deferral — a later increment.)
 *
 * Returns a map: subject ruleset → its composed header (`,\n`-joined Or-branches, the
 * eval-path byte shape). ONLY subjects that gained ≥1 extra branch appear; a subject with
 * no reaching extend is absent (it streams its authored header unchanged — the §4.0
 * `Reaching(S)=∅` inline case). A subject whose projection would HOIST (crossing) throws
 * fail-loud (crossing is a later increment).
 *
 * Bucket paths are trivial at this topology: every subject/extender is a root child, so its
 * path is `[localSelector]` (length 1) — no ancestor chain to compose. This is exactly the
 * shape the pipeline's `runExtendPipeline` consumes; we reuse it (SOLVE fixpoint + EMIT
 * projection, validated) and format its ordered `branches` with the `,\n` join.
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.0 §4.2 §4.4.2
 */
export function composeFlatSubjectHeaders(
  context: Context,
  subjects: FlatSubject[]
): Map<Ruleset, Selector> {
  extendLayerCounter.planRuns++;
  const instructions: PipelineInstruction[] = [];
  for (const [target, extendWith, partial, , , documentOrder] of context.extends) {
    // The extender's bucket path is its own composed selector as a single root-level level.
    // `extendWith` is the extender's already-composed selector (the eval gather resolved `&`
    // + parent composition), so at the flat topology its path is just `[extendWith]`.
    instructions.push({
      target,
      extendWith,
      partial,
      path: [extendWith],
      order: documentOrder ?? 0
    });
  }

  const headers = new Map<Ruleset, Selector>();
  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i]!;
    const pipelineSubject: PipelineSubject = {
      id: `s${i}`,
      path: [subject.localSelector],
      order: subject.order
    };
    extendLayerCounter.solveRuns++;
    const { projection, ownBuilt } = runSubjectProjection(pipelineSubject, instructions);
    if (!ownBuilt || !projection) {
      // A shape the own engine can't build — leave the subject on its authored header; the
      // eval-path fallback (still live in P3) covers it. (Flat exact extends are own-built.)
      continue;
    }
    if (projection.hoistToRoot) {
      throw new Error(
        'spine extend flat: hoistToRoot not wired (P3 increment 1 handles root-level non-crossing only)'
      );
    }
    // Only override when the subject actually gained a branch (else stream authored header).
    if (projection.branches.length > 1) {
      // Build the multi-branch header NODE so the normal serializer emits `,\n` (the
      // eval-path byte shape) — never a re-parsed string. The projected branches are the
      // authored own form + composed contributions, document-order sorted + deduped (EMIT).
      headers.set(subject.ruleset, new SelectorList(projection.branches as SelectorList['value']));
    }
  }
  return headers;
}

/**
 * Gather extend instructions from a root-child extender ruleset by running the VALIDATED
 * eval gather (`Extend.runEffect`) against the LIVE frame — reused, not reimplemented (A1).
 * The caller has confirmed `context.extendRoots` has the document root registered+pushed
 * and pushes `extender` onto `context.rulesetFrames` so `runEffect` composes the extender's
 * selector against the correct parent frame (the flagged frame-composition risk). Runs the
 * effect for every `Extend` node in the extender's selector; async-safe (chains).
 */
export function gatherExtenderInstructions(
  context: Context,
  extendNodes: readonly Extend[]
): MaybePromise<void> {
  const run = (i: number): MaybePromise<void> => {
    if (i >= extendNodes.length) {
      return undefined;
    }
    const effect = extendNodes[i]!.runEffect(context);
    return isThenable(effect) ? effect.then(() => run(i + 1)) : run(i + 1);
  };
  return run(0);
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

/** Every Extend effect in a ruleset's body has a simple target (see `extendTargetIsSimple`). */
function rulesetExtendsAreSimple(ruleset: Ruleset): boolean {
  return rulesetExtendNodes(ruleset).every(extendTargetIsSimple);
}

/**
 * True when this eligibility check admits the FLAT topology only: every root child that
 * bears extends is a plain root-level Ruleset (concrete local selector), and no extend
 * subject/extender is nested inside another container. Increment 1 handles ONLY this shape;
 * anything nested falls to the eval path (unchanged, byte-identical). Conservative: any
 * non-flat extend shape anywhere → return false (whole root stays on eval).
 */
export function isFlatExtendTopology(root: Rules): boolean {
  const targets = new Set<string>();
  const rootChildSelectors = new Set<string>();

  for (const child of root.rules) {
    if (isNode(child, N.Ruleset)) {
      const local = flatLocalSelector(child);
      if (treeHasExtend(child) && local === undefined) {
        return false; // amp-only / interpolated root child bearing extends — not flat
      }
      if (local !== undefined) {
        rootChildSelectors.add(String(local.valueOf()));
      }
      // Every extend BORNE by this root child must be a SIMPLE target (single compound, no
      // combinator/list/graft) — the only find the flat single-subject override applies.
      if (!rulesetExtendsAreSimple(child)) {
        return false;
      }
      collectSimpleTargets(child, targets);
      // A nested ruleset/at-rule INSIDE this root child bearing an extend is deferral
      // territory (not flat) — its extenders/subjects are not root-direct children.
      for (const grand of child.rules) {
        const isContainer = isNode(grand, N.Ruleset) || (isNode(grand, N.AtRule) && 'rules' in grand);
        if (isContainer && treeHasExtend(grand)) {
          return false;
        }
      }
    } else if ((isNode(child, N.AtRule) || isNode(child, N.Rules)) && treeHasExtend(child)) {
      // Extends inside an at-rule / nested Rules wrapper (a `.a:extend(.b)` reaching INTO a
      // `@media` subject, etc.) are NOT the flat root case — the root-child override cannot
      // reach a nested subject. Route the whole root to eval.
      return false;
    }
  }

  // The selectors of root children that THEMSELVES bear an extend (extenders) — used to
  // detect CHAINING (a target that is another extender's subject).
  const extenderSelectors = new Set<string>();
  for (const child of root.rules) {
    if (isNode(child, N.Ruleset) && treeHasExtend(child)) {
      const local = flatLocalSelector(child);
      if (local !== undefined) {
        extenderSelectors.add(String(local.valueOf()));
      }
    }
  }

  // STRICT SUBJECT CORRESPONDENCE. The flat override only rewrites ROOT-DIRECT-CHILD subject
  // headers, so every extend TARGET must resolve to a root-child ruleset's own selector — and
  // NOT to any deeper (nested) ruleset that would also be a subject the override misses. If a
  // target matches no root child, or ALSO matches a nested selector, route to eval.
  for (const target of targets) {
    if (!rootChildSelectors.has(target)) {
      return false; // target's subject is not a root child (nested / cross-scope)
    }
    if (anyNestedRulesetMatchesSelector(root, target)) {
      return false; // a deeper ruleset shares the target selector — override would miss it
    }
    // CHAINING: a target whose subject is ITSELF an extender (`.c:extend(.b)` where
    // `.b:extend(.a)`) needs the transitive fixpoint's cross-subject ordering — deferred to a
    // later increment. Keep chains on the eval path (byte-identical) so increment 1 stays the
    // simplest non-chained shape.
    if (extenderSelectors.has(target)) {
      return false;
    }
  }
  return true;
}

/** Collect the target strings of a ruleset's direct Extend/ExtendList children. */
function collectSimpleTargets(ruleset: Ruleset, out: Set<string>): void {
  for (const node of rulesetExtendNodes(ruleset)) {
    if (node.target !== undefined && node.target !== null) {
      out.add(String(node.target.valueOf()));
    }
  }
}

/**
 * True if any ruleset NESTED below the root's direct children has a local selector equal to
 * `selector` — i.e. a subject the flat root-child override would fail to rewrite. Walks the
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
 * Collect the Extend/ExtendList EFFECT nodes from a ruleset's DIRECT body children. `:extend`
 * (both `.b:extend(.a)` selector sugar and `&:extend(.a)` body form) lands as an invisible
 * Extend / ExtendList body child; its `runEffect` is the validated eval gather.
 */
function collectExtendEffectNodes(ruleset: Ruleset): Extend[] {
  return rulesetExtendNodes(ruleset);
}

/**
 * FLAT extend wire-in (P3 increment 1) — the full live path for root-direct-child subjects.
 *
 * PRE-SCAN + GATHER: register the document root as the extend root (replicating the eval
 * registration `rules.ts:5417`) and, for each root-child extender ruleset, push its frame
 * onto `context.rulesetFrames` and run its Extend effects (`runEffect`, the validated gather
 * — A1) so `context.extends` is populated BEFORE any subject emits. Because the scan
 * precedes emit, `Reaching(S)` is fully known at every subject's position (§4.0), so the
 * header is final inline — no deferral (§4.4.2 degenerate; see `composeFlatSubjectHeaders`).
 *
 * COMPOSE: build the per-subject header override map (`composeFlatSubjectHeaders`).
 *
 * The caller (`renderRootViaSpine`) installs the returned map on `options.spineExtendHeaders`
 * for the emit descent, then RESTORES the extend-root/frame state. Async-safe: `runEffect`
 * can be async (an extender selector reading an async value), so the gather chains.
 *
 * @see UNIFIED-EVAL-EMIT-DESIGN.md §4.0 §4.2 §4.3 §4.4.2
 */
export function wireFlatExtends(root: Rules, context: Context): MaybePromise<Map<Ruleset, Selector>> {
  // Register + push the document root as the extend root (eval does this at registration;
  // the spine skips eval, so do the minimal equivalent here). Idempotent-guarded like eval.
  if (!context.extendRoots.root) {
    context.extendRoots.registerRoot(root);
  }
  context.extendRoots.pushExtendRoot(root);

  const subjects: FlatSubject[] = [];
  for (const child of root.rules) {
    if (isNode(child, N.Ruleset)) {
      const local = flatLocalSelector(child);
      if (local !== undefined) {
        subjects.push({ ruleset: child, localSelector: local, order: orderOf(child) });
      }
    }
  }

  // GATHER: run each extender's effects with its frame live so `runEffect` composes the
  // extender selector against the correct parent (the flagged frame-composition risk).
  const gatherChild = (i: number): MaybePromise<void> => {
    if (i >= subjects.length) {
      return undefined;
    }
    const ruleset = subjects[i]!.ruleset;
    const effects = collectExtendEffectNodes(ruleset);
    if (effects.length === 0) {
      return gatherChild(i + 1);
    }
    context.rulesetFrames.push(ruleset);
    const done = gatherExtenderInstructions(context, effects);
    const pop = (): MaybePromise<void> => {
      context.rulesetFrames.pop();
      return gatherChild(i + 1);
    };
    return isThenable(done) ? done.then(pop) : pop();
  };

  const finish = (): Map<Ruleset, Selector> => {
    context.extendRoots.popExtendRoot();
    return composeFlatSubjectHeaders(context, subjects);
  };

  const gathered = gatherChild(0);
  return isThenable(gathered) ? gathered.then(finish) : finish();
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
