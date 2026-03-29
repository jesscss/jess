import { Ruleset, Nil, Selector, SelectorList, Node } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';

export const transformRulesetToLess = createFromAdapter<Ruleset>({
  fields: {
    selectors: (rs, cache) => {
      const selector = rs.get('selector');
      if (selector instanceof Nil) {
        return [];
      }
      if (selector instanceof SelectorList) {
        return selector.get('value').map((s: Selector) => toLessNode(s, { cache }));
      }
      return [toLessNode(selector, { cache })];
    },
    rules: (rs, cache) => {
      const rules = rs.get('rules');
      return rules._value.map((r: Node) => toLessNode(r, { cache }));
    }
  },
  accept: (ruleset, visitor, cache) => {
    const selector = ruleset.get('selector');
    const rules = ruleset.get('rules');

    // Traverse selectors
    if (selector && !(selector instanceof Nil)) {
      if (selector instanceof SelectorList) {
        const lessSelectors = selector.get('value').map((s: Selector) => toLessNode(s, { cache }));
        if (visitor.visitArray) {
          visitor.visitArray(lessSelectors);
        } else {
          for (const ls of lessSelectors) {
            if (ls?.accept) {
              ls.accept(visitor);
            }
          }
        }
      } else {
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

    // Traverse rules
    if (rules?._value?.length > 0) {
      const lessRules = rules._value.map((r: Node) => toLessNode(r, { cache }));
      if (visitor.visitArray) {
        visitor.visitArray(lessRules);
      } else {
        for (const lr of lessRules) {
          if (lr?.accept) {
            lr.accept(visitor);
          }
        }
      }
    }
  }
});
