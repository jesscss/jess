import type { Ruleset } from '../ruleset';
import type { Selector } from '../selector';
import type { Rules } from '../rules';
import { isNode } from './is-node';
import type { Mixin } from '../mixin';
import { Nil } from '../nil';
import type { Node } from '../node';
import type { JsFunction } from '../js-function';
import type { Func } from '../function';
import type { Declaration } from '../declaration';
import type { Context } from '../../context';
import { atIndex } from './collections';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const { isArray } = Array;

// Debug logging helper
const debugLog = (location: string, message: string, data: any, hypothesisId: string) => {
  try {
    // registry-utils.ts is in tree/util/, so we need one more level up than reference.ts/rules.ts
    const logPath = join(__dirname, '../../../../../.cursor/debug.log');
    const logEntry = JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId
    }) + '\n';
    appendFileSync(logPath, logEntry, 'utf8');
  } catch (e) {
    // Log error to console to see if writes are failing
    console.error(`[DEBUG LOG ERROR] ${location}: ${message}`, e);
  }
};

export type DeclarationFindOptions = {
  filter?: (n: Node) => boolean;
  candidates?: Set<Node>;
  findAll?: boolean;
  /** This gets set if any parent is set to readonly */
  readonly?: boolean;
  searchParents?: boolean;
  start?: number;
  local?: boolean;
};

export type FindOptions = DeclarationFindOptions & {
  childFilterType?: 'Mixin' | 'Ruleset' | undefined;
  context?: Context;
  searchedRules?: Set<Rules>;
};

export abstract class Registry<
  Type extends Node,
  IndexType extends Type | Set<Type> | Array<{
    value: Type;
    [key: string]: any;
  }> = Set<Type>
> {
  abstract index: Map<string, IndexType>;
  protected pendingItems = new Set<Type>();

  constructor(public rules: Rules) {}

  add(item: Type): void {
    this.pendingItems.add(item);
  }

  indexPendingItems() {
    for (const item of this.pendingItems) {
      let key = String((item as any).value);
      let set = this.index.get(key);
      if (set && set instanceof Set) {
        set.add(item);
      } else {
        this.index.set(key, new Set([item]) as IndexType);
      }
    }
    this.pendingItems.clear();
  }

  _searchRulesChildren(
    key: string,
    filterType: 'VarDeclaration' | 'Declaration' | 'Mixin',
    options: FindOptions = {}
  ) {
    let rules = this.rules;
    let findType = filterType === 'Mixin' ? 'mixin' as const : 'declaration' as const;
    let findAll = Boolean(options.findAll);
    let {
      candidates = new Set(),
      start,
      readonly,
      local,
      childFilterType,
      context
    } = options;
    // childFilterType is the filterType to use when calling child Rules.find
    // If not provided, use filterType (for backward compatibility with DeclarationRegistry)
    // Note: childFilterType can be undefined to mean "don't filter" (accept both Mixin and Ruleset)
    const actualChildFilterType = 'childFilterType' in options ? childFilterType : filterType;
    let firstValue = candidates.values().next().value;
    if (rules._rulesSet) {
      let { rulesSet } = rules;
      /**
       * Only consider rules after the last found declaration (if relevant)
       * and before the start position (if relevant)
       */
      rulesSet = rulesSet.filter((n) => {
        const visibility = n.rulesVisibility?.[filterType] ?? '';
        const isVisible = ['optional', 'public'].includes(visibility);
        // Local nodes can only be searched once - if we've already passed through
        // a local boundary (local === true), we cannot search another local node
        // This prevents re-exporting local variables to parent's parent
        const isLocalNode = Boolean(n.node.options?.local);
        const skipLocalNode = local && isLocalNode; // Skip if already in local context
        // If we already have a candidate (firstValue exists), we should still search imported Rules
        // to compare them and determine which was declared later.
        // The original condition (findAll || !firstValue) was preventing comparison.
        // We need to search imported Rules when:
        // 1. findAll is true (search all)
        // 2. firstValue doesn't exist (initial lookup - search imported Rules to find the variable)
        // 3. firstValue exists AND candidates was explicitly passed with items (comparison context)
        //    This happens when DeclarationRegistry.find calls _searchRulesChildren after finding a local variable
        //    The key difference: if candidates was passed from DeclarationRegistry.find, it will have the local variable
        //    If candidates is empty or wasn't passed, we're in initial lookup mode
        const isComparisonContext = firstValue && candidates.size > 0;
        return (findAll || !firstValue || isComparisonContext)
          && (start === undefined || n.node.index < start)
          && !skipLocalNode
          && isVisible;
      });

      let length = rulesSet.length;
      if (length) {
        // Get searchedRules from options to prevent re-searching the same Rules nodes
        const searchedRules = options?.searchedRules;
        for (let i = length - 1; i >= 0; i--) {
          let r = rulesSet.at(i)!;
          // Skip if we've already searched this Rules node to prevent infinite recursion
          if (searchedRules && searchedRules.has(r.node)) {
            continue;
          }
          /** Locals can be searched once but not twice */
          let newLocal = local || Boolean(r.node.options?.local);
          let newOpts = options ? { ...options, readonly: readonly || r.readonly } : { readonly: readonly || r.readonly };
          newOpts.local = newLocal;
          newOpts.start = undefined;
          // _searchRulesChildren should never search parents - only search within imported Rules
          newOpts.searchParents = false;
          if (context) {
            newOpts.context = context;
          }
          // Use actualChildFilterType which may be undefined for mixin-ruleset lookups
          // filterType parameter is used to SELECT registry, actualChildFilterType is used to FILTER results
          let result = r.node.find(findType, key, actualChildFilterType as any, newOpts);
          if (result) {
            /**
             * If it's a public declaration, and it's the lower-most declaration,
             * it wins.
             */
            if (!findAll && r.rulesVisibility?.[filterType] === 'public') {
              if (options && newOpts.readonly) {
                options.readonly = true;
              }
              // Add to candidates and stop searching this rule
              if (isArray(result)) {
                for (const node of result) {
                  candidates.add(node);
                }
              } else {
                candidates.add(result);
              }
              break; // Stop searching this rule
            }
            /**
             * If we're looking for a declaration and its optional OR
             * we're looking for a mixin, then we need to keep searching.
             */
            options.readonly ||= newOpts.readonly;
            if (isArray(result)) {
              for (const node of result) {
                candidates.add(node);
              }
            } else {
              candidates.add(result);
            }
          }
        }
      }
    }
    // Also search direct child Rules nodes (not just rulesSet)
    // This handles cases like wrapper Rules from getFunctionFromMixins
    // where child Rules are in rules.value, not in rulesSet
    const searchedRules = options?.searchedRules;
    if (rules.value) {
      for (const childNode of rules.value) {
        if (isNode(childNode, 'Rules')) {
          const childRules = childNode as Rules;
          // Skip if we've already searched this Rules node to prevent infinite recursion
          if (searchedRules && searchedRules.has(childRules)) {
            continue;
          }
          // Search in the child Rules - this will trigger indexing via find()
          const newOpts = options ? { ...options, readonly: readonly } : { readonly: readonly };
          newOpts.searchParents = false;
          newOpts.local = local;
          if (context) {
            newOpts.context = context;
          }
          newOpts.start = undefined;
          // Use actualChildFilterType which may be undefined for mixin-ruleset lookups
          // filterType parameter is used to SELECT registry, actualChildFilterType is used to FILTER results
          const result = childRules.find(findType, key, actualChildFilterType as any, newOpts);
          if (result) {
            if (isArray(result)) {
              for (const node of result) {
                candidates.add(node);
              }
            } else {
              candidates.add(result);
            }
          }
        }
      }
    }
  }

  /**
   * Find the closest declaration from start, in reverse order,
   * using a binary search
   */
  _findClosestByStart(list: Type[], start?: number) {
    if (start === undefined) {
      return atIndex(list, -1);
    }
    /**
     * We do this so we start looking above the given position and don't
     * return the current node.
     */
    start -= 1;
    let bestMatch: number | undefined;

    /** Binary search the queue to find a starting position */
    let left = 0;
    let right = list.length - 1;

    while (left <= right) {
      let mid = Math.floor((left + right) / 2);
      let midVal = list.at(mid)!.index;
      if (midVal === start) {
        bestMatch = mid;
        break;
      }
      if (midVal < start) {
        bestMatch = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return bestMatch !== undefined ? list.at(bestMatch) : undefined;
  }

  private _findByKey(candidates: Set<Type> | Type | undefined, key: string): Set<Type> | Type | undefined {
    let set = this.index.get(key);
    if (set) {
      let newSet: Set<Type> | undefined;
      if (set instanceof Set) {
        newSet = set;
      } else if (isArray(set)) {
        newSet = new Set(set.map(({ value }) => value));
      } else {
        return set as Type;
      }
      if (candidates) {
        if (candidates instanceof Set) {
          candidates = candidates.union(newSet);
        } else {
          candidates = new Set([candidates, ...newSet]);
        }
      } else {
        candidates = newSet;
      }
    }
    return candidates;
  }

  find(keys: string | string[] | Set<string>, filterType?: string, options?: FindOptions): Type[] | Type | Array<{ value: Type; [key: string]: any }> | undefined {
    this.indexPendingItems();
    let candidates: Set<Type> | Type | undefined;
    if (isArray(keys) || keys instanceof Set) {
      for (const key of keys) {
        candidates = this._findByKey(candidates, key);
      }
    } else {
      candidates = this._findByKey(candidates, keys);
    }
    if (candidates instanceof Set) {
      return candidates.size ? [...candidates] : undefined;
    }
    return candidates;
  }
}

/**
 * Registry for fast selector-based ruleset lookups
 */
export class RulesetRegistry extends Registry<Ruleset> {
  index = new Map<string, Set<Ruleset>>();

  /**
   * Add a ruleset to be indexed later
   */
  override add(ruleset: Ruleset) {
    if (isNode(ruleset.value.selector, 'Selector')) {
      this.pendingItems.add(ruleset);
    }
  }

  /**
   * Index any pending rulesets
   */
  private indexPendingRulesets() {
    const index = this.index;
    for (const ruleset of this.pendingItems) {
      /** Make sure we're indexing according to the ruleset's context */
      const selector = ruleset.selector instanceof Nil ? ruleset.selector : ruleset.getImplicitSelector(ruleset.selector);
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
    this.pendingItems.clear();
  }

  /**
   * Find candidate rulesets that might match the target selector
   */
  override find(keys: string[] | Set<string>): Ruleset[] | undefined {
    // Index any pending rulesets first
    this.indexPendingRulesets();

    const keyArray = Array.isArray(keys) ? keys : Array.from(keys);

    let candidates: Set<Ruleset> | undefined = undefined;

    // Use intersection to whittle down candidates with each subsequent key
    for (const key of keys) {
      // const key = targetKeys[i]!;
      const keyRulesets = this.index.get(key);
      if (!keyRulesets || keyRulesets.size === 0) {
        // If no matches in current registry, search imported Rules in rulesSet
        if (candidates === undefined) {
          // First key, search imported Rules
          const importedCandidates = this._searchRulesChildrenForRulesets(keys);
          if (importedCandidates && importedCandidates.size > 0) {
            candidates = importedCandidates;
            continue; // Found candidates in imported Rules, continue with next key
          }
        }
        return; // No matches for this key, so no candidates
      }

      if (candidates) {
        /**
         * The ruleset registry is keyed by each selector in each ruleset,
         * so in this registry, we want the intersection i.e. only rulesets
         * with selectors that have every key, as opposed to getting a
         * set of items that have any of the keys.
         */
        candidates = candidates.intersection(keyRulesets);
      } else {
        candidates = keyRulesets;
      }
      /** If the key doesn't exist, we can take an early exit. */
      if (candidates.size === 0) {
        return undefined;
      }
    }

    // Also search imported Rules in rulesSet for additional candidates
    // This allows extends to find rulesets from imported stylesheets
    const importedCandidates = this._searchRulesChildrenForRulesets(keys);
    if (importedCandidates && importedCandidates.size > 0) {
      if (candidates) {
        // Merge with existing candidates
        for (const ruleset of importedCandidates) {
          candidates.add(ruleset);
        }
      } else {
        candidates = importedCandidates;
      }
    }

    return candidates?.size ? [...candidates] : undefined;
  }

  /**
   * Search through imported Rules in rulesSet for rulesets matching the keys
   */
  private _searchRulesChildrenForRulesets(keys: string[] | Set<string>): Set<Ruleset> | undefined {
    let rules = this.rules;
    let candidates: Set<Ruleset> | undefined = undefined;
    const keyArray = Array.isArray(keys) ? keys : Array.from(keys);
    if (rules._rulesSet) {
      let { rulesSet } = rules;
      // Filter to only public/optional rulesets (similar to _searchRulesChildren)
      rulesSet = rulesSet.filter((n) => {
        const visibility = n.rulesVisibility?.Ruleset ?? '';
        const isVisible = ['optional', 'public'].includes(visibility);
        return isVisible;
      });

      let length = rulesSet.length;
      if (length) {
        for (let i = length - 1; i >= 0; i--) {
          let r = rulesSet.at(i)!;
          // Check if the imported Rules has a ruleset registry
          const importedRulesetRegistry = r.node.getRegistry('ruleset');
          importedRulesetRegistry.indexPendingRulesets();
          // Search for rulesets in the imported Rules
          let result = r.node.find('ruleset', keys);
          if (result && result.length > 0) {
            if (candidates) {
              // Merge with existing candidates
              for (const ruleset of result) {
                candidates.add(ruleset);
              }
            } else {
              // First match, create candidates set
              candidates = new Set(result);
            }
          } else {
            // Try searching directly in the imported Rules' value for rulesets
            for (const childNode of r.node.value) {
              if (isNode(childNode, 'Ruleset')) {
                const selector = childNode.selector;
                if (selector && !isNode(selector, 'Nil')) {
                  const selectorKeySet = selector.keySet;
                  if (selectorKeySet) {
                    const keyArray = Array.isArray(keys) ? keys : Array.from(keys);
                    const selectorKeys = Array.from(selectorKeySet);
                    // Check if any search key matches any selector key
                    const hasMatch = keyArray.some(key => selectorKeys.includes(key));
                    if (hasMatch) {
                      const ruleset = childNode as Ruleset;
                      if (candidates) {
                        candidates.add(ruleset);
                      } else {
                        candidates = new Set([ruleset]);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return candidates;
  }
}

/**
 * The mixin registry works a little differently than the selector registry
 * in these ways:
 *
 * 1. The mixin registry can only be indexed by basic element, class, and
 *    id selectors.
 * 2. The index is the start key, not any key found in the selector.
 * 3. '>' and ' ' combinators are ignored.
 * 4. Initial ampersands (implicit or explicit) are ignored.
 * 5. The mixin registry is local to the rules, whereas the selector registry
 *    is global to the file tree.
 * 6. Rulesets and mixins without params will have their children searched
 *    if the first part matches.
 */
export class MixinRegistry extends Registry<
  Mixin | Ruleset,
  Array<{
    value: Mixin | Ruleset;
    match: string[];
  }>
> {
  index = new Map();

  // private getSimpleKeyList(selector: Selector | Nil | undefined): string[] | undefined {
  //   let keyList: string[] | undefined;
  //   if (selector && 'keySet' in selector) {
  //     let passed = true;
  //     let foundBasic = false;
  //     for (const sel of selector.nodes()) {
  //       /** Ampersand is okay at start, but not after a basic selector */
  //       if (!foundBasic && isNode(sel, 'Ampersand')) {
  //         continue;
  //       }

  //       if (isNode(sel, 'Combinator')) {
  //         if (sel.value !== '>' && sel.value !== ' ') {
  //           passed = false;
  //           break;
  //         }
  //         continue;
  //       }

  //       /** Anything other than a universal selector is fine */
  //       if (isNode(sel, 'BasicSelector') && /^[^*]/.test(sel.value)) {
  //         (keyList ??= []).push(sel.valueOf() as string);
  //         foundBasic = true;
  //         continue;
  //       }
  //       if (isNode(sel, 'CompoundSelector') || isNode(sel, 'ComplexSelector')) {
  //         /** Might still be fine */
  //         continue;
  //       }
  //       /** Nothing else is valid, so fail */
  //       passed = false;
  //       break;
  //     }
  //     if (!passed) {
  //       return;
  //     }
  //   }
  //   return keyList;
  // }

  private _indexSelectorStart(mixin: Ruleset | Mixin, keySet: Set<string>) {
    const index = this.index;

    if (keySet?.size) {
      // Filter out non-indexable selectors
      // Universal selectors (*) and pseudo-selectors (:hover, :before, etc.) should not be indexed
      const indexableKeys = Array.from(keySet).filter((key) => {
        return typeof key === 'string' && !key.startsWith('*') && !key.startsWith(':');
      });

      if (indexableKeys.length === 0) {
        return; // Nothing to index
      }

      const [startKey, ...rest] = indexableKeys;
      // #region agent log
      debugLog('registry-utils.ts:553', 'Indexing mixin/ruleset', { startKey, rest, selector: isNode(mixin, 'Ruleset') ? (mixin as Ruleset).value.selector?.valueOf() : undefined, mixinType: mixin.type, rulesIndex: this.rules.index }, 'F');
      // #endregion
      const existing = index.get(startKey!);
      if (existing) {
        existing.push({ value: mixin, match: rest });
      } else {
        index.set(startKey!, [{ value: mixin, match: rest }]);
      }
    }
  }

  override indexPendingItems() {
    for (const mixin of this.pendingItems) {
      if (isNode(mixin, 'Ruleset')) {
        let selector = mixin.value.selector;
        if (isNode(selector, 'Nil')) {
          continue;
        }
        if (isNode(selector, 'SelectorList')) {
          /** Selector list's selectors are individually registered */
          for (const sel of selector.value) {
            // #region agent log
            const keySetArray = Array.from(sel.keySet);
            debugLog('registry-utils.ts:576', 'Indexing SelectorList selector', { selectorValueOf: sel.valueOf(), keySet: keySetArray, rulesetSelector: selector.valueOf() }, 'H');
            // #endregion
            this._indexSelectorStart(mixin, sel.keySet);
          }
        } else {
          // #region agent log
          const keySetArray = Array.from(selector.keySet);
          debugLog('registry-utils.ts:582', 'Indexing single selector', { selectorValueOf: selector.valueOf(), keySet: keySetArray, rulesetSelector: selector.valueOf(), mixinParent: mixin.parent?.type, mixinParentSelector: isNode(mixin.parent, 'Ruleset') ? (mixin.parent as any).value?.selector?.valueOf() : undefined }, 'H');
          // #endregion
          this._indexSelectorStart(mixin, selector.keySet);
        }
      } else {
        // #region agent log
        const keySetArray = Array.from(mixin.keySet);
        debugLog('registry-utils.ts:588', 'Indexing Mixin', { keySet: keySetArray }, 'H');
        // #endregion
        this._indexSelectorStart(mixin, mixin.keySet);
      }
    }
    this.pendingItems.clear();
  }

  /**
   * Check if an entry matches the search criteria.
   * Handles exact matches, partial matches (compound selector completion), and recursive searches.
   * This consolidates the matching logic to avoid duplication.
   */
  private _checkEntryMatch(
    value: Mixin | Ruleset,
    match: string[],
    startKey: string,
    search: string[],
    filterType: 'Mixin' | 'Ruleset' | undefined,
    candidates: Set<Mixin | Ruleset>,
    options?: FindOptions
  ): boolean {
    // Apply filter if provided (e.g., to exclude nodes in searchScope)
    if (options?.filter && !options.filter(value)) {
      return false;
    }

    // For mixin-ruleset lookups (filterType is undefined), accept both Mixin and Ruleset types
    // When filterType is 'Mixin' or 'Ruleset', filter to that specific type only
    if (filterType && value.type !== filterType) {
      return false;
    }

    // Exact match: all match keys match all search keys
    if (arraysEqual(match, search)) {
      candidates.add(value);
      return true;
    }

    // Compound selector completion: searching for a single key (search is empty) and we found a match with additional keys.
    // This handles cases like searching for ".jo" when ".jo.ki" exists.
    // The Ruleset can be called to get a Rules node, and then ".ki" can be looked up in that Rules node.
    // This supports compound selector completion: .jo.ki() matches .jo { .ki {} }, .jo.ki {}, etc.
    // Only match if the match array contains actual selectors (starting with . or #), not universal selectors (*) or combinators
    if (search.length === 0 && match.length > 0 && isNode(value, 'Ruleset')) {
      // Check if match array contains actual selectors (not just universal selectors or combinators)
      const hasActualSelectors = match.some(key => typeof key === 'string' && (key.startsWith('.') || key.startsWith('#')));
      if (hasActualSelectors && !candidates.has(value)) {
        // #region agent log
        const selector = isNode(value, 'Ruleset') ? (value as Ruleset).value.selector : undefined;
        const selectorValueOf = selector && !isNode(selector, 'Nil') ? selector.valueOf() : undefined;
        const selectorKeySet = selector && !isNode(selector, 'Nil') ? Array.from(selector.keySet) : [];
        const selectorType = selector && !isNode(selector, 'Nil') ? selector.type : undefined;
        const rulesetParent = value.parent;
        const rulesetParentType = rulesetParent?.type;
        const rulesetParentSelector = isNode(rulesetParent, 'Ruleset') ? (rulesetParent as Ruleset).value.selector && !isNode((rulesetParent as Ruleset).value.selector, 'Nil') ? (rulesetParent as Ruleset).value.selector.valueOf() : undefined : undefined;
        // Check if selector is a ComplexSelector and what its components are
        const selectorComponents = selector && !isNode(selector, 'Nil') && 'value' in selector ? (selector as any).value : undefined;
        const selectorComponentTypes = Array.isArray(selectorComponents) ? selectorComponents.map((c: any) => c?.type) : undefined;
        debugLog('registry-utils.ts:673', 'Adding compound selector candidate for partial match', { startKey, match, valueType: value.type, selectorValueOf, selectorKeySet, selectorType, selectorComponentTypes, rulesetParentType, rulesetParentSelector, note: 'checking selector structure to see why keySet includes parent keys' }, 'G');
        // #endregion
        // Store the matched keys so far (e.g., [".jo"]) for chained calls like .jo.ki()
        // When looking up the next key, we'll accumulate it and use registry lookup to verify the match
        if (options?.context) {
          options.context.partialMatchKeys.set(value, [startKey]);
        }
        candidates.add(value);
        return true;
      }
    }

    // Partial match: startKey appears in the match array (for cases where key is indexed under a different startKey)
    if (search.length === 0 && match.includes(startKey)) {
      // #region agent log
      debugLog('registry-utils.ts:607', 'Found partial match in match array', { startKey, matchIndex: match.indexOf(startKey), match }, 'F');
      // #endregion
      candidates.add(value);
      return true;
    }

    return false;
  }

  /**
   * Check if a Ruleset/Mixin matches a given array of keys using the same logic as the registry
   * This uses the indexed match arrays (same as _checkEntryMatch) rather than direct selector comparison
   * @param value The Ruleset or Mixin to check
   * @param keys The array of keys to match against (e.g., [".jo", ".ki"])
   * @returns true if the Ruleset/Mixin matches the keys using registry matching logic
   */
  checkRulesetMatchesKeys(value: Mixin | Ruleset, keys: string[]): boolean {
    if (!keys || keys.length === 0) {
      return false;
    }

    // Get the selector's keySet and extract indexable keys (same as _indexSelectorStart)
    let indexableKeys: string[] = [];
    if (isNode(value, 'Ruleset')) {
      const selector = value.value.selector;
      if (isNode(selector, 'Nil')) {
        return false;
      }
      if (isNode(selector, 'SelectorList')) {
        // For selector lists, check if any selector matches
        return selector.value.some((sel) => {
          const selKeys = Array.from(sel.keySet).filter(key =>
            typeof key === 'string' && !key.startsWith('*') && !key.startsWith(':')
          );
          if (selKeys.length === 0) { return false; }
          // #region agent log
          debugLog('registry-utils.ts:680', 'Checking SelectorList selector', { selKeys, keys, selectorValueOf: sel.valueOf() }, 'H');
          // #endregion
          // Check if keys appear in sequence in this selector's keys
          return this._checkKeysSubsequence(selKeys, keys);
        });
      }
      const keySet = selector.keySet;
      if (!keySet || keySet.size === 0) {
        return false;
      }
      indexableKeys = Array.from(keySet).filter((key) => {
        return typeof key === 'string' && !key.startsWith('*') && !key.startsWith(':');
      });
      // #region agent log
      const fullKeySetArray = Array.from(keySet);
      debugLog('registry-utils.ts:695', 'Checking Ruleset keySet', { indexableKeys, fullKeySet: fullKeySetArray, keys, selectorValueOf: selector.valueOf(), keySetSize: keySet.size, note: 'indexableKeys is what we use for matching, selectorValueOf may include parent context' }, 'H');
      // #endregion
    } else {
      const keySet = value.keySet;
      if (!keySet || keySet.size === 0) {
        return false;
      }
      indexableKeys = Array.from(keySet).filter((key) => {
        return typeof key === 'string' && !key.startsWith('*') && !key.startsWith(':');
      });
    }

    if (indexableKeys.length === 0) {
      return false;
    }

    // Check if the provided keys appear in sequence in the selector's indexable keys
    // The keySet should only contain keys from the Ruleset's own selector, not parent context
    return this._checkKeysSubsequence(indexableKeys, keys);
  }

  /**
   * Internal helper that checks if the provided keys appear in sequence within the selector's keys
   *
   * For compound selectors like `#header .milk .chips .jo.ki`, when we search for `.jo`, we get:
   * - The full selector's indexable keys: `["#header", ".milk", ".chips", ".jo", ".ki"]`
   * - When checking if accumulated keys `[".jo", ".ki"]` match, we check if they appear in sequence
   */
  private _checkKeysSubsequence(selectorKeys: string[], searchKeys: string[]): boolean {
    if (searchKeys.length === 0) {
      return false;
    }

    // Check if searchKeys is a subsequence of selectorKeys (searchKeys appear in order)
    let searchIndex = 0;
    for (const selectorKey of selectorKeys) {
      if (searchIndex < searchKeys.length && selectorKey === searchKeys[searchIndex]) {
        searchIndex++;
      }
    }

    const matches = searchIndex === searchKeys.length;
    // #region agent log
    debugLog('registry-utils.ts:727', 'Checking keys subsequence', { selectorKeys, searchKeys, matches, searchIndex }, 'H');
    // #endregion
    return matches;
  }

  /**
   * Find candidate mixins (or rulesets, or both) that might match the target selector
   *
   * ...also...
   *
   * @todo - Not sure how recursion works here with the match overflow and returning
   * proper arrays.
   */
  override find(
    keys: string | string[],
    filterType: 'Mixin' | 'Ruleset' | undefined = undefined,
    options: FindOptions = {}
  ): (Mixin | Ruleset)[] | undefined {
    let keyList: string[] | undefined;

    if (isArray(keys)) {
      keyList = keys;
    } else {
      keyList = [keys];
    }

    if (!keyList?.length) {
      return;
    }

    let rules: Rules | undefined = this.rules;
    let { searchParents = true, local = false, candidates = new Set(), context } = options ?? {};
    // Track which Rules nodes we've already searched to prevent infinite recursion
    // Use the searchedRules from options if it exists, otherwise create a new Set
    const searchedRules = options?.searchedRules || new Set<Rules>();
    if (options) {
      options.searchedRules = searchedRules;
    }
    while (rules) {
      // If we've already searched this Rules node, skip it to prevent recursion
      if (searchedRules.has(rules)) {
        break;
      }
      // Don't add to searchedRules yet - we'll add it after we finish searching (including children)
      let [startKey, ...search] = keyList;
      let registry = rules.getRegistry('mixin');
      registry.indexPendingItems();
      // #region agent log
      // Use a more reliable identifier - track Rules node identity by value length and parent
      const rulesId = `${rules.value.length}_${rules.parent ? 'hasParent' : 'noParent'}_${Date.now()}`;
      debugLog('registry-utils.ts:671', 'Searching in Rules node', { startKey, rulesId, registrySize: registry.index.size, searchKeys: keyList, rulesValueLength: rules.value.length }, 'F');
      // #endregion
      const existing = registry.index.get(startKey!);

      if (existing) {
        for (const { value, match } of existing) {
          // Check for exact match, compound selector completion, or partial match
          if (this._checkEntryMatch(value, match, startKey!, search, filterType, candidates as Set<Mixin | Ruleset>, options)) {
            continue;
          }

          // If there are more search keys, and this is a ruleset or has empty params
          if (search.length > match.length) {
            const remainder = search.slice(match.length);
            if (
              (isNode(value, 'Ruleset'))
              || (isNode(value, 'Mixin') && (!value.value.params || (value.value.params?.length ?? 0) === 0))
            ) {
            // Recursively search in this mixin's registry
              let subRules = value.value.rules;
              const recursiveResult = subRules.getRegistry('mixin').find(remainder, filterType, {
                searchParents: false,
                local,
                candidates: candidates as Set<Node>,
                context,
                filter: options?.filter
              } as FindOptions);
            }
          }
        }
      }

      // If direct lookup failed and we're searching for a single key (search is empty),
      // also check all entries to see if startKey appears in their match arrays.
      // This handles cases like searching for ".biohazard" when it's indexed under "#container"
      // with match: ["#header", ".milk", ".secure-zone", ".biohazard"]
      let checkedAllEntries = false;
      if (!existing && search.length === 0) {
        // #region agent log
        debugLog('registry-utils.ts:590', 'Direct lookup failed, checking all entries for partial match', { startKey, registrySize: registry.index.size }, 'F');
        // #endregion
        checkedAllEntries = true;
        for (const [indexKey, entries] of registry.index.entries()) {
          for (const { value, match } of entries) {
            // #region agent log
            debugLog('registry-utils.ts:728', 'Checking entry for partial match', { startKey, indexKey, match, valueType: value.type, selector: isNode(value, 'Ruleset') ? (value as Ruleset).value.selector?.valueOf() : undefined }, 'F');
            // #endregion
            // Use the consolidated match checking logic
            this._checkEntryMatch(value, match, startKey!, search, filterType, candidates as Set<Mixin | Ruleset>, options);
          }
        }
      }

      // Always search children if we haven't found candidates yet
      // The registry might be empty (e.g., wrapper Rules nodes from getFunctionFromMixins),
      // but the child Rules nodes might have the Rulesets we need
      // Only skip searching children if we found candidates AND we've checked all entries AND the registry has entries
      // (meaning we found everything we need in this Rules node)
      const shouldSearchChildren = candidates.size === 0 || !checkedAllEntries || registry.index.size === 0;

      if (shouldSearchChildren) {
        registry._searchRulesChildren(
          startKey!,
          'Mixin', // This selects which registry to search (mixin vs declaration)
          {
            searchParents: false,
            local,
            candidates: candidates as Set<Node>,
            findAll: true,
            childFilterType: filterType, // Pass the original filterType to use when calling child Rules.find
            context,
            filter: options?.filter,
            searchedRules: searchedRules // Pass through to prevent re-searching
          }
        );
      }

      // Mark this Rules node as searched after we've finished searching it (including children)
      searchedRules.add(rules);

      if (!searchParents) {
        break;
      }
      do {
        rules = rules?.parent as Rules;
        /**
         * If we reach an import boundary, stop unless it's an `@import`
         * which means these rules can reach into the parent file that imports
         * this one.
         */
        if (rules && isNode(rules.sourceNode, 'StyleImport') && rules.sourceNode.options.type !== 'import') {
          rules = undefined;
          break;
        }
      } while (rules && rules.type !== 'Rules');
    }
    return candidates.size ? [...candidates] as (Mixin | Ruleset)[] : undefined;
  }
}

/**
 * For either Sass, Jess, or JS functions.
 *
 * Less and Sass can register global functions that can be called from the language
 * without a `@-use` directive.
 *
 * @todo Should the presence of `@-use` directives anywhere in the
 * stylesheet tree cause these global functions to be disabled?
 */
export class FunctionRegistry extends Registry<JsFunction, JsFunction> {
  index = new Map<string, JsFunction>();

  override indexPendingItems() {
    for (const item of this.pendingItems) {
      this.index.set(item.name!, item);
    }
    this.pendingItems.clear();
  }

  override find(name: string, filterType?: string, options?: FindOptions): JsFunction | undefined {
    let fn: JsFunction | undefined;
    let rules: Rules | undefined = this.rules;
    let { searchParents = true } = options ?? {};
    let findRoot = false;
    while (rules) {
      let registry = rules.functionRegistry;
      if (registry) {
        registry.indexPendingItems();
        fn = registry.index.get(name);

        if (fn || !searchParents) {
          break;
        }
      }

      do {
        rules = rules?.parent as Rules;
        if (findRoot && rules.type === 'Rules' && rules?.parent === undefined) {
          /** We're at the root */
          break;
        }
        /**
         * If we reach an import boundary, skip the scope until we get to the top level.
         */
        if (rules && isNode(rules.sourceNode, 'StyleImport') && rules.sourceNode.options.type !== 'import') {
          findRoot = true;
        }
      } while (!findRoot && rules && rules.type !== 'Rules');
    }

    return fn;
  }
}

/**
 *
 * @note - Keys of different types may overlap, but then are filtered when searching.
 *         As in, a variable named `$foo` and a property named `foo` will be in the
 *         same map.
 */
export class DeclarationRegistry extends Registry<Declaration> {
  index = new Map<string, Set<Declaration>>();

  override indexPendingItems() {
    for (const item of this.pendingItems) {
      let key = String(item.value.name);
      let set = this.index.get(key);
      if (set && set instanceof Set) {
        set.add(item);
      } else {
        this.index.set(key, new Set([item]));
      }
    }
    this.pendingItems.clear();
  }

  /**
   * Get declarations from map and nested rulesets.
   * This will return a list of all matching nodes.
   *
   * @todo - The pattern for mixins will be similar, no? Can this be
   * re-used / abstracted?
   *
   * @todo - Register declarations and index them only when searching.
   * This would be similar to how we index rulesets for extending.
   */
  override find(
    key: string,
    filterType: 'VarDeclaration' | 'Declaration' = 'VarDeclaration',
    options?: FindOptions
  ): Declaration | undefined {
    let declCandidate = new Set<Declaration>();
    let rules: Rules | undefined = this.rules;
    let isPublic = false;
    let {
      searchParents = true,
      local = false,
      start
    } = options ?? {};

    let newReadonly: boolean | undefined = false;
    while (rules) {
      let currentReadonly = options?.readonly || rules.options.readonly;
      newReadonly = currentReadonly;
      let registry = rules.getRegistry('declaration');
      registry.indexPendingItems();
      let set = registry.index.get(key);
      let list = set ? [...set] : undefined;
      if (list) {
        list = list.filter(
          n =>
            n.type === filterType
            && (
              !options?.filter
              || options.filter(n)
            )
        );
        // Sort by index for _findClosestByStart (which uses binary search)
        if (list.length > 1) {
          list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        }
      }
      if (list?.length) {
        let result = rules.getRegistry('declaration')._findClosestByStart(list, start);
        if (result) {
          newReadonly ||= result.options.readonly;
          // Add to candidates instead of replacing
          declCandidate.add(result);
        }
        isPublic = true;
      }
      let searchChildrenOptions = {
        ...options,
        searchParents: false,
        readonly: newReadonly,
        candidates: declCandidate
      };

      rules.getRegistry('declaration')._searchRulesChildren(key, filterType, searchChildrenOptions);

      // If we found declarations, compare by Rules node sibling index (where the Rules appears in parent)
      // Variable indices are only used for linear lookups within the same Rules
      if (declCandidate.size > 0) {
        let bestResult: Declaration | undefined;
        let bestRulesIndex = -1;
        for (const candidate of declCandidate) {
          // Get the Rules node that contains this variable
          const candidateRules = candidate.rulesParent;
          // Get the Rules node's index as a sibling in its parent Rules
          // For variables in the current Rules (the one we're searching in), treat it as having
          // the highest index since it's the "current scope" and should win over imported Rules
          // For variables in imported Rules, use the imported Rules' index (set when registered)
          const candidateRulesIndex = candidateRules === rules
            ? Number.MAX_SAFE_INTEGER // Current Rules: treat as highest priority
            : (candidateRules?.index ?? -1); // Imported Rules' index (set when registered)

          // Compare by Rules node sibling index - the Rules that appears later wins
          if (candidateRulesIndex > bestRulesIndex) {
            bestRulesIndex = candidateRulesIndex;
            bestResult = candidate;
          }
        }
        // If we found a result, return it; otherwise return the first one
        const result = bestResult || declCandidate.values().next().value;
        // Check if this is a public declaration (not optional)
        // For now, assume all declarations in children are public since _searchRulesChildren
        // should have returned immediately for public declarations
        isPublic = true; // Set isPublic to true so we don't continue searching parents
        if (options && searchChildrenOptions.readonly) {
          options.readonly = true;
        }
        return result;
      }

      if (isPublic || !searchParents) {
        if (options && searchChildrenOptions.readonly) {
          options.readonly = true;
        }
        const result = declCandidate.values().next().value;
        return result;
      }

      do {
        rules = rules?.parent as Rules;
        /** If we're searching linearly, update the start position to the parent node index */
        // if (start !== undefined && rules) {
        //   start = rules.index;
        // }
        /**
         * If we reach an import boundary, stop unless it's an `@import`
         * which means these rules can reach into the parent file that imports
         * this one.
         */
        if (rules && isNode(rules.sourceNode, 'StyleImport') && rules.sourceNode.options.type !== 'import') {
          rules = undefined;
          break;
        }
      } while (rules && !isNode(rules, 'Rules'));
    }
    if (options && newReadonly) {
      options.readonly = true;
    }
    return declCandidate.values().next().value;
  }
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}