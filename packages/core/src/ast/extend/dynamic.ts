/**
 * DYNAMIC — the extend facts the one render walk records, and the deferred fold that
 * applies them (EXTEND-SEMANTICS §1a, ledger X12).
 *
 * A rule a mixin call, a detached-ruleset call, an `@if`/loop body or an in-rule
 * `@import` places is reached only by the walk, so its extend facts are recorded there
 * ({@link DynamicExtendState}) and folded once the walk is done: header slots are
 * rewritten in place, and nested output is restructured where the re-solved plan moves
 * a block or splits an exact extender off it (ledger X22,
 * {@link restructureNestedSlots}): the walk reserves, in each enclosing rule's hoist
 * queue, the chunk where the rule lands if it rises that far ({@link NestedLanding}),
 * and records where its block, its body and its child blocks start. Nothing is
 * evaluated: the moved and copied bytes are the ones the walk wrote.
 */

import { branchTextIsPlaceholder, selectorBranchHasInterp } from '../nodes.js';
import type { ExtendInstruction, Ruleset, SelectorList, Stylesheet } from '../nodes.js';
import type { AtRuleBlock } from '../at-rule.js';
import type { SelectorUnits } from '../selector-text.js';
import { compressSelectorHeader } from '../compress.js';
import { computeExtends } from './emit.js';
import type { ExtendPlacementResults, ExtendResults, NestedRulePlan } from './emit.js';
import { branchFromSelector, branchSharesAtom, collectBranchAtoms, descendantBranch, levelFromSelectorList, textSimple } from './ir.js';
import type { Branch, Level } from './ir.js';
import { plannedParent, recordAstExtendProfile } from './plan.js';
import type { AtRuleScopes, ExtendBoundary, PlanInstruction, PlanOverlay, PlanSubject } from './plan.js';

const INDENT = '  ';

/** The chunks reserved where a rule rising out of `k + 1` enclosing rule blocks lands, innermost first. */
export interface NestedLanding {
  at: number[];

  /** The block depth the rule lands at. */
  depth: number[];

  /** The at-rules it rises out of on the way, outermost first, re-opened where it lands. */
  wrappers: Array<ReadonlyArray<{ readonly node: { readonly name: string }; readonly prelude: string }> | null>;
}

/**
 * The extend projection of one render placement: the static projection for the
 * static placement (`token` undefined), else that placement's own — null when the
 * plan projected nothing there. Never the static projection for a placed copy: it
 * holds the static copy of the same canonical rules (#359).
 */
export function placementProjection(
  ext: ExtendResults,
  token: object | undefined
): ExtendResults | ExtendPlacementResults | null {
  return token === undefined ? ext : ext.byPlacement?.get(token) ?? null;
}

/**
 * Drop every placeholder branch from a composed header; `null` when that leaves
 * nothing, which is how a placeholder rule emits no output of its own.
 *
 * This runs on the FLAT composed header rather than on the authored selector
 * list on purpose: after extend folds an extender in, the header is longer than
 * the authored list, and the extender branch is exactly the one that must
 * survive. Filtering by text keeps that alignment free.
 */
export function withoutPlaceholders(header: string[]): string[] | null {
  if (!header.some(branchTextIsPlaceholder)) {
    return header;
  }
  const vis = header.filter(branch => !branchTextIsPlaceholder(branch));
  return vis.length > 0 ? vis : null;
}

/**
 * [import:reference] Filter a rule's composed header down to its VISIBLE branches.
 * Returns `null` when the rule emits nothing (every branch hidden) — the caller then
 * skips the block entirely. A rule with no hidden branch (the overwhelming common
 * case: any document with no `(reference)` import) returns `header` unchanged, so the
 * serializer stays byte-identical. Shared by the live walk (`visibleHeader`) and the
 * deferred fold, so the two never diverge.
 *
 *  - extend folded a per-branch mask (`hiddenByRule`, aligned 1:1 with the FLAT
 *    header): keep the branches whose mask bit is false. This also handles a VISIBLE
 *    rule that received a hidden extender branch (drop just that branch).
 *  - no mask, and the rule is placed inside a `(reference)` import (`hidden`) where
 *    extend never changed it: all its (seed-only) branches are hidden → drop it.
 *    Hiding follows the placement, not the canonical rule: the same rule reached by a
 *    plain import, or called as a mixin from outside the reference import, is visible.
 */
export function visibleHeaderCore(
  rule: Ruleset,
  header: string[],
  projection: ExtendResults | ExtendPlacementResults | null,
  hidden: boolean
): string[] | null {
  const mask = projection?.hiddenByRule.get(rule);
  if (mask?.length === header.length) {
    const vis = header.filter((_, i) => mask[i] !== true);
    return vis.length > 0 ? withoutPlaceholders(vis) : null;
  }
  if (hidden && projection?.flatByRule.has(rule) !== true) {
    return null;
  }
  return withoutPlaceholders(header);
}

/**
 * The header the deferred rewrite writes for a nested slot: its re-solved own-local
 * header, or null for a hidden `(reference)` rule left with no visible branch. A
 * flattened plan keeps the header the walk wrote: {@link restructureNestedSlots} moves
 * the block where it lands.
 */
export function nestedSlotHeader(ext: ExtendResults, slot: DynExtendSlot): string[] | null {
  const projection = placementProjection(ext, slot.token);
  const plan = projection?.nestedPlan.get(slot.rule);
  if (plan === undefined || plan.flatten) {
    return slot.hiddenRef && plan === undefined ? null : slot.emitted;
  }
  return slot.hiddenRef ? visibleHeaderCore(slot.rule, plan.header, projection, true) : withoutPlaceholders(plan.header);
}

/** Reserve, at the current block depth, the chunk a rule rising this far lands in. */
export function reserveLanding(landing: NestedLanding | null, chunks: string[], depth: number, wrappers: NestedLanding['wrappers'][number]): void {
  if (landing === null) {
    return;
  }
  landing.at.push(chunks.length);
  landing.depth.push(depth);
  landing.wrappers.push(wrappers);
  chunks.push('');
}

const isClose = (chunk: string): boolean => chunk === '}\n' || chunk === '}';
const isBlank = (chunk: string): boolean => chunk.trim() === '';

/** The chunk after the block that starts at `from`. */
function blockEndFrom(chunks: readonly string[], from: number): number {
  let depth = 0;
  for (let i = from; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (chunk === ' {\n' || chunk === '{') {
      depth++;
    } else if (isClose(chunk) && --depth === 0) {
      return i + 1;
    }
  }
  return chunks.length;
}

/** `text` with `levels` indent levels taken off each line that has them. */
function dedent(text: string, levels: number): string {
  return levels <= 0 ? text : text.replace(new RegExp(`(^|\\n)${INDENT.repeat(levels)}`, 'g'), '$1');
}

/** A block's bytes as the nested writer writes them at indent `idt`. */
function blockText(header: readonly string[], body: string, idt: string, compress: boolean): string {
  return compress
    ? `${compressSelectorHeader(header.join(','))}{${body.endsWith(';') ? body.slice(0, -1) : body}}`
    : `${idt}${header.join(',\n' + idt)} {\n${body}${idt}}\n`;
}

/** The rule's direct declarations and comments: its body without its child blocks. */
function directText(chunks: readonly string[], slot: DynExtendSlot, compress: boolean): string {
  const close = slot.blockEnd - (slot.indent !== '' && !compress ? 2 : 1);
  let text = '';
  let k = 0;
  for (let i = slot.body; i < close; i++) {
    if (slot.kids![k] === i) {
      i = blockEndFrom(chunks, i) - 1;
      k++;
    } else {
      text += chunks[i]!;
    }
  }

  /* A statement comment is trivia (ledger G24), not one of the declarations a split carries. */
  return compress ? text : text.replace(/^ *\/\*[\s\S]*?\*\/\n/gm, '');
}

/**
 * Blank the blocks the moved range `[from, to)` leaves empty, innermost first. Under
 * compress, a block it leaves ending in a declaration drops that declaration's `;`,
 * as the writer drops the last one before a `}`.
 */
function dropEmptied(chunks: string[], enclosing: readonly number[], from: number, to: number, compress: boolean): void {
  for (let k = enclosing.length - 2; k >= 0; k -= 2) {
    let close = to;
    while (close < chunks.length && isBlank(chunks[close]!)) {
      close++;
    }
    let last = from - 1;
    while (last >= enclosing[k + 1]! && isBlank(chunks[last]!)) {
      last--;
    }
    if (close === chunks.length || !isClose(chunks[close]!) || last >= enclosing[k + 1]!) {
      if (compress && isClose(chunks[close] ?? '') && chunks[last] === ';') {
        /* ponytail: a custom property keeps its last `;` where the writer closes the block; one moved out from after it does not. */
        chunks[last] = '';
      }
      return;
    }
    from = enclosing[k]!;
    to = close + 1;
    chunks.fill('', from, to);
  }
}

/** Write `text`, a block `slot` wrote, where its landing is reserved for a rule rising `bubble` blocks. */
function land(chunks: string[], slot: DynExtendSlot, bubble: number, text: string, compress: boolean): void {
  const landing = slot.landing!;
  const depth = slot.indent.length / INDENT.length;
  const level = Math.min(bubble, landing.at.length) - 1;
  const wrappers = landing.wrappers[level] ?? [];
  const base = landing.depth[level]!;
  let open = '';
  let close = '';
  for (let w = 0; w < wrappers.length; w++) {
    const idt = compress ? '' : INDENT.repeat(base + w);
    const { node, prelude } = wrappers[w]!;
    const sep = prelude === '' ? '' : compress && prelude.charCodeAt(0) === 0x28 /* ( */ ? '' : ' ';
    open += `${idt}${node.name}${sep}${prelude}${compress ? '{' : ' {\n'}`;
    close = `${idt}${compress ? '}' : '}\n'}${close}`;
  }
  chunks[landing.at[level]!] += open + (compress ? text : dedent(text, depth - base - wrappers.length)) + close;
}

/**
 * Apply each nested slot's re-solved plan where it restructures the block the walk
 * wrote (ledger X22): a flatten moves the block where it lands, with its hoisted
 * header; an exact extender that cannot carry the block's child rules gets a block of
 * its own with the block's direct declarations (§7b), beside the block or, for one
 * that shares no level with the block's ancestors, where the block would land at the
 * top. A slot the walk did not track keeps what the walk wrote, header included.
 */
export function restructureNestedSlots(chunks: string[], slots: readonly DynExtendSlot[], ext: ExtendResults | null, compress: boolean): void {
  for (const slot of slots) {
    if (slot.hiddenRef && slot.nested && chunks[slot.chunkIndex] === '') {
      /* A hidden `(reference)` block the fold revealed nothing in goes, with the blocks it leaves empty. */
      chunks.fill('', slot.mark, slot.blockEnd);
      if (slot.enclosing !== null) {
        dropEmptied(chunks, slot.enclosing, slot.mark, slot.blockEnd, compress);
      }
      continue;
    }
    const projection = ext !== null && slot.nested && slot.walked !== null ? placementProjection(ext, slot.token) : null;
    const plan = projection?.nestedPlan.get(slot.rule);
    if (plan === undefined) {
      continue;
    }
    if (plan.flatten) {
      if (slot.walked?.flatten !== true && slot.landing !== null) {
        const header = visibleHeaderCore(slot.rule, plan.hoistNested ? plan.header : projection!.hoistHeader.get(slot.rule) ?? [], projection, slot.hiddenRef);
        chunks[slot.chunkIndex] = header === null ? '' : compress ? compressSelectorHeader(header.join(',')) : header.join(',\n' + slot.indent);
        const text = header === null ? '' : chunks.slice(slot.mark, slot.blockEnd).join('');
        chunks.fill('', slot.mark, slot.blockEnd);
        if (text !== '') {
          land(chunks, slot, plan.hoistBubble ?? 1, text, compress);
        }
        dropEmptied(chunks, slot.enclosing!, slot.mark, slot.blockEnd, compress);
      } else if (slot.hiddenRef && slot.walked?.flatten !== true) {
        chunks.fill('', slot.mark, slot.blockEnd);
      }
      continue;
    }
    const known = new Set([...slot.walked?.splits ?? [], ...slot.walked?.rootSplits ?? []].map(h => h.join(',')));
    const splits = plan.splits.filter(h => !known.has(h.join(',')));
    const roots = (plan.rootSplits ?? []).filter(h => !known.has(h.join(',')));
    if (splits.length === 0 && roots.length === 0) {
      continue;
    }
    if (slot.kids === undefined || (roots.length > 0 && slot.landing === null)) {
      /* ponytail: no record to split from; the walk's header stands, extender and all. */
      chunks[slot.chunkIndex] = compress ? compressSelectorHeader(slot.emitted.join(',')) : slot.emitted.join(',\n' + slot.indent);
      continue;
    }
    const direct = directText(chunks, slot, compress);
    if (isBlank(direct)) {
      continue;
    }
    for (const header of splits) {
      chunks[slot.blockEnd - 1] += blockText(header, direct, slot.indent, compress);
    }
    for (const header of roots) {
      land(chunks, slot, Number.MAX_SAFE_INTEGER, blockText(header, direct, slot.indent, compress), compress);
    }
  }
}

/**
 * [extend/dynamic] One recorded target header slot: the render-buffer chunk holding a
 * rule's emitted selector header, plus everything needed to recompose it once the
 * deferred extend fold knows the rule's complete extended selector. Keyed per EMISSION
 * (`token` distinguishes loop/mixin iterations that share one canonical Ruleset node).
 */
export interface DynExtendSlot {
  rule: Ruleset;
  token: object | undefined;
  chunkIndex: number;
  indent: string;
  hoistMode: boolean;

  /** The visible header branch texts actually emitted into the chunk. Serves as both
   * the change-detection baseline and the fallback header when the re-solve leaves
   * this rule unchanged. */
  emitted: string[];

  /** [import:reference] The rule was emitted inside a `(reference)` import: its own
   * seed branch is HIDDEN, so if no visible extender folds in, its block (chunks
   * `chunkIndex`…`blockEnd`) is blanked; otherwise its header is rewritten to the
   * visible extender branches only. */
  hiddenRef: boolean;

  /** The hidden rule had no visible branch when the walk emitted it: its block is
   * RESERVED for an extend the fold may still fold in, and blanked when none does. */
  reserved: boolean;

  /** Exclusive end of the block's chunk range (for blanking a hidden-ref rule the
   * fold leaves with no visible branch). */
  blockEnd: number;

  /** The header was emitted by the NESTED writer (`writeNestedRule`): the deferred
   * rewrite recomposes it from the re-solved NESTED projection (own-local `nestedPlan`
   * header), not the flat composed header. */
  nested: boolean;

  /** [nesting] What the deferred fold restructures a nested block from ({@link restructureNestedSlots}); -1, null and undefined for a flat slot. */
  mark: number;
  body: number;
  kids: number[] | null | undefined;
  enclosing: number[] | null;
  landing: NestedLanding | null;
  walked: NestedRulePlan | null | undefined;
}

/** [extend/dynamic] Facts collected during the one render walk for the deferred fold. */
export interface DynamicExtendState {
  root: Stylesheet;

  /** The pre-walk STATIC overlay (reference/static imported subjects) this render's
   * deferred fold must re-include alongside the dynamic facts. */
  baseOverlay: PlanOverlay;

  /** At-rule scope ids shared by the walk and the deferred fold's planner. */
  atRuleScopes: AtRuleScopes;

  /** The at-rule scope the walk is currently emitting into (EXTEND-SEMANTICS §8). */
  scope: number[];

  /** The sheet boundary the walk is currently emitting (a composed module or a
   * `(reference)` sheet): the import planner's, by import placement (`Emit.importPlacements`)
   * for a `(reference)` sheet and by module identity for a `@compose`. */
  boundary: ExtendBoundary | null;
  moduleBoundaries: Map<string, ExtendBoundary>;

  /**
   * The flat writer's open rules, outermost first: each rule, its composed header,
   * and how its extend path starts (`PATH_NESTED` / `PATH_ROOT` / `PATH_OPAQUE`).
   * The selector IR of a path is built only when a recorded fact reads it
   * (`dynamicPathAt`), then kept in `pathMemo`.
   */
  pathRules: Ruleset[];
  pathHeaders: string[][];
  pathKinds: number[];
  pathMemo: Array<Level[] | undefined>;

  /** The walk's one resolution of an open rule's interpolated selector, when it has one
   * ({@link resolvedSelectorList}); its selector IR is built from it. */
  pathSelectors: Array<SelectorList | undefined>;

  /** The subject recorded for an open rule the nested writer records, or a stand-in for a planned one ({@link nestedSubjectParent}). */
  pathSubjects: Array<PlanSubject | undefined>;

  /** Selector IR built once per canonical node, however often the walk places it: a
   * rule's own level, and an `:extend()`'s target branches. */
  ownLevels: Map<Ruleset, Level>;
  targetBranches: Map<ExtendInstruction, Branch[]>;

  /** Hidden `(reference)` rules a walk-recorded extend may still reveal, and the
   * hidden rules enclosing them (#355). Null when nothing can be revealed. */
  revealRules: ReadonlySet<Ruleset> | null;
  revealAncestors: ReadonlySet<Ruleset> | null;

  /** Hidden at-rules around the rules in `revealRules`, and the chunk ranges of those
   * the walk wrote only as reserved containers (parallel arrays). */
  revealAtRules: ReadonlySet<AtRuleBlock> | null;
  containerStarts: number[];
  containerEnds: number[];

  /** Rules already accounted for statically (main + static imported preflight); a
   * rule outside this set is a dynamic emission whose facts are recorded at emit. */
  staticRules: Set<Ruleset>;

  /** The extend pre-pass's resolved selector lists ({@link EvalSession.resolvedSelectors}). */
  resolvedSelectors: ReadonlyMap<SelectorList, SelectorList>;

  /** {@link EvalSession.resolvedUnits}. */
  resolvedUnits: ReadonlyMap<SelectorList, SelectorUnits>;

  /** The import placements the walk issued, which the static plan never projected:
   * a rule they place is a dynamic emission even when `staticRules` holds it, since
   * the plan holds it at another copy of its sheet. */
  walkPlacements: Set<object> | null;
  subjects: PlanSubject[];
  instructions: PlanInstruction[];
  slots: DynExtendSlot[];
  order: number;

  /** [extend/dynamic] Side channel: the chunk index (and indent) of the header
   * `flushBlock` most recently PUT, or -1 when it reopened a merged block / wrote no
   * header. The rule-emitting caller reads it to register a target slot. */
  pendingHeaderChunk: number;
  pendingHeaderIndent: string;
}

/**
 * [extend/dynamic] Build a selector-IR level from ALREADY-COMPOSED header text. Each
 * composed branch becomes one opaque descendant compound — its serialized text is
 * exact, and for a simple-class rule (`.col-1`) it is token-identical to the
 * AST-derived IR. A compound or complex header is held as one opaque compound: it
 * serializes and folds correctly, but a compound target cannot match one of its parts.
 * ponytail: used only where the selector IR is not known — a header composed against
 * a placement the recorder never opened, or an interpolated selector the walk could
 * not resolve as structure ({@link resolvedSelectorList}: a lone `@{name}` that may be
 * a captured list, a resolved `&`, an interpolated ruleset-mixin placement).
 */
export function opaqueLevel(header: readonly string[]): Level {
  return header.map(text => descendantBranch([textSimple(text)]));
}

/** How an open rule's extend path starts (see {@link DynamicExtendState.pathKinds}). */
export const PATH_NESTED = 0; // under the enclosing open rule
export const PATH_ROOT = 1; // at a root context: its own selector alone
export const PATH_OPAQUE = 2; // its header text, held as one opaque level
export const PATH_OPAQUE_NESTED = 3; // its own-local header text, opaque, under the enclosing open rule
export const PATH_ROOT_GUARD = 4; // a root `&` guard block: its own selector alone; its children are root rules

/**
 * [extend/dynamic] Open `rule` on the recorder's path, written with `header`: the
 * flat writer's composed header, or the nested writer's own-local one (`local`).
 * `rooted` — written at a root context; `resolved` — the walk's one resolution of an
 * interpolated selector ({@link resolvedSelectorList}), read in place of the rule's own.
 * Returns the open-rule depth to restore.
 */
export function openDynamicPath(
  dyn: DynamicExtendState,
  rule: Ruleset,
  rooted: boolean,
  header: string[],
  local: boolean,
  resolved: SelectorList | undefined = undefined
): number {
  const depth = dyn.pathRules.length;

  /*
   * Under a root `&` guard block (`& when (…) { … }`), which the nested writer keeps
   * as a lone `&` wrapper, a rule composes as a root rule, as the flat writer has it.
   */
  if (!rooted && depth > 0 && dyn.pathKinds[depth - 1] === PATH_ROOT_GUARD) {
    rooted = true;
  }
  let kind = rooted ? PATH_ROOT : PATH_NESTED;
  if (rooted && local && header.length === 1 && header[0] === '&') {
    kind = PATH_ROOT_GUARD;
  } else if (!rooted && depth === 0) {
    kind = PATH_OPAQUE;
  } else if (resolved === undefined && rule.selector.selectors.some(selectorBranchHasInterp)) {
    kind = local && !rooted ? PATH_OPAQUE_NESTED : PATH_OPAQUE;
  }
  dyn.pathRules.push(rule);
  dyn.pathHeaders.push(header);
  dyn.pathKinds.push(kind);
  dyn.pathMemo.push(undefined);
  dyn.pathSelectors.push(resolved);
  dyn.pathSubjects.push(undefined);
  return depth;
}

/**
 * [extend/dynamic] The extend path (ancestor levels, then own) of the open rule at
 * `index`, built from the rules' selector IR on first read only — most open rules are
 * never read. The walk already composed these selectors; this rebuilds no selector
 * text and evaluates nothing.
 */
export function dynamicPathAt(dyn: DynamicExtendState, index: number): Level[] {
  let path = dyn.pathMemo[index];
  if (path === undefined) {
    const kind = dyn.pathKinds[index]!;
    const resolved = dyn.pathSelectors[index];
    const own = kind === PATH_OPAQUE || kind === PATH_OPAQUE_NESTED
      ? opaqueLevel(dyn.pathHeaders[index]!)
      : resolved !== undefined ? levelFromSelectorList(resolved) : ownLevelOf(dyn, dyn.pathRules[index]!);
    path = kind === PATH_ROOT || kind === PATH_ROOT_GUARD || kind === PATH_OPAQUE ? [own] : [...dynamicPathAt(dyn, index - 1), own];
    dyn.pathMemo[index] = path;
  }
  return path;
}

/**
 * [extend/dynamic] The subject a rule the nested writer records at open depth `depth`
 * nests under (ledger X22): the enclosing open rule's recorded subject, or a stand-in
 * for its planned one. Null at a root context; false under an opaque level, where the
 * rule is no rewritable target.
 */
export function nestedSubjectParent(dyn: DynamicExtendState, depth: number): PlanSubject | null | false {
  const kind = dyn.pathKinds[depth];
  if (kind === PATH_ROOT || kind === PATH_ROOT_GUARD) {
    return null;
  }
  const above = dyn.pathKinds[depth - 1];
  if (kind !== PATH_NESTED || above === PATH_OPAQUE || above === PATH_OPAQUE_NESTED) {
    return false;
  }
  return dyn.pathSubjects[depth - 1]
    ?? (dyn.staticRules.has(dyn.pathRules[depth - 1]!) ? plannedParent(dyn.pathRules[depth - 1]!, dynamicPathAt(dyn, depth - 1)) : false);
}

/** [extend/dynamic] A rule's own selector level, built once per canonical rule. The
 * solver never mutates a level (composePath clones), so every placement shares it. */
export function ownLevelOf(dyn: DynamicExtendState, rule: Ruleset): Level {
  let own = dyn.ownLevels.get(rule);
  if (own === undefined) {
    own = levelFromSelectorList(dyn.resolvedSelectors.get(rule.selector) ?? rule.selector);
    dyn.ownLevels.set(rule, own);
  }
  return own;
}

/**
 * [extend/dynamic] Record the extend facts for a rule reached through a dynamic
 * expansion (a placing body or mixin call, or an import inside a ruleset), at the
 * at-rule scope, sheet boundary and placement it lands in. `path` is its extend path:
 * the flat writer's open rules (`dynamicPathAt`), or the nested writer's own-local
 * header. This only registers the fact — it never re-drives evaluation (ledger X12 /
 * EXTEND-SEMANTICS §1a). A rule the static plan already holds at this placement is
 * skipped by the callers.
 */
export function recordDynamicExtendFacts(
  dyn: DynamicExtendState,
  rule: Ruleset,
  placement: object | undefined,
  hidden: boolean,
  path: Level[],
  structured: boolean,
  parent: PlanSubject | null | false,
  resolved: SelectorList | undefined
): void {
  const scope = dyn.scope;
  const boundary = dyn.boundary;
  if (parent !== false) {
    const subject: PlanSubject = {
      rule,
      path,
      scope,
      ownLocal: path[path.length - 1]!,
      parent,
      mayMatch: false,
      hidden,
      boundary,
      referenceAtRule: null,
      placement
    };
    dyn.subjects.push(subject);
    dyn.pathSubjects[dyn.pathRules.length - 1] = subject;
  }
  if (rule.extendInstructions) {
    for (const inst of rule.extendInstructions) {
      /*
       * An inline extend binds to its own branch, as `collectPlan` reads it: in the
       * walk's resolution of the rule's selector when there is one.
       */
      const at = inst.subject && resolved !== undefined ? rule.selector.selectors.indexOf(inst.subject.selectors[0]!) : -1;
      const extenderPath = inst.subject && structured
        ? [...path.slice(0, -1), at >= 0 ? [branchFromSelector(resolved!.selectors[at]!)] : levelFromSelectorList(dyn.resolvedSelectors.get(inst.subject) ?? inst.subject)]
        : path;
      recordDynamicInstruction(dyn, inst, extenderPath, hidden);
    }
  }
}

/** [extend/dynamic] Record one `:extend()` the walk reached, extended by `extenderPath`
 * at the walk's current scope and sheet boundary. */
export function recordDynamicInstruction(dyn: DynamicExtendState, inst: ExtendInstruction, extenderPath: Level[], hidden: boolean): void {
  let targets = dyn.targetBranches.get(inst);
  if (targets === undefined) {
    targets = (dyn.resolvedSelectors.get(inst.target) ?? inst.target).selectors.map(branchFromSelector);
    dyn.targetBranches.set(inst, targets);
  }
  for (const target of targets) {
    dyn.instructions.push({
      target,
      partial: inst.partial,
      extenderPath,
      scope: dyn.scope,
      order: dyn.order++,
      extenderHidden: hidden,
      boundary: dyn.boundary
    });
  }
}

/**
 * [extend/dynamic] The extend results once the walk-recorded facts join the static
 * plan, or null when they cannot change any header. A recorded rule that shares no
 * atom with any extend target can neither match nor chain (the planner's `mayMatch`
 * argument), so it is left out; with none left and no recorded extend, the static
 * results already stand and nothing is re-solved.
 */
export function resolveDynamicExtends(dyn: DynamicExtendState, base: ExtendResults | null, guardedNesting: boolean): ExtendResults | null {
  const atoms = new Set<string>(base?.targetAtoms);
  for (const inst of dyn.instructions) {
    collectBranchAtoms(inst.target, atoms);
  }
  const subjects = dyn.subjects.filter(s => s.path.some(level => level.some(b => branchSharesAtom(b, atoms))));
  recordAstExtendProfile?.('astExtend.fold.recordedSubjects', dyn.subjects.length);
  recordAstExtendProfile?.('astExtend.fold.keptSubjects', subjects.length);
  if (subjects.length === 0 && dyn.instructions.length === 0) {
    return null;
  }
  const overlay: PlanOverlay = {
    subjects: [...dyn.baseOverlay.subjects, ...subjects],
    instructions: [...dyn.baseOverlay.instructions, ...dyn.instructions],
    bubbles: dyn.baseOverlay.bubbles,
    atRuleScopes: dyn.atRuleScopes
  };
  return computeExtends(dyn.root, overlay, guardedNesting, dyn.resolvedSelectors, dyn.resolvedUnits);
}

/** [extend/dynamic] Byte-array header-branch equality (change detection for a slot). */
export function arraysEqualText(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
