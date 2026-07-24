/**
 * Match / construct — applies one extend instruction to a selector list.
 *
 *   - whole-branch match (exact & all): append the extender branches (dedup).
 *   - `all` sub-match: substitute the matched span in place with `:is(span, ext)`.
 *   - recurse into `:is()` grafts (transitive chaining lives inside them).
 */

import {
  branchSharesAtom,
  branchText,
  cloneBranch,
  cloneSeg,
  cloneSimple,
  collectBranchAtoms,
  compoundText,
  descendantBranch,
  isOrPlainSimples,
  mkBranch,
  multisetEqual,
  multisetSubset,
  simpleTexts,
  textSimples
} from './ir.js';
import type { Branch, Compound, Seg, Simple } from './ir.js';
import { wouldConflict } from './conflict.js';
import { recordAstExtendProfile } from './plan.js';

/**
 * Apply one instruction to a selector list (a rule's branches OR an `:is()`
 * arg). Returns a new list when it changed, else null. `extenderKeys` are the
 * extenders' texts (self-avoidance: never wrap a branch that IS an extender
 * contribution).
 */
export function applyInstruction(
  list: Branch[],
  target: Branch,
  extenders: Branch[],
  partial: boolean,
  extenderKeys: Set<string>,
  targetAtoms: Set<string>,
  extenderHidden = false,
  // The plain-text simples of the ENCLOSING compound(s) this list sits inside — non-empty
  // only when the fixpoint re-enters an instruction into an `:is()` graft (`div:is(<list>)`
  // threads `['div']`). The element/id conflict guard unions it so a wrap decided INSIDE a
  // graft still sees the full outer compound context (an extender that would form
  // `div ∧ span` is rejected even when `span` is re-tried transitively through the graft).
  outerSurrounding: readonly string[] = []
): Branch[] | null {
  const out: Branch[] = [];
  const appends: Branch[] = [];
  let changed = false;

  // When this list sits INSIDE an `:is()` graft (`outerSurrounding` non-empty), a
  // whole-branch append adds a NEW `:is()` arm that distributes over the enclosing
  // compound — so an extender forming an invalid two-type / two-id compound with
  // `outerSurrounding` must be dropped here as well (the append path, unlike the
  // sub-wrap, has no matched compound of its own to reason about). At the top level
  // (`outerSurrounding` empty) an append is a rule-level comma sibling that can never
  // conflict, so the input array is used verbatim — byte-identical, no allocation.
  const appendExtenders = outerSurrounding.length > 0
    ? nonConflictingExtenders(outerSurrounding, extenders)
    : extenders;

  for (const b of list) {
    // Core matcher comparison: one candidate branch tested against the target.
    // Opt-in, import-time-captured counter (undefined in production → no call, no
    // allocation); the sum across the fixpoint is the O(subjects·instructions·
    // branches) surface the extend-op-budget gate ceilings.
    recordAstExtendProfile?.('astExtend.match.branchComparisons');
    const bKey = branchText(b);
    // [import:reference] chaining an extend off a branch that was itself an extend
    // PRODUCT from a hidden rule (`b.ext && b.hidden`) yields a hidden result — the
    // less.js per-chain `visibilityInfo`. An extend off an ORIGINAL hidden seed
    // (`!b.ext`) keeps the extender's own visibility, so the seed's `hidden` does
    // NOT force the append hidden. `effHidden` folds both into one decision.
    const chainHidden = b.hidden === true && b.ext === true;
    const effHidden = extenderHidden || chainHidden;
    // Whole-branch EXACT match → append extenders as siblings. Matches by selector
    // EQUIVALENCY (EXTEND_RULES §0), not serialization: `.b.c` ≡ `.c.b`, and a target
    // may match THROUGH a base's crossable `:is()` graft — in a single compound
    // (`.x:is(.a, .b)` matched by `.x.a`), alongside trailing simples (`.x:is(.a, .b).c`
    // by `.x.a.c`), across ANY number of segments (`.x:is(.a, .b) .y` by `.x.a .y`), or
    // as a lone-graft segment expanding (`:is(.a .b, .c) .d` by `.a .b .d`).
    if (branchWholeMatch(b, target, false)) {
      out.push(b);
      for (const e of appendExtenders) {
        pushExtender(appends, e, chainHidden);
      }
      continue;
    }
    // ATOM FAST-REJECT: every remaining (`all`) match — whole-branch subset,
    // sub-compound substitution, and `:is()`-graft chaining — requires the branch
    // to share at least one individual simple atom with the target (the matcher's
    // multiset-subset / graft-recurse can only fire on a common atom). A branch
    // disjoint from `targetAtoms` (graft-recursive, same extraction both sides)
    // provably yields `rewriteBranchPartial === null`, so skip the clone + double
    // `branchText` + substitute. ~98% of partial candidates on real fixtures are
    // atom-disjoint (measured), so this reject is the fixpoint's dominant lever.
    if (partial && !extenderKeys.has(bKey) && branchSharesAtom(b, targetAtoms)) {
      // `all` whole-branch SUBSET match: a multi-segment target whose every segment
      // compound-subsets the aligned branch segment across the WHOLE span (each
      // pattern compound ⊆ its branch compound, combinators aligned — e.g.
      // `.a > .c` vs `.a.b > .c.d`). The matched span is the entire selector, so it
      // degenerates to a plain comma-append (`.a.b > .c.d, .x`), NOT an
      // `:is()`-wrap of the whole branch — the sub-span `:is()` wrap is reserved for
      // matches with surrounding combinator context (see `substituteMultiCompound`).
      if (branchWholeMatch(b, target, true)) {
        out.push(b);
        for (const e of appendExtenders) {
          pushExtender(appends, e, chainHidden);
        }
        continue;
      }
      // [import:reference] a HIDDEN sub-part `all` match adds only invisible copies
      // (less.js comma-expands the extender with the extender's hidden visibility),
      // which the serializer drops — so the VISIBLE base branch must be left EXACTLY
      // as authored (never rewritten into `:is(span, hidden-ext)`, which would leak
      // the hidden extender's text). Skip the in-place substitution for this branch;
      // the net visible effect of a hidden extender's sub-match is nothing.
      if (!effHidden) {
        const rewritten = rewriteBranchPartial(b, target, extenders, partial, extenderKeys, targetAtoms, outerSurrounding);
        if (rewritten) {
          out.push(rewritten);
          changed = true;
          continue;
        }
      }
    }
    out.push(b);
  }

  if (appends.length > 0) {
    // Build the presence index ONCE per apply (i.e. once per group per pass — the
    // fold collapses a target's N instructions into one call), not once per queued
    // extender. `appendDeduped` then folds every whole-branch append through it.
    const present = new Set(out.map(branchText));
    if (appendDeduped(out, appends, present)) {
      changed = true;
    }
  }
  return changed ? out : null;
}

/**
 * Append `appends` onto `out`, skipping any branch whose text already occurs in
 * `out` (the whole-branch self-avoidance dedup). `present` is the caller-owned
 * presence index, seeded once from `out` so a folded group's appends dedup in a
 * single pass instead of rebuilding the set per extender. Mutates `out`/`present`;
 * returns whether any branch was actually added. */
export function appendDeduped(out: Branch[], appends: Branch[], present: Set<string>): boolean {
  let added = false;
  for (const e of appends) {
    const k = branchText(e);
    if (!present.has(k)) {
      out.push(e);
      present.add(k);
      added = true;
    }
  }
  return added;
}

/**
 * [import:reference] Queue an extender branch for appending. `forceHidden` (a chain
 * off a hidden extend product) overrides an otherwise-visible extender to hidden via
 * a clone (the shared contrib branch is never mutated); a branch already carrying its
 * extender rule's hidden bit is queued as-is (no allocation on the common path).
 */
function pushExtender(appends: Branch[], e: Branch, forceHidden: boolean): void {
  if (forceHidden && e.hidden !== true) {
    const c = cloneBranch(e);
    c.hidden = true;
    appends.push(c);
  } else {
    appends.push(e);
  }
}

/**
 * True when `target` matches the WHOLE of `b` — the append condition
 * `applyInstruction` uses for a whole-branch (exact/all) hit. This is the "the
 * extender becomes a SIBLING of the whole complex" signal the nested re-projection
 * reads to decide a cross-`&` flatten (a foreign whole-complex sibling cannot be
 * expressed as a local own-local rewrite). Delegates to the single `branchWholeMatch`:
 * the exact whole-branch equivalence/graft-cross for any instruction, plus the
 * multi-segment `all` subset for a partial one. A single-compound `all` sub-match
 * (which rewrites a compound IN PLACE, never appends a whole sibling) is deliberately
 * NOT a whole match (`branchWholeMatch`'s ALL-mode P<2 gate).
 */
export function branchWholeMatches(b: Branch, target: Branch, partial: boolean): boolean {
  return branchWholeMatch(b, target, false) || (partial && branchWholeMatch(b, target, true));
}

/** Sentinel for a find cursor that could not consume a graft arm. Distinct from
 *  `-1` (a legitimately exhausted find cursor). */
const NO_MATCH = -2;

/**
 * [&-boundary] The ampersand-boundary class of an instruction match against a
 * COMPOSED branch (its per-segment `bnd` origin, `compose.ts`): the structural
 * replacement for the emit-layer text heuristics.
 *
 *   - `'none'`     — the target does not match this branch at all.
 *   - `'local'`    — the matched span is ENTIRELY own-local (`bnd === 0`): the rule
 *                    keeps the match in place; no `&`-boundary is crossed.
 *   - `'within'`   — the matched span is ENTIRELY inherited from an ancestor `&`
 *                    (`bnd > 0`): the match is on the parent context, not this
 *                    ruleset's own selector.
 *   - `'crossing'` — the matched span straddles the boundary (some `bnd === 0` and
 *                    some `bnd > 0`): it cannot be expressed as a local rewrite.
 *
 * The span is located exactly as `applyInstruction` locates it (whole-branch append
 * vs sub-compound / sub-segment rewrite), then classified from `b.bnd`. `undefined`
 * `bnd` (a branch that never went through an `&`-compose) reads as all own-local.
 */
export type MatchBoundary = 'none' | 'local' | 'within' | 'crossing';

/**
 * [&-boundary] A boundary verdict PLUS the deepest ancestor `&`-hop the matched span
 * reaches (`maxBnd` = the largest `bnd` over the span; `0` for a purely own-local
 * span). `maxBnd` is the per-boundary HOIST LEVEL: a `'crossing'` match hoists out of
 * exactly `maxBnd` enclosing rule blocks (the nesting levels its span reaches into),
 * leaving strictly-outer ancestors (`bnd > maxBnd`) as wrappers — not blindly one
 * level, not always root. `'none'`/`'local'` carry `maxBnd = 0`.
 */
export interface SpanBoundary {
  boundary: MatchBoundary;
  maxBnd: number;
}

function classifySpan(bnd: Int8Array | undefined, start: number, len: number): SpanBoundary {
  if (!bnd) {
    return { boundary: 'local', maxBnd: 0 };
  }
  let hasOwn = false;
  let maxBnd = 0;
  for (let i = start; i < start + len && i < bnd.length; i++) {
    const v = bnd[i]!;
    if (v === 0) {
      hasOwn = true;
    } else if (v > maxBnd) {
      maxBnd = v;
    }
  }
  const hasAncestor = maxBnd > 0;
  const boundary: MatchBoundary = hasOwn && hasAncestor
    ? 'crossing'
    : hasAncestor ? 'within' : 'local';
  return { boundary, maxBnd };
}

/**
 * Locate the matched span exactly as `applyInstruction` does, then classify it from
 * `b.bnd` and report the deepest ancestor hop it reaches (`{@link SpanBoundary}`).
 * `undefined` `bnd` (a branch that never went through an `&`-compose) reads as all
 * own-local.
 */
export function matchBoundarySpan(b: Branch, target: Branch, partial: boolean): SpanBoundary {
  // Whole-branch (exact/all) append: the span is the ENTIRE branch.
  if (branchWholeMatch(b, target, false) || (partial && branchWholeMatch(b, target, true))) {
    return classifySpan(b.bnd, 0, b.segs.length);
  }
  if (!partial) {
    return { boundary: 'none', maxBnd: 0 };
  }
  // Single-compound `all` sub-match: the first segment the target compound subsets.
  if (target.segs.length === 1) {
    const need = textSimples(target.segs[0]!.compound);
    for (let i = 0; i < b.segs.length; i++) {
      if (multisetSubset(need, textSimples(b.segs[i]!.compound))) {
        return classifySpan(b.bnd, i, 1);
      }
    }
    return { boundary: 'none', maxBnd: 0 };
  }
  // Multi-segment `all` sub-match: the first aligned span (mirrors substituteMultiCompound).
  const P = target.segs.length;
  for (let start = 0; start + P <= b.segs.length; start++) {
    let ok = true;
    for (let k = 0; k < P; k++) {
      if (!multisetSubset(textSimples(target.segs[k]!.compound), textSimples(b.segs[start + k]!.compound))) {
        ok = false;
        break;
      }
      if (k > 0 && target.segs[k]!.comb !== b.segs[start + k]!.comb) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return classifySpan(b.bnd, start, P);
    }
  }
  return { boundary: 'none', maxBnd: 0 };
}

export function classifyMatchBoundary(b: Branch, target: Branch, partial: boolean): MatchBoundary {
  return matchBoundarySpan(b, target, partial).boundary;
}

/**
 * The invariant CONTEXT of one whole-branch walk, passed BY REFERENCE so the recursion
 * threads only the two `(segIdx, findIdx)` cursors by value (no cloned cursor objects,
 * invariant 5). `base`/`target` are the two branches' segments; `partial` selects EXACT
 * vs ALL semantics; `memo` caches `(si, fi)` results (non-null only for a lone-graft
 * base, the sole forking source); `guard`/`guardMax` bound total visits (mirrors
 * solve.ts's `guardMax`) so a pathological graft nesting can never spin.
 */
interface Walk {
  base: readonly Seg[];
  target: readonly Seg[];
  partial: boolean;
  memo: Map<number, boolean> | null;
  guard: number;
  guardMax: number;
}

/**
 * The SINGLE whole-branch matcher. Decides whether `target` matches the WHOLE of `b`
 * — the append condition `applyInstruction` uses for a whole-branch (exact/all) hit —
 * crossing the base's structured `{ t: 'is' }` grafts. It REPLACES the four ad-hoc
 * predicates the whole-branch condition used to OR together (order-independent exact
 * equivalence, `:is()`-graft segment expansion, the single-compound dual-cursor graft
 * cross, and the multi-segment `all` subset), generalized to MULTI-segment selectors:
 *
 *   - `partial === false` (EXACT, EXTEND_RULES §0 — same elements): every aligned
 *     segment's compound is MULTISET-EQUAL (order-independent, consume-ALL: `.b.c` ≡
 *     `.c.b`, but `.b.b.c` ≢ `.b.c`), OR — when the base compound carries a graft —
 *     matched THROUGH it (`compoundCross`); a base segment that is a LONE graft expands
 *     its OR-arms into a segment span (`segSpanMatch`, e.g. `:is(.a .b, .c) .d` matched
 *     by `.a .b .d`). Combinators align at EVERY segment, including the head.
 *   - `partial === true` (ALL): a MULTI-segment (≥2) target whose every compound is a
 *     multiset SUBSET of the aligned base compound with internal combinators aligned
 *     (grafts dropped). A single-compound `all` target is deliberately NOT a whole
 *     match — it is a sub-compound rewrite (`substituteSingleCompound`) — so this
 *     returns false for it.
 *
 * A memoized `branchText` fast-ACCEPT runs FIRST (equal serializations ⇒ match,
 * allocation-free — reuses the cached `Branch.key`, and preserves interp-empty parity
 * like `.a@{x}` vs `.a`). For a graft-bearing base an ATOM SUBSET reject precedes any
 * fork: a target text atom no base branch can supply (grafts walked) makes the match
 * impossible, so it bails before a single OR-path is explored. The walk recurses BY
 * VALUE — numeric `(segIdx, simpleIdx)` cursors on the JS call stack, no cloned cursor
 * objects, no `valueOf()` — and is memoized on `(segIdx, findIdx)` so segment-graft
 * expansion stays polynomial.
 */
export function branchWholeMatch(b: Branch, target: Branch, partial: boolean): boolean {
  if (branchText(b) === branchText(target)) {
    return true;
  }
  // A single-compound `all` target is a sub-compound rewrite, never a whole-branch
  // append (the former `matchesWholeBranchSubset` P<2 guard). Exact mode still matches
  // a single compound by order-independent equality, so this gate is ALL-mode only.
  if (partial && target.segs.length < 2) {
    return false;
  }
  // GRAFT-FREE FAST PATH (the overwhelmingly-common candidate): with no crossable graft
  // anywhere in the base there is nothing to fork, so no atom Set, no memo Map, no `Walk`
  // and no recursion — a flat per-segment multiset compare (the former inline
  // `branchExactEquivalent` / `matchesWholeBranchSubset` loops), allocation-identical to
  // dev. The recursive cross-through machinery is reserved for the rare grafted base.
  if (!branchHasGraft(b)) {
    return flatWholeMatch(b.segs, target.segs, partial);
  }
  // ATOM FAST-REJECT (grafted base): every atom the target REQUIRES (its plain-text
  // simples across all segments) must be suppliable by the base — its bare text simples
  // plus every atom reachable inside a crossable graft. A required atom no branch
  // supplies is unmatchable, so bail before exploring any OR-path.
  const baseAtoms = new Set<string>();
  collectBranchAtoms(b, baseAtoms);
  for (const seg of target.segs) {
    for (const s of seg.compound.simples) {
      if (s.t === 'text' && !baseAtoms.has(s.text)) {
        return false;
      }
    }
  }
  // Memoize on (segIdx, findIdx) ONLY when the base has a lone-graft segment — the sole
  // source of segment-level forking. Without one the walk advances both cursors in
  // lockstep (linear), so no memo Map is allocated on that path either.
  const walk: Walk = {
    base: b.segs,
    target: target.segs,
    partial,
    memo: hasLoneGraftSeg(b) ? new Map<number, boolean>() : null,
    guard: 0,
    guardMax: (b.segs.length + 2) * (target.segs.length + 2)
  };
  return segMatch(walk, 0, 0);
}

/**
 * Flat whole-branch compare for a graft-FREE base: same segment count, every aligned
 * compound EXACT multiset-equal (or, ALL-mode, a multiset subset) with combinators
 * aligned (EXACT includes the head; ALL ignores the leading combinator). No fork, so no
 * allocation beyond the per-segment `multiset*` the compare already needs.
 */
function flatWholeMatch(base: readonly Seg[], target: readonly Seg[], partial: boolean): boolean {
  if (base.length !== target.length) {
    return false;
  }
  for (let k = 0; k < base.length; k++) {
    const bs = base[k]!;
    const ts = target[k]!;
    if (!combAligned(k, bs.comb, ts.comb, partial) || !compoundMatch(bs.compound, ts.compound, partial)) {
      return false;
    }
  }
  return true;
}

/**
 * Walk `base`/`target` segments together from the head. A base segment that is a LONE
 * crossable graft forks its OR-arms into a segment span (`segSpanMatch`, exact only);
 * every other base segment consumes exactly ONE target segment (combinator-aligned
 * compound match). Success is BOTH cursors exhausted. Recurses BY VALUE (only the
 * `(si, fi)` numeric cursors vary; `w` is invariant, passed by reference); memoized on
 * `(si, fi)` when `w.memo` is non-null so segment-graft expansion stays polynomial.
 */
function segMatch(w: Walk, si: number, fi: number): boolean {
  if (si === w.base.length) {
    return fi === w.target.length;
  }
  if (fi === w.target.length || w.guard++ > w.guardMax) {
    return false;
  }
  const key = w.memo ? si * (w.target.length + 1) + fi : 0;
  if (w.memo) {
    const cached = w.memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
  }
  const bSeg = w.base[si]!;
  const graft = w.partial ? null : loneGraftSimple(bSeg.compound);
  let result: boolean;
  if (graft) {
    result = false;
    for (const arm of graft.branches) {
      if (segSpanMatch(w, si, bSeg.comb, arm, fi)) {
        result = true;
        break;
      }
    }
  } else {
    const fSeg = w.target[fi]!;
    result =
      combAligned(fi, bSeg.comb, fSeg.comb, w.partial)
      && compoundMatch(bSeg.compound, fSeg.compound, w.partial)
      && segMatch(w, si + 1, fi + 1);
  }
  if (w.memo) {
    w.memo.set(key, result);
  }
  return result;
}

/**
 * Consume a lone-graft base segment's OR-arm as a segment SPAN: the arm's segments
 * graft in at `fi` (the arm's first segment takes the parent graft segment's `headComb`,
 * the rest their own), each an EXACT combinator-aligned compound match. On success the
 * outer walk resumes past the consumed span. Exact-mode only (the caller gates it).
 */
function segSpanMatch(w: Walk, si: number, headComb: Seg['comb'], arm: Branch, fi: number): boolean {
  const armSegs = arm.segs;
  if (fi + armSegs.length > w.target.length) {
    return false;
  }
  for (let k = 0; k < armSegs.length; k++) {
    const aSeg = armSegs[k]!;
    const fSeg = w.target[fi + k]!;
    const comb = k === 0 ? headComb : aSeg.comb;
    if (comb !== fSeg.comb || !compoundMatch(aSeg.compound, fSeg.compound, false)) {
      return false;
    }
  }
  return segMatch(w, si + 1, fi + armSegs.length);
}

/** Head-combinator rule: EXACT aligns every combinator including the leading one; ALL
 *  ignores the leading combinator (`fi === 0`) and aligns only internal ones. */
function combAligned(fi: number, bComb: Seg['comb'], fComb: Seg['comb'], partial: boolean): boolean {
  return partial && fi === 0 ? true : bComb === fComb;
}

/**
 * Match one target compound against one base compound. EXACT: order-independent
 * multiset EQUALITY of the serialized simples (grafts as opaque tokens), OR — when the
 * base carries a graft — a positional cross THROUGH it (`compoundCross`). ALL: the
 * target's plain-text simples are a multiset SUBSET of the base's (grafts dropped, as
 * the former `matchesWholeBranchSubset`).
 */
function compoundMatch(baseC: Compound, findC: Compound, partial: boolean): boolean {
  if (partial) {
    return multisetSubset(textSimples(findC), textSimples(baseC));
  }
  if (multisetEqual(simpleTexts(baseC), simpleTexts(findC))) {
    return true;
  }
  return compoundHasGraft(baseC)
    && compoundCross(baseC.simples, baseC.simples.length - 1, findC.simples, findC.simples.length - 1);
}

/**
 * EXACT positional cross of one base compound's simples through its crossable grafts.
 * Two cursors walk `base`/`find` back-to-front: a base TEXT simple must equal the
 * aligned find text simple; a base GRAFT forks over its single-segment OR-arms
 * (`consumeArm`), the first that lets the remaining cursors exhaust winning (a
 * descendant span cannot fit inside a compound, so multi-segment arms are skipped —
 * they are the lone-graft SEGMENT case handled by `segSpanMatch`). Success is BOTH
 * cursors exhausted. Recurses BY VALUE (the two numeric cursor indices).
 */
function compoundCross(base: readonly Simple[], bi: number, find: readonly Simple[], fi: number): boolean {
  if (bi < 0) {
    return fi < 0;
  }
  if (fi < 0) {
    return false;
  }
  const bs = base[bi]!;
  if (bs.t === 'text') {
    const fs = find[fi]!;
    return fs.t === 'text' && fs.text === bs.text && compoundCross(base, bi - 1, find, fi - 1);
  }
  for (const arm of bs.branches) {
    if (arm.segs.length !== 1) {
      continue;
    }
    const nf = consumeArm(arm.segs[0]!.compound.simples, find, fi);
    if (nf !== NO_MATCH && compoundCross(base, bi - 1, find, nf)) {
      return true;
    }
  }
  return false;
}

/**
 * Consume a single-segment graft arm's `inner` simples against `find` back-to-front
 * from `fi`, returning the new find cursor (may be `-1` when fully consumed) or
 * `NO_MATCH`. Text-only positional match; a non-text inner simple bails.
 */
function consumeArm(inner: readonly Simple[], find: readonly Simple[], fi: number): number {
  let f = fi;
  for (let j = inner.length - 1; j >= 0; j--) {
    const innerSimple = inner[j]!;
    if (f < 0 || innerSimple.t !== 'text') {
      return NO_MATCH;
    }
    const fs = find[f]!;
    if (fs.t !== 'text' || fs.text !== innerSimple.text) {
      return NO_MATCH;
    }
    f--;
  }
  return f;
}

/** True when any of a compound's simples is a crossable `:is()` graft. */
function compoundHasGraft(c: Compound): boolean {
  for (const s of c.simples) {
    if (s.t === 'is') {
      return true;
    }
  }
  return false;
}

/** True when any segment of a branch carries a crossable `:is()` graft. */
function branchHasGraft(b: Branch): boolean {
  for (const seg of b.segs) {
    if (compoundHasGraft(seg.compound)) {
      return true;
    }
  }
  return false;
}

/** The lone `:is()` graft when a compound is exactly one crossable graft simple, else
 *  null — the segment-level expansion case (`:is(.a .b, .c) .d`). */
function loneGraftSimple(c: Compound): Extract<Simple, { t: 'is' }> | null {
  return c.simples.length === 1 && c.simples[0]!.t === 'is' ? c.simples[0]! : null;
}

/** True when a branch has a segment that is exactly one crossable graft — the only
 *  source of segment-level forking, so the memo is allocated only for these bases. */
function hasLoneGraftSeg(b: Branch): boolean {
  for (const seg of b.segs) {
    if (loneGraftSimple(seg.compound)) {
      return true;
    }
  }
  return false;
}

/**
 * Rewrite ONE branch for an `all` sub-match: substitute the matched span in
 * place, and recurse into any `:is()` grafts. Returns a new branch if changed.
 */
function rewriteBranchPartial(
  b: Branch,
  target: Branch,
  extenders: Branch[],
  partial: boolean,
  extenderKeys: Set<string>,
  targetAtoms: Set<string>,
  outerSurrounding: readonly string[]
): Branch | null {
  const before = branchText(b);
  let work = cloneBranch(b);

  // (1) recurse into `:is()` grafts (transitive chaining lives inside them).
  work = recurseIntoGrafts(work, target, extenders, partial, extenderKeys, targetAtoms, outerSurrounding);

  // (2) span substitution against the (possibly graft-updated) branch.
  if (target.segs.length === 1) {
    work = substituteSingleCompound(work, target.segs[0]!.compound, extenders, outerSurrounding);
  } else {
    work = substituteMultiCompound(work, target, extenders);
  }

  return branchText(work) !== before ? work : null;
}

/** Recurse an instruction into every `:is()` graft simple in the branch. A graft
 * `:is(<inner>)` distributes back over its compound's BARE text simples, so those
 * simples (unioned with the inherited `outerSurrounding`) become the outer conflict
 * context threaded into the inner apply — keeping the element/id guard aware of the
 * full enclosing compound one level down. */
function recurseIntoGrafts(
  b: Branch,
  target: Branch,
  extenders: Branch[],
  partial: boolean,
  extenderKeys: Set<string>,
  targetAtoms: Set<string>,
  outerSurrounding: readonly string[]
): Branch {
  return mkBranch(
    b.segs.map((seg) => {
      let graftOuter = outerSurrounding;
      for (const s of seg.compound.simples) {
        if (s.t === 'text') {
          graftOuter = graftOuter === outerSurrounding ? [...outerSurrounding, s.text] : [...graftOuter, s.text];
        }
      }
      return {
        comb: seg.comb,
        compound: {
          simples: seg.compound.simples.map((s): Simple => {
            if (s.t !== 'is') {
              return s;
            }
            const inner = applyInstruction(s.branches, target, extenders, partial, extenderKeys, targetAtoms, false, graftOuter);
            return inner ? { t: 'is', branches: inner } : s;
          })
        }
      };
    })
  );
}

/**
 * ELEMENT/ID CONFLICT GUARD. The matched compound is about to be wrapped as
 * `<surrounding>:is(<matched>, <extenders…>)`; on serialization each extender
 * distributes back over `surrounding`, so an extender whose TERMINAL compound would
 * place a SECOND distinct element type or a SECOND distinct id alongside `surrounding`
 * forms invalid CSS and must NOT be wrapped. Returns the extenders that survive.
 *
 * The rejection is PER EXTENDER, not all-or-nothing: a folded group can pair a benign
 * extender (`.b`) with a conflicting one (`span`), and only the conflicting one is
 * dropped — the tree-v1 `partialWrapMayConflict` reject applied at extender
 * granularity. When nothing conflicts the input array is returned as-is (no
 * allocation on the common path). See `./conflict.ts`.
 */
function nonConflictingExtenders(surrounding: readonly string[], extenders: Branch[]): Branch[] {
  let kept: Branch[] | null = null;
  for (let i = 0; i < extenders.length; i++) {
    const e = extenders[i]!;
    const lastSeg = e.segs[e.segs.length - 1];
    if (lastSeg && wouldConflict(surrounding, textSimples(lastSeg.compound))) {
      // First conflict: materialize the survivors seen so far, then skip this one.
      kept ??= extenders.slice(0, i);
    } else if (kept !== null) {
      kept.push(e);
    }
  }
  return kept ?? extenders;
}

/** The matched compound's simples left OUTSIDE the `:is()` wrap (bare text simples not
 * pulled in by `needSet`), unioned with the enclosing-graft `outerSurrounding`. This is
 * the full compound context an extender must not conflict with. */
function surroundingOf(compound: Compound, needSet: Set<string>, outerSurrounding: readonly string[]): string[] {
  const out: string[] = outerSurrounding.length > 0 ? [...outerSurrounding] : [];
  for (const s of compound.simples) {
    if (s.t === 'text' && !needSet.has(s.text)) {
      out.push(s.text);
    }
  }
  return out;
}

/** Substitute a single-compound target inside every matching compound. */
function substituteSingleCompound(b: Branch, targetCompound: Compound, extenders: Branch[], outerSurrounding: readonly string[]): Branch {
  const need = textSimples(targetCompound);
  const needSet = new Set(need);
  const segs = b.segs.map((seg) => {
    const have = textSimples(seg.compound);
    if (!multisetSubset(need, have)) {
      return seg;
    }
    // Drop any extender whose wrap would form an invalid two-type / two-id compound
    // with the surrounding context (graft-inherited outer context included). If none
    // survive, leave this segment — and, if nothing else changes, the branch — as authored.
    const kept = nonConflictingExtenders(surroundingOf(seg.compound, needSet, outerSurrounding), extenders);
    if (kept.length === 0) {
      return seg;
    }
    if (need.length > 1) {
      return { comb: seg.comb, compound: collapseMatchedAtoms(seg.compound, needSet, targetCompound, kept) };
    }
    // single-simple target: wrap each matched slot individually (deduping a
    // self-extend's `:is(x, x)` down to `x`).
    return {
      comb: seg.comb,
      compound: {
        simples: seg.compound.simples.flatMap((s): Simple[] =>
          s.t === 'text' && needSet.has(s.text)
            ? isOrPlainSimples([descendantBranch([cloneSimple(s)]), ...kept])
            : [cloneSimple(s)]
        )
      }
    };
  });
  return mkBranch(segs);
}

/** Collapse contiguous matched atoms into one `:is(<matched>, ext)`, keep the rest. */
function collapseMatchedAtoms(
  compound: Compound,
  needSet: Set<string>,
  targetCompound: Compound,
  extenders: Branch[]
): Compound {
  const matchedBranch = descendantBranch([{ t: 'text', text: compoundText(targetCompound) }]);
  const out: Simple[] = [];
  let placed = false;
  for (const s of compound.simples) {
    if (s.t === 'text' && needSet.has(s.text)) {
      if (!placed) {
        out.push(...isOrPlainSimples([matchedBranch, ...extenders]));
        placed = true;
      }
      // subsequent matched atoms are subsumed by the :is()
    } else {
      out.push(cloneSimple(s));
    }
  }
  return { simples: out };
}

/**
 * Substitute a multi-compound (P>1) target span in place. Finds a contiguous
 * segment run whose compounds each superset the target compounds and whose
 * internal combinators align; collapses the span into one `:is(span, ext)`.
 */
function substituteMultiCompound(b: Branch, target: Branch, extenders: Branch[]): Branch {
  const P = target.segs.length;
  const segs = b.segs;
  for (let start = 0; start + P <= segs.length; start++) {
    let ok = true;
    for (let k = 0; k < P; k++) {
      const ts = target.segs[k]!;
      const bs = segs[start + k]!;
      if (!multisetSubset(textSimples(ts.compound), textSimples(bs.compound))) {
        ok = false;
        break;
      }
      if (k > 0 && ts.comb !== bs.comb) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      continue;
    }
    // Build the matched span text (segments start..start+P-1, internal combinators).
    const spanSegs: Seg[] = [];
    for (let k = 0; k < P; k++) {
      const bs = segs[start + k]!;
      spanSegs.push({ comb: k === 0 ? ' ' : bs.comb, compound: { simples: bs.compound.simples.map(cloneSimple) } });
    }
    const isSeg: Seg = {
      comb: start === 0 ? ' ' : segs[start]!.comb,
      compound: { simples: isOrPlainSimples([mkBranch(spanSegs), ...extenders]) }
    };
    const outSegs: Seg[] = [];
    for (let i = 0; i < segs.length; i++) {
      if (i < start || i >= start + P) {
        outSegs.push(cloneSeg(segs[i]!));
      } else if (i === start) {
        outSegs.push(isSeg);
      }
    }
    return mkBranch(outSegs);
  }
  return b;
}
