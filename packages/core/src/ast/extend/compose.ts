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

/** Strip every `&` from a ROOT-context branch, returning `null` when nothing but
 * `&` (and combinators) is left. A segment emptied by the strip is dropped along
 * with its combinator, so `& .x` yields `.x` — the structural equivalent of the
 * serializer's `value.split('&').join('').trim()`. The first surviving segment
 * takes a descendant combinator so a leading `>`/`+`/`~` never trails a parent
 * that no longer exists. Always returns a FRESH branch: path levels are shared by
 * reference across every descendant subject, so this must not mutate.
 *
 * A root branch with no `&` at all — every root level in a document that never
 * writes one — takes the plain clone this replaced, so its cost and its `bnd`
 * origin are unchanged. `hidden`/`ext` are provenance, not text, and survive the
 * strip; `bnd` cannot, since the strip drops segments it was aligned with (an
 * absent `bnd` reads as all-own-local, which is what a root level is). */
function stripRootAmp(b: Branch): Branch | null {
  if (!branchHasAmp(b)) {
    return cloneBranch(b);
  }
  const segs: Seg[] = [];
  for (const seg of b.segs) {
    const simples: Simple[] = [];
    for (const s of seg.compound.simples) {
      if (s.t !== 'text') {
        simples.push(cloneSimple(s));
        continue;
      }
      const text = s.text.split('&').join('');
      if (text.length > 0) {
        simples.push({ t: 'text', text });
      }
    }
    if (simples.length > 0) {
      segs.push({ comb: segs.length === 0 ? ' ' : seg.comb, compound: { simples } });
    }
  }
  if (segs.length === 0) {
    return null;
  }
  const out = mkBranch(segs);
  if (b.hidden) {
    out.hidden = true;
  }
  if (b.ext) {
    out.ext = true;
  }
  return out;
}

/**
 * [nesting] Normalize the ROOT level of a path — the IR mirror of the serializer's
 * `rootStrings`. At a root context a parentless `&` resolves to EMPTY, so a branch
 * that is nothing but `&` is not a selector: it contributes no header branch and no
 * descendant prefix to the rules nested inside it. Dropping it here is what stops a
 * root `& when (…) { … }` guard block from projecting a literal `&` into its
 * children's flat branches.
 */
function rootLevel(level: Level): Branch[] {
  const out: Branch[] = [];
  for (const b of level) {
    const stripped = stripRootAmp(b);
    if (stripped !== null) {
      out.push(stripped);
    }
  }
  return out;
}

/**
 * Compose an ancestor path (outermost → own local) into a flat selector list,
 * wrapping a multi-branch inner level in `:is(...)` before composing (so the
 * parent is not distributed across the group). Every returned branch carries its
 * per-segment `bnd` origin.
 */
export function composePath(levels: Level[]): Branch[] {
  // [nesting] Peel the leading levels that root-normalize to nothing (a parentless
  // `&` guard block wrapping the real rules). The first level that survives IS the
  // root context; the levels above it were never a `&`-boundary hop, so the peeled
  // branches carry no `bnd` origin for them either.
  let result: Branch[] = [];
  let i = 0;
  for (; i < levels.length; i++) {
    result = rootLevel(levels[i]!);
    if (result.length > 0) {
      i++;
      break;
    }
  }
  if (result.length === 0) {
    // Every level was a bare root `&` (the guard block itself is the subject).
    // Keep the authored innermost level rather than resolving to nothing.
    return levels[levels.length - 1]!.map(cloneBranch);
  }
  // The root level's own segments are own-local at this stage (`bnd = 0`); each
  // `composeLevel` step lifts the accumulated parent one hop deeper.
  for (; i < levels.length; i++) {
    result = composeLevel(levels[i]!, result);
  }
  return result;
}
