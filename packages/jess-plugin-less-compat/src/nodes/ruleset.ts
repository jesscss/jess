import { Ruleset, Nil, Selector, SelectorList, Rules, Node } from '@jesscss/core';
import { createFromAdapter } from '../transform/adapter.js';
import { toLessNode } from '../transform/to-less.js';
import { transformSelectorToLess } from './selector.js';

/**
 * Return a Ruleset's child rules as a flat array.
 *
 * Core's `Ruleset.rules` is normally a plain `Node[]` (the parser delivers an
 * array), but a caller may also construct a Ruleset with a `Rules` wrapper node
 * as its body (`new Ruleset({ rules: new Rules([...]) })`). The wrapper is stored
 * as-is now that the old factory-side unwrap was removed, so read its `.rules`.
 */
function ruleList(rs: Ruleset): Node[] {
  // `rs.rules` is typed `Node[]`, but a `Rules` wrapper node may be stored there
  // at runtime (see doc above), so widen before narrowing.
  const rules: Node[] | Rules = rs.rules;
  if (rules instanceof Rules) {
    return rules.rules;
  }
  if (Array.isArray(rules)) {
    return rules;
  }
  return [];
}

export const transformRulesetToLess = createFromAdapter<Ruleset>({
  fields: {
    selectors: (rs, cache) => {
      const selector = rs.selector;
      if (selector instanceof Nil) {
        return [];
      }
      if (!selector) {
        return [];
      }
      if (selector instanceof SelectorList) {
        return selector.value
          .filter((s): s is Selector => s instanceof Selector)
          .map(s => transformSelectorToLess(s, cache));
      }
      return [transformSelectorToLess(selector, cache)];
    },
    rules: (rs, cache) => {
      return ruleList(rs).map((r: Node) => toLessNode(r, { cache }));
    }
  },
  accept: (ruleset, visitor, cache) => {
    const selector = ruleset.selector;
    const rules = ruleList(ruleset);

    // Traverse selectors
    if (selector && !(selector instanceof Nil)) {
      if (selector instanceof SelectorList) {
        const lessSelectors = selector.value
          .filter((s): s is Selector => s instanceof Selector)
          .map(s => toLessNode(s, { cache }));
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
        const lessSelector = transformSelectorToLess(selector, cache);
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
    if (rules.length > 0) {
      const lessRules = rules.map((r: Node) => toLessNode(r, { cache }));
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
