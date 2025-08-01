import type { Ruleset } from '../ruleset';
import type { Selector } from '../selector';
import type { Rules } from '../rules';
import { isNode } from './is-node';
import type { Mixin } from '../mixin';
import type { Nil } from '../nil';
import type { Node } from '../node';
import type { JsFunction } from '../js-function';
import type { General } from '../general';
import type { Declaration } from '../declaration';
import type { BasicDeclaration } from '../declaration-basic';

const { isArray } = Array;

export abstract class Registry<
  Type extends Node,
  FindUsing extends Node,
  IndexType extends Set<Type> | Array<{
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

  find(using: FindUsing): Set<Type> | undefined {
    this.indexPendingItems();
    let set = this.index.get(String(using));
    if (set) {
      if (set instanceof Set) {
        return set;
      }
      return new Set(set.map(({ value }) => value));
    }
    return;
  }
}

/**
 * Registry for fast selector-based ruleset lookups
 */
export class SelectorRegistry extends Registry<Ruleset, Selector> {
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
  override find(targetSelector: Selector): Set<Ruleset> | undefined {
    // Index any pending rulesets first
    this.indexPendingRulesets();
    const { keySet } = targetSelector;

    let candidates: Set<Ruleset> | undefined = undefined;

    // Use intersection to whittle down candidates with each subsequent key
    for (const key of keySet) {
      // const key = targetKeys[i]!;
      const keyRulesets = this.index.get(key);
      if (!keyRulesets || keyRulesets.size === 0) {
        return; // No matches for this key, so no candidates
      }

      if (candidates) {
        candidates = candidates.intersection(keyRulesets);
      } else {
        candidates = keyRulesets;
      }
      if (candidates.size === 0) {
        return candidates;
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
  Selector,
  Array<{
    value: Mixin | Ruleset;
    match: string[];
  }>
> {
  index = new Map();

  private getSimpleKeyList(selector: Selector | Nil | undefined): string[] | undefined {
    let keyList: string[] | undefined;
    if (selector && 'keySet' in selector) {
      let passed = true;
      let foundBasic = false;
      for (const sel of selector.nodes()) {
        /** Ampersand is okay at start, but not after a basic selector */
        if (!foundBasic && isNode(sel, 'Ampersand')) {
          continue;
        }

        if (isNode(sel, 'Combinator')) {
          if (sel.value !== '>' && sel.value !== ' ') {
            passed = false;
            break;
          }
          continue;
        }

        /** Anything other than a universal selector is fine */
        if (isNode(sel, 'BasicSelector') && /^[^*]/.test(sel.value)) {
          (keyList ??= []).push(sel.valueOf() as string);
          foundBasic = true;
          continue;
        }
        if (isNode(sel, 'CompoundSelector') || isNode(sel, 'ComplexSelector')) {
          /** Might still be fine */
          continue;
        }
        /** Nothing else is valid, so fail */
        passed = false;
        break;
      }
      if (!passed) {
        return;
      }
    }
    return keyList;
  }

  private _indexSelectorStart(mixin: Ruleset | Mixin, selector: Selector | Nil | undefined) {
    const keyList = this.getSimpleKeyList(selector);
    const index = this.index;

    if (keyList?.length) {
      const [startKey, ...rest] = keyList;
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
      const selector = mixin.value.selector;
      if (isNode(selector, 'SelectorList')) {
        /** Selector list's selectors are individually registered */
        for (const sel of selector.value) {
          this._indexSelectorStart(mixin, sel);
        }
      } else {
        this._indexSelectorStart(mixin, selector);
      }
    }
    this.pendingItems.clear();
  }

  /**
   * Find candidate mixins (or rulesets, or both) that might match the target selector
   *
   * @todo - Prevent infinite recursion when a mixin calls itself.
   */
  override find(
    targetSelector: Selector | string[] | string,
    filterType: 'Mixin' | 'Ruleset' | undefined = undefined,
    options: {
      searchParents?: boolean;
      candidates?: Set<Mixin | Ruleset>;
    } = {}
  ): Set<Mixin | Ruleset> | undefined {
    let keyList: string[] | undefined;

    /**
       * This is for calls from `.scss` files, which can
       * call namespaced mixins like `@include \.bar\#foo;
       *
       * @todo - Test after completing the Sass+ parser if this is needed.
       */
    if (typeof targetSelector === 'string') {
      keyList = targetSelector.split(/([#.])/);
      for (let i = 0; i < keyList.length; i++) {
        let key = keyList[i];
        keyList[i] = key!.trim();
        if (!key) {
          throw new Error(`Invalid mixin name: ${targetSelector}`);
        }
      }
    } else if (isArray(targetSelector)) {
      keyList = targetSelector;
    } else {
      keyList = this.getSimpleKeyList(targetSelector);
    }

    if (!keyList?.length) {
      return;
    }

    let rules: Rules | undefined = this.rules;
    let { searchParents = true, candidates } = options;
    while (rules) {
      let registry = rules.mixinRegistry;
      registry.indexPendingItems();

      let [startKey, ...search] = keyList;
      const existing = registry.index.get(startKey!);

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
              const registry = value.value.rules.mixinRegistry;
              if (registry) {
                const subCandidates =
                registry.find(remainder, filterType, {
                  searchParents: false,
                  candidates
                });
                if (subCandidates) {
                  if (candidates) {
                    candidates = candidates.union(subCandidates);
                  } else {
                    candidates = subCandidates;
                  }
                }
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
    return candidates;
  }
}

/**
 * @deprecated
 *
 * This is used by Less and Sass. Their respective plugins can register
 * functions that can be called from the language without a `@-use` directive.
 *
 * The presence of `@-use` directives anywhere in the stylesheet tree will cause
 * these global functions to be disabled.
 */
export class FunctionRegistry extends Registry<BasicDeclaration<{
  name: string;
  value: JsFunction;
}>, General> {
  index = new Map<string, Set<BasicDeclaration<{
    name: string;
    value: JsFunction;
  }>>>();
}

export class DeclarationRegistry extends Registry<Declaration, Selector> {
  index = new Map<string, Set<Declaration>>();
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}