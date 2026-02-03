import { Selector } from '../selector.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { F_AMPERSAND, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';
import { isNode } from './is-node.js';
import { syncLog } from './__tests__/debug-log.js';

// Some build targets for core do not include Node typings; keep debug gating type-safe.
declare const process: { env: Record<string, string | undefined> };

// #region agent log
let __agentImplicitIsCount = 0;
// #endregion

/**
 * Adds an implicit ampersand to a selector if it doesn't already have one.
 * This is used by rulesets and extends to prepend the parent selector.
 *
 * @param selector - The selector to add the ampersand to
 * @param collapseNesting - Whether to collapse nesting (affects visibility flags)
 * @param parentSelector - Optional parent selector to set on the ampersand
 * @returns The selector with implicit ampersand added
 */
export function addImplicitAmpersand(
  selector: Selector,
  collapseNesting: boolean = false,
  parentSelector?: Selector
): Selector {
  if (selector.hasFlag(F_AMPERSAND)) {
    return selector;
  }
  let amp = Ampersand.create({});
  // If parentSelector is provided, set it on the ampersand so it resolves correctly
  // This ensures the ampersand resolves to the parent selector when evaluated
  if (parentSelector) {
    // #region agent log
    if (process.env.DEBUG_IMPLICIT_SELECTOR === 'true') {
      const psParent = parentSelector.parent;
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
        hypothesisId: 'H15',
        location: 'selector-utils.ts:addImplicitAmpersand',
        message: 'implicit-amp-set-parentSelector-enter',
        data: {
          selectorType: selector.type,
          selectorLoc: selector.location ?? null,
          parentSelectorType: parentSelector.type,
          parentSelectorLoc: parentSelector.location ?? null,
          parentSelectorIsSelfParent: psParent === parentSelector,
          parentSelectorParentType: psParent?.type ?? null,
          parentSelectorParentLoc: psParent?.location ?? null
        },
        timestamp: Date.now()
      });
    }
    // #endregion
    // IMPORTANT: do NOT attach the live parent selector into the ampersand value tree.
    // The Node proxy will "adopt" it, reparenting the existing selector and potentially
    // creating circular/self-parent chains when we later call .inherit() on newly created selectors.
    // Always store a copy instead.
    // If the parent is a SelectorList and we are NOT collapsing nesting, store it as `:is(parentList)`
    // so later extend matching can expand it into concrete branches.
    //
    // Runtime evidence: keeping a raw SelectorList here causes exact extend targets like
    // `.replace.replace .replace` to fail to match a nested selector like
    // `.replace.replace,.c.replace+.replace .replace` (because the parent list is embedded as a list).
    // Wrapping as `:is(...)` allows normalization to expand the OR branches during matching.
    const parentCopy = parentSelector.copy(true);
    if (!collapseNesting && isNode(parentCopy, 'SelectorList')) {
      amp.value.selector = PseudoSelector.create({ name: ':is', arg: parentCopy });
      // #region agent log
      if ((process.env.DEBUG_RUN_ID || '') === 'extend-exact-debug' && __agentImplicitIsCount++ < 25) {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'extend-exact-debug',
          hypothesisId: 'H16',
          location: 'selector-utils.ts:addImplicitAmpersand',
          message: 'wrapped-parent-selectorlist-into-is',
          data: {
            collapseNesting,
            storedType: amp.value.selector.type,
            storedValue: amp.value.selector.valueOf(),
            parentType: parentCopy.type,
            parentValue: parentCopy.valueOf()
          },
          timestamp: Date.now()
        });
      }
      // #endregion
    } else {
      amp.value.selector = parentCopy;
    }
    // #region agent log
    if (process.env.DEBUG_IMPLICIT_SELECTOR === 'true') {
      const psParent = parentSelector.parent;
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
        hypothesisId: 'H15',
        location: 'selector-utils.ts:addImplicitAmpersand',
        message: 'implicit-amp-set-parentSelector-exit',
        data: {
          parentSelectorIsSelfParent: psParent === parentSelector,
          parentSelectorParentType: psParent?.type ?? null,
          parentSelectorParentLoc: psParent?.location ?? null,
          parentSelectorParentIsAmp: psParent === amp
        },
        timestamp: Date.now()
      });
    }
    // #endregion
  }
  // Mark as implicit so it can be excluded from visibleKeySet for indexing
  amp.addFlag(F_IMPLICIT_AMPERSAND);
  if (!collapseNesting) {
    amp.removeFlag(F_VISIBLE);
  }
  let comb = Combinator.create(' ');
  if (!collapseNesting) {
    comb.removeFlag(F_VISIBLE);
  }
  if (isNode(selector, 'ComplexSelector')) {
    const complex = selector;
    // Avoid moving live nodes from the existing selector into a new selector
    // (which would reparent them). Work with a copy instead.
    const complexCopy = complex.copy(true) as ComplexSelector;
    if (isNode(complexCopy.value[0], 'Combinator')) {
      return ComplexSelector.create([amp, ...complexCopy.value]).inherit(selector);
    }
    return ComplexSelector.create([amp, comb, ...complexCopy.value]).inherit(selector);
  }
  // Avoid self-parenting: if we include `selector` as a child and then call `.inherit(selector)`,
  // the constructor will adopt `selector` first (setting selector.parent = newComplex),
  // and then `.inherit()` would set newComplex.parent = selector.parent = newComplex.
  return ComplexSelector.create([amp, comb, selector.copy(true)]).inherit(selector);
}

/**
 * Gets the implicit selector by adding an implicit ampersand from the parent selector.
 * This is used by rulesets and extends to prepend the parent selector to their own selector.
 *
 * @param selector - The selector to add the implicit ampersand to
 * @param parentSelector - The parent selector to prepend
 * @param collapseNesting - Whether to collapse nesting (affects visibility flags)
 * @returns The selector with implicit ampersand added
 */
export function getImplicitSelector(
  selector: Selector,
  parentSelector: Selector,
  collapseNesting: boolean = false
): Selector {
  if (isNode(selector, 'Nil')) {
    return selector;
  }
  if (isNode(selector, 'SelectorList')) {
    let mutated = false;
    const value = selector.value;
    for (let i = 0; i < value.length; i++) {
      const sel = value[i]!;
      const result = addImplicitAmpersand(sel, collapseNesting, parentSelector);
      if (result !== sel) {
        if (!mutated) {
          selector = selector.clone(true);
        }
        (selector as SelectorList).value[i] = result;
        mutated = true;
      }
    }
  } else {
    selector = addImplicitAmpersand(selector, collapseNesting, parentSelector);
  }
  if (collapseNesting) {
    selector.hoistToRoot = true;
  }
  return selector;
}
