import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import { applyExtendsToSelector } from './extend.js';
import { isNode } from './is-node.js';
import { Nil } from '../nil.js';

export { ExtendRootRegistry } from './extend-roots.old.js';

const rulesetsByRoot = new Map<Rules, Set<Ruleset>>();

export function registerRulesetWithRoot(root: Rules, ruleset: Ruleset): void {
  if (!root || !ruleset) {
    return;
  }
  let set = rulesetsByRoot.get(root);
  if (!set) {
    set = new Set<Ruleset>();
    rulesetsByRoot.set(root, set);
  }
  set.add(ruleset);
}

export function processExtends(context: Context): void {
  const instructions = context.extends.map(([target, selectorWithExtend, partial, extendRoot]) => ({
    target,
    extendWith: selectorWithExtend,
    partial,
    extendRoot
  }));

  if (!instructions.length) {
    return;
  }

  for (const [rootRules, rulesetSet] of rulesetsByRoot) {
    if (!rootRules) {
      continue;
    }
    const visibleExtends = instructions.filter((instruction) => {
      if (!instruction.extendRoot) {
        return false;
      }
      if (instruction.extendRoot === rootRules) {
        return true;
      }
      return context.extendRoots.isSameOrDescendantRoot(rootRules, instruction.extendRoot);
    });
    if (!visibleExtends.length) {
      continue;
    }

    for (const ruleset of rulesetSet) {
      const selector = ruleset.value.selector as Selector | undefined;
      if (!selector || isNode(selector, 'Nil')) {
        continue;
      }
      const newSelector = applyExtendsToSelector(selector, visibleExtends);
      if (newSelector !== selector) {
        ruleset.value.selector = newSelector;
      }
    }
  }
}
