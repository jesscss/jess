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

import { branchTextIsPlaceholder, selectorBranchHasAmpersand, selectorBranchHasInterp } from '../nodes.js';
import type { ExtendInstruction, Ruleset, SelectorList, Stylesheet } from '../nodes.js';
import type { AtRuleBlock } from '../at-rule.js';
import type { SelectorUnits } from '../selector-text.js';
import { computeExtends } from './emit.js';
import type { ExtendPlacementResults, ExtendResults, NestedRulePlan } from './emit.js';
import { branchFromSelector, branchSharesAtom, collectBranchAtoms, descendantBranch, levelFromSelectorList, selectorLevel, textSimple } from './ir.js';
import type { Level } from './ir.js';
import { buildsSharedName } from './compose.js';
import { plannedParent, recordAstExtendProfile } from './plan.js';
import type { AtRuleScopes, ExtendBoundary, PlanInstruction, PlanOverlay, PlanSubject } from './plan.js';

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
 * the block where it lands. A hidden rule's mask ({@link ExtendResults.hiddenByRule})
 * lines up with its flat header; where the nested header lines up with it too it is
 * read branch by branch, and where an exact extender split off left the nested header
 * shorter, the rule's own branches — the ones the walk wrote — are dropped by text.
 */
export function nestedSlotHeader(ext: ExtendResults | null, slot: DynExtendSlot): string[] | null {
  const projection = ext === null ? null : placementProjection(ext, slot.token);
  const plan = projection?.nestedPlan.get(slot.rule);
  if (plan === undefined || plan.flatten) {
    return slot.hiddenRef && plan === undefined ? null : slot.emitted;
  }
  if (!slot.hiddenRef) {
    return withoutPlaceholders(plan.header);
  }
  const mask = projection!.hiddenByRule.get(slot.rule);
  if (mask === undefined || !mask.includes(false)) {
    return null;
  }
  if (mask.length === plan.header.length) {
    return visibleHeaderCore(slot.rule, plan.header, projection, true);
  }
  const own = new Set(slot.emitted);
  const shown = plan.header.filter(branch => !own.has(branch));
  return shown.length > 0 ? withoutPlaceholders(shown) : null;
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

/**
 * The extent of a block a rule the fold may move is written in: its first chunk, its
 * body's, the chunk after its close (-1 while open), its indent, its declarations
 * ({@link DynExtendSlot.leaves}), and how far from each end its body is known to be empty.
 */
export interface BlockExtent {
  rule: boolean;
  mark: number;
  body: number;
  end: number;
  idt: string;
  leaves: number[] | null | undefined;
  scan: number;

  /** How far back from its close its body is known to be empty, -1 before it is read. */
  tail: number;
}

/**
 * Whether an extend can split `rule` off or take its declarations: its own selector
 * shares an atom with a known target, or holds a `&`, which composes its parent's, or
 * is interpolated, which the walk resolves. The
 * fast-reject the planner applies, at walk time; a rule it rejects keeps the header the
 * walk wrote if the fold would split it. A rule the static plan holds reads the level
 * the planner built for it (`planned`, read into {@link DynamicExtendState.ownLevels}
 * once); only a rule the walk records builds its own.
 */
export function mayBeTarget(dyn: DynamicExtendState, rule: Ruleset, planned: ExtendResults | null): boolean {
  if (dyn.targetAtoms.size === 0) {
    return false;
  }
  if (rule.selector.selectors.some(branch => selectorBranchHasInterp(branch) || selectorBranchHasAmpersand(branch))) {
    return true;
  }
  if (!dyn.plannedLevels) {
    dyn.plannedLevels = true;
    for (const subject of planned?.subjects ?? []) {
      if (!dyn.ownLevels.has(subject.rule)) {
        dyn.ownLevels.set(subject.rule, subject.ownLocal);
      }
    }
  }
  return ownLevelOf(dyn, rule).some(branch => branchSharesAtom(branch, dyn.targetAtoms));
}

/** The extents of the first `count` blocks of `open`, the blocks a rule is written in, outermost first, kept on each block once made. */
export function enclosingExtents(
  open: ReadonlyArray<{ rule: unknown; mark: number; body: number; idt: string; extent: BlockExtent | null }>,
  count: number
): BlockExtent[] {
  const extents: BlockExtent[] = [];
  for (let i = 0; i < count; i++) {
    const block = open[i]!;
    extents.push(block.extent ??= { rule: block.rule !== null, mark: block.mark, body: block.body, end: -1, idt: block.idt, leaves: undefined, scan: block.body, tail: -1 });
  }
  return extents;
}

/** How the nested writer writes a block's open and close, so the fold writes what it would ({@link restructureNestedSlots}). */
export interface NestedWriter {
  /** One indent level, and a block's `{`. */
  indent: string;
  open: string;

  /** A rule's selector header at indent `idt`. */
  selectors(own: string[], idt: string): string;

  /** An at-rule block's `name prelude`. */
  atRule(name: string, prelude: string): string;

  /** A block's `}` at indent `idt`. */
  close(idt: string): string;
}

/** The output the fold restructures: the writer's chunks, the positions and pseudo-element split blocks recorded against them. */
export interface NestedOutput {
  chunks: string[];
  positions: Array<{ start: number; end: number }> | null;
  splitBlocks: Array<{ header: number; end: number }> | null;
  compress?: boolean;
  extends: ExtendResults | null;
}

/**
 * What the fold writes after one chunk: bytes it composed, or a run of the walk's
 * chunks `levels` indent levels out — the run of block `id` that moved there, or with
 * `id` 0 a copy of declarations.
 */
type Piece = { from: number; to: number; levels: number; id: number } | string;

/**
 * The edits of one fold. `gone` marks each chunk a block moved out of (by the block's
 * positive id) or dropped (by a negative id) where it was written; `at` holds what is
 * written after a chunk; `header` the header a moved block is written with. The output
 * is rebuilt once, from them ({@link rebuild}).
 */
interface Edits {
  gone: Int32Array;
  at: Map<number, Piece[]>;
  header: Map<number, string>;
  ids: number;

  /** The header chunks of the nested rules, whose lines a moved run re-indents with its indent chunks. */
  headers: ReadonlySet<number>;
}

/** Mark `[from, to)` gone as block `id`, but for what an earlier edit already took. */
function take(edits: Edits, from: number, to: number, id: number): void {
  for (let i = from; i < to; i++) {
    if (edits.gone[i] === 0) {
      edits.gone[i] = id;
    }
  }
}

/** The chunk ends the walk's run of blank chunks. */
function isBlank(chunk: string): boolean {
  for (let i = 0; i < chunk.length; i++) {
    const code = chunk.charCodeAt(i);
    if (code !== 0x20 && code !== 0x0A) {
      return false;
    }
  }
  return true;
}

function insertAt(edits: Edits, chunk: number, pieces: Piece[]): void {
  const list = edits.at.get(chunk);
  if (list === undefined) {
    edits.at.set(chunk, pieces);
  } else {
    list.push(...pieces);
  }
}

/**
 * Drop the blocks the chunks `[from, to)` leave empty, innermost first. Each extent
 * keeps how far its body is known to be empty, so no chunk is read twice. Under
 * compress, a block left ending in a declaration other than a custom property drops
 * that declaration's `;`, as the writer drops the last one before a `}`.
 */
function dropEmptied(out: NestedOutput, edits: Edits, enclosing: readonly BlockExtent[]): void {
  const { chunks } = out;
  for (let k = enclosing.length - 1; k >= 0; k--) {
    const block = enclosing[k]!;
    const close = block.end - (block.idt === '' ? 1 : 2);
    while (block.scan < close && (edits.gone[block.scan] !== 0 || (isBlank(chunks[block.scan]!) && !edits.at.has(block.scan)))) {
      block.scan++;
    }
    if (block.scan < close) {
      if (out.compress === true) {
        dropLastSemicolon(chunks, edits, block, close);
      }
      return;
    }
    take(edits, block.mark, block.end, -++edits.ids);
  }
}

function dropLastSemicolon(chunks: readonly string[], edits: Edits, block: BlockExtent, close: number): void {
  const leaves = block.leaves;
  if (!leaves) {
    return;
  }
  let last = block.tail < 0 ? close - 1 : block.tail;
  while (last >= block.scan && (edits.gone[last] !== 0 || chunks[last] === '')) {
    last--;
  }
  block.tail = last;
  for (let k = leaves.length - 3; k >= 0; k -= 3) {
    if (leaves[k + 1] === last + 1 && chunks[last] === ';' && leaves[k + 2] === 0) {
      edits.gone[last] = -++edits.ids;
      return;
    }
  }
}

/** The pieces that write `pieces` where `slot`'s landing reserved for a rule rising `bubble` blocks, `levels` set from the slot's depth. */
function landing(slot: DynExtendSlot, bubble: number, writer: NestedWriter, make: (depth: number, levels: number) => Piece[]): [number, Piece[]] {
  const { indent } = writer;
  const land = slot.landing!;
  const level = Math.min(bubble, land.at.length) - 1;
  const wrappers = land.wrappers[level] ?? [];
  const base = land.depth[level]!;
  const depth = base + wrappers.length;
  const pieces: Piece[] = [];
  const closes: string[] = [];
  for (let w = 0; w < wrappers.length; w++) {
    const idt = indent.repeat(base + w);
    const { node, prelude } = wrappers[w]!;
    pieces.push(`${idt}${writer.atRule(node.name, prelude)}${writer.open}`);
    closes.unshift(writer.close(idt));
  }
  pieces.push(...make(depth, indent === '' ? 0 : slot.indent.length / indent.length - depth), ...closes);
  return [land.at[level]!, pieces];
}

/**
 * Apply each nested slot's re-solved plan where it restructures the block the walk
 * wrote (ledger X22): a flatten moves the block where it lands, with its hoisted
 * header; an exact extender that cannot carry the block's child rules gets a block of
 * its own with the block's direct declarations (§7b), beside the block or, for one
 * that shares no level with the block's ancestors, where the block would land at the
 * top; a hidden `(reference)` rule nothing revealed goes. A block that leaves its
 * enclosing blocks empty drops them. The chunks are rebuilt once, positions and
 * pseudo-element split blocks carried with them. A slot the walk did not track keeps
 * what the walk wrote. `resolved` — the fold re-solved; without it only hidden rules
 * can change.
 */
export function restructureNestedSlots(out: NestedOutput, slots: readonly DynExtendSlot[], resolved: boolean, writer: NestedWriter): void {
  let edits: Edits | null = null;
  let revealed: Set<number> | null = null;
  const start = (): Edits => edits ??= {
    gone: new Int32Array(out.chunks.length + 1),
    at: new Map(),
    header: new Map(),
    ids: 0,
    headers: nestedHeaders(slots)
  };
  for (const slot of slots) {
    if (!slot.nested || slot.walked === null || (!resolved && !slot.hiddenRef)) {
      continue;
    }
    const projection = out.extends === null ? null : placementProjection(out.extends, slot.token);
    const plan = projection?.nestedPlan.get(slot.rule);
    let shown = slot.hiddenRef ? nestedSlotHeader(out.extends, slot) : slot.emitted;
    if (slot.hiddenRef && plan !== undefined && !plan.flatten && underShown(slot, revealed ??= revealedHidden(out.extends, slots))) {
      /* Under a hidden rule an extender revealed, the rule's own selector is written: it composes with the extender. */
      shown = withoutPlaceholders(plan.header);
      out.chunks[slot.chunkIndex] = shown === null ? out.chunks[slot.chunkIndex]! : writer.selectors(shown, slot.indent);
    }
    if (plan?.flatten === true && slot.walked?.flatten !== true && slot.landing !== null) {
      const header = visibleHeaderCore(slot.rule, plan.hoistNested ? plan.header : projection!.hoistHeader.get(slot.rule) ?? [], projection, slot.hiddenRef);
      const ed = start();
      const id = ++ed.ids;
      take(ed, slot.mark, slot.blockEnd, header === null ? -id : id);
      if (header !== null) {
        ed.header.set(slot.chunkIndex, writer.selectors(header, slot.indent));
        const [chunk, pieces] = landing(slot, plan.hoistBubble ?? 1, writer, (_depth, levels) => [{ from: slot.mark, to: slot.blockEnd, levels, id }]);
        insertAt(ed, chunk, pieces);
      }
      dropEmptied(out, ed, slot.enclosing!);
      continue;
    }
    if (plan !== undefined && !plan.flatten && (plan.splits.length > 0 || (plan.rootSplits?.length ?? 0) > 0)) {
      splitOff(out, slot, plan, writer, start);
    }
    if (shown === null || (slot.hiddenRef && plan?.flatten === true)) {
      hide(out, slot, start());
    }
  }
  if (edits !== null) {
    rebuild(out, edits);
  }
}

/** The header chunks of the nested slots. */
function nestedHeaders(slots: readonly DynExtendSlot[]): Set<number> {
  const headers = new Set<number>();
  for (const slot of slots) {
    if (slot.nested) {
      headers.add(slot.chunkIndex);
    }
  }
  return headers;
}

/**
 * The first chunks of the hidden `(reference)` rules an extender reveals, the
 * outermost first so a rule's parent is decided before it: a rule written with a
 * visible branch, or one written under such a rule, whose own selector then composes
 * with the extender.
 */
function revealedHidden(ext: ExtendResults | null, slots: readonly DynExtendSlot[]): Set<number> {
  const shown = new Set<number>();
  for (let i = slots.length - 1; ext !== null && i >= 0; i--) {
    const slot = slots[i]!;
    const projection = slot.nested && slot.hiddenRef ? placementProjection(ext, slot.token) : null;
    const plan = projection?.nestedPlan.get(slot.rule);
    if (plan === undefined) {
      continue;
    }
    const visible = plan.flatten
      ? visibleHeaderCore(slot.rule, plan.hoistNested ? plan.header : projection!.hoistHeader.get(slot.rule) ?? [], projection, true) !== null
      : underShown(slot, shown) || nestedSlotHeader(ext, slot) !== null;
    if (visible) {
      shown.add(slot.mark);
    }
  }
  return shown;
}

/** Whether the rule block `slot` is written in directly is one of `shown`. */
function underShown(slot: DynExtendSlot, shown: ReadonlySet<number>): boolean {
  const enclosing = slot.enclosing;
  for (let k = (enclosing?.length ?? 0) - 1; k >= 0; k--) {
    if (enclosing![k]!.rule) {
      return shown.has(enclosing![k]!.mark);
    }
  }
  return false;
}

/**
 * Drop a hidden `(reference)` rule nothing revealed: its declarations, and the block
 * itself, with the blocks it leaves empty, unless a rule in it was revealed — that
 * rule stays written under it, as the flat writer composes it under its hidden
 * ancestors.
 */
function hide(out: NestedOutput, slot: DynExtendSlot, edits: Edits): void {
  const leaves = slot.leaves;
  for (let k = 0; leaves && k < leaves.length; k += 3) {
    take(edits, leaves[k]!, leaves[k + 1]!, -++edits.ids);
  }
  const own: BlockExtent = { rule: true, mark: slot.mark, body: slot.body, end: slot.blockEnd, idt: slot.indent, leaves: null, scan: slot.body, tail: -1 };
  dropEmptied(out, edits, leaves === undefined ? [] : [own]);
  if (leaves === undefined) {
    take(edits, slot.mark, slot.blockEnd, -++edits.ids);
  } else if (edits.gone[slot.mark] === 0) {
    return;
  }
  if (slot.enclosing !== null) {
    dropEmptied(out, edits, slot.enclosing);
  }
}

/** Write the exact extenders `plan` splits off the block of `slot` that the walk did not, each a block of the block's declarations (§7b). */
function splitOff(out: NestedOutput, slot: DynExtendSlot, plan: NestedRulePlan, writer: NestedWriter, start: () => Edits): void {
  const walked = slot.walked;
  const known = walked ? new Set([...walked.splits, ...walked.rootSplits ?? []].map(h => h.join(','))) : null;
  const splits = known === null ? plan.splits : plan.splits.filter(h => !known.has(h.join(',')));
  const roots = known === null ? plan.rootSplits ?? [] : (plan.rootSplits ?? []).filter(h => !known.has(h.join(',')));
  if (splits.length === 0 && roots.length === 0) {
    return;
  }
  if (slot.leaves === undefined || (roots.length > 0 && slot.landing === null)) {
    /* ponytail: no record to split from (no known target reached the rule while the walk wrote it): the header the walk wrote stands. Recording every block would cost an array per block. */
    out.chunks[slot.chunkIndex] = writer.selectors(slot.emitted, slot.indent);
    return;
  }
  const leaves = slot.leaves;
  if (leaves === null) {
    return;
  }

  /* A block of `header` at indent `idt` holding the declarations, `levels` levels out. Under compress its last `;` goes, but a custom property's. */
  const block = (header: readonly string[], idt: string, levels: number): Piece[] => {
    const pieces: Piece[] = [`${idt}${writer.selectors([...header], idt)}${writer.open}`];
    for (let k = 0; k < leaves.length; k += 3) {
      const to = leaves[k + 1]!;
      const last = k === leaves.length - 3 && out.compress === true && out.chunks[to - 1] === ';' && leaves[k + 2] === 0;
      pieces.push({ from: leaves[k]!, to: last ? to - 1 : to, levels, id: 0 });
    }
    pieces.push(writer.close(idt));
    return pieces;
  };
  const ed = start();
  for (const header of splits) {
    insertAt(ed, slot.blockEnd - 1, block(header, slot.indent, 0));
  }
  for (const header of roots) {
    const [chunk, pieces] = landing(slot, Number.MAX_SAFE_INTEGER, writer, (depth, levels) => block(header, writer.indent.repeat(depth), levels));
    insertAt(ed, chunk, pieces);
  }
}

/**
 * Carry positions over to the rebuilt chunks (`map`, old chunk to new). A position
 * inside a copied run is copied with it: the runs are kept by first chunk, sorted, and
 * each position looks its run up by binary search.
 */
function carryPositions(positions: Array<{ start: number; end: number }>, copied: ReadonlyArray<[from: number, to: number, at: number]>, map: Int32Array, size: number): void {
  const runs = [...copied].sort((a, b) => a[0] - b[0]);
  const count = positions.length;
  for (let index = 0; index < count; index++) {
    const p = positions[index]!;
    let lo = 0;
    let hi = runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (runs[mid]![0] <= p.start) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    for (let k = lo - 1; k >= 0 && runs[k]![0] === runs[lo - 1]![0]; k--) {
      const [from, to, at] = runs[k]!;
      if (p.end <= to && p.end > p.start) {
        positions.push({ ...p, start: at + p.start - from, end: at + p.end - from });
      }
    }
    remapRange(p, map, size);
  }
}

/** Move `range` from old chunk indices to new ones through `map`; a range whose chunks are gone collapses where they were. */
function remapRange(range: { start: number; end: number }, map: Int32Array, size: number): void {
  const start = map[range.start]! < 0 ? size : map[range.start]!;
  range.end = range.end <= range.start || map[range.end - 1]! < 0 ? start : map[range.end - 1]! + 1;
  range.start = start;
}

/**
 * Rebuild the chunks from `edits`: each chunk where it was written unless it is gone,
 * then what is written after it. A moved run is written where it lands, with its
 * indent chunks and headers `levels` levels out and what is written inside it with
 * it; a copied run is written as it is. The positions and split blocks recorded
 * against the old chunks are carried over; a position inside a copied run is copied
 * with it.
 */
function rebuild(out: NestedOutput, edits: Edits): void {
  const old = out.chunks;
  const chunks: string[] = [];
  const map = new Int32Array(old.length + 1).fill(-1);
  const copied: Array<[from: number, to: number, at: number]> = [];
  const strips = new Map<number, RegExp>();
  let lastNewline = true;
  const push = (text: string): void => {
    chunks.push(text);
    if (text !== '') {
      lastNewline = text.endsWith('\n');
    }
  };

  /* `id` -1 writes the chunks where they were written, a positive id the run of the block that moved, 0 a copy. */
  const writeRun = (from: number, to: number, levels: number, id: number): void => {
    let strip: RegExp | null = null;
    if (levels > 0) {
      strip = strips.get(levels) ?? new RegExp(`(^|\\n) {${levels * 2}}`, 'g');
      strips.set(levels, strip);
    }
    for (let i = from; i < to; i++) {
      const gone = edits.gone[i]!;
      const write = id === 0 || gone === (id < 0 ? 0 : id);
      if (id !== 0 && map[i] === -1 && (write || (id < 0 && gone < 0))) {
        map[i] = chunks.length;
      }
      if (!write) {
        continue;
      }
      let text = edits.header.get(i) ?? old[i]!;
      if (strip !== null && ((lastNewline && text !== '' && isBlank(text)) || edits.headers.has(i))) {
        text = text.replace(strip, '$1');
      }
      push(text);
      for (const piece of id === 0 ? [] : edits.at.get(i) ?? []) {
        if (typeof piece === 'string') {
          push(strip === null ? piece : piece.replace(strip, '$1'));
          continue;
        }
        const at = chunks.length;
        writeRun(piece.from, piece.to, piece.levels + levels, piece.id);
        if (piece.id === 0) {
          copied.push([piece.from, piece.to, at]);
        }
      }
    }
  };
  writeRun(0, old.length, 0, -1);
  map[old.length] = chunks.length;
  if (out.positions !== null) {
    carryPositions(out.positions, copied, map, chunks.length);
  }
  for (const block of out.splitBlocks ?? []) {
    const range = { start: block.header, end: block.end };
    remapRange(range, map, chunks.length);
    block.header = range.start;
    block.end = range.end;
  }
  out.chunks = chunks;
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

  /**
   * [nesting] What the deferred fold restructures a nested block from
   * ({@link restructureNestedSlots}): its first chunk and its body's, `start, end,
   * custom` of each declaration it holds (undefined when untracked), and the blocks it is
   * written in. -1, undefined and null for a flat slot.
   */
  mark: number;
  body: number;
  leaves: number[] | null | undefined;
  enclosing: BlockExtent[] | null;
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

  /** A rule's own level, however often the walk places it: the one the static plan read
   * for it, else its selector's ({@link selectorLevel}). */
  ownLevels: Map<Ruleset, Level>;

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
  staticRules: ReadonlySet<Ruleset>;

  /** The atoms of every extend target the graph is known to hold before the walk (static and placed). */
  targetAtoms: Set<string>;

  /** {@link ownLevels} holds the levels the static plan built ({@link mayBeTarget}). */
  plannedLevels: boolean;

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
  const parent = dyn.pathRules[depth - 1]!;
  if (dyn.pathSubjects[depth - 1] === undefined && dyn.staticRules.has(parent)) {
    dyn.pathSubjects[depth - 1] = plannedParent(parent, dynamicPathAt(dyn, depth - 1));
  }
  return dyn.pathSubjects[depth - 1] ?? false;
}

/** [extend/dynamic] A rule's own selector level, built once per canonical rule. The
 * solver never mutates a level (composePath clones), so every placement shares it. */
export function ownLevelOf(dyn: DynamicExtendState, rule: Ruleset): Level {
  let own = dyn.ownLevels.get(rule);
  if (own === undefined) {
    own = selectorLevel(dyn.resolvedSelectors.get(rule.selector) ?? rule.selector);
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
        ? [...path.slice(0, -1), at >= 0 ? [branchFromSelector(resolved!.selectors[at]!)] : selectorLevel(dyn.resolvedSelectors.get(inst.subject) ?? inst.subject)]
        : path;
      recordDynamicInstruction(dyn, inst, extenderPath, hidden);
    }
  }
}

/** [extend/dynamic] Record one `:extend()` the walk reached, extended by `extenderPath`
 * at the walk's current scope and sheet boundary. */
export function recordDynamicInstruction(dyn: DynamicExtendState, inst: ExtendInstruction, extenderPath: Level[], hidden: boolean): void {
  for (const target of selectorLevel(dyn.resolvedSelectors.get(inst.target) ?? inst.target)) {
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
 * Whether a subject's own selector shares an atom with `atoms`, a name its `&` builds on
 * its parent included ({@link buildsSharedName}).
 */
export function ownSharesAtom(s: PlanSubject, atoms: Set<string>): boolean {
  return s.ownLocal.some(b => branchSharesAtom(b, atoms)) || buildsSharedName(s.path, atoms);
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
  const subjects = dyn.subjects.filter(s => s.path.some(level => level.some(b => branchSharesAtom(b, atoms))) || buildsSharedName(s.path, atoms));
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
