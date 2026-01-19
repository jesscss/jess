import { Ruleset, Nil, Selector, SelectorList, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import type { LessNode } from '../types.js';

// Debug logging helper (only in debug mode)
const syncLog = process.env.DEBUG ? (data: object) => {
  try {
    // eslint-disable-next-line no-console
    console.log('[Ruleset]', JSON.stringify(data, null, 2));
  } catch {
    // Ignore errors
  }
} : () => {};

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
        // #region agent log
        syncLog({location:'ruleset.ts:53',message:'Ruleset accept() called',data:{visitorType:visitor?.constructor?.name,hasVisitArray:!!visitor?.visitArray},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
        // #endregion
        // CRITICAL: The visitor passed here is the Less visitor, not the plugin visitor
        // Less's Ruleset.accept() traverses selectors and rules
        // Use visitArray which handles the traversal correctly
        const selector = ruleset.value.selector;
        const rules = ruleset.value.rules;

        // Traverse selectors using visitArray (Less's pattern)
        if (selector && !(selector instanceof Nil)) {
          if (selector instanceof SelectorList) {
            // Convert all selectors to Less format BEFORE calling visitArray
            // This ensures visitArray receives Less proxies, not Jess nodes
            const lessSelectors = selector.value.map((s: Selector) => {
              const lessSel = toLessNode(s, { cache });
              // Ensure we have a Less proxy, not a Jess node
              return lessSel;
            });
            if (visitor.visitArray) {
              // #region agent log
              syncLog({location:'ruleset.ts:71',message:'Calling visitor.visitArray(selectors)',data:{selectorCount:lessSelectors.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
              // #endregion
              visitor.visitArray(lessSelectors);
            } else {
              // Fallback: call accept on each selector if visitArray not available
              for (const lessSel of lessSelectors) {
                if (lessSel && lessSel.accept) {
                  lessSel.accept(visitor);
                }
              }
            }
          } else {
            // Single selector - convert to Less format BEFORE calling visitArray
            const lessSelector = toLessNode(selector, { cache });
            if (lessSelector) {
              if (visitor.visitArray) {
                visitor.visitArray([lessSelector]);
              } else if (lessSelector.accept) {
                lessSelector.accept(visitor);
              }
            }
          }
        }

        // Traverse rules using visitArray (Less's pattern)
        if (rules && rules.value && rules.value.length > 0) {
          // Convert all rules to Less format BEFORE calling visitArray
          // This ensures visitArray receives Less proxies, not Jess nodes
          const lessRules = rules.value.map((r: Node) => {
            const lessRule = toLessNode(r, { cache });
            // Ensure we have a Less proxy, not a Jess node
            return lessRule;
          });
          if (visitor.visitArray) {
            // #region agent log
            syncLog({location:'ruleset.ts:103',message:'Calling visitor.visitArray(rules)',data:{ruleCount:lessRules.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'});
            // #endregion
            visitor.visitArray(lessRules);
          } else {
            // Fallback: call accept on each rule if visitArray not available
            for (const lessRule of lessRules) {
              if (lessRule && lessRule.accept) {
                lessRule.accept(visitor);
              }
            }
          }
        }
      };
    }

    // Pass through other properties
    return undefined;
  });
}
