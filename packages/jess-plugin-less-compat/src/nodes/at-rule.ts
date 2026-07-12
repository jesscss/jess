import { AtRule, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess AtRule to a Less-compatible AtRule
 */
export function transformAtRuleToLess(
  jessAtRule: AtRule,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessAtRule, cache, (prop, target) => {
    const atRule = target as AtRule;

    // Map 'type' property
    // Less.js v2 used "Directive" instead of "AtRule" - support both for compatibility
    if (prop === 'type') {
      // For Less.js v2 compatibility, we can return "Directive" if needed
      // But by default, map to "AtRule" (modern)
      return mapJessTypeToLessType(atRule.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'name' property
    if (prop === 'name') {
      return atRule.data.name;
    }

    // Map 'value' property (Less expects Value node or array)
    // Jess uses 'prelude' instead of 'value'
    if (prop === 'value') {
      const prelude = atRule.data.prelude;
      if (prelude instanceof Node) {
        return toLessNode(prelude, { cache });
      }
      return prelude;
    }

    // Map 'rules' property (for @media, @keyframes, etc.)
    if (prop === 'rules') {
      const rules = atRule.data.rules;
      if (rules) {
        return rules.data.map((r: Node) => toLessNode(r, { cache }));
      }
      return [];
    }

    // Map 'accept' method for visitor traversal
    // AtRule's accept should ONLY traverse children (rules), NOT call visitor methods on itself
    // The visitor's visit() method already called visitAtRule() or visitDirective() before calling accept()
    if (prop === 'accept') {
      return function(visitor: any) {
        // AtRule's accept only traverses its rules (children)
        // Less.js AtRule.accept() pattern: visitor.visitArray(this.rules)
        const rules = atRule.data.rules;
        if (rules && rules.data && rules.data.length > 0) {
          const lessRules = rules.data.map((r: Node) => toLessNode(r, { cache }));
          if (visitor.visitArray) {
            visitor.visitArray(lessRules);
          } else {
            // Fallback: call accept on each rule
            for (const lessRule of lessRules) {
              if (lessRule && lessRule.accept) {
                lessRule.accept(visitor);
              }
            }
          }
        }
        // Return the atRule (accept doesn't return a replacement node)
        return atRule;
      };
    }

    return undefined;
  });
}
