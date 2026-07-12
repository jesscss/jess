/**
 * spine-merge — `+:` / `+_:` cross-declaration coalescing for the single-pass
 * spine (P1, the last value-path piece).
 *
 * Less property-merge combines same-property merge-flagged declarations in a
 * body into ONE declaration: `background +: red; background +: blue` →
 * `background: red, blue` (comma list, `+:` / `&,:`), and `+_:` / `&_:` →
 * space sequence. The LAST occurrence is the anchor that emits the combined
 * value; earlier occurrences are suppressed.
 *
 * The eval path does this in `_coalesceMergedDeclarations` (a post-eval pass that
 * MUTATES the output tree). The spine can't mutate the canonical source, so this
 * computes a per-body PLAN — a side table keyed by source declaration — consulted
 * at emit: a suppressed decl emits nothing; the anchor emits the combined value.
 * The combined value is a genuinely NEW node (design "NOT copies, stays" list —
 * merge constructs a new value), never a canonical mutation.
 *
 * Scope: the SAME-BODY subset the spine admits (cross-scope / mixin-output merges
 * are excluded from eligibility and stay on the eval path). Combining reuses the
 * eval'd leaf values, so merge values resolve against the live frame.
 */

import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Nil } from '../nil.js';
import { List } from '../list.js';
import { spaced } from '../sequence.js';

/** What the emit path does with a merge-flagged declaration. */
export type SpineMergePlanEntry =
  | { kind: 'suppress' }
  | { kind: 'anchor'; value: Node };

export type SpineMergePlan = WeakMap<Node, SpineMergePlanEntry>;

const COMMA_MERGE = new Set(['+:', '+,:', '&,:']);
const SPACE_MERGE = new Set(['+_:', '&_:']);

/** The merge operator a declaration was authored with, or undefined if none. */
function mergeAssignOf(decl: Node): string | undefined {
  if (!isNode(decl, N.Declaration) || isNode(decl, N.VarDeclaration)) {
    return undefined;
  }
  const options = decl.options as { assign?: string; normalizedFromAssign?: string } | undefined;
  const assign = options?.normalizedFromAssign ?? options?.assign;
  if (assign && (COMMA_MERGE.has(assign) || SPACE_MERGE.has(assign))) {
    return assign;
  }
  return undefined;
}

/** Flatten a comma-list value into its member items (a non-list is one item). */
function commaItems(value: Node): Node[] {
  if (isNode(value, N.List)) {
    const out: Node[] = [];
    for (const item of value.value) {
      if (item instanceof Node) {
        out.push(...commaItems(item));
      }
    }
    return out;
  }
  return [value];
}

/** True for the empty placeholder a bare `+:` with no prior produces. */
function isEmptyPlaceholder(value: Node): boolean {
  return isNode(value, N.Nil) || (isNode(value, N.Any) && value.value === '');
}

/**
 * Combine an accumulated merge value with the next declaration's value, per the
 * merge operator: `+:`/`&,:` → a comma `List` of all items; `+_:`/`&_:` → a
 * space `Sequence`. Empty placeholders (a leading bare `+:`) drop out.
 */
function combineMergeValue(accumulated: Node | undefined, next: Node, assign: string): Node {
  if (!accumulated || isEmptyPlaceholder(accumulated)) {
    return next;
  }
  if (isEmptyPlaceholder(next)) {
    return accumulated;
  }
  if (SPACE_MERGE.has(assign)) {
    return spaced([accumulated, next]);
  }
  return new List([...commaItems(accumulated), ...commaItems(next)]);
}

/**
 * Plan the `+:` / `+_:` coalescing for one body (P1). Walks the body's DIRECT
 * declaration children in source order (a nested ruleset / at-rule is its own
 * cascade scope — not descended), grouping same-property merge chains. Each
 * chain's earlier members are `suppress`; its last member is the `anchor`
 * carrying the combined value. Non-merge decls of the same property RESET the
 * chain (a plain `:` assignment breaks the merge run).
 *
 * `resolve(decl)` yields the eval'd VALUE of a declaration against the live frame
 * (MaybePromise — merge values may resolve async, like any leaf). The plan is
 * empty (returns `undefined`) when the body has no merge-flagged declarations, so
 * the common case allocates nothing.
 */
export function planBodyMerges(
  children: readonly Node[],
  resolveValue: (decl: Node) => MaybePromise<Node | undefined>
): MaybePromise<SpineMergePlan | undefined> {
  return planEntrySequenceMerges(
    children.map(node => ({ node, ownerKey: undefined })),
    resolveValue
  );
}

/**
 * One entry of the POST-EXPANSION render sequence a container descends
 * (`rulesToRender`), carrying whether the node was spliced in from a mixin-call
 * expansion (`fromMixinOutput` ≡ the entry's `spineFrame` is set). The mixin-output
 * bit reproduces eval's cross-scope merge boundary (see `planEntrySequenceMerges`).
 */
export type SpineMergeEntry = {
  node: Node;
  /**
   * VESTIGIAL (retained for caller-population compatibility; no longer read).
   * Formerly the merge decl's owner scope, used to gate cross-owner accumulation.
   * That gate was WRONG per the oracle (see `planEntrySequenceMerges`): Less
   * property-merge combines EVERY same-property merge-flagged decl in a ruleset's
   * output regardless of which mixin body injected it, so there is no owner
   * boundary. IOU: drop this field and the `mergeOwner` plumbing in
   * `serialize-helper.ts` that populates it.
   */
  ownerKey?: object | undefined;
};

/**
 * MERGE-ACROSS-MIXIN fold: plan the `+:`/`+_:` coalescing over the POST-EXPANSION
 * entry sequence (mixin-call surfaces already spliced in place), so an
 * expansion-contributed merge decl participates in the coalesce (it never entered
 * the pre-expansion `planBodyMerges` over `node.rules`).
 *
 * Add-pull-prior semantics (the Less oracle). A `+:`/`+_:` merge decl combines with
 * EVERY prior same-property merge decl in source order — the mixin-injected decls
 * AND the caller-body decls alike — because Less resolves property-merge at the
 * OUTPUT ruleset level: all same-property merge-flagged declarations of a ruleset
 * combine, independent of which mixin body contributed them. A plain `:` decl of the
 * property RESETS the run (it breaks the merge chain). Verified against the upstream
 * `tests-unit/merge/merge.less` oracle: `.test-rule1 { .first-transform();
 * .second-transform(); }` → `transform: rotate(90deg), skew(30deg), scale(2, 4)` —
 * two DISTINCT mixin bodies combine, they are NOT last-wins. The former per-owner
 * boundary (distinct mixins supersede) diverged from this oracle and is removed.
 *
 * Empty plan (returns `undefined`) when the sequence has no merge decl — the
 * common case allocates nothing.
 */
export function planEntrySequenceMerges(
  entries: readonly SpineMergeEntry[],
  resolveValue: (decl: Node) => MaybePromise<Node | undefined>
): MaybePromise<SpineMergePlan | undefined> {
  const children = entries;
  // Fast path: no merge decls → no plan, no work.
  let hasMerge = false;
  for (let i = 0; i < children.length; i++) {
    if (mergeAssignOf(children[i]!.node) !== undefined) {
      hasMerge = true;
      break;
    }
  }
  if (!hasMerge) {
    return undefined;
  }

  const plan: SpineMergePlan = new WeakMap();
  // Per property name: the anchor decl so far and its accumulated combined value.
  // A merge run accumulates across ALL contributors (mixin-injected + caller-body);
  // a plain `:` decl of the property resets it.
  const anchorByName = new Map<string, Node>();
  const accumulatedByName = new Map<string, Node>();

  const step = (index: number): MaybePromise<SpineMergePlan> => {
    for (let i = index; i < children.length; i++) {
      const entry = children[i]!;
      const child = entry.node;
      if (!isNode(child, N.Declaration) || isNode(child, N.VarDeclaration)) {
        continue;
      }
      const name = String(child.name);
      const assign = mergeAssignOf(child);
      if (assign === undefined) {
        // A plain `:` (or other) declaration of this property ends any merge run.
        anchorByName.delete(name);
        accumulatedByName.delete(name);
        continue;
      }
      const resolved = resolveValue(child);
      if (isThenable(resolved)) {
        return resolved.then((value: Node | undefined) => {
          applyMerge(child, name, assign, value, plan, anchorByName, accumulatedByName);
          return step(i + 1);
        });
      }
      applyMerge(child, name, assign, resolved, plan, anchorByName, accumulatedByName);
    }
    return plan;
  };
  return step(0);
}

function applyMerge(
  decl: Node,
  name: string,
  assign: string,
  value: Node | undefined,
  plan: SpineMergePlan,
  anchorByName: Map<string, Node>,
  accumulatedByName: Map<string, Node>
): void {
  const resolvedValue = value ?? new Nil();
  const priorAnchor = anchorByName.get(name);
  // Add-pull-prior: this occurrence combines with the accumulated same-property
  // merge value (whatever prior merge decls — mixin-injected or caller-body —
  // contributed), matching the Less oracle. No owner boundary.
  const combined = combineMergeValue(accumulatedByName.get(name), resolvedValue, assign);
  if (priorAnchor) {
    // The prior anchor is superseded as the emit position by this later occurrence
    // (jess anchors the combined value at the LAST occurrence) — suppress it.
    plan.set(priorAnchor, { kind: 'suppress' });
  }
  plan.set(decl, { kind: 'anchor', value: combined });
  anchorByName.set(name, decl);
  accumulatedByName.set(name, combined);
}
