/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import type { Selector } from '../selector.js';
import type { Rules } from '../rules.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { Node } from '../node.js';
import { JsFunction } from '../js-function.js';
import type { Func } from '../function.js';
import type { Declaration } from '../declaration.js';
import type { Context } from '../../context.js';
import { atIndex } from './collections.js';
import { comparePosition } from './compare.js';
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
  semanticFilter?: boolean;
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
  /** For mixin-ruleset calls with args, namespace containers may be rulesets but terminal hits must be mixins. */
  terminalMixinOnly?: boolean;
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
          // Use actualChildFilterType which may be undefined for mixin-ruleset lookups.
          // filterType selects the lookup family; actualChildFilterType filters results.
          let result = filterType === 'Mixin'
            ? r.node.findMixin(key, actualChildFilterType === 'Mixin' ? 'Mixin' : undefined, newOpts)
            : r.node.findDeclaration(
                key,
                actualChildFilterType === 'VarDeclaration' || actualChildFilterType === 'Declaration'
                  ? actualChildFilterType
                  : undefined,
                newOpts
              );
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
    for (const [name, fn] of next.index) {
      rules.setFunctionBinding(name, fn);
    }
    next.pendingItems = new Set(this.pendingItems);
    return next;
  }

  override indexPendingItems() {
    for (const item of this.pendingItems) {
      if (item instanceof JsFunction) {
        this.index.set(item.name!, item);
        this.rules.setFunctionBinding(item.name, item);
        continue;
      }
      // Stylesheet-defined function node
      const nameKey = (item as Func).nameKey;
      if (nameKey) {
        this.index.set(nameKey, item);
        this.rules.setFunctionBinding(nameKey, item);
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
        const live = rules._scopeFrame?.currentBindingsByName.get(key);
        const liveSource = live?.kind === 'live' ? live.sourceNode : undefined;
        if (liveSource && isNode(liveSource, N.VarDeclaration)) {
          const passesFilter = !options?.filter || options.filter(liveSource);
          if (passesFilter) {
            newReadonly ||= live.cell.readonly || liveSource.options?.readonly;
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
