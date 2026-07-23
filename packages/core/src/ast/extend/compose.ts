/**
 * Composition (nesting) — folds an ancestor path of selector levels into flat
 * branches exactly as the serializer composes authored nesting, including `&`
 * substitution against the parent context.
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
import type { Branch, Level, Simple } from './ir.js';

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

/**
 * Substitute every `&` text token in `child` with the parent selector. When the
 * parent is a MULTI-SEGMENT complex (a descendant selector such as `.a .b`) and
 * the `&` is FUSED into a compound alongside other simples, the parent is wrapped
 * in `:is(...)` so the compound stays a single element target (`.f&` under `.a .b`
 * → `.f:is(.a .b)`, not `.f.a .b`). A standalone `&` (the whole compound) or a
 * single-compound parent substitutes the parent's bare text.
 */
function substituteAmp(child: Branch, parent: Branch): Branch {
  const parentStr = branchText(parent);
  const parentMultiSeg = parent.segs.length > 1;
  const segs = child.segs.map((seg) => {
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
    return { comb: seg.comb, compound: { simples } };
  });
  return mkBranch(segs);
}

/** The parent token for composing a child under a multi-branch parent. */
function parentToken(parents: Branch[]): Branch {
  if (parents.length === 1) {
    return cloneBranch(parents[0]!);
  }
  return descendantBranch([isSimple(parents)]);
}

/** Compose one child branch under a parent token branch (mirrors serialize). */
function composeOne(parent: Branch, child: Branch): Branch {
  if (branchHasAmp(child)) {
    return substituteAmp(child, parent);
  }
  // Descendant: parent then space then child.
  return mkBranch([...parent.segs.map(cloneSeg), ...cloneBranch(child).segs]);
}

/** Compose a child selector list under a parent selector list. */
function composeLevel(childBranches: Branch[], parentBranches: Branch[]): Branch[] {
  const token = parentToken(parentBranches);
  return childBranches.map(c => composeOne(token, c));
}

/**
 * Compose an ancestor path (outermost → own local) into a flat selector list,
 * wrapping a multi-branch inner level in `:is(...)` before composing (so the
 * parent is not distributed across the group).
 */
export function composePath(levels: Level[]): Branch[] {
  let result = levels[0]!.map(cloneBranch);
  for (let i = 1; i < levels.length; i++) {
    result = composeLevel(levels[i]!, result);
  }
  return result;
}
