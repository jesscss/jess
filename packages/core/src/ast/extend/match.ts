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
  isSimple,
  multisetSubset,
  textSimples,
} from './ir.js';
import type { Branch, Compound, Seg, Simple } from './ir.js';

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
): Branch[] | null {
  const targetKey = branchText(target);
  const out: Branch[] = [];
  const appends: Branch[] = [];
  let changed = false;

  for (const b of list) {
    const bKey = branchText(b);
    // [import:reference] chaining an extend off a branch that was itself an extend
    // PRODUCT from a hidden rule (`b.ext && b.hidden`) yields a hidden result — the
    // less.js per-chain `visibilityInfo`. An extend off an ORIGINAL hidden seed
    // (`!b.ext`) keeps the extender's own visibility, so the seed's `hidden` does
    // NOT force the append hidden. `effHidden` folds both into one decision.
    const chainHidden = b.hidden === true && b.ext === true;
    const effHidden = extenderHidden || chainHidden;
    // Whole-branch match → append extenders as siblings. A multi-segment target
    // also matches an `:is()`-grafted branch whose expansion equals the target
    // (`.replace.replace .replace` vs `:is(.replace.replace, …) .replace`).
    if (bKey === targetKey || (target.segs.length > 1 && branchExpansions(b).includes(targetKey))) {
      out.push(b);
      for (const e of extenders) pushExtender(appends, e, chainHidden);
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
        for (const e of extenders) pushExtender(appends, e, chainHidden);
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
    const present = new Set(out.map(branchText));
    for (const e of appends) {
      const k = branchText(e);
      if (!present.has(k)) {
        out.push(e);
        present.add(k);
        changed = true;
      }
    }
  }
  return changed ? out : null;
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
 * True when a MULTI-segment target compound-subset-matches the ENTIRE branch:
 * same segment count, each target compound ⊆ the aligned branch compound, and
 * internal combinators aligned. A whole-span match consumes the whole selector,
 * so the caller comma-appends the extenders rather than `:is()`-wrapping the
 * branch. Single-compound (P===1) targets are excluded — their sub-compound
 * matches carry in-compound context and are handled by `substituteSingleCompound`.
 */
function matchesWholeBranchSubset(b: Branch, target: Branch): boolean {
  const P = target.segs.length;
  if (P < 2 || P !== b.segs.length) return false;
  for (let k = 0; k < P; k++) {
    const ts = target.segs[k]!;
    const bs = b.segs[k]!;
    if (!multisetSubset(textSimples(ts.compound), textSimples(bs.compound))) return false;
    if (k > 0 && ts.comb !== bs.comb) return false;
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
  targetAtoms: Set<string>,
): Branch {
  return {
    segs: b.segs.map((seg) => ({
      comb: seg.comb,
      compound: {
        simples: seg.compound.simples.map((s): Simple => {
          if (s.t !== 'is') return s;
          const inner = applyInstruction(s.branches, target, extenders, partial, extenderKeys, targetAtoms);
          return inner ? { t: 'is', branches: inner } : s;
        }),
      },
    })),
  };
}

/** Substitute a single-compound target inside every matching compound. */
function substituteSingleCompound(b: Branch, targetCompound: Compound, extenders: Branch[]): Branch {
  const need = textSimples(targetCompound);
  const needSet = new Set(need);
  const segs = b.segs.map((seg) => {
    const have = textSimples(seg.compound);
    if (!multisetSubset(need, have)) return seg;
    if (need.length > 1) {
      return { comb: seg.comb, compound: collapseMatchedAtoms(seg.compound, needSet, targetCompound, extenders) };
    }
    // single-simple target: wrap each matched slot individually.
    return {
      comb: seg.comb,
      compound: {
        simples: seg.compound.simples.map((s): Simple =>
          s.t === 'text' && needSet.has(s.text)
            ? isSimple([descendantBranch([cloneSimple(s)]), ...extenders])
            : cloneSimple(s),
        ),
      },
    };
  });
  return { segs };
}

/** Collapse contiguous matched atoms into one `:is(<matched>, ext)`, keep the rest. */
function collapseMatchedAtoms(
  compound: Compound,
  needSet: Set<string>,
  targetCompound: Compound,
  extenders: Branch[],
): Compound {
  const matchedBranch = descendantBranch([{ t: 'text', text: compoundText(targetCompound) }]);
  const out: Simple[] = [];
  let placed = false;
  for (const s of compound.simples) {
    if (s.t === 'text' && needSet.has(s.text)) {
      if (!placed) {
        out.push(isSimple([matchedBranch, ...extenders]));
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
    if (!ok) continue;
    // Build the matched span text (segments start..start+P-1, internal combinators).
    const spanSegs: Seg[] = [];
    for (let k = 0; k < P; k++) {
      const bs = segs[start + k]!;
      spanSegs.push({ comb: k === 0 ? ' ' : bs.comb, compound: { simples: bs.compound.simples.map(cloneSimple) } });
    }
    const isSeg: Seg = {
      comb: start === 0 ? ' ' : segs[start]!.comb,
      compound: { simples: [isSimple([{ segs: spanSegs }, ...extenders])] },
    };
    const outSegs: Seg[] = [];
    for (let i = 0; i < segs.length; i++) {
      if (i < start || i >= start + P) outSegs.push(cloneSeg(segs[i]!));
      else if (i === start) outSegs.push(isSeg);
    }
    return { segs: outSegs };
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
            compound: as.compound,
          }));
          next.push([...pre, ...grafted]);
        }
      }
      acc = next;
    } else {
      acc = acc.map((pre) => [...pre, seg]);
    }
  }
  return acc.map((segs) => branchText({ segs }));
}
