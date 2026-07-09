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

const COMMA_MERGE = new Set(['+:', '&,:']);
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
   * The merge decl's OWNER scope — the spliced mixin surface it came from, or
   * `undefined` for a decl authored directly in the caller body. Two merge decls
   * COMPOSE (comma/space combine) only when they share the same owner; a decl from
   * a DIFFERENT owner (a distinct mixin body, or a mixin body vs the caller) does
   * not accumulate across the boundary — the later one SUPERSEDES.
   */
  ownerKey: object | undefined;
};

/**
 * MERGE-ACROSS-MIXIN fold: plan the `+:`/`+_:` coalescing over the POST-EXPANSION
 * entry sequence (mixin-call surfaces already spliced in place), so an
 * expansion-contributed merge decl participates in the coalesce (it never entered
 * the pre-expansion `planBodyMerges` over `node.rules`).
 *
 * Reproduces eval's cross-scope merge boundary. A `+:`/`+_:` chain accumulates
 * (comma/space combine) only among decls of the SAME OWNER (same spliced mixin
 * surface, or all authored in the caller body). When the next same-property merge
 * decl comes from a DIFFERENT owner, it does NOT combine with the accumulated
 * value — it SUPERSEDES (the prior anchor is suppressed, its value dropped) and
 * starts a fresh chain. This matches eval: two merges inside one mixin body
 * coalesce (`transform: r, s`), but two SEPARATE mixin bodies each contributing a
 * `transform+:` are last-wins (`transform: s`), because a mixin-body `+:` only sees
 * prior contributions within its own body.
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
  // Per property name: the anchor decl so far, its accumulated combined value, and
  // the OWNER the accumulated chain belongs to (a chain only accumulates within one
  // owner; a different owner supersedes — see the doc comment).
  const anchorByName = new Map<string, Node>();
  const accumulatedByName = new Map<string, Node>();
  const ownerByName = new Map<string, object | undefined>();

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
        ownerByName.delete(name);
        continue;
      }
      const resolved = resolveValue(child);
      if (isThenable(resolved)) {
        return resolved.then((value: Node | undefined) => {
          applyMerge(child, name, assign, entry.ownerKey, value, plan, anchorByName, accumulatedByName, ownerByName);
          return step(i + 1);
        });
      }
      applyMerge(child, name, assign, entry.ownerKey, resolved, plan, anchorByName, accumulatedByName, ownerByName);
    }
    return plan;
  };
  return step(0);
}

function applyMerge(
  decl: Node,
  name: string,
  assign: string,
  ownerKey: object | undefined,
  value: Node | undefined,
  plan: SpineMergePlan,
  anchorByName: Map<string, Node>,
  accumulatedByName: Map<string, Node>,
  ownerByName: Map<string, object | undefined>
): void {
  const resolvedValue = value ?? new Nil();
  const priorAnchor = anchorByName.get(name);
  // A merge chain accumulates only within ONE owner. When this occurrence belongs
  // to a DIFFERENT owner than the accumulated chain (a distinct mixin surface, or
  // mixin↔caller), it does NOT combine across the boundary — it supersedes the
  // prior anchor (value dropped) and starts a fresh chain. Same owner combines.
  const sameOwner = priorAnchor !== undefined && ownerByName.get(name) === ownerKey;
  const combined = sameOwner
    ? combineMergeValue(accumulatedByName.get(name), resolvedValue, assign)
    : resolvedValue;
  if (priorAnchor) {
    // The prior anchor is superseded by this later occurrence — suppress it.
    plan.set(priorAnchor, { kind: 'suppress' });
  }
  plan.set(decl, { kind: 'anchor', value: combined });
  anchorByName.set(name, decl);
  accumulatedByName.set(name, combined);
  ownerByName.set(name, ownerKey);
}
