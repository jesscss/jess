/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
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
import { type BitSet } from './bitset.js';
import {
  canEnterRulesEntryForLookup,
  getMixinOutputLookupState,
  type LookupVisibility,
  type MixinOutputLookupState,
  type RulesEntryLike,
  isOptionalRulesEntry,
  isPublicRulesEntry
} from './mixin-output-slot.js';

const { isArray } = Array;

type SelectorKeySet = Set<string> | BitSet<string>;

export type RulesEntryTraversalState = {
  canEnter: boolean;
  mixinOutput?: MixinOutputLookupState;
};

export function getRulesEntryTraversalState(
  entry: RulesEntryLike,
  lookup: {
    type?: LookupVisibility;
    hasTarget?: boolean;
  }
): RulesEntryTraversalState {
  const mixinOutput = getMixinOutputLookupState(entry, lookup);
  return {
    canEnter: mixinOutput?.canEnter ?? canEnterRulesEntryForLookup(entry, lookup),
    ...(mixinOutput ? { mixinOutput } : {})
  };
}

function getSelectorKeyValues(keySet: SelectorKeySet | string[] | undefined): string[] {
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

function selectorKeySetSize(keySet: SelectorKeySet | undefined): number {
  if (!keySet) {
    return 0;
  }
  if (keySet instanceof Set) {
    return keySet.size;
  }
  return keySet._library?.valuesOf(keySet).length ?? 0;
}

export function getOrderedSelectorKeys(selector: Selector | Nil | undefined): string[] {
  if (!selector || isNode(selector, N.Nil)) {
    return [];
  }
  const keys: string[] = [];
  let foundBasic = false;
  const visit = (node: Selector | Nil | undefined) => {
    if (!node || isNode(node, N.Nil)) {
      return;
    }
    if (!foundBasic && isNode(node, N.Ampersand)) {
      return;
    }
    if (isNode(node, N.Combinator)) {
      return;
    }
    if (isNode(node, N.BasicSelector)) {
      const value = String(node.valueOf?.() ?? node.value ?? '');
      if (!value || value.startsWith('*') || value.startsWith(':')) {
        return;
      }
      keys.push(value);
      foundBasic = true;
      return;
    }
    const { value } = node as unknown as { value?: unknown };
    if (isArray(value)) {
      for (const child of value) {
        visit(child as Selector | Nil | undefined);
      }
    }
  };
  visit(selector);
  return keys;
}

export function isNonClassicImportBoundary(rules: Rules | undefined): boolean {
  return rules?.options.importBoundary === true;
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
  ignoreCurrentScopeStart?: boolean;
  ignoreParentScopeStart?: boolean;
  local?: boolean;
};

export type FindOptions = DeclarationFindOptions & {
  childFilterType?: 'Mixin' | 'Ruleset' | undefined;
  context?: Context;
  searchedRules?: Set<Rules>;
  /** Whether this lookup has an explicit target, e.g. #ns[@foo]. */
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
    filterType: 'VarDeclaration' | 'Declaration' | 'Mixin' | undefined,
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
        const isVisible = getRulesEntryTraversalState(n, {
          type: filterType,
          hasTarget: options?.hasTarget
        }).canEnter;
        /**
         * Sass `@forward`:
         * Forwarded Rules should not be visible to lookups within the current stylesheet scope
         * (context.rulesContext === rules), but should remain visible to downstream consumers.
         */
        const isForwardNode = Boolean(n.node.options?.forward);
        const skipForwardNode = isForwardNode && context?.rulesContext === rules;
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
          && !skipForwardNode
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
          // Preserve source-order constraints when looking "through" child Rules.
          // This prevents an earlier sibling declaration from seeing vars emitted by
          // a later child/call output Rules (e.g. `.tiny-scope { color: @mix; .mixin(); }`).
          // Parent searches still reset start naturally as they walk outward.
          newOpts.start = start;
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
            const isOptional = filterType !== undefined && isOptionalRulesEntry(r, filterType);
            const optionalCandidates = options?.optionalCandidates;

            /**
             * If it's a public declaration, and it's the lower-most declaration,
             * it wins.
             * Rules constructor sets defaults, so visibility should always be defined.
             */
            const isPublic = filterType !== undefined && isPublicRulesEntry(r, filterType);
            if (!findAll && isPublic) {
              if (options && newOpts.readonly) {
                options.readonly = true;
              }
              // Add to candidates and stop searching this rule
              if (isArray(result)) {
                for (const node of result) {
                  candidates.add(node as unknown as Type);
                }
              } else {
                candidates.add(result as Type);
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
                if (isOptional && optionalCandidates) {
                  optionalCandidates.add(node as Node);
                } else {
                  candidates.add(node as unknown as Type);
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
    const keyValues = getSelectorKeyValues(keySet);

    if (keyValues.length > 0) {
      const candidateKeys = keyValues.filter(
        key => typeof key === 'string' && !key.startsWith(':')
      );
      const startIndex = candidateKeys.findIndex(key => !key.startsWith('*'));
      if (startIndex === -1) {
        return; // Only skip when there is no indexable key (e.g. :hover-only selector)
      }

      const startKey = candidateKeys[startIndex]!;
      const rest = candidateKeys.slice(startIndex + 1);
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
      if (isNode(mixin, N.Ruleset)) {
        // Use the ruleset's own selector, not the implicit selector with parent context
        // This ensures nested rulesets are indexed by their local keys, not parent keys
        // If the selector has been evaluated/flattened, use sourceNode which has the original
        let selector = mixin.value.selector;
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
        const selectorToIndex = (
          getOrderedSelectorKeys(selector).length > 0
            ? selector
            : (getOrderedSelectorKeys(sourceSelector).length > 0 ? sourceSelector : selector)
        ) as Selector;
        let keySetToUse: SelectorKeySet | string[] | undefined;
        let orderedKeysToUse: string[] | undefined;
        if (isNode(selectorToIndex, N.SelectorList)) {
          /** Selector list's selectors are individually registered */
          for (const sel of selectorToIndex.value) {
            const orderedKeys = getOrderedSelectorKeys(sel);
            if (orderedKeys.length > 0) {
              this._indexSelectorStart(mixin, orderedKeys);
            }
          }
          keySetToUse = undefined; // already indexed above
        } else {
          orderedKeysToUse = getOrderedSelectorKeys(selectorToIndex);
          keySetToUse = orderedKeysToUse.length > 0
            ? orderedKeysToUse
            : selectorToIndex.visibleKeySet;
        }
        // Normalize nested `&...` selectors to local keys when possible.
        // Evaluated key sets can include inherited parent keys (e.g. [".b",".bb",".foo-xxx",...]),
        // but recursive lookup descends with local remainder keys (e.g. [".foo-xxx", ...]).
        if (
          keySetToUse
          && ((orderedKeysToUse?.length ?? 0) > 0 || getSelectorKeyValues(keySetToUse).length > 0)
          && ownSelector
          && !isNode(ownSelector, N.Nil)
        ) {
          const evaluatedKeys = orderedKeysToUse ?? getSelectorKeyValues(keySetToUse);
          const parentSelector = isNode(mixin.parent?.parent, N.Ruleset)
            ? (mixin.parent.parent as Ruleset).value.selector
            : undefined;
          const parentKeys = (
            parentSelector && !isNode(parentSelector, N.Nil)
              ? getOrderedSelectorKeys(parentSelector)
              : []
          );
          if (
            parentKeys.length > 0
            && evaluatedKeys.length > parentKeys.length
            && parentKeys.every((k, i) => evaluatedKeys[i] === k)
          ) {
            keySetToUse = evaluatedKeys.slice(parentKeys.length);
            orderedKeysToUse = keySetToUse;
          }
        }
        // When the resolved selector is an Ampersand (implicit &), visibleKeySet is empty so we
        // would not index. Use the ruleset's ownSelector from registration prep
        // to index by the callable selector that was explicitly authored.
        if (keySetToUse !== undefined) {
          if (
            getSelectorKeyValues(keySetToUse).length === 0
            && ownSelector
            && !isNode(ownSelector, N.Nil)
          ) {
            const ownKeySet = (ownSelector as Selector).visibleKeySet;
            if (selectorKeySetSize(ownKeySet)) {
              const ownKeys = getOrderedSelectorKeys(ownSelector as Selector);
              const selectorText = String(selectorToIndex.valueOf?.() ?? '');
              if (selectorText.startsWith('&') && ownKeys.length > 1) {
                keySetToUse = ownKeys.slice(1);
              } else {
                keySetToUse = ownKeys;
              }
              orderedKeysToUse = keySetToUse as string[];
            }
          }
          this._indexSelectorStart(mixin, orderedKeysToUse ?? keySetToUse);
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
      const selector = value.value.selector;
      if (isNode(selector, N.Nil)) {
        return false;
      }
      if (isNode(selector, N.SelectorList)) {
        // For selector lists, check if any selector matches
        return selector.value.some((sel) => {
          const selKeys = getOrderedSelectorKeys(sel);
          if (selKeys.length === 0) {
            return false;
          }
          return this._checkKeysSubsequence(selKeys, keys);
        });
      }
      const keyValues = getOrderedSelectorKeys(selector);
      if (keyValues.length === 0) {
        return false;
      }
      indexableKeys = keyValues;
    } else {
      const keyValues = getSelectorKeyValues(value.keySet);
      if (keyValues.length === 0) {
        return false;
      }
      indexableKeys = keyValues.filter((key) => {
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
    const mixinHasNoRequiredParams = (mixinNode: Mixin): boolean => {
      const params = mixinNode.value.params;
      if (!params || params.length === 0) {
        return true;
      }
      for (const param of params.value) {
        if (param.type === 'Rest') {
          continue;
        }
        if (isNode(param, N.VarDeclaration)) {
          if (param.value.value instanceof Nil) {
            return false;
          }
          continue;
        }
        if (isNode(param, N.Any) && param.options.role === 'property') {
          return false;
        }
        return false;
      }
      return true;
    };

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
            const resolvedValue = String(maybeVar.value.value.valueOf?.() ?? maybeVar.value.value ?? '');
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
          // BUT: For compound search paths (keyList.length > 1), we should NOT add the startKey mixin itself
          // as a candidate when search.length === 0 && match.length === 0, because that means we found the startKey
          // but haven't fully matched the compound path. The startKey should only be added as a candidate if we're
          // doing a simple lookup (keyList.length === 1), where the startKey IS the full match.
          if (arraysEqual(match, targetMatch)) {
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
              (isNode(value, N.Ruleset))
              || (isNode(value, N.Mixin) && mixinHasNoRequiredParams(value as Mixin))
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
      const candidatesBeforeChildren = candidates ? new Set(candidates) : new Set();
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

      // After _searchRulesChildren, check if any new candidates are mixins/rulesets we should search inside
      // This handles the case where #theme mixin is found in imported Rules and we need to search inside it
      // Also, for compound paths, remove #theme from candidates if it was added by _searchRulesChildren
      // because we only want to search inside it, not include it as a final candidate
      if (candidates) {
        const candidatesToRemove: (Mixin | Ruleset)[] = [];
        for (const candidate of candidates) {
          const candidateNode = candidate as Mixin | Ruleset;
          // Only check candidates that were added by _searchRulesChildren (not in allEntriesToCheck)
          if (!candidatesBeforeChildren.has(candidateNode)) {
            const isMixin = isNode(candidateNode, N.Mixin);
            const isRuleset = isNode(candidateNode, N.Ruleset);
            const hasNoParams = isMixin && mixinHasNoRequiredParams(candidateNode as Mixin);
            // Check if this candidate matches the startKey.
            // For rulesets discovered via child-search, key-set membership is the reliable signal.
            const candidateKey = isMixin
              ? candidateNode.value.name?.valueOf?.()
              : (isRuleset ? candidateNode.value.selector.valueOf?.() : '');
            const matchesStartKey = isRuleset
              ? (
                  (!isNode(candidateNode.value.selector, N.Nil) && hasSelectorKey(candidateNode.value.selector.visibleKeySet, startKey!))
                  || (!isNode(candidateNode.value.selector, N.Nil) && hasSelectorKey(candidateNode.value.selector.keySet, startKey!))
                )
              : candidateKey === startKey;

            // For compound paths (keyList.length > 1), remove startKey from candidates if it was added by _searchRulesChildren
            // because we only want to search inside it, not include it as a final candidate
            if (matchesStartKey && keyList.length > 1) {
              candidatesToRemove.push(candidateNode);
            }

            // Search inside the candidate if it matches startKey and we have remaining search keys
            if (matchesStartKey && search.length > 0 && (isRuleset || hasNoParams)) {
              let subRules = candidateNode.value.rules;
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
        if (isNonClassicImportBoundary(rules)) {
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
        const rulesParent = rules?.parent;
        if (findRoot && rules.type === 'Rules' && rulesParent === undefined) {
          /** We're at the root */
          break;
        }
        /**
         * If we reach an import boundary, skip the scope until we get to the top level.
         */
        if (isNonClassicImportBoundary(rules)) {
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
    for (const item of this.pendingItems) {
      let key = item.value.name.valueOf();
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
    filterType?: 'VarDeclaration' | 'Declaration',
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
    const preserveLinearStart = start !== undefined;

    let newReadonly: boolean | undefined = false;
    // Track visited Rules nodes in the parent chain to detect circular parent chains
    const visitedRules = new Set<Rules>();
    let ignoreCurrentScopeStart = options?.ignoreCurrentScopeStart === true;
    while (rules) {
      const currentScopeStart = ignoreCurrentScopeStart ? undefined : start;
      ignoreCurrentScopeStart = false;
      // CRITICAL: Check for circular parent chain
      if (visitedRules.has(rules)) {
        throw new Error(`Circular parent chain detected in DeclarationRegistry.find`);
      }
      visitedRules.add(rules);
      let currentReadonly = options?.readonly || rules.options.readonly;
      newReadonly = currentReadonly;
      if (filterType !== 'Declaration') {
        const live = rules.scopeFrame?.liveSlotsByName.get(key);
        const liveSource = live?.sourceNode;
        if (liveSource && isNode(liveSource, N.VarDeclaration)) {
          const passesFilter = !options?.filter || options.filter(liveSource);
          if (passesFilter) {
            newReadonly ||= live.readonly || liveSource.options?.readonly;
            const currentRulesVisibility = rules.options.rulesVisibility?.VarDeclaration ?? '';
            const isRulesetBodyScope = isNode(rules.parent, N.Ruleset) || isNode(rules.sourceNode, N.Ruleset);
            if (currentRulesVisibility === 'optional' && !isRulesetBodyScope) {
              optionalCandidates.add(liveSource);
            } else {
              if (options && newReadonly) {
                options.readonly = true;
              }
              return liveSource;
            }
          }
        }
      }
      let registry = rules.getRegistry('declaration');
      registry.indexPendingItems();
      let set = registry.index.get(key);
      let list = set ? [...set] : undefined;
      if (list) {
        if (filterType || options?.filter) {
          list = list.filter(
            n =>
              (!filterType || n.type === filterType)
              && (
                !options?.filter
                || options.filter(n)
              )
          );
        }
        // Sort using comparePosition for proper source order comparison
        if (list.length > 1) {
          list.sort((a, b) => {
            const pos = comparePosition(a, b);
            return pos ?? 0;
          });
        }
      }
      if (list?.length) {
        let result = rules.getRegistry('declaration')._findClosestByStart(list, currentScopeStart);
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
          const currentRulesVisibility = (filterType ? rules.options.rulesVisibility?.[filterType] : undefined) ?? '';
          const isRulesetBodyScope = isNode(rules.parent, N.Ruleset) || isNode(rules.sourceNode, N.Ruleset);
          if (currentRulesVisibility === 'optional' && !isRulesetBodyScope) {
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
      // infinite loops. Children searches should never traverse up the parent chain.
      // If options.searchParents is true, we're in a parent search context, and searching
      // children should not trigger another parent search.
      let searchChildrenOptions = {
        ...options,
        searchParents: false, // Always false when searching children
        readonly: newReadonly,
        candidates: declCandidate,
        searchedRules: searchedRules,
        start
      };

      const searchRules = rules;
      searchChildrenOptions.optionalCandidates = optionalCandidates;
      searchRules.getRegistry('declaration')._searchRulesChildren(key, filterType, searchChildrenOptions);

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
        const childRules = rules;
        let containingNode: Node | undefined = childRules as unknown as Node;
        while (containingNode?.parent && !isNode(containingNode.parent, N.Rules)) {
          containingNode = containingNode.parent;
        }
        rules = rules?.parent as Rules;
        /**
         * If we reach an import boundary, stop unless it's an `@import`
         * which means these rules can reach into the parent file that imports
         * this one.
         */
        if (isNonClassicImportBoundary(rules)) {
          rules = undefined;
          break;
        }
        if (rules && options?.ignoreParentScopeStart) {
          start = undefined;
        } else if (rules && preserveLinearStart) {
          start = containingNode?.index;
        }
      } while (rules && rules.type !== 'Rules');
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
