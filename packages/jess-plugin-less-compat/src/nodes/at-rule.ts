import { AtRule, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

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
    if (prop === 'type') {
      return mapJessTypeToLessType(atRule.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'name' property
    if (prop === 'name') {
      return atRule.value.name;
    }

    // Map 'value' property (Less expects Value node or array)
    // Jess uses 'prelude' instead of 'value'
    if (prop === 'value') {
      const prelude = atRule.value.prelude;
      if (prelude instanceof Node) {
        return toLessNode(prelude, { cache });
      }
      return prelude;
    }

    // Map 'rules' property (for @media, @keyframes, etc.)
    if (prop === 'rules') {
      const rules = atRule.value.rules;
      if (rules) {
        return rules.value.map((r: Node) => toLessNode(r, { cache }));
      }
      return [];
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessAtRule = transformAtRuleToLess(atRule, cache);
        const result = visitor.visit(lessAtRule);
        if (result !== lessAtRule) {
          const { fromLessNode } = require('../transform/from-less');
          return fromLessNode(result, { cache });
        }
        return atRule;
      };
    }

    return undefined;
  });
}
