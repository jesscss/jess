import { Ruleset, Nil, Selector, SelectorList, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

/**
 * Transform a Jess Ruleset to a Less-compatible Ruleset
 */
export function transformRulesetToLess(
  jessRuleset: Ruleset,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessRuleset, cache, (prop, target) => {
    const ruleset = target as Ruleset;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(ruleset.type);
    }

    // typeIndex is handled automatically by the base proxy handler

    // Map 'selectors' property (Less expects array, Jess has single Selector | Nil)
    if (prop === 'selectors') {
      const selector = ruleset.value.selector;
      
      // Handle Nil selector
      if (selector instanceof Nil) {
        return [];
      }

      // Handle SelectorList - convert to array
      if (selector instanceof SelectorList) {
        return selector.value.map((s: Selector) => toLessNode(s, { cache }));
      }

      // Single selector - wrap in array
      return [toLessNode(selector, { cache })];
    }

    // Map 'rules' property (Less expects array, Jess has Rules container)
    if (prop === 'rules') {
      const rules = ruleset.value.rules;
      // Rules has a value array of nodes
      return rules.value.map((r: Node) => toLessNode(r, { cache }));
    }

    // Map 'accept' method for visitor traversal
    // Less's Visitor.visit() calls node.accept(this) to traverse children
    // The accept method should traverse children, NOT call visitor.visit again
    if (prop === 'accept') {
      return function(visitor: any) {
        // Less's Ruleset.accept() traverses selectors and rules
        const selector = ruleset.value.selector;
        const rules = ruleset.value.rules;
        
        // Traverse selectors
        if (selector && !(selector instanceof Nil)) {
          if (selector instanceof SelectorList) {
            const lessSelectors = selector.value.map((s: Selector) => toLessNode(s, { cache }));
            if (visitor.visitArray) {
              visitor.visitArray(lessSelectors);
            }
          } else {
            const lessSelector = toLessNode(selector, { cache });
            if (lessSelector && lessSelector.accept) {
              lessSelector.accept(visitor);
            }
          }
        }
        
        // Traverse rules
        if (rules && rules.value && rules.value.length > 0) {
          const lessRules = rules.value.map((r: Node) => toLessNode(r, { cache }));
          if (visitor.visitArray) {
            visitor.visitArray(lessRules);
          }
        }
      };
    }

    // Pass through other properties
    return undefined;
  });
}
