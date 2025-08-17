import type { Ruleset } from '../ruleset';
import type { Selector } from '../selector';
import type { Rules } from '../rules';
import { isNode } from './is-node';
import type { Mixin } from '../mixin';
import type { Nil } from '../nil';
import type { Node } from '../node';
import type { JsFunction } from '../js-function';
import type { Func } from '../function';
import type { Declaration } from '../declaration';
import { atIndex } from './collections';

const { isArray } = Array;

export type DeclarationFindOptions = {
  filter?: (n: Node) => boolean;
  /** This gets set if any parent is set to readonly */
  readonly?: boolean;
  searchParents?: boolean;
  start?: number;
  local?: boolean;
};

export type FindOptions = DeclarationFindOptions & {
  [key: string]: any;
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

  private _findByKey(candidates: Set<Type> | Type | undefined, key: string, filterType?: string, options?: FindOptions): Set<Type> | Type | undefined {
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
        candidates = this._findByKey(candidates, key, filterType, options);
      }
    } else {
      candidates = this._findByKey(candidates, keys, filterType, options);
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
      const selector = ruleset.getImplicitSelector();
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

    let candidates: Set<Ruleset> | undefined = undefined;

    // Use intersection to whittle down candidates with each subsequent key
    for (const key of keys) {
      // const key = targetKeys[i]!;
      const keyRulesets = this.index.get(key);
      if (!keyRulesets || keyRulesets.size === 0) {
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
    return candidates?.size ? [...candidates] : undefined;
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
    // const keyList = this.getSimpleKeyList(selector);
    const index = this.index;

    if (keySet?.size) {
      const [startKey, ...rest] = keySet;
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
            this._indexSelectorStart(mixin, sel.keySet);
          }
        } else {
          this._indexSelectorStart(mixin, selector.keySet);
        }
      }
    }
    this.pendingItems.clear();
  }

  /**
   * Find candidate mixins (or rulesets, or both) that might match the target selector
   *
   * @todo - Prevent infinite recursion when a mixin calls itself.
   *
   * ...also...
   *
   * @todo - Not sure how recursion works here with the match overflow and returning
   * proper arrays.
   */
  _findMatches(
    keys: string | string[],
    filterType: 'Mixin' | 'Ruleset' | undefined = undefined,
    options: {
      searchParents?: boolean;
      candidates?: Set<Mixin | Ruleset>;
    } = {}
  ): Array<{ value: Mixin | Ruleset; match: string[] }> | undefined {
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
    let { searchParents = true, candidates } = options;
    let outer: Array<{ value: Mixin | Ruleset; match: string[] }> | undefined;
    while (rules) {
      let [startKey, ...search] = keyList;
      const existing = rules.mixinRegistry?._findMatches(startKey!);
      if (rules === this.rules) {
        outer = existing;
      }

      if (existing) {
        for (const { value, match } of existing) {
          if (filterType && value.type !== filterType) {
            continue;
          }

          // If all match keys match all search keys, add as candidate
          if (arraysEqual(match, search)) {
            (candidates ??= new Set()).add(value);
            continue;
          }

          // If there are more search keys, and this is a ruleset or has empty params
          if (search.length > match.length) {
            const remainder = search.slice(match.length);
            if (
              (isNode(value, 'Ruleset'))
              || (isNode(value, 'Mixin') && (!value.value.params || value.value.params.length === 0))
            ) {
            // Recursively search in this mixin's registry
              let subRules = value.value.rules;
              const subCandidates =
                subRules.mixinRegistry?._findMatches(remainder, filterType, {
                  searchParents: false,
                  candidates: (candidates ??= new Set())
                });
              if (subCandidates) {
                candidates = candidates!.union(new Set(subCandidates.map(({ value }) => value)));
              }
            }
          }
        }
      }
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
        if (isNode(rules, 'StyleImport') && rules.options.type !== 'import') {
          rules = undefined;
          break;
        }
      } while (rules && rules.type !== 'Rules');
    }
    return outer;
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
    this.indexPendingItems();
    let declCandidate: [
      declaration: Declaration,
      read?: boolean
    ] | undefined;
    let rules: Rules | undefined = this.rules;
    let isPublic = false;
    const {
      searchParents = true,
      local = false,
      start
    } = options ?? {};
    while (rules) {
      let currentReadonly = options?.readonly || rules.options.readonly;
      let registry = rules.declarationRegistry;
      if (registry) {
        registry.indexPendingItems();
      }
      let set = registry?.index.get(key);
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
      }
      if (list?.length) {
        let result = rules.declarationRegistry?._findClosestByStart(list, start);
        if (result) {
          declCandidate = [result, result.options.readonly || currentReadonly];
        }
        isPublic = true;
      }

      if (rules._rulesSet) {
        let { rulesSet } = rules;
        /**
         * Only consider rules after the last found declaration (if relevant)
         * and before the start position (if relevant)
         */
        rulesSet = rulesSet.filter((n) => {
          return (!declCandidate || n.node.index > declCandidate[0].index)
            && (start === undefined || n.node.index < start)
            && (!(local && Boolean(n.node.options?.local)))
            && (
              n.rulesVisibility?.[filterType] === 'optional'
              || n.rulesVisibility?.[filterType] === 'public'
            );
        });

        let length = rulesSet.length;
        if (length) {
          for (let i = length - 1; i >= 0; i--) {
            let r = rulesSet.at(i)!;
            /** Locals can be searched once but not twice */
            let newLocal = local || Boolean(r.node.options?.local);
            let newOpts = options ? { ...options, readonly: currentReadonly || r.readonly } : { readonly: currentReadonly || r.readonly };
            newOpts.searchParents = false;
            newOpts.local = newLocal;
            newOpts.start = undefined;
            let result = r.node.find('declaration', key, filterType, newOpts);
            if (result) {
              /**
               * If it's public, and it's the lower-most declaration,
               * it wins.
               */
              if (r.rulesVisibility?.[filterType] === 'public') {
                if (options && newOpts.readonly) {
                  options.readonly = true;
                }
                return result;
              }
              /**
               * The declaration is optional, so we need to keep searching.
               * If we already have a candidate, that means we have a local
               * value which should win.
               */
              if (!declCandidate) {
                declCandidate = [result, newOpts.readonly];
              }
            }
          }
        }
      }
      if (isPublic || !searchParents) {
        if (options && declCandidate?.[1]) {
          options.readonly = true;
        }
        return declCandidate?.[0];
      }

      do {
        rules = rules?.parent as Rules;
        /**
         * If we reach an import boundary, stop unless it's an `@import`
         * which means these rules can reach into the parent file that imports
         * this one.
         */
        if (isNode(rules, 'StyleImport') && rules.options.type !== 'import') {
          rules = undefined;
          break;
        }
      } while (rules && !isNode(rules, 'Rules'));
    }
    if (options && declCandidate?.[1]) {
      options.readonly = true;
    }
    return declCandidate?.[0];
  }
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}