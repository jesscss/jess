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
 * @see docs/archive/ponytail-core-audit.md E12
 */
export function checkValidNodes(
  rules: readonly Node[] | undefined,
  context?: Context
): void {
  if (!rules) {
    return;
  }
  const ctx = context?.treeContext;
  for (let i = 0; i < rules.length; i++) {
    const node = rules[i]!;
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
