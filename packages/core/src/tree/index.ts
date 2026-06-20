/**
 * @note
 * Tree nodes are canonical source/runtime values. Evaluation may create
 * placement-owned wrappers, but the source tree remains the default owner.
 */

/**
 * Import from node.ts which applies all the prototype patches
 * (nil, operate, treeContext) and re-exports from node-base.ts
 */
import {
  Node,
  type LocationInfo,
  F_VISIBLE,
  F_MAY_ASYNC,
  F_STATIC,
  F_NON_STATIC,
  F_HAS_NODE_CHILD
} from './node.js';
import { TreeContext } from '../context.js';
import { compare } from './util/compare.js';

export { Node, TreeContext, type LocationInfo, F_VISIBLE, F_MAY_ASYNC, F_STATIC, F_NON_STATIC, F_HAS_NODE_CHILD };
export { N } from './node-type.js';

import { Selector } from './selector.js';

export * from './at-rule.js';
export * from './at-rule-statement.js';
export * from './block.js';
export * from './bool.js';
export * from './ampersand.js';
export * from './any.js';
export * from './call.js';
export * from './color.js';
export * from './comment.js';
export * from './combinator.js';
export * from './condition.js';
export * from './control.js';
export * from './declaration.js';
export * from './declaration-custom.js';
export * from './declaration-var.js';
export * from './dimension.js';
export * from './number.js';
export * from './expression.js';
export * from './extend.js';
export * from './list.js';
export * from './log.js';
export * from './mixin.js';
export * from './negative.js';
export * from './function.js';
export * from './js-function.js';
export * from './js-array.js';
export * from './js-object.js';
export * from './nil.js';
export * from './operation.js';
export * from './paren.js';
export * from './quoted.js';
export * from './range.js';
export * from './progressive-at-rule.js';
export * from './progressive-declaration.js';
export * from './progressive-ruleset.js';
export * from './progressive-variable-declaration.js';
export * from './ruleset.js';
export * from './rules.js';
export * from './rules-raw.js';
export * from './collection.js';
export * from './selector.js';
export * from './selector-attr.js';
export * from './selector-basic.js';
export * from './selector-list.js';
export * from './selector-pseudo.js';
export * from './selector-compound.js';
export * from './selector-complex.js';
export * from './selector-simple.js';
export * from './selector-capture.js';
export * from './sequence.js';
export * from './query-condition.js';
export * from './comment.js';
export * from './reference.js';
export * from './import-style.js';
export * from './import-js.js';
export * from './interpolated.js';
export * from './selector-interpolated.js';
export * from './default-guard.js';
export * from './rest.js';
export * from './util/raw-selector.js';
export * from './url.js';

// Patch Selector.compare after all exports to avoid circular dependency
import { selectorCompare } from './util/compare.js';

function isSelectorLike(value: unknown): value is Selector {
  return !!value
    && typeof value === 'object'
    && (value as { isSelector?: unknown }).isSelector === true;
}

/** Patch Selector to avoid circularity */
Selector.prototype.compare = function(other: Node) {
  // Avoid `instanceof Selector` here: module identity can diverge under Vite/Vitest
  // if the same file is loaded via different specifiers.
  if (isSelectorLike(other)) {
    const forward = selectorCompare(this, other);
    if (forward.isEquivalent) {
      return 0;
    }
    if (forward.hasPartialMatch) {
      return -1;
    }
    const backward = selectorCompare(other, this);
    if (backward.hasPartialMatch) {
      return 1;
    }
  }
  return compare(this.valueOf(), other?.valueOf?.());
};
