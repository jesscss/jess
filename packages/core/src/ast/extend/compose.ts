/**
 * Composition (nesting) — folds an ancestor path of selector levels into flat
 * branches exactly as the serializer composes authored nesting, including `&`
 * substitution against the parent context.
 *
 * [&-boundary] A `&`-compose now SPLICES the parent's segments in as SEPARATE
 * `Seg`s (`.f {…}` under `.outer .mid` yields the three segments `.outer .mid .leaf`,
 * never one embedded-space text simple), and every composed branch carries a
 * per-segment `bnd` origin (`0` = own-local, `k>0` = the k-th enclosing `&`-hop).
 * The `bnd` marker is what lets the matcher tell a match that stays inside the
 * ruleset's own selector from one that crosses (or lives entirely inside) the
 * ampersand — the structural replacement for the old text-prefix hoist heuristics.
 * Serialization is unchanged: a spliced multi-segment parent renders byte-identically
 * to the old collapsed text (`.outer .mid` either way).
 */

import {
  branchText,
  cloneBranch,
  cloneSeg,
  cloneSimple,
  descendantBranch,
  isSimple,
  mkBranch
} from './ir.js';
import type { Branch, Level, Seg, Simple } from './ir.js';

function branchHasAmp(b: Branch): boolean {
  for (const seg of b.segs) {
    for (const s of seg.compound.simples) {
      if (s.t === 'text') {
        if (s.text.includes('&')) {
          return true;
        }
      } else if (s.branches.some(branchHasAmp)) {
        return true;
      }
    }
  }
  return false;
}

/** The `bnd` origin of a branch's segment `k`, defaulting to own-local (`0`) when
 * the branch carries no origin array (a raw own-local level before any compose). No
 * allocation — the common no-nested-`&` branch reads its implicit `0` directly. */
function bndAt(b: Branch, k: number): number {
  return b.bnd ? b.bnd[k]! : 0;
}

/** Stamp `arr` as the branch's per-segment origin. `undefined` is left as-is (the
 * "all own-local" default); an all-zero array is elided so a document with no nested
 * `&`-compose carries no `bnd` allocation and every reader's `?? 0` default holds. */
function withBnd(b: Branch, arr: number[]): Branch {
  for (const v of arr) {
    if (v !== 0) {
      b.bnd = Int8Array.from(arr);
      return b;
    }
  }
  return b;
}

/** True when a compound is exactly one bare `&` simple (`&`, as its own segment) —
 * the standalone ampersand that SPLICES the parent's segments in. A fused `.f&` or a
 * pure-`&` self-compound (`&&`) is NOT this case (handled by text substitution). */
function isBareAmp(seg: Seg): boolean {
  const s = seg.compound.simples;
  return s.length === 1 && s[0]!.t === 'text' && s[0]!.text === '&';
}

/**
 * Substitute every `&` in `child` against the parent selector, producing a branch
 * whose `bnd` records each output segment's origin. A STANDALONE `&` (its own
 * segment) splices the parent's SEGMENTS in place — separate `Seg`s carrying
 * `bnd = parentBnd + 1` — so a multi-segment parent (`.outer .mid`) stays matchable
 * per segment. A `&` FUSED into a compound alongside other simples keeps the prior
 * behavior: under a MULTI-segment parent it wraps in `:is(...)` so the compound
 * stays one element target (`.f&` → `.f:is(.outer .mid)`); under a single-compound
 * parent it substitutes the parent's bare text. Fused/own segments are `bnd = 0`.
 */
function substituteAmp(child: Branch, parent: Branch): Branch {
  const parentStr = branchText(parent);
  const parentMultiSeg = parent.segs.length > 1;
  const outSegs: Seg[] = [];
  const outBnd: number[] = [];
  for (const seg of child.segs) {
    if (isBareAmp(seg)) {
      // Splice the parent's segments in. The first spliced segment takes THIS `&`
      // segment's combinator (its position in the child complex); the rest keep the
      // parent's own internal combinators. Each carries the parent's origin + 1.
      for (let k = 0; k < parent.segs.length; k++) {
        const ps = parent.segs[k]!;
        outSegs.push({ comb: k === 0 ? seg.comb : ps.comb, compound: { simples: ps.compound.simples.map(cloneSimple) } });
        outBnd.push(bndAt(parent, k) + 1);
      }
      continue;
    }
    const fused = seg.compound.simples.length > 1;
    const wrap = parentMultiSeg && fused;
    const simples: Simple[] = [];
    for (const s of seg.compound.simples) {
      if (s.t === 'text' && s.text.includes('&')) {
        if (wrap) {
          // Splice `:is(parent)` in place of each `&`, preserving any fused text.
          const parts = s.text.split('&');
          for (let i = 0; i < parts.length; i++) {
            if (parts[i]!.length > 0) {
              simples.push({ t: 'text', text: parts[i]! });
            }
            if (i < parts.length - 1) {
              simples.push(isSimple([parent]));
            }
          }
        } else {
          simples.push({ t: 'text', text: s.text.split('&').join(parentStr) });
        }
      } else {
        simples.push(cloneSimple(s));
      }
    }
    // A fused/own segment is the ruleset's own element target (the parent is sealed
    // inside an `:is()` when wrapped), so it is own-local (`bnd = 0`).
    outSegs.push({ comb: seg.comb, compound: { simples } });
    outBnd.push(0);
  }
  return withBnd(mkBranch(outSegs), outBnd);
}

/** The parent token for composing a child under a multi-branch parent. */
function parentToken(parents: Branch[]): Branch {
  if (parents.length === 1) {
    return cloneBranch(parents[0]!);
  }
  // A multi-branch parent collapses to one sealed `:is(...)` segment; its inner
  // branches keep their own boundary provenance, but as a single top-level segment
  // it is one origin unit (own-local `0` here — the composeOne `+1` lifts it).
  return descendantBranch([isSimple(parents)]);
}

/** Compose one child branch under a parent token branch (mirrors serialize). */
function composeOne(parent: Branch, child: Branch): Branch {
  if (branchHasAmp(child)) {
    return substituteAmp(child, parent);
  }
  // Descendant: parent then space then child. The parent's segments shift one hop
  // deeper (origin + 1); the child's own segments keep their origin (own-local `0`).
  const outBnd: number[] = [];
  for (let k = 0; k < parent.segs.length; k++) {
    outBnd.push(bndAt(parent, k) + 1);
  }
  for (let k = 0; k < child.segs.length; k++) {
    outBnd.push(bndAt(child, k));
  }
  return withBnd(mkBranch([...parent.segs.map(cloneSeg), ...cloneBranch(child).segs]), outBnd);
}

/** Compose a child selector list under a parent selector list. */
function composeLevel(childBranches: Branch[], parentBranches: Branch[]): Branch[] {
  const token = parentToken(parentBranches);
  return childBranches.map(c => composeOne(token, c));
}

/**
 * Compose an ancestor path (outermost → own local) into a flat selector list,
 * wrapping a multi-branch inner level in `:is(...)` before composing (so the
 * parent is not distributed across the group). Every returned branch carries its
 * per-segment `bnd` origin.
 */
export function composePath(levels: Level[]): Branch[] {
  // The outermost level's own segments are own-local at this stage (`bnd = 0`); each
  // `composeLevel` step lifts the accumulated parent one hop deeper.
  let result = levels[0]!.map(cloneBranch);
  for (let i = 1; i < levels.length; i++) {
    result = composeLevel(levels[i]!, result);
  }
  return result;
}
