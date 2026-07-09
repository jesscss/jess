/**
 * spine-setdefined — Sass `!global` (`setDefined`) folding for the single-pass
 * spine (mechanism B: incremental binding-write during descent).
 *
 * `setDefined` is NOT a declaration — it is an ASSIGNMENT that writes the runtime
 * value of an EXISTING binding cell in whatever (possibly outer) scope owns the
 * name. `prepareScopeFrameDeclarationIndex` SKIPS `setDefined` nodes (they never
 * enter a bucket), so the spine's upfront frame does not model them. The eval path
 * (`Rules.evalNode`, `rules.ts` ~5150) resolves the existing binding via
 * `lookupScopeFrameVariable(frame, key, { includeAssignmentTargets: true })` and
 * writes `hit.cell.value = <evaluated RHS>`; a miss throws `"x" is not defined`;
 * readonly throws; an `uncovered` frame surface falls back to the eval occurrence
 * crawl (which the spine does NOT replicate — it routes that sub-shape to eval).
 *
 * This module reproduces that frame-path EXACTLY, called at each body-enter in
 * source order (so a write lands before any later sibling / descendant read of the
 * cell and after earlier ones — eval's order). The write targets the OUTER cell
 * the parent-search finds; the spine's frame-per-placement invariant keeps it
 * isolated to this invocation.
 *
 * Hot-path cost: ZERO on the variable-READ path — a write fires only at the rare
 * `setDefined` node (fast pre-scan bail, exactly like `planBodyMerges`). Reads are
 * untouched.
 *
 * Coverage: the frame path (`live`/`declaration` hit → write; `miss` → throw). On
 * an `uncovered` frame surface (optional / dynamic assignment targets) the caller
 * SEQUENCES that root to the eval path — a transitional gate (ratcheted + spec'd),
 * NOT a permanent fallback: the occurrence-crawl is an eval-pass concept the spine
 * does not port. `applyBodySetDefined` returns `'uncovered'` so the caller can
 * decline eligibility for that root.
 */

import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { Node } from '../node.js';
import { N } from '../node-type.js';
import type { Context } from '../../context.js';
import type { ScopeFrame } from '../scope-frame.js';
import { lookupScopeFrameVariable } from '../scope-frame.js';
import { isNode } from './is-node.js';

/** True if any DIRECT child of `body` is a `setDefined` VarDeclaration. */
export function bodyHasSetDefined(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isNode(child, N.VarDeclaration) && (child.options as { setDefined?: boolean } | undefined)?.setDefined) {
      return true;
    }
  }
  return false;
}

/** Outcome of the setDefined write pass for one body. */
export type SetDefinedApplyResult = 'ok' | 'uncovered';

/**
 * Perform the `setDefined` binding writes for one body's DIRECT children in
 * source order, mirroring the eval frame-path. Returns `'uncovered'` when a
 * `setDefined` target's frame surface can't be modeled (the caller sequences the
 * root to eval); otherwise `'ok'`. Throws `"x" is not defined` on a miss and
 * `"x" is readonly` on a readonly target — byte-identical to eval.
 *
 * A body with no `setDefined` child does no work (fast pre-scan bail).
 */
export function applyBodySetDefined(
  children: readonly Node[],
  frame: ScopeFrame | undefined,
  context: Context
): MaybePromise<SetDefinedApplyResult> {
  if (!bodyHasSetDefined(children) || !frame) {
    return 'ok';
  }

  const step = (index: number): MaybePromise<SetDefinedApplyResult> => {
    for (let i = index; i < children.length; i++) {
      const child = children[i]!;
      if (!isNode(child, N.VarDeclaration) || !(child.options as { setDefined?: boolean } | undefined)?.setDefined) {
        continue;
      }
      const key = child.name.toString();
      // EXACT eval frame-path (`Rules.evalNode` setDefined branch): resolve the
      // existing binding (searching parents by default), including assignment
      // targets, blocking/filtering this node itself.
      const variableHit = lookupScopeFrameVariable(frame, key, {
        bailOnPendingDeclarations: true,
        blockedSource: source => source === child,
        filter: source => source !== child,
        includeAssignmentTargets: true
      });
      if (variableHit.kind === 'uncovered') {
        // The frame can't model this assignment surface — SEQUENCED to eval.
        return 'uncovered';
      }
      if (variableHit.kind === 'miss') {
        throw new ReferenceError(`"${key}" is not defined`);
      }
      // live | declaration hit.
      // CROSS-SCOPE SEQUENCED: when the resolved binding lives in an OUTER frame
      // (the parent search left this body's frame), the eval two-pass does NOT
      // leak the write to a later SAME-scope read of the outer binding the way a
      // direct in-descent cell write would — spine and eval diverge on that shape
      // (`.a{@x:red; .inner{@x:blue !global} color:@x}` → eval `red`, a direct
      // write → `blue`). Byte-identical only holds for a SAME-frame target, so an
      // outer-frame target is routed to eval (transitional gate, ratcheted + spec'd
      // — NOT abandonment; a faithful cross-scope write is a later increment).
      if (variableHit.frame !== frame) {
        return 'uncovered';
      }
      if (variableHit.readonly || variableHit.cell.readonly) {
        throw new ReferenceError(`"${key}" is readonly`);
      }
      const cell = variableHit.cell;
      // Resolve the RHS against the live frame, matching `evalSetDefinedAssignedValue`
      // (`rules.ts`): eval the value node; a thenable is awaited on the async path.
      const resolved = child.valueNode().eval(context);
      if (isThenable(resolved)) {
        return resolved.then((value: Node) => {
          cell.value = value;
          cell.prepareValue = undefined;
          return step(i + 1);
        });
      }
      cell.value = resolved;
      cell.prepareValue = undefined;
    }
    return 'ok';
  };
  return step(0);
}
