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
  const targetKey = branchText(target);
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
    // Whole-branch match → append extenders as siblings. Exact mode matches by
    // selector EQUIVALENCY (EXTEND_RULES §0), not serialization: `.b.c` and `.c.b`
    // are the same selector, so the decision is order-independent multiset-equal
    // compounds with aligned combinators (`branchExactEquivalent`), NOT `branchText`
    // equality. A multi-segment target also matches an `:is()`-grafted branch whose
    // expansion equals the target (`.replace.replace .replace` vs
    // `:is(.replace.replace, …) .replace`).
    if (
      branchExactEquivalent(b, target)
      || (target.segs.length > 1 && branchExpansions(b).includes(targetKey))
      || (b.segs.length === 1 && target.segs.length === 1
        && compoundExhaustive(b.segs[0]!.compound, target.segs[0]!.compound))
    ) {
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
      if (matchesWholeBranchSubset(b, target)) {
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
 * `applyInstruction` uses for a whole-branch (exact/all) hit: an identical key,
 * a multi-segment target equal to one of `b`'s `:is()`-graft expansions, or (for
 * an `all` match) a multi-segment compound-subset of the entire branch. This is
 * the "the extender becomes a SIBLING of the whole complex" signal the nested
 * re-projection reads to decide a cross-`&` flatten (a foreign whole-complex
 * sibling cannot be expressed as a local own-local rewrite). A single-compound
 * `all` sub-match (which rewrites a compound IN PLACE, never appends a whole
 * sibling) is deliberately NOT a whole match.
 */
export function branchWholeMatches(b: Branch, target: Branch, partial: boolean): boolean {
  if (branchExactEquivalent(b, target)) {
    return true;
  }
  const targetKey = branchText(target);
  if (target.segs.length > 1 && branchExpansions(b).includes(targetKey)) {
    return true;
  }
  if (partial && matchesWholeBranchSubset(b, target)) {
    return true;
  }
  return false;
}

/**
 * Order-independent WHOLE-branch equivalence for EXACT (non-`all`) mode: `b` and
 * `target` select the same elements (EXTEND_RULES §0). The criterion is structural,
 * not textual — it REPLACES the former `branchText(b) === branchText(target)` exact
 * test, which missed reordered compounds (`.b.c` vs `.c.b` produced NO extend):
 *
 *   - same number of segments;
 *   - each aligned segment's compound is MULTISET-EQUAL — order of simples is
 *     irrelevant, but consume-ALL (a strict subset like `.b.b.c` vs `.b.c` is NOT
 *     equal, so it correctly does not match in exact mode);
 *   - combinators align left-to-right, INCLUDING the head (leading) combinator, so
 *     `.a .b` never matches `.a > .b` / `.a + .b`.
 *
 * `:is()` grafts are compared as opaque `:is(...)` tokens (via `simpleTexts`).
 *
 * A memoized `branchText` equality is tried FIRST as a fast-ACCEPT (EXTEND_RULES.md
 * early-exit: equal serializations ⇒ match). This is allocation-free (reuses the
 * cached `Branch.key`), keeps the hot common path off `simpleTexts`/`multisetEqual`,
 * and makes this a TRUE strict superset of the old `bKey === targetKey`: every pair the
 * string compare matched still matches (incl. interpolated simples that render empty,
 * e.g. `.a@{x}` vs `.a`), plus reordered compounds. The structural multiset comparison
 * runs ONLY when the serializations differ — the genuine order-independent case — never
 * as an early-exit FALSE.
 */
export function branchExactEquivalent(b: Branch, target: Branch): boolean {
  if (branchText(b) === branchText(target)) {
    return true;
  }
  const bSegs = b.segs;
  const tSegs = target.segs;
  if (bSegs.length !== tSegs.length) {
    return false;
  }
  for (let k = 0; k < bSegs.length; k++) {
    const bs = bSegs[k]!;
    const ts = tSegs[k]!;
    if (bs.comb !== ts.comb) {
      return false;
    }
    if (!multisetEqual(simpleTexts(bs.compound), simpleTexts(ts.compound))) {
      return false;
    }
  }
  return true;
}

/** Sentinel for a find cursor that could not consume a graft branch. Distinct from
 *  `-1` (a legitimately exhausted find cursor). */
const NO_MATCH = -2;

/**
 * EXACT-mode whole-compound match THROUGH crossable `:is()` grafts. Both `base`
 * and `find` are one segment's simples (the caller gates `b.segs.length === 1 &&
 * target.segs.length === 1`); the base may carry structured `{ t: 'is' }` grafts
 * (authored `:is()`/`:matches()`), the find is plain text. Turns C1
 * (`.x:is(.a, .b)` matched by `.x.a`) and C4 (`.x:is(.a, .b).c` by `.x.a.c`) into
 * whole-branch appends — the extender becomes a comma sibling via the existing
 * append path, with no emit change.
 *
 * FAST-REJECT precedes any fork: a graft-free base can add nothing beyond the
 * caller's order-independent `branchExactEquivalent`, and a find atom no branch can
 * supply makes the match impossible — both bail before a single OR-path is walked.
 * The walk itself (`cursorMatch`) recurses by VALUE (numeric cursor indices on the
 * call stack): no cloned cursor objects, no `valueOf()`.
 */
function compoundExhaustive(base: Compound, find: Compound): boolean {
  // A graft-free base positional-matches the find iff it multiset-matches it, a
  // case `branchExactEquivalent` already decided FALSE upstream — so a base with no
  // `{ t: 'is' }` graft can never add a match here. This cheap gate keeps every
  // graft-free candidate (the overwhelming majority) off the atom Set + cursor.
  let hasGraft = false;
  for (const s of base.simples) {
    if (s.t === 'is') {
      hasGraft = true;
      break;
    }
  }
  if (!hasGraft) {
    return false;
  }
  // Every atom the find REQUIRES must be suppliable by the base — its bare text
  // simples plus every atom reachable inside a crossable graft (`collectBranchAtoms`
  // recurses grafts). A find atom no branch supplies is unmatchable, so bail without
  // exploring any OR-path. A find graft is outside this rung's positional cursor and
  // also bails here (the `s.t !== 'text'` guard).
  const baseAtoms = new Set<string>();
  collectCompoundAtoms(base, baseAtoms);
  for (const s of find.simples) {
    if (s.t !== 'text' || !baseAtoms.has(s.text)) {
      return false;
    }
  }
  return cursorMatch(base.simples, base.simples.length - 1, find.simples, find.simples.length - 1);
}

/** Collect every atom a compound can supply into `out`: its bare text simples plus,
 *  for each crossable graft, every atom reachable inside its branches. */
function collectCompoundAtoms(c: Compound, out: Set<string>): void {
  for (const s of c.simples) {
    if (s.t === 'text') {
      out.add(s.text);
    } else {
      for (const br of s.branches) {
        collectBranchAtoms(br, out);
      }
    }
  }
}

/**
 * Two cursors walk `base`/`find` back-to-front. A base TEXT simple must equal the
 * aligned find text simple. A base crossable GRAFT forks: each single-segment
 * OR-branch is consumed positionally against the find (`consumeBranch`), and the
 * first branch that lets the remaining cursors exhaust wins. Success is BOTH cursors
 * exhausted. Recurses by value — the cursor state is the two `number` indices.
 */
function cursorMatch(base: readonly Simple[], bi: number, find: readonly Simple[], fi: number): boolean {
  if (bi < 0) {
    return fi < 0;
  }
  if (fi < 0) {
    return false;
  }
  const bs = base[bi]!;
  if (bs.t === 'text') {
    const fs = find[fi]!;
    return fs.t === 'text' && fs.text === bs.text && cursorMatch(base, bi - 1, find, fi - 1);
  }
  // Crossable graft: fork over its OR-branches. Only a SINGLE-segment branch is
  // consumable inside one compound (a descendant span cannot fit in a compound).
  // `consumeBranch` bails on the first irreconcilable atom, so a branch whose
  // trailing atom != find[fi] never descends — the per-branch fast reject.
  for (const br of bs.branches) {
    if (br.segs.length !== 1) {
      continue;
    }
    const nf = consumeBranch(br.segs[0]!.compound.simples, find, fi);
    if (nf !== NO_MATCH && cursorMatch(base, bi - 1, find, nf)) {
      return true;
    }
  }
  return false;
}

/**
 * Consume a graft branch's `inner` simples against `find` back-to-front from `fi`,
 * returning the new find cursor (may be `-1` when the find is fully consumed) or
 * `NO_MATCH`. Text-only positional match — this rung's authored `:is()` args are
 * plain compounds; a non-text inner simple bails (deferred to a later rung).
 */
function consumeBranch(inner: readonly Simple[], find: readonly Simple[], fi: number): number {
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

/**
 * True when a MULTI-segment target compound-subset-matches the ENTIRE branch:
 * same segment count, each target compound ⊆ the aligned branch compound, and
 * internal combinators aligned. A whole-span match consumes the whole selector,
 * so the caller comma-appends the extenders rather than `:is()`-wrapping the
 * branch. Single-compound (P===1) targets are excluded — their sub-compound
 * matches carry in-compound context and are handled by `substituteSingleCompound`.
 */
function matchesWholeBranchSubset(b: Branch, target: Branch): boolean {
  const P = target.segs.length;
  if (P < 2 || P !== b.segs.length) {
    return false;
  }
  for (let k = 0; k < P; k++) {
    const ts = target.segs[k]!;
    const bs = b.segs[k]!;
    if (!multisetSubset(textSimples(ts.compound), textSimples(bs.compound))) {
      return false;
    }
    if (k > 0 && ts.comb !== bs.comb) {
      return false;
    }
  }
  return true;
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

/** Expand a branch's `:is()` grafts into the set of flat complex texts it denotes. */
function branchExpansions(b: Branch): string[] {
  let acc: Seg[][] = [[]];
  for (const seg of b.segs) {
    // A segment whose compound is a single `:is(...)` graft expands to its args.
    const single = seg.compound.simples.length === 1 ? seg.compound.simples[0]! : null;
    if (single && single.t === 'is') {
      const next: Seg[][] = [];
      for (const arg of single.branches) {
        for (const pre of acc) {
          // Graft the arg's segments in place (first arg-seg takes this seg's comb).
          const grafted = arg.segs.map((as, i) => ({
            comb: i === 0 ? seg.comb : as.comb,
            compound: as.compound
          }));
          next.push([...pre, ...grafted]);
        }
      }
      acc = next;
    } else {
      acc = acc.map(pre => [...pre, seg]);
    }
  }
  return acc.map(segs => branchText(mkBranch(segs)));
}
