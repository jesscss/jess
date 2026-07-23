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
  extenderHidden = false
): Branch[] | null {
  const targetKey = branchText(target);
  const out: Branch[] = [];
  const appends: Branch[] = [];
  let changed = false;

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
    if (branchExactEquivalent(b, target) || (target.segs.length > 1 && branchExpansions(b).includes(targetKey))) {
      out.push(b);
      for (const e of extenders) {
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
        for (const e of extenders) {
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
        const rewritten = rewriteBranchPartial(b, target, extenders, partial, extenderKeys, targetAtoms);
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
  targetAtoms: Set<string>
): Branch | null {
  const before = branchText(b);
  let work = cloneBranch(b);

  // (1) recurse into `:is()` grafts (transitive chaining lives inside them).
  work = recurseIntoGrafts(work, target, extenders, partial, extenderKeys, targetAtoms);

  // (2) span substitution against the (possibly graft-updated) branch.
  if (target.segs.length === 1) {
    work = substituteSingleCompound(work, target.segs[0]!.compound, extenders);
  } else {
    work = substituteMultiCompound(work, target, extenders);
  }

  return branchText(work) !== before ? work : null;
}

/** Recurse an instruction into every `:is()` graft simple in the branch. */
function recurseIntoGrafts(
  b: Branch,
  target: Branch,
  extenders: Branch[],
  partial: boolean,
  extenderKeys: Set<string>,
  targetAtoms: Set<string>
): Branch {
  return mkBranch(
    b.segs.map(seg => ({
      comb: seg.comb,
      compound: {
        simples: seg.compound.simples.map((s): Simple => {
          if (s.t !== 'is') {
            return s;
          }
          const inner = applyInstruction(s.branches, target, extenders, partial, extenderKeys, targetAtoms);
          return inner ? { t: 'is', branches: inner } : s;
        })
      }
    }))
  );
}

/** Substitute a single-compound target inside every matching compound. */
function substituteSingleCompound(b: Branch, targetCompound: Compound, extenders: Branch[]): Branch {
  const need = textSimples(targetCompound);
  const needSet = new Set(need);
  const segs = b.segs.map((seg) => {
    const have = textSimples(seg.compound);
    if (!multisetSubset(need, have)) {
      return seg;
    }
    if (need.length > 1) {
      return { comb: seg.comb, compound: collapseMatchedAtoms(seg.compound, needSet, targetCompound, extenders) };
    }
    // single-simple target: wrap each matched slot individually (deduping a
    // self-extend's `:is(x, x)` down to `x`).
    return {
      comb: seg.comb,
      compound: {
        simples: seg.compound.simples.flatMap((s): Simple[] =>
          s.t === 'text' && needSet.has(s.text)
            ? isOrPlainSimples([descendantBranch([cloneSimple(s)]), ...extenders])
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
