/**
 * Selector IR for the extend engine.
 *
 * A small self-contained selector model built from `ComplexSelector`/`CompoundSelector` tokens
 * with no node cloning. Every downstream phase (PLAN / SOLVE / EMIT) operates on
 * this IR and serializes it back to selector text. This module owns the data
 * shapes plus the text, clone, from-AST, and atom primitives they all share.
 */

import { renderCombinator } from '../node.js';
import type { Combinator } from '../node.js';
import { complexHasInterp, simpleTokenText } from '../nodes.js';
import type { ComplexSelector, SelectorList, SelectorTerm, SimpleToken } from '../nodes.js';

/* --------------------------------------------------------------------- types */

/** A simple-selector token: plain text (`.a`, `&`, `[x]`) or an `:is()` group. */
export type Simple = { t: 'text'; text: string } | { t: 'is'; branches: Branch[] };

/** A run of simple tokens with no separator (`.a.b`). */
export interface Compound {
  simples: Simple[];
}

/** One `(combinator, compound)` segment. The head segment's `comb` is the
 * leading combinator (`' '` when none). */
export interface Seg {
  comb: Combinator;
  compound: Compound;
}

/** A complex selector branch: an ordered list of segments.
 *
 * [import:reference] `hidden` is the branch's VISIBILITY provenance: true when the
 * branch originates from a `(reference)`-imported (hidden) rule — its own seed, or
 * an extender folded in from a hidden rule. Absent/false ⇒ visible. It is ORTHOGONAL
 * to the selector text (every text/serialize op ignores it; clone preserves it), so
 * a document with no reference imports carries it false everywhere and the extend
 * engine is byte-identical. The serializer drops all-hidden rules and the hidden
 * branches of a mixed rule. */
export interface Branch {
  segs: Seg[];

  /**
   * Memoized `branchText(this)`. PRE-DECLARED (initialized `undefined`) by the sole
   * `mkBranch` factory so every branch is born with this field, and `branchText`'s
   * `b.key = out` write is an in-place value store — never a `{segs}`→`{segs,key}`
   * hidden-class transition (V8 invariant 1 / R4). Sound because branches are never
   * mutated in place: every transform builds a FRESH branch, so a branch's `segs`
   * (hence its text) is fixed for its lifetime. `hidden`/`ext` are provenance only
   * and ignored by `branchText`, so stamping them after a text read cannot stale it. */
  key?: string;

  /**
   * [&-boundary] Per-SEGMENT ampersand-compose origin, one `Int8Array` entry per
   * `segs[i]`. `bnd[i] === 0` ⇒ the segment is the ruleset's OWN-LOCAL selector;
   * `bnd[i] === k > 0` ⇒ it was spliced in from the k-th enclosing ancestor by an
   * `&`-compose (`composePath`). PRE-DECLARED `undefined` by the sole `mkBranch`
   * factory (exactly like `key`) so a later `b.bnd = …` write lands on an existing
   * field — never a hidden-class transition (V8 invariant 1 / R4). A branch with no
   * boundary information (a bare target, an `:is()`-arg sub-branch) leaves it
   * `undefined`, which every reader treats as "all own-local". `branchText`,
   * `collectBranchAtoms`, `textSimples`, `branchSharesAtom` all IGNORE it (it is
   * origin provenance, not selector text); `cloneBranch` copies it. */
  bnd?: Int8Array;
  hidden?: boolean;

  /** [import:reference] true when this branch was PRODUCED by an extend (a folded-in
   * extender), false/absent for an original seed branch. Chaining an extend off a
   * HIDDEN extender branch yields a hidden result (matching less.js's per-chain
   * `visibilityInfo`), whereas an extend off an original hidden seed keeps the
   * extender's own visibility — so the two must be told apart. */
  ext?: boolean;
}

/**
 * The SOLE Branch factory. Every branch is born `{ segs, key: undefined }` so the
 * `branchText` memo write lands on a pre-declared field (one hidden class on the
 * fixpoint's hot path). `hidden`/`ext` are stamped after construction by the
 * provenance-carrying sites (`cloneBranch`, `buildContribs`), exactly as before. */
export function mkBranch(segs: Seg[]): Branch {
  return { segs, key: undefined, bnd: undefined };
}

/** A selector list level (a rule's own-local alternatives / an `:is()` arg). */
export type Level = Branch[];

/* ----------------------------------------------------------------- serialize */

export function simpleText(s: Simple): string {
  if (s.t === 'text') {
    return s.text;
  }
  return `:is(${s.branches.map(branchText).join(', ')})`;
}

export function compoundText(c: Compound): string {
  let out = '';
  for (const s of c.simples) {
    out += simpleText(s);
  }
  return out;
}

export function branchText(b: Branch): string {
  if (b.key !== undefined) {
    return b.key;
  }
  let out = '';
  for (let i = 0; i < b.segs.length; i++) {
    const seg = b.segs[i]!;
    if (i === 0) {
      if (seg.comb !== ' ') {
        out += renderCombinator(seg.comb).trimStart();
      }
      out += compoundText(seg.compound);
    } else {
      out += renderCombinator(seg.comb) + compoundText(seg.compound);
    }
  }
  b.key = out;
  return out;
}

/* ---------------------------------------------------------------- construct */

/** A single-segment descendant branch wrapping the given simples. */
export function descendantBranch(simples: Simple[]): Branch {
  return mkBranch([{ comb: ' ', compound: { simples } }]);
}

/** An `:is(...)` simple wrapping the given branches. */
export function isSimple(branches: Branch[]): Simple {
  return { t: 'is', branches: branches.map(cloneBranch) };
}

/**
 * The substitution simples for an `all` sub-match: DEDUP identical branches, and
 * when a single unique single-segment branch survives, INLINE its compound simples
 * instead of an `:is(...)` wrap. A self-extend (`.class:extend(.class all)`) or any
 * extender equal to the matched span would otherwise emit `:is(x, x)`; since
 * `:is(x, x)` and `:is(x)` are both semantically `x`, this is a byte-transparent
 * collapse that never alters a group of genuinely-distinct branches. Returns the
 * simple(s) to splice in place of the matched slot.
 */
export function isOrPlainSimples(branches: Branch[]): Simple[] {
  const seen = new Set<string>();
  const uniq: Branch[] = [];
  for (const b of branches) {
    const k = branchText(b);
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(b);
    }
  }
  if (uniq.length === 1 && uniq[0]!.segs.length === 1) {
    return uniq[0]!.segs[0]!.compound.simples.map(cloneSimple);
  }
  return [isSimple(uniq)];
}

/* --------------------------------------------------------------------- clone */

export function cloneSimple(s: Simple): Simple {
  return s.t === 'text' ? { t: 'text', text: s.text } : { t: 'is', branches: s.branches.map(cloneBranch) };
}

export function cloneSeg(seg: Seg): Seg {
  return { comb: seg.comb, compound: { simples: seg.compound.simples.map(cloneSimple) } };
}

export function cloneBranch(b: Branch): Branch {
  /*
   * [import:reference] `hidden`/`ext` are provenance, not text — preserve them across
   * every clone so a branch's visibility survives compose/solve/compaction unchanged.
   */
  const out: Branch = mkBranch(b.segs.map(cloneSeg));

  /*
   * [&-boundary] `bnd` is per-segment origin provenance, not text — carry it across
   * every clone (a fresh `Int8Array`, since a clone's segs are a fresh array too).
   */
  if (b.bnd) {
    out.bnd = Int8Array.from(b.bnd);
  }
  if (b.hidden) {
    out.hidden = true;
  }
  if (b.ext) {
    out.ext = true;
  }
  return out;
}

/* ------------------------------------------------------------------ from AST */

/**
 * Build the IR simple for one selector token.
 *
 * A CROSSABLE structured pseudo (`:is(...)`/`:matches(...)`) with a concrete arg
 * list and NO interpolation anywhere in that list becomes the structured
 * `{ t: 'is' }` graft the whole-branch matcher forks through (`branchWholeMatch`). Every other
 * token flattens to its canonical text via `simpleTokenText`, exactly as before:
 *   - a SEALED pseudo (`:where`/`:not`/`:has`/…, `crossable === false`) stays an
 *     opaque `:where(…)` text token — its arg is not a boundary extend may cross;
 *   - a degrade-to-opaque pseudo (`args === null`) keeps its retained `text`;
 *   - a `@{…}`-interpolated token (`text: null`) contributes `''` — its concrete
 *     text is only known in an entering frame the extend engine cannot access.
 *
 * The interp guard is load-bearing: an arg list that only resolves under
 * interpolation must stay opaque (each `@{…}` contributes `''`) rather than a
 * structured branch the matcher would treat as concrete atoms — the engine has no
 * frame to materialize it. Structuring is byte-transparent to serialization: a
 * `{ t: 'is' }` graft renders via `simpleText` to the same `:is(a, b)` join as
 * `pseudoCanonical`, so a document with no matching extend is unchanged.
 */
function simpleFromToken(sim: SimpleToken): Simple {
  if (
    sim.type === 'PseudoSelector'
    && sim.crossable
    && sim.args !== null
    && sim.interp === null
    && !sim.args.selectors.some(complexHasInterp)
  ) {
    return { t: 'is', branches: levelFromSelectorList(sim.args) };
  }
  return { t: 'text', text: simpleTokenText(sim) };
}

function compoundFromTokens(simples: SimpleToken[]): Compound {
  return { simples: simples.map(simpleFromToken) };
}

function termFromSelector(term: SelectorTerm): Compound {
  return term.type === 'CompoundSelector'
    ? compoundFromTokens(term.value)
    : compoundFromTokens([term]);
}

export function branchFromComplex(c: ComplexSelector): Branch {
  const segs: Seg[] = [];
  let first = true;
  let pendingComb: Combinator = c.leadingComb ?? ' ';
  for (const part of c.value) {
    if (typeof part === 'string') {
      pendingComb = part;
      continue;
    }
    segs.push({
      comb: first ? (c.leadingComb ?? ' ') : pendingComb,
      compound: termFromSelector(part)
    });
    first = false;
  }
  return segs.length === 0 ? mkBranch([{ comb: ' ', compound: { simples: [] } }]) : mkBranch(segs);
}

export function levelFromSelectorList(list: SelectorList): Level {
  return list.selectors.map(branchFromComplex);
}

/* --------------------------------------------------------------------- atoms */

/** Multiset of a compound's plain-text simples (ignores `:is` grafts). */
export function textSimples(c: Compound): string[] {
  const out: string[] = [];
  for (const s of c.simples) {
    if (s.t === 'text') {
      out.push(s.text);
    }
  }
  return out;
}

/**
 * Collect every individual plain-text simple atom in a branch into `out`,
 * RECURSING into `:is()` grafts. This is the atom granularity/normalization the
 * matcher actually uses: compounds are split per-simple (`.a.b` → `.a`, `.b`,
 * exactly like `textSimples`/`multisetSubset`), grafts are walked so simples that
 * only appear inside an `:is()` (`:is(.p1, .p2) .c` → `.p1`, `.p2`, `.c`) are
 * captured — never dropped the way `textSimples` drops grafts. Text is taken RAW
 * (case-sensitive, no trim/fold), the same `branchFromComplex` → `s.text ?? ''`
 * value both sides carry.
 */
export function collectBranchAtoms(b: Branch, out: Set<string>): void {
  for (const seg of b.segs) {
    for (const s of seg.compound.simples) {
      if (s.t === 'text') {
        out.add(s.text);
      } else {
        for (const inner of s.branches) {
          collectBranchAtoms(inner, out);
        }
      }
    }
  }
}

/**
 * True when some atom of `branch` (graft-recursive, per the same extraction as
 * `collectBranchAtoms`) is in `atoms`. Direct set-intersection — no per-subject
 * atom Set is allocated. Used by the target-atom PREFILTER to prove a subject's
 * seed can neither match nor chain any instruction target before running solve.
 */
export function branchSharesAtom(b: Branch, atoms: Set<string>): boolean {
  for (const seg of b.segs) {
    for (const s of seg.compound.simples) {
      if (s.t === 'text') {
        if (atoms.has(s.text)) {
          return true;
        }
      } else if (s.branches.some(inner => branchSharesAtom(inner, atoms))) {
        return true;
      }
    }
  }
  return false;
}

/** True when `need` (multiset) ⊆ `have` (multiset). */
export function multisetSubset(need: string[], have: string[]): boolean {
  const counts = new Map<string, number>();
  for (const h of have) {
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  for (const n of need) {
    const c = counts.get(n) ?? 0;
    if (c <= 0) {
      return false;
    }
    counts.set(n, c - 1);
  }
  return true;
}

/**
 * True when `a` and `b` are EQUAL multisets — same elements with the same counts.
 * This is `multisetSubset` in BOTH directions (each ⊆ the other), computed in one
 * pass off the equal-length invariant: same length + `a` ⊆ `b` ⟹ equal. Exact-mode
 * whole-branch equivalence needs equality (consume-ALL: `.b.b.c` must NOT equal
 * `.b.c`), not the one-directional subset the `all` sub-part path uses.
 */
export function multisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const x of a) {
    counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  for (const y of b) {
    const c = counts.get(y) ?? 0;
    if (c <= 0) {
      return false;
    }
    counts.set(y, c - 1);
  }
  return true;
}

/**
 * The full serialized simples of a compound, INCLUDING `:is()` grafts (each graft is
 * one opaque `:is(...)` token). Unlike `textSimples` (plain-text simples only, grafts
 * dropped) this keeps grafts as tokens so a multiset comparison over the result treats
 * `.a` and `.a:is(.b)` as distinct — matching the pre-fix `branchText` string equality,
 * which the exact-mode equivalence must not loosen. Order-independent by construction:
 * the caller multiset-compares, so simple order within the compound is irrelevant.
 */
export function simpleTexts(c: Compound): string[] {
  return c.simples.map(simpleText);
}
