import type { Ruleset } from '../ruleset';
import type { Selector } from '../selector';
import type { Rules } from '../rules';
import { isNode } from './is-node';
import type { Mixin } from '../mixin';
import { Nil } from '../nil';
import { Node } from '../node';
import type { JsFunction } from '../js-function';
import type { Func } from '../function';
import type { Declaration } from '../declaration';
import type { Context } from '../../context';
import { atIndex } from './collections';

const { isArray } = Array;

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
  /**
   * Whether this lookup has an explicit target (e.g., #ns[@foo]).
   * When true, Rules with isMixinOutput=true will be searchable.
   * When false or undefined, mixin output Rules will be excluded.
   */
  hasTarget?: boolean;
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
    // CRITICAL FIX: Initialize searchedRules if not provided, and add current Rules BEFORE any recursive calls
    // The flaw in the original algorithm: when _searchRulesChildren calls childRules.find(), that creates
    // a new search context via DeclarationRegistry.find(), which may not preserve searchedRules tracking.
    // By initializing it here and adding the current Rules immediately, we ensure tracking persists.
    const searchedRules = options?.searchedRules ?? new Set<Rules>();
    if (!searchedRules.has(rules)) {
      searchedRules.add(rules);
    }
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
        const isMixinOutput = n.node.options?.isMixinOutput === true;
        // If lookup has a target and Rules is mixin output, grant public access to all nodes
        if (isMixinOutput && options?.hasTarget === true) {
          return true;
        }
        // Otherwise, follow normal visibility rules
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
        // searchedRules is already initialized above and includes the current Rules
        for (let i = length - 1; i >= 0; i--) {
          let r = rulesSet.at(i)!;
          // Skip if we've already searched this Rules node to prevent infinite recursion
          if (searchedRules && searchedRules.has(r.node)) {
            continue;
          }
          if (r.node === rules) {
            throw new Error(`Rules node contains itself in rulesSet`);
          }
          /** Locals can be searched once but not twice */
          let newLocal = local || Boolean(r.node.options?.local);
          let newOpts = options ? { ...options, readonly: readonly || r.readonly } : { readonly: readonly || r.readonly };
          newOpts.local = newLocal;
          newOpts.start = undefined;
          // _searchRulesChildren should never search parents - only search within imported Rules
          newOpts.searchParents = false;
          // Pass through searchedRules to prevent circular references
          // searchedRules is always defined (initialized above)
          newOpts.searchedRules = searchedRules;
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
    // REMOVED: Manual iteration through rules.value for child Rules nodes
    // If a Rules node is in rules.value and should be searchable, it should be registered
    // via registerNode() which adds it to rulesSet. We already search rulesSet above.
    // Manually iterating through rules.value creates infinite loops when a Rules node
    // appears in its own children, and is unnecessary since registered Rules are in rulesSet.
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
      // Check if the selector contains any non-indexable selectors
      // Universal selectors (*) and pseudo-selectors (:hover, :before, etc.) should not be indexed
      // If the selector contains ANY non-indexable selector, the entire mixin/ruleset should not be registered
      const hasNonIndexableKeys = Array.from(keySet).some((key) => {
        return typeof key === 'string' && (key.startsWith('*') || key.startsWith(':'));
      });

      if (hasNonIndexableKeys) {
        return; // Don't register mixins/rulesets with non-indexable selectors
      }

      // All keys are indexable, so proceed with indexing
      const indexableKeys = Array.from(keySet);
      const [startKey, ...rest] = indexableKeys;
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
        // Use the ruleset's own selector, not the implicit selector with parent context
        // This ensures nested rulesets are indexed by their local keys, not parent keys
        // If the selector has been evaluated/flattened, use sourceNode which has the original
        let selector = mixin.value.selector;
        if (isNode(selector, 'Nil')) {
          continue;
        }
        // Use sourceNode if available - it has the original selector with implicit ampersand
        // Use visibleKeySet to get only the visible selectors (ignoring invisible ampersands)
        const selectorToIndex = (selector.sourceNode || selector) as Selector;
        if (isNode(selectorToIndex, 'SelectorList')) {
          /** Selector list's selectors are individually registered */
          for (const sel of selectorToIndex.value) {
            this._indexSelectorStart(mixin, sel.visibleKeySet);
          }
        } else {
          this._indexSelectorStart(mixin, selectorToIndex.visibleKeySet);
        }
      } else {
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
          if (selKeys.length === 0) {
            return false;
          }
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
    let {
      searchParents = true,
      local = false,
      candidates = new Set(),
      context,
      hasTarget = false
    } = options ?? {};

    // Track which Rules nodes we've already searched to prevent infinite recursion
    // Use the searchedRules from options if it exists, otherwise create a new Set
    const searchedRules = options?.searchedRules || new Set<Rules>();
    if (options) {
      options.searchedRules = searchedRules;
    }
    while (rules) {
      // Don't add to searchedRules yet - we'll add it after we finish searching (including children)
      let [startKey, ...search] = keyList;
      let registry = rules.getRegistry('mixin');
      registry.indexPendingItems();
      const existing = registry.index.get(startKey!);

      // With the new indexing (by local visible keys), nested rulesets are indexed under their own keys
      // So we only need to check entries under the startKey - no need to scan all entries
      let allEntriesToCheck: Array<{ value: Mixin | Ruleset; match: string[] }> = [];
      if (existing) {
        allEntriesToCheck.push(...existing);
      }
      // Also check if any entries match the full search path (for compound selectors like .foo.bar)
      const targetMatch = search.length === 0 ? [startKey!] : search;
      for (const entries of registry.index.values()) {
        for (const entry of entries) {
          if (arraysEqual(entry.match, targetMatch)) {
            allEntriesToCheck.push(entry);
          }
        }
      }

      if (allEntriesToCheck.length > 0) {
        const targetMatch = search.length === 0 ? [startKey!] : search;
        for (const { value, match } of allEntriesToCheck) {
          if (filterType && value.type !== filterType) {
            continue;
          }

          // If match equals targetMatch (search or [startKey] when search is empty), this IS the ruleset we're looking for
          // Also, if search is empty and match is empty, this ruleset IS the startKey we're looking for
          if (arraysEqual(match, targetMatch) || (search.length === 0 && match.length === 0)) {
            (candidates ??= new Set()).add(value);
            continue;
          }

          // If match equals [startKey] OR match is empty (meaning this ruleset IS the startKey),
          // we need to search inside it for the remaining search keys
          if (search.length > 0 && (arraysEqual(match, [startKey!]) || match.length === 0)) {
            if (
              (isNode(value, 'Ruleset'))
              || (isNode(value, 'Mixin') && (!value.value.params || (value.value.params?.length ?? 0) === 0))
            ) {
              let subRules = value.value.rules;
              const subMixinRegistry = subRules.getRegistry('mixin');
              subMixinRegistry.indexPendingItems();
              // With the new indexing, nested rulesets are indexed by their local visible keys
              // So we can just do a normal recursive search - no need to check for matches ending with search
              // When searching inside a nested ruleset with searchParents: false, we don't need searchedRules
              // because we're not traversing the parent chain
              subMixinRegistry.find(search, filterType, {
                searchParents: false,
                local,
                candidates: candidates as Set<Node>,
                context,
                filter: options?.filter,
                hasTarget,
                searchedRules: undefined // Not needed when searchParents is false
              } as FindOptions);
            }
            continue;
          }

          // If there are more search keys than match keys, recursively search inside this ruleset
          // This handles cases where match is a prefix of search (e.g., match=[".foo"], search=[".foo", ".bar"])
          // Or when match is empty (ruleset IS the startKey) and we need to search inside for the full search
          const shouldRecurse = search.length > 0 && (search.length > match.length || match.length === 0);
          const isPrefix = match.length > 0 && arraysEqual(match, search.slice(0, match.length));
          if (shouldRecurse) {
            let searchKeys: string[];
            if (match.length === 0) {
              // Match is empty, meaning this ruleset IS the startKey, search inside for the full search
              searchKeys = search;
            } else if (isPrefix) {
              // Match is a prefix of search, search for the remainder after the match
              searchKeys = search.slice(match.length);
            } else {
              // Match is not a prefix of search - skip this ruleset, it doesn't match
              continue;
            }
            if (
              (isNode(value, 'Ruleset'))
              || (isNode(value, 'Mixin') && (!value.value.params || (value.value.params?.length ?? 0) === 0))
            ) {
              let subRules = value.value.rules;
              const subMixinRegistry = subRules.getRegistry('mixin');
              subMixinRegistry.indexPendingItems();
              subMixinRegistry.find(searchKeys, filterType, {
                searchParents: false,
                local,
                candidates: candidates as Set<Node>,
                context,
                filter: options?.filter,
                hasTarget,
                searchedRules: searchedRules
              } as FindOptions);
            }
          }
        }
      }

      // Always search children (old behavior)
      registry._searchRulesChildren(
        startKey!,
        'Mixin',
        {
          searchParents: false,
          local,
          candidates: candidates as Set<Node>,
          findAll: true,
          childFilterType: filterType,
          context,
          filter: options?.filter,
          hasTarget,
          searchedRules: searchedRules
        }
      );

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

    // With compound keys parsed as arrays (e.g., ['#theme', '.dark', '.navbar', '.colors']),
    // we can find all matches in one pass. The find() method handles compound keys by
    // recursively searching inside nested rulesets for the remaining keys.

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
    // Track visited Rules nodes in the parent chain to detect circular parent chains
    const visitedRules = new Set<Rules>();
    while (rules) {
      // CRITICAL: Check for circular parent chain
      if (visitedRules.has(rules)) {
        throw new Error(`Circular parent chain detected in DeclarationRegistry.find`);
      }
      visitedRules.add(rules);
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
      // Initialize searchedRules to prevent infinite recursion when searching child Rules
      // This is critical: if a Rules node appears in its own children, we need to track it
      const searchedRules = options?.searchedRules ?? new Set<Rules>();
      if (!searchedRules.has(rules)) {
        searchedRules.add(rules);
      }
      // CRITICAL: When searching children, we MUST set searchParents: false to prevent
      // infinite loops. Children searches should never traverse up the parent chain.
      // If options.searchParents is true, we're in a parent search context, and searching
      // children should not trigger another parent search.
      let searchChildrenOptions = {
        ...options,
        searchParents: false, // Always false when searching children
        readonly: newReadonly,
        candidates: declCandidate,
        searchedRules: searchedRules
      };

      const searchRules = this.rules;
      const beforeSearchCount = declCandidate.size;
      searchRules.getRegistry('declaration')._searchRulesChildren(key, filterType, searchChildrenOptions);
      const afterSearchCount = declCandidate.size;

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