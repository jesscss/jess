import { F_ALLOW_ROOT, type Node } from '../node.js';
import type { Context } from '../../context.js';
import { makeJessError } from '../../jess-error.js';

/**
 * Port of Less 4.x `to-css-visitor.checkValidNodes` — statement-position
 * validation for evaluated rules bodies.
 *
 * Each statement-legal node type sets the `F_ALLOW_ROOT` flag in its
 * constructor (Less's per-instance `allowRoot = true`, folded into the flags
 * bitmask). Any node in an evaluated body WITHOUT that flag is a value that
 * cannot stand as a statement — the realistic cause being a function/mixin/
 * detached-ruleset that evaluated to a bare value and dropped it into
 * statement position.
 *
 * @see docs/future/core-architecture/CORE-CLEANUP.md
 */
export function checkValidNodes(
  rules: readonly Node[] | undefined,
  context?: Context,
  isRoot = false,
  fromCallOutput = false
): void {
  if (!rules) {
    return;
  }
  const ctx = context?.treeContext;
  for (let i = 0; i < rules.length; i++) {
    const node = rules[i]!;
    // Less: a property Declaration that a mixin / detached-ruleset CALL dropped at
    // the root is invalid ("Properties must be inside selector blocks"). We only
    // flag declarations reached through such a call's output block (see the Rules
    // recursion below), not bare ones — nil-selector rulesets legitimately stream
    // declarations to the buffer as an internal mechanism. VarDeclaration `@x:`
    // and custom props are distinct node types and are never flagged.
    if (isRoot && fromCallOutput && node.type === 'Declaration') {
      throw makeJessError({
        code: 'eval/property-in-root',
        phase: 'eval',
        ctx,
        node,
        meta: { what: String((node as { name?: unknown }).name ?? 'property') }
      });
    }
    // Recurse into root-level `Rules` blocks (they flatten into the root at
    // render). Only once a mixin / detached-ruleset call's output block
    // (`mixinOutputSlot`) is in the chain do the inner declarations count as
    // call-output — so `@import`ed call output is still caught, while plain
    // nil-selector streaming stays unflagged.
    if (isRoot && node.type === 'Rules') {
      const slot = Boolean((node as { options?: { mixinOutputSlot?: unknown } }).options?.mixinOutputSlot);
      checkValidNodes((node as { rules?: readonly Node[] }).rules, context, true, fromCallOutput || slot);
      continue;
    }
    if (node.type && !node.hasFlag(F_ALLOW_ROOT)) {
      throw makeJessError({
        code: 'eval/invalid-statement',
        phase: 'eval',
        ctx,
        node,
        meta: { what: `${node.type} node` }
      });
    }
  }
}
