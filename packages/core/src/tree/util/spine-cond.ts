/**
 * spine-cond — conditional-assign `?:` (`AssignmentType.CondAssign`) folding for
 * the single-pass spine.
 *
 * `@x ?: v` is **assign-if-not-already-bound**: `@x: red; @x ?: blue; color:@x`
 * emits `red` — the prior binding wins; the fallback `v` is used only when no
 * prior binding of `@x` exists. The eval path implements this NOT as a special
 * binding write but as a VALUE REWRITE during registration
 * (`Declaration._normalizeAssignmentValue`): `@x ?: v` becomes a self-`Reference`
 * with a `fallbackValue` (`new Reference({ key }, { type, fallbackValue: v })`),
 * whose position-gated read (`ref.index = node.index`) sees only bindings BEFORE
 * the `?:` node — the prior `@x: red` or, failing that, the fallback.
 *
 * The spine skips registration, so the rewrite never happens — a naive fold would
 * read the `?:` node's OWN cell (whose raw value is the fallback) and wrongly emit
 * `blue` (last-wins). This module reproduces the eval rewrite as a per-body PLAN
 * (modeled 1:1 on `spine-merge.ts`): at body-enter it builds the EXACT self-
 * reference the eval path constructs, resolves it against the live frame (which
 * already holds every prior binding, position-gated), and:
 *   1. stores the resolved value as an `anchor` entry consulted at emit, AND
 *   2. WRITES that value FORWARD onto the `?:` node's own binding cell in the
 *      frame — so a LATER read of `@x` (position past the `?:`) dereferences the
 *      resolved value, byte-for-byte as eval.
 *
 * Byte-identical by construction: it reuses the node the eval path builds and the
 * same position-gated `lookupScopeFrameVariable` read model the spine already runs.
 *
 * Hot-path cost: ZERO. No `lookupScopeFrameVariable` change; the plan is built
 * only in bodies that contain a `?:` (fast pre-scan bail, exactly like
 * `planBodyMerges`) and touched only at those anchors. A body without `?:`
 * allocates nothing and pays no read-time tax.
 */

import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { Node } from '../node.js';
import { N } from '../node-type.js';
import type { ScopeFrame } from '../scope-frame.js';
import { Reference } from '../reference.js';
import { isNode } from './is-node.js';

/** What the emit path does with a `?:` (CondAssign) declaration. */
export type SpineCondPlanEntry = { kind: 'anchor'; value: Node };

export type SpineCondPlan = WeakMap<Node, SpineCondPlanEntry>;

/** The `?:` (assign-if-undefined) operator, in each authored surface form. */
const CONDITIONAL_ASSIGNS = new Set(['?:']);

/**
 * The `?:` assign a VARIABLE declaration was authored with, or undefined if none.
 * Only a `VarDeclaration` `?:` (`@x ?: v` — a binding) is folded here; a plain-
 * PROPERTY `?:` (`color ?: v`) is a non-binding shape kept on the eval path
 * (SEQUENCED — see module header + `isSimpleSpineLeaf`).
 */
function conditionalAssignOf(decl: Node): string | undefined {
  if (!isNode(decl, N.VarDeclaration)) {
    return undefined;
  }
  const options = decl.options as { assign?: string } | undefined;
  const assign = options?.assign;
  return assign && CONDITIONAL_ASSIGNS.has(assign) ? assign : undefined;
}

/** True if any DIRECT child of `body` is a `?:` conditional-assign declaration. */
export function bodyHasConditionalAssign(children: readonly Node[]): boolean {
  for (let i = 0; i < children.length; i++) {
    if (conditionalAssignOf(children[i]!) !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * Plan the `?:` conditional-assign folding for one body. Walks the body's DIRECT
 * children in source order; for each `?:` declaration it builds the eval-path
 * self-reference (`new Reference({ key }, { type, fallbackValue })` with
 * `ref.index = node.index`) and resolves it against the live frame — the frame
 * already holds every prior binding position-gated, so the read returns the prior
 * value or the fallback, byte-for-byte as `_normalizeAssignmentValue`. The
 * resolved value is stored as an `anchor` entry AND written forward onto the
 * `?:` node's own binding cell so later reads of the same name see it.
 *
 * `resolveReference(ref)` yields the eval'd VALUE of a reference against the live
 * frame (MaybePromise — the fallback value may resolve async, like any leaf). The
 * plan is empty (returns `undefined`) when the body has no `?:` declaration, so
 * the common case allocates nothing.
 */
export function planBodyConditionals(
  children: readonly Node[],
  frame: ScopeFrame | undefined,
  resolveReference: (ref: Reference) => MaybePromise<Node | undefined>
): MaybePromise<SpineCondPlan | undefined> {
  // Fast path: no `?:` decls → no plan, no work.
  if (!bodyHasConditionalAssign(children)) {
    return undefined;
  }

  const plan: SpineCondPlan = new WeakMap();

  const step = (index: number): MaybePromise<SpineCondPlan> => {
    for (let i = index; i < children.length; i++) {
      const child = children[i]!;

      /*
       * `conditionalAssignOf` admits only a `VarDeclaration` `?:`; re-narrow so
       * `.name` / `.valueNode()` resolve without a cast.
       */
      if (!isNode(child, N.VarDeclaration) || conditionalAssignOf(child) === undefined) {
        continue;
      }

      /*
       * Build the EXACT self-reference the eval path constructs
       * (`_normalizeAssignmentValue`, CondAssign case): a `variable` reference on
       * this name, with the authored value as `fallbackValue`. The position bound
       * is the `?:` node's own index (eval-time nodes don't parent — carry it
       * directly, exactly as the `+:`/merge path does).
       */
      const key = String(child.name);
      const type = 'variable' as const;
      const fallbackValue = child.valueNode();

      /*
       * A `snapshot` read applies the position gate (`ref.index` → `start`), so the
       * lookup sees only bindings BEFORE the `?:` node — the prior `@x: red` or, on
       * a miss, the reference's `fallbackValue`. A default (non-snapshot) contextual
       * read is last-wins (would read the `?:` node's OWN cell), so snapshot is
       * REQUIRED here to reproduce assign-if-undefined.
       */
      const ref = new Reference({ key }, { type, fallbackValue, readMode: 'snapshot' }, undefined);
      ref.index = child.index;
      const resolved = resolveReference(ref);
      if (isThenable(resolved)) {
        return resolved.then((value: Node | undefined) => {
          applyConditional(child, value, plan, frame, key);
          return step(i + 1);
        });
      }
      applyConditional(child, resolved, plan, frame, key);
    }
    return plan;
  };
  return step(0);
}

function applyConditional(
  decl: Node,
  value: Node | undefined,
  plan: SpineCondPlan,
  frame: ScopeFrame | undefined,
  key: string
): void {
  if (!value) {
    return;
  }
  plan.set(decl, { kind: 'anchor', value });

  /*
   * Write forward: overwrite the `?:` node's OWN binding cell so a LATER read of
   * this name (position past the `?:`) dereferences the resolved value. The cell
   * is already in the frame (the `?:` VarDeclaration was NOT skipped by
   * `prepareScopeFrameDeclarationIndex` — only `setDefined` is), so this is a
   * single in-place write on the node's own entry, no outer-scope machinery.
   */
  const bucket = frame?.declarationBucketsByName.get(key);
  if (!bucket) {
    return;
  }
  for (let i = bucket.length - 1; i >= 0; i--) {
    const entry = bucket[i]!;
    if (entry.sourceNode === decl) {
      entry.cell.value = value;
      entry.cell.prepareValue = undefined;
      return;
    }
  }
}
