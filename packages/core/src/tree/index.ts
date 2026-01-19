/**
 * @note
 * These nodes are actually taking the role of two ASTs,
 * because there are nodes that will be used to produce a module,
 * and that module will create AST nodes to create CSS.
 *
 * @todo - rewrite the above, this is no longer true
 */

/**
 * Import from node.ts which applies all the prototype patches
 * (nil, operate, treeContext) and re-exports from node-base.ts
 */
import { Node, type LocationInfo, F_VISIBLE, F_MAY_ASYNC, F_STATIC, F_NON_STATIC } from './node';
import { TreeContext } from '../context';
import { compare } from './util/compare';

export { Node, TreeContext, type LocationInfo, F_VISIBLE, F_MAY_ASYNC, F_STATIC, F_NON_STATIC };

import { Selector } from './selector';

export * from './at-rule';
export * from './block';
export * from './bool';
export * from './ampersand';
export * from './any';
export * from './call';
export * from './color';
export * from './comment';
export * from './combinator';
export * from './condition';
export * from './declaration-custom';
export * from './declaration-var';
export * from './declaration';
export * from './dimension';
export * from './number';
export * from './expression';
export * from './extend';
export * from './list';
export * from './mixin';
export * from './negative';
export * from './function';
export * from './js-function';
export * from './js-array';
export * from './js-object';
export * from './js-expr';
export * from './nil';
export * from './operation';
export * from './paren';
export * from './quoted';
export * from './ruleset';
export * from './rules';
export * from './rules-raw';
export * from './collection';
export * from './selector';
export * from './selector-attr';
export * from './selector-basic';
export * from './selector-list';
export * from './selector-pseudo';
export * from './selector-compound';
export * from './selector-complex';
export * from './selector-simple';
export * from './sequence';
export * from './query-condition';
export * from './comment';
export * from './reference';
export * from './import-style';
export * from './import-js';
export * from './interpolated';
export * from './selector-interpolated';
export * from './default-guard';
export * from './rest';
export * from './url';

// Patch Selector.compare after all exports to avoid circular dependency
import { matchSelectors } from './util/find-extendable-locations';

/** Patch Selector to avoid circularity */
Selector.prototype.compare = function(other: Node) {
  if (other instanceof Selector) {
    let result = matchSelectors(this, other);
    if (result.hasMatch) {
      return 0;
    } else if (result.hasPartialMatch) {
      return -1;
    } else {
      /** Try for a reverse match to see if this is a partial of other */
      result = matchSelectors(other, this);
      if (result.hasPartialMatch) {
        return 1;
      }
    }
  }
  return compare(this.valueOf(), other?.valueOf?.());
};