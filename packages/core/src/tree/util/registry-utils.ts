import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import type { Rules } from '../rules.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import type { Mixin } from '../mixin.js';
import { Nil } from '../nil.js';
import { Node } from '../node.js';
import { JsFunction } from '../js-function.js';
import type { Func } from '../function.js';
import type { Declaration } from '../declaration.js';
import type { Context } from '../../context.js';
import { atIndex } from './collections.js';
import { comparePosition } from './compare.js';
import { type BitSet, type BitSetLibrary, isSubsetOf } from './bitset.js';

const { isArray } = Array;

type SelectorKeySet = Set<string> | BitSet<string>;
type SelectorKeySource = SelectorKeySet | string[];

const NON_INDEXABLE_SELECTOR_KEYS = new Set(['', ' ', '>', '+', '~', '||']);

function isIndexableSelectorKey(key: string): boolean {
  return !key.startsWith(':') && !NON_INDEXABLE_SELECTOR_KEYS.has(key);
}

function tryGetSelectorKeySet(
  selector: Selector | Nil | undefined,
  visible: boolean = true
): SelectorKeySet | undefined {
  if (!selector || selector instanceof Nil) {
    return undefined;
  }
  try {
    return visible ? selector.visibleKeySet : selector.keySet;
  } catch {
    return undefined;
  }
}

function getSelectorKeyValues(keySet: SelectorKeySource | undefined): string[] {
  if (!keySet) {
    return [];
  }
  if (isArray(keySet)) {
    return keySet;
  }
  if (keySet instanceof Set) {
    return [...keySet];
  }
  return keySet._library?.valuesOf(keySet) ?? [];
}

function hasSelectorKey(keySet: SelectorKeySet | undefined, key: string): boolean {
  if (!keySet) {
    return false;
  }
  if (keySet instanceof Set) {
    return keySet.has(key);
  }
  return keySet._library?.hasBit(keySet, key) ?? false;
}

function getIndexableSelectorKeys(keySet: SelectorKeySource | undefined): string[] {
  return getSelectorKeyValues(keySet).filter(
    key => typeof key === 'string' && !key.startsWith('*') && isIndexableSelectorKey(key)
  );
}

export type DeclarationFindOptions = {
  filter?: (n: Node) => boolean;
  candidates?: Set<Node>;
  optionalCandidates?: Set<Node>;
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
    if (this.pendingItems.size === 0) {
      return;
    }
    for (const item of this.pendingItems) {
      let key = String(item.valueOf());
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
      const { rulesSet } = rules;
      const length = rulesSet.length;
      if (length) {
        // Create one shared child options object, reused across loop iterations
        const childOpts: FindOptions = options
          ? {
              ...options,
              searchParents: false,
              start: undefined,
              searchedRules,
              context
            }
          : { searchParents: false, start: undefined, readonly, searchedRules, context };
        const optionalCandidates = options?.optionalCandidates;
        const isComparisonContext = firstValue && candidates.size > 0;
        const hasTarget = options?.hasTarget === true;

        // searchedRules is already initialized above and includes the current Rules
        // Inline the filter logic into the loop to avoid creating an intermediate array
        for (let i = length - 1; i >= 0; i--) {
          let r = rulesSet.at(i)!;

          // --- inline filter logic ---
          const entryVisibility = r.rulesVisibility?.[filterType];
          const nodeVisibility = r.node.options.rulesVisibility?.[filterType];
          const visibility = entryVisibility ?? nodeVisibility;
          const isMixinOutput = r.node.options?.isMixinOutput === true;
          if (isMixinOutput && !hasTarget) {
            continue;
          }
          if (!isMixinOutput) {
            const isVisible = visibility === 'public' || visibility === 'optional';
            if (!isVisible) {
              continue;
            }
            if (r.node.options?.forward && context?.rulesContext === rules) {
              continue;
            }
            if (local && r.node.options?.local) {
              continue;
            }
            if (!(findAll || !firstValue || isComparisonContext)) {
              continue;
            }
            if (start !== undefined && r.node.index >= start) {
              continue;
            }
          }
          // --- end inline filter logic ---
          // Skip if we've already searched this Rules node to prevent infinite recursion
          if (searchedRules && searchedRules.has(r.node)) {
            continue;
          }
          if (r.node === rules) {
            throw new Error(`Rules node contains itself in rulesSet`);
          }
          // Update per-iteration fields on the shared object
          childOpts.readonly = readonly || r.readonly;
          childOpts.local = local || Boolean(r.node.options?.local);
          // Use actualChildFilterType which may be undefined for mixin-ruleset lookups
          // filterType parameter is used to SELECT registry, actualChildFilterType is used to FILTER results
          let result = r.node.find(findType, key, actualChildFilterType as any, childOpts);
          if (result) {
            // Check if this Rules has optional visibility (from RulesEntry or the actual Rules node)
            const entryVisibility = r.rulesVisibility?.[filterType];
            const nodeVisibility = r.node.options.rulesVisibility?.[filterType];
            const isOptional = entryVisibility === 'optional' || nodeVisibility === 'optional';

            const isPublic = entryVisibility === 'public' || nodeVisibility === 'public';
            if (!findAll && isPublic) {
              if (options && childOpts.readonly) {
                options.readonly = true;
              }
              if (isArray(result)) {
                for (const node of result) {
                  candidates.add(node);
                }
              } else {
                candidates.add(result);
              }
              break;
            }
            if (options) {
              options.readonly ||= childOpts.readonly;
            }
            if (isArray(result)) {
              for (const node of result) {
                if (isOptional && optionalCandidates) {
                  optionalCandidates.add(node);
                } else {
                  candidates.add(node);
                }
              }
            } else {
              if (isOptional && optionalCandidates) {
                optionalCandidates.add(result);
              } else {
                candidates.add(result);
              }
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
          // Avoid Set.prototype.union (not available in our TS lib target)
          for (const v of newSet) {
            candidates.add(v);
          }
        } else {
          candidates = new Set([candidates, ...newSet]);
        }
      } else {
        candidates = newSet;
      }
    }
    return candidates;
  }

  find(keys: string | string[] | Set<string>, _filterType?: string, _options?: FindOptions): Type[] | Type | Array<{ value: Type; [key: string]: any }> | undefined {
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
    if (isNode(ruleset.selector, N.Selector)) {
      this.pendingItems.add(ruleset);
    }
  }

  /**
   * Index any pending rulesets
   * Override the base class method to use keySet-based indexing
   */
  override indexPendingItems() {
    if (this.pendingItems.size === 0) {
      return;
    }
    const index = this.index;
    for (const ruleset of this.pendingItems) {
      /** Index using the ruleset's actual selector keySet - no need for getImplicitSelector here
       * since we're indexing the selector as-is, not transforming it for parent context */
      const selector = ruleset.selector;
      if (selector instanceof Nil) {
        continue;
      }
      if (!('keySet' in selector)) {
        continue;
      }
      const keySet = selector.keySet;
      for (const key of getSelectorKeyValues(keySet)) {
        const existing = index.get(key);
        if (existing) {
          existing.add(ruleset);
        } else {
          index.set(key, new Set([ruleset]));
        }
      }
    }
    this.pendingItems.clear();
  }

  /**
   * Find candidate rulesets that might match the target selector.
   * Searches only the local index - all rulesets should be registered
   * to the extend root's registry during evaluation.
   */
  override find(keys: string[] | Set<string>): Ruleset[] | undefined {
    // Index any pending rulesets first
    this.indexPendingItems();

    let candidates: Set<Ruleset> | undefined;
    let rulesets: Ruleset[] | undefined;

    /** Just get based on first key */
    for (const key of keys) {
      candidates = this.index.get(key);
      break;
    }
    if (!candidates) {
      return undefined;
    }

    /** Now find selectors that have all keys */
    const searchKeys = keys instanceof Set ? [...keys] : keys;
    let searchKeySet = keys instanceof Set ? keys : new Set(keys);
    let searchBitSet: BitSet<string> | undefined;
    for (const c of candidates) {
      let sel = c.selector;
      if (!sel || isNode(sel, N.Nil)) {
        continue;
      }
      let isSubset: boolean;
      const selectorKeySet = sel.keySet;
      if (!(selectorKeySet instanceof Set) && selectorKeySet._library) {
        searchBitSet ??= selectorKeySet._library.getBitset(searchKeySet);
        isSubset = isSubsetOf(searchBitSet, selectorKeySet);
      } else {
        isSubset = true;
        for (const k of searchKeys) {
          if (!hasSelectorKey(selectorKeySet, k)) {
            isSubset = false;
            break;
          }
        }
      }
      if (isSubset) {
        (rulesets ??= []).push(c);
      }
    }

    return rulesets;
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

  private _indexSelectorStart(mixin: Ruleset | Mixin, keySet: SelectorKeySet | string[]) {
    const index = this.index;

    const candidateKeys = (isArray(keySet) ? keySet : getSelectorKeyValues(keySet)).filter(
      key => typeof key === 'string' && isIndexableSelectorKey(key)
    );
    if (!candidateKeys.length) {
      return;
    }

    // Only use non-`*` keys as index start keys, but keep `*` in the match path
    // so selectors like `.mixin > *` do not collide with plain `.mixin` mixin calls.
    const indexableKeys = candidateKeys.filter(key => !key.startsWith('*'));
    if (indexableKeys.length === 0) {
      return;
    }

    // Index under ALL indexable keys so lookups starting with any key can find this entry.
    // Each entry's `match` contains the OTHER candidate keys (including `*` keys).
    for (let i = 0; i < indexableKeys.length; i++) {
      const startKey = indexableKeys[i]!;
      const rest = candidateKeys.filter(k => k !== startKey);
      const existing = index.get(startKey);
      if (existing) {
        existing.push({ value: mixin, match: rest });
      } else {
        index.set(startKey, [{ value: mixin, match: rest }]);
      }
    }
  }

  /**
   * For un-preEvaluated mixin rules, register child Rulesets/Mixins
   * so namespace lookup can descend into them. Also propagate
   * keySetLibrary so selectors can compute their keySets.
   */
  private _ensureChildrenRegistered(rules: Rules, selectorBits?: BitSetLibrary<string>) {
    for (const child of rules.value) {
      if (isNode(child, N.Ruleset)) {
        const sel = (child as Ruleset).selector;
        if (sel && selectorBits && !isNode(sel, N.Nil) && !(sel as Selector).keySetLibrary) {
          (sel as Selector).keySetLibrary = selectorBits;
          const selValue = (sel as unknown as { value?: unknown }).value;
          if (isArray(selValue)) {
            for (const sub of selValue as Selector[]) {
              if (!sub.keySetLibrary) {
                sub.keySetLibrary = selectorBits;
              }
            }
          }
        }
        rules.registerNode(child);
      } else if (isNode(child, N.Mixin)) {
        rules.registerNode(child);
      }
    }
  }

  override indexPendingItems() {
    if (this.pendingItems.size === 0) {
      return;
    }
    for (const mixin of this.pendingItems) {
      if (isNode(mixin, N.Ruleset)) {
        // Use the ruleset's own selector, not the implicit selector with parent context
        // This ensures nested rulesets are indexed by their local keys, not parent keys
        // If the selector has been evaluated/flattened, use sourceNode which has the original
        let selector = mixin.selector;
        if (isNode(selector, N.Nil)) {
          continue;
        }
        // `&` rulesets are structural nesting selectors, not callable mixins.
        // Determine callability from ownSelector (before implicit selector resolution) when available.
        const ownSelector = (mixin.options as { ownSelector?: Selector } | undefined)?.ownSelector;
        const callableSelector = ownSelector && !isNode(ownSelector, N.Nil) ? ownSelector : selector;
        if (isNode(callableSelector, N.Ampersand)) {
          continue;
        }
        // Prefer evaluated selector keys; they resolve interpolations (e.g. .@{a0} -> .\123).
        // Fall back to source selector only when evaluated keys are empty.
        const sourceSelector = selector.sourceNode as Selector | undefined;
        const selectorVisibleKeySet = tryGetSelectorKeySet(selector);
        const sourceVisibleKeySet = tryGetSelectorKeySet(sourceSelector);
        const selectorToIndex = (
          getIndexableSelectorKeys(selectorVisibleKeySet).length
            ? selector
            : (getIndexableSelectorKeys(sourceVisibleKeySet).length ? sourceSelector : selector)
        ) as Selector;
        let keySetToUse: SelectorKeySet | string[] | undefined;
        if (isNode(selectorToIndex, N.SelectorList)) {
          /** Selector list's selectors are individually registered */
          for (const sel of selectorToIndex.value) {
            const selKeySet = tryGetSelectorKeySet(sel as Selector);
            if (selKeySet) {
              this._indexSelectorStart(mixin, selKeySet);
            }
          }
          keySetToUse = undefined; // already indexed above
        } else {
          keySetToUse = tryGetSelectorKeySet(selectorToIndex);
        }
        // Normalize nested `&...` selectors to local keys when possible.
        // Evaluated key sets can include inherited parent keys (e.g. [".b",".bb",".foo-xxx",...]),
        // but recursive lookup descends with local remainder keys (e.g. [".foo-xxx", ...]).
        if (
          keySetToUse
          && getIndexableSelectorKeys(keySetToUse).length > 0
          && ownSelector
          && !isNode(ownSelector, N.Nil)
        ) {
          const resolvedKeys = getIndexableSelectorKeys(keySetToUse);
          const ownSelectorText = String((ownSelector as Selector).valueOf?.() ?? '');
          const ownKeys = getIndexableSelectorKeys(tryGetSelectorKeySet(ownSelector as Selector));
          const parentSelector = isNode(mixin.parent?.parent, N.Ruleset)
            ? (mixin.parent.parent as Ruleset).selector
            : undefined;
          const parentKeys = (
            parentSelector && !isNode(parentSelector, N.Nil)
              ? getIndexableSelectorKeys(tryGetSelectorKeySet(parentSelector))
              : []
          );
          if (
            parentKeys.length > 0
            && resolvedKeys.length > parentKeys.length
          ) {
            // Use set-based parent key removal (BitSet iteration order is non-deterministic)
            const parentKeySet = new Set(parentKeys);
            const localKeys = resolvedKeys.filter(k => !parentKeySet.has(k));
            if (localKeys.length > 0 && localKeys.length < resolvedKeys.length) {
              keySetToUse = localKeys;
            }
          } else if (ownKeys.length > 1 && ownSelectorText.trimStart().startsWith('&')) {
            keySetToUse = ownKeys.slice(1);
          } else if (
            parentKeys.length === 0
            && ownKeys.length > 0
            && resolvedKeys.length > ownKeys.length
          ) {
            // No parent Ruleset in chain (e.g. mixin output), but resolved keys include
            // implicit parent context. Use ownSelector keys for local indexing.
            keySetToUse = ownKeys;
          }
        }
        // When the resolved selector is an Ampersand (implicit &), visibleKeySet is empty so we
        // would not index. Use the ruleset's ownSelector (set in preEval before getImplicitSelector)
        // to index by the callable selector that was explicitly authored.
        if (keySetToUse !== undefined) {
          if (
            getIndexableSelectorKeys(keySetToUse).length === 0
            && ownSelector
            && !isNode(ownSelector, N.Nil)
          ) {
            const ownKeySet = tryGetSelectorKeySet(ownSelector as Selector);
            if (ownKeySet && getIndexableSelectorKeys(ownKeySet).length) {
              const ownKeys = getIndexableSelectorKeys(ownKeySet);
              const selectorText = String(selectorToIndex.valueOf?.() ?? '');
              // In nested `&...` rulesets, ownKeySet may include inherited parent key first.
              // For local lookup chains we want the nested segment as the start key.
              if (selectorText.startsWith('&') && ownKeys.length > 1) {
                keySetToUse = new Set(ownKeys.slice(1));
              } else {
                keySetToUse = ownKeySet;
              }
            }
          }
          this._indexSelectorStart(mixin, keySetToUse);
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
    if (isNode(value, N.Ruleset)) {
      const selector = value.selector;
      if (isNode(selector, N.Nil)) {
        return false;
      }
      if (isNode(selector, N.SelectorList)) {
        // For selector lists, check if any selector matches
        return selector.value.some((sel) => {
          const selKeys = getIndexableSelectorKeys(tryGetSelectorKeySet(sel as Selector, false));
          if (selKeys.length === 0) {
            return false;
          }
          // Check if keys appear in sequence in this selector's keys
          return this._checkKeysSubsequence(selKeys, keys);
        });
      }
      const keySet = tryGetSelectorKeySet(selector, false);
      if (!keySet || getSelectorKeyValues(keySet).length === 0) {
        return false;
      }
      indexableKeys = getIndexableSelectorKeys(keySet);
    } else {
      const keySet = value.keySet;
      if (!keySet || getSelectorKeyValues(keySet).length === 0) {
        return false;
      }
      indexableKeys = getIndexableSelectorKeys(keySet);
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
    const mixinHasNoRequiredParams = (mixinNode: Mixin): boolean => {
      const params = mixinNode.params;
      if (!params || params.length === 0) {
        return true;
      }
      for (const param of params.value) {
        if (param.type === 'Rest') {
          continue;
        }
        if (isNode(param, N.VarDeclaration)) {
          if (param.value instanceof Nil) {
            return false;
          }
          continue;
        }
        if (isNode(param, N.Any) && param.role === 'property') {
          return false;
        }
        return false;
      }
      return true;
    };

    // Track which Rules nodes we've already searched to prevent infinite recursion
    // Use the searchedRules from options if it exists, otherwise create a new Set
    let mixinChildSearchOpts: FindOptions | undefined;
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
      // Resolve interpolated selector starts (e.g. "@{a2}") against current context
      // so unresolved-index keys can still match resolved call keys (e.g. ".foo").
      let resolvedInterpolatedStartEntries: Array<{ value: Mixin | Ruleset; match: string[] }> = [];
      if (context && typeof startKey === 'string' && !existing?.length) {
        for (const [indexedKey, indexedEntries] of registry.index) {
          const matchInterpolated = /^@\{(.+)\}$/.exec(indexedKey);
          if (!matchInterpolated) {
            continue;
          }
          const varName = matchInterpolated[1]!;
          const maybeVar = rules.find('declaration', varName, 'VarDeclaration', {
            context,
            hasTarget,
            filter: options?.filter
          } as FindOptions);
          if (isNode(maybeVar, N.VarDeclaration)) {
            const resolvedValue = String(maybeVar.value.valueOf?.() ?? maybeVar.value ?? '');
            if (resolvedValue === startKey) {
              resolvedInterpolatedStartEntries.push(...indexedEntries);
            }
          }
        }
      }

      // With the new indexing (by local visible keys), nested rulesets are indexed under their own keys
      // So we only need to check entries under the startKey - no need to scan all entries
      let allEntriesToCheck: Array<{ value: Mixin | Ruleset; match: string[] }> = [];
      if (existing) {
        allEntriesToCheck.push(...existing);
      }
      if (resolvedInterpolatedStartEntries.length > 0) {
        allEntriesToCheck.push(...resolvedInterpolatedStartEntries);
      }

      if (allEntriesToCheck.length > 0) {
        const targetMatch = search.length === 0 ? [startKey!] : search;
        for (const { value, match } of allEntriesToCheck) {
          if (filterType && value.type !== filterType) {
            continue;
          }

          // If match equals targetMatch (search or [startKey] when search is empty), this IS the ruleset we're looking for
          // Also, if search is empty and match is empty, this ruleset IS the startKey we're looking for
          // BUT: For compound search paths (keyList.length > 1), we should NOT add the startKey mixin itself
          // as a candidate when search.length === 0 && match.length === 0, because that means we found the startKey
          // but haven't fully matched the compound path. The startKey should only be added as a candidate if we're
          // doing a simple lookup (keyList.length === 1), where the startKey IS the full match.
          if (arraysEqualAsSet(match, targetMatch)) {
            (candidates ??= new Set()).add(value);
            continue;
          }
          // Only add startKey mixin as candidate if we're doing a simple lookup (not a compound path)
          if (search.length === 0 && match.length === 0 && keyList.length === 1) {
            (candidates ??= new Set()).add(value);
            continue;
          }
          // For compound paths, we don't add startKey as a candidate, but we still need to search inside it
          // The recursive search below will handle finding nested mixins

          // If match equals [startKey] OR match is empty (meaning this ruleset IS the startKey),
          // we need to search inside it for the remaining search keys
          // NOTE: We should search inside #theme even if we're not adding it as a candidate (for compound paths)
          if (search.length > 0 && (arraysEqual(match, [startKey!]) || match.length === 0)) {
            if (
              (isNode(value, N.Ruleset))
              || (isNode(value, N.Mixin) && mixinHasNoRequiredParams(value as Mixin))
            ) {
              let subRules = value.rules;
              // Mixin rules aren't preEvaluated during registration — register
              // child rulesets/mixins now so namespace lookup can descend.
              if (!subRules.preEvaluated) {
                this._ensureChildrenRegistered(subRules, context?.selectorBits);
              }
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
          const matchKeysInSearch = match.length > 0 && arrayContainsAll(search, match);
          if (shouldRecurse) {
            let searchKeys: string[];
            if (match.length === 0) {
              // Match is empty, meaning this ruleset IS the startKey, search inside for the full search
              searchKeys = search;
            } else if (matchKeysInSearch) {
              // Match keys are all contained in search — remove them (set-based) to get the remainder
              const matchSet = new Set(match);
              searchKeys = search.filter(k => !matchSet.has(k));
            } else {
              // Match is not a prefix of search - skip this ruleset, it doesn't match
              continue;
            }
            if (
              (isNode(value, N.Ruleset))
              || (isNode(value, N.Mixin) && mixinHasNoRequiredParams(value as Mixin))
            ) {
              let subRules = value.rules;
              if (!subRules.preEvaluated) {
                this._ensureChildrenRegistered(subRules, context?.selectorBits);
              }
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

      // Track which candidates existed before searching children (by snapshot of the set)
      const candidateSizeBefore = candidates ? candidates.size : 0;
      const candidatesBefore = candidateSizeBefore > 0 ? new Set(candidates) : undefined;
      // Reuse a single child search options object
      // For compound paths (keyList.length > 1), the first segment acts as a namespace
      // target — allow searching inside mixin output rulesets so that e.g.
      // `.Person("Male")` output containing `.person { .sayGender() {} }` is reachable.
      const childHasTarget = hasTarget || keyList.length > 1;
      if (!mixinChildSearchOpts) {
        mixinChildSearchOpts = {
          searchParents: false,
          local,
          candidates: candidates as Set<Node>,
          findAll: true,
          childFilterType: filterType,
          context,
          filter: options?.filter,
          hasTarget: childHasTarget,
          searchedRules
        };
      } else {
        mixinChildSearchOpts.searchedRules = searchedRules;
      }
      registry._searchRulesChildren(startKey!, 'Mixin', mixinChildSearchOpts);

      // After _searchRulesChildren, check if any new candidates are mixins/rulesets we should search inside
      // This handles the case where #theme mixin is found in imported Rules and we need to search inside it
      // Also, for compound paths, remove #theme from candidates if it was added by _searchRulesChildren
      // because we only want to search inside it, not include it as a final candidate
      if (candidates && candidates.size > candidateSizeBefore) {
        const candidatesToRemove: (Mixin | Ruleset)[] = [];
        for (const candidate of candidates) {
          const candidateNode = candidate as Mixin | Ruleset;
          // Only check candidates that were added by _searchRulesChildren (not in original set)
          if (candidatesBefore && candidatesBefore.has(candidateNode)) {
            continue;
          }
          {
            const isMixin = isNode(candidateNode, N.Mixin);
            const isRuleset = isNode(candidateNode, N.Ruleset);
            const hasNoParams = isMixin && mixinHasNoRequiredParams(candidateNode as Mixin);
            // Check if this candidate matches the startKey.
            // For rulesets discovered via child-search, key-set membership is the reliable signal.
            const candidateKey = isMixin
              ? (candidateNode as Mixin).name?.valueOf?.()
              : (isRuleset ? (candidateNode as Ruleset).selector.valueOf?.() : '');
            const matchesStartKey = isRuleset
              ? (
                  (!isNode((candidateNode as Ruleset).selector, N.Nil) && hasSelectorKey(((candidateNode as Ruleset).selector as Selector).visibleKeySet, startKey!))
                  || (!isNode((candidateNode as Ruleset).selector, N.Nil) && hasSelectorKey(((candidateNode as Ruleset).selector as Selector).keySet, startKey!))
                )
              : candidateKey === startKey;

            // For compound paths (keyList.length > 1), remove startKey from candidates if it was added by _searchRulesChildren
            // because we only want to search inside it, not include it as a final candidate
            if (matchesStartKey && keyList.length > 1) {
              candidatesToRemove.push(candidateNode);
            }

            // Search inside the candidate if it matches startKey and we have remaining search keys
            if (matchesStartKey && search.length > 0 && (isRuleset || hasNoParams)) {
              let subRules = (candidateNode as Ruleset | Mixin).rules;
              const subMixinRegistry = subRules.getRegistry('mixin');
              subMixinRegistry.indexPendingItems();
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
          }
        }
        // Remove candidates that shouldn't be in the final result (for compound paths)
        for (const candidateToRemove of candidatesToRemove) {
          candidates.delete(candidateToRemove);
        }
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
        if (rules && rules.sourceNode?.type === 'StyleImport' && rules.sourceNode.options.type !== 'import') {
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
export class FunctionRegistry extends Registry<JsFunction | Func, JsFunction | Func> {
  index = new Map<string, JsFunction | Func>();

  cloneForRules(rules: Rules): FunctionRegistry {
    const next = new FunctionRegistry(rules);
    // Preserve any functions injected directly into the registry (Less plugin style).
    next.index = new Map(this.index);
    next.pendingItems = new Set(this.pendingItems);
    return next;
  }

  override indexPendingItems() {
    if (this.pendingItems.size === 0) {
      return;
    }
    for (const item of this.pendingItems) {
      if (item instanceof JsFunction) {
        this.index.set(item.name!, item);
        continue;
      }
      // Stylesheet-defined function node
      const nameKey = (item as Func).nameKey;
      if (nameKey) {
        this.index.set(nameKey, item);
      }
    }
    this.pendingItems.clear();
  }

  override find(name: string, filterType?: string, options?: FindOptions): JsFunction | Func | undefined {
    let fn: JsFunction | Func | undefined;
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
        if (rules && rules.sourceNode?.type === 'StyleImport' && rules.sourceNode.options.type !== 'import') {
          findRoot = true;
        }
      } while (!findRoot && rules && rules.type !== 'Rules');
    }

    return fn;
  }

  /**
   * Override add() to support both Jess API (add(item)) and Less.js API (add(name, func))
   */
  override add(item: JsFunction | Func): void;
  override add(name: string, func: JsFunction | ((...args: any[]) => any)): void;
  override add(
    nameOrItem: string | JsFunction | Func,
    func?: JsFunction | ((...args: any[]) => any)
  ): void {
    // If first argument is a JsFunction or Func, use base class behavior
    if (nameOrItem instanceof JsFunction || (nameOrItem as any)?.type === 'Func') {
      super.add(nameOrItem as any);
      return;
    }

    // Otherwise, it's Less.js-compatible API: add(name, func)
    if (typeof nameOrItem !== 'string' || func === undefined) {
      throw new Error('FunctionRegistry.add() requires either a JsFunction or (name: string, func: JsFunction | Function)');
    }

    // Convert name to lowercase for Less.js compatibility
    const lowerName = nameOrItem.toLowerCase();

    // If func is already a JsFunction, use it directly
    // Otherwise, create a new JsFunction from the raw function
    const jsFunc = func instanceof JsFunction
      ? func
      : new JsFunction({ name: lowerName, fn: func });

    // Ensure the name is set
    if (!jsFunc.name) {
      jsFunc.name = lowerName;
    }

    // Add to pendingItems directly
    this.pendingItems.add(jsFunc);
  }

  /**
   * Less.js-compatible API: Add multiple functions at once
   * @param functions Object mapping function names to functions
   */
  addMultiple(functions: Record<string, JsFunction | ((...args: any[]) => any)>): void {
    for (const [name, func] of Object.entries(functions)) {
      this.add(name, func);
    }
  }

  /**
   * Less.js-compatible API: Get a function by name
   * Uses case-insensitive lookup and searches parent chain
   * @param name Function name (case-insensitive)
   * @returns The function if found, undefined otherwise
   */
  get(name: string): JsFunction | Func | undefined {
    // Convert to lowercase for case-insensitive lookup
    const lowerName = name.toLowerCase();

    // First check local registry
    this.indexPendingItems();
    let fn = this.index.get(lowerName);

    if (fn) {
      return fn;
    }

    // If not found locally, use find() to search parent chain
    // find() already handles parent traversal
    return this.find(lowerName);
  }

  /**
   * Less.js-compatible API: Get all local functions (without parent chain)
   * @returns Object mapping function names to functions
   */
  getLocalFunctions(): Record<string, JsFunction | Func> {
    this.indexPendingItems();
    const result: Record<string, JsFunction | Func> = {};
    for (const [name, func] of this.index.entries()) {
      result[name] = func;
    }
    return result;
  }

  /**
   * Less.js-compatible API: Create a child registry that inherits from this one
   * In Less.js, this creates a new registry with prototype inheritance.
   * In Jess, we create a new registry that searches this one as a parent.
   *
   * @returns A new FunctionRegistry that will search this registry when functions aren't found locally
   */
  inherit(): FunctionRegistry {
    // Create a new registry for the same Rules
    // The new registry will use find() which searches parent chain
    // We need to create a registry that references this one as parent
    // Since FunctionRegistry.find() already searches parent Rules chain,
    // we can create a new registry on the same Rules and it will naturally
    // find functions in parent Rules. However, for true "inherit" behavior
    // where we want to search THIS registry specifically, we need a different approach.

    // For now, create a new registry on the same Rules
    // The find() method will search up the Rules parent chain, which includes
    // this registry's Rules, so it should work correctly.
    const childRegistry = new FunctionRegistry(this.rules);

    // Store reference to parent registry for direct lookup
    // This allows the child to search the parent registry even if it's on the same Rules
    (childRegistry as any)._parentRegistry = this;

    // Override get() to check parent registry first
    const originalGet = childRegistry.get.bind(childRegistry);
    childRegistry.get = function(this: FunctionRegistry, name: string): JsFunction | Func | undefined {
      // First check local registry
      this.indexPendingItems();
      const localFn = this.index.get(name.toLowerCase());
      if (localFn) {
        return localFn;
      }

      // Then check parent registry
      const parentRegistry = (this as unknown as { _parentRegistry?: FunctionRegistry })._parentRegistry;
      if (parentRegistry) {
        const parentFn = parentRegistry.get(name);
        if (parentFn) {
          return parentFn;
        }
      }

      // Finally, use find() to search Rules parent chain
      return originalGet(name);
    }.bind(childRegistry);

    return childRegistry;
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
    if (this.pendingItems.size === 0) {
      return;
    }
    for (const item of this.pendingItems) {
      let key = item.name.valueOf();
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
    let optionalCandidates = (options?.optionalCandidates as Set<Declaration> | undefined) ?? new Set<Declaration>();
    let rules: Rules | undefined = this.rules;
    let isPublic = false;
    let {
      searchParents = true,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      local = false,
      start
    } = options ?? {};

    let newReadonly: boolean | undefined = false;
    let searchChildrenOptions: FindOptions | undefined;
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
      // Build filtered list without intermediate spread — iterate Set directly
      let list: Declaration[] | undefined;
      if (set) {
        const filter = options?.filter;
        for (const n of set) {
          if (n.type === filterType && (!filter || filter(n))) {
            (list ??= []).push(n);
          }
        }
        // Sort using comparePosition for proper source order comparison
        if (list && list.length > 1) {
          list.sort((a, b) => {
            const pos = comparePosition(a, b);
            return pos ?? 0;
          });
        }
      }
      if (list) {
        let result = registry._findClosestByStart(list, start);
        if (result) {
          newReadonly ||= result.options.readonly;
          // Visibility determines how declarations are found:
          // - 'private': only visible from INSIDE (children looking up) or same scope,
          //              NOT from outside looking in (child Rules searches).
          // - 'optional': fallback only — returned if no public match is found.
          // - 'public': immediate candidate.
          //
          // IMPORTANT: Walking UP the parent chain is always an "inside" lookup — the
          // search originates from a descendant of this scope, so private does NOT block.
          // Private only blocks _searchRulesChildren (outside looking in).
          const currentRulesVisibility = rules.options.rulesVisibility?.[filterType] ?? '';
          if (currentRulesVisibility === 'optional') {
            optionalCandidates.add(result);
          } else {
            declCandidate.add(result);
            isPublic = true;
          }
        }
      }
      // Initialize searchedRules to prevent infinite recursion when searching child Rules
      // This is critical: if a Rules node appears in its own children, we need to track it
      const searchedRules = options?.searchedRules ?? new Set<Rules>();
      if (!searchedRules.has(rules)) {
        searchedRules.add(rules);
      }
      // CRITICAL: When searching children, we MUST set searchParents: false to prevent
      // Reuse a single child options object — update mutable fields per iteration
      // instead of spreading a new object every loop
      if (!searchChildrenOptions) {
        searchChildrenOptions = options
          ? {
              ...options,
              searchParents: false,
              readonly: newReadonly,
              candidates: declCandidate,
              searchedRules: searchedRules,
              optionalCandidates
            }
          : {
              searchParents: false,
              readonly: newReadonly,
              candidates: declCandidate,
              searchedRules: searchedRules,
              optionalCandidates
            };
      } else {
        searchChildrenOptions.readonly = newReadonly;
      }
      rules.getRegistry('declaration')._searchRulesChildren(key, filterType, searchChildrenOptions);

      // After searching the CURRENT scope (index + children), if we found public declarations,
      // sort them, find the best one (closest to start or at bottom), and return immediately.
      // Otherwise, continue up the parent scope.
      if (declCandidate.size > 0) {
        let bestResult: Declaration | undefined;
        // Use comparePosition to find the last declaration by source order
        const candidateArray = Array.from(declCandidate);
        if (candidateArray.length === 1) {
          bestResult = candidateArray[0];
        } else {
          // Sort by comparePosition and take the last one
          candidateArray.sort((a, b) => {
            const pos = comparePosition(a, b);
            return pos ?? 0;
          });
          bestResult = candidateArray[candidateArray.length - 1];
        }
        if (options && searchChildrenOptions.readonly) {
          options.readonly = true;
        }
        return bestResult;
      }

      // If we haven't found public candidates in the current scope, continue normal parent search
      // (optional candidates are tracked but we keep searching up the parent chain)
      if (isPublic || !searchParents) {
        if (options && searchChildrenOptions.readonly) {
          options.readonly = true;
        }
        const result = declCandidate.values().next().value;
        return result;
      }

      do {
        rules = rules?.parent as Rules;
        if (rules && rules.sourceNode?.type === 'StyleImport' && rules.sourceNode.options.type !== 'import') {
          rules = undefined;
          break;
        }
      } while (rules && rules.type !== 'Rules');
      // The start constraint only applies within the originating scope.
      // When walking up to a parent scope, drop it so declarations at any
      // position in the parent are eligible.
      start = undefined;
    }
    if (options && newReadonly) {
      options.readonly = true;
    }
    // After searching all parents, if we only have optional candidates, return the best one
    if (declCandidate.size === 0 && optionalCandidates.size > 0) {
      const optionalArray = Array.from(optionalCandidates);
      if (optionalArray.length === 1) {
        return optionalArray[0];
      }
      // Sort by comparePosition and take the last one
      optionalArray.sort((a, b) => {
        const pos = comparePosition(a, b);
        return pos ?? 0;
      });
      const optionalResult = optionalArray[optionalArray.length - 1];
      return optionalResult;
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

/**
 * Does `a` contain all elements of `b`? (order-independent)
 *
 * Uses linear scan instead of `Set.prototype.isSubsetOf` because
 * selector key arrays are typically 1–3 elements, where the overhead
 * of allocating a Set dominates.
 */
function arrayContainsAll(a: string[], b: string[]): boolean {
  if (b.length > a.length) {
    return false;
  }
  if (b.length === 0) {
    return true;
  }
  // For small arrays, just use includes
  for (const item of b) {
    if (!a.includes(item)) {
      return false;
    }
  }
  return true;
}

/** Are `a` and `b` equal as unordered sets? See {@link arrayContainsAll}. */
function arraysEqualAsSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return arrayContainsAll(a, b);
}
