import type { Ruleset } from '../ruleset';
import type { Selector } from '../selector';
import type { Rules } from '../rules';
import type { Condition } from '../condition';
import { isNode } from './is-node';

type RulesetWithSelector = Ruleset<{
  selector: Selector;
  rules: Rules;
  guard?: Condition;
}>;

/**
 * Registry for fast selector-based ruleset lookups
 */
export class SelectorRegistry {
  private index = new Map<string, Set<RulesetWithSelector>>();
  private pendingRulesets = new Set<RulesetWithSelector>();

  /**
   * Add a ruleset to be indexed later
   */
  addRuleset(ruleset: Ruleset) {
    if (isNode(ruleset.value.selector, 'Selector')) {
      this.pendingRulesets.add(ruleset as RulesetWithSelector);
    }
  }

  /**
   * Index any pending rulesets
   */
  private indexPendingRulesets() {
    const index = this.index;
    for (const ruleset of this.pendingRulesets) {
      const selector = ruleset.selector;
      if (selector && 'keySet' in selector) {
        for (const key of selector.keySet) {
          const existing = index.get(key);
          if (existing) {
            existing.add(ruleset);
          } else {
            index.set(key, new Set([ruleset]));
          }
        }
      }
    }
    this.pendingRulesets.clear();
  }

  /**
   * Find candidate rulesets that might match the target selector
   */
  findCandidateRulesets(targetSelector: Selector): Set<RulesetWithSelector> {
    // Index any pending rulesets first
    this.indexPendingRulesets();
    const { keySet } = targetSelector;

    let candidates: Set<RulesetWithSelector> | undefined = undefined;

    // Use intersection to whittle down candidates with each subsequent key
    for (const key of keySet) {
      // const key = targetKeys[i]!;
      const keyRulesets = this.index.get(key);
      if (!keyRulesets || keyRulesets.size === 0) {
        return new Set(); // No matches for this key, so no candidates
      }

      candidates = (candidates ?? new Set()).intersection(keyRulesets);
      if (candidates.size === 0) {
        return candidates;
      }
    }

    return candidates ?? new Set();
  }
}