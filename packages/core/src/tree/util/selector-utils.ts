import { Selector } from '../selector.js';
import { Nil } from '../nil.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { SelectorList } from '../selector-list.js';
import { F_AMPERSAND, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';
// #region agent log
import { syncLog } from '../util/__tests__/debug-log.js';
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
      const psParent = (parentSelector as any)?.parent as any;
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
        hypothesisId: 'H15',
        location: 'selector-utils.ts:addImplicitAmpersand',
        message: 'implicit-amp-set-parentSelector-enter',
        data: {
          selectorType: (selector as any)?.type ?? null,
          selectorLoc: (selector as any)?.location ?? null,
          parentSelectorType: (parentSelector as any)?.type ?? null,
          parentSelectorLoc: (parentSelector as any)?.location ?? null,
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
    amp.value.selector = parentSelector.copy(true);
    // #region agent log
    if (process.env.DEBUG_IMPLICIT_SELECTOR === 'true') {
      const psParent = (parentSelector as any)?.parent as any;
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
  if ((selector as any)?.type === 'ComplexSelector') {
    const complex = selector as unknown as ComplexSelector;
    // Avoid moving live nodes from the existing selector into a new selector
    // (which would reparent them). Work with a copy instead.
    const complexCopy = complex.copy(true) as ComplexSelector;
    if ((complexCopy.value[0] as any)?.type === 'Combinator') {
      return ComplexSelector.create([amp, ...complexCopy.value]).inherit(selector);
    }
    return ComplexSelector.create([amp, comb, ...complexCopy.value]).inherit(selector);
  }
  // Avoid self-parenting: if we include `selector` as a child and then call `.inherit(selector)`,
  // the constructor will adopt `selector` first (setting selector.parent = newComplex),
  // and then `.inherit()` would set newComplex.parent = selector.parent = newComplex.
  const returnVal = ComplexSelector.create([amp, comb, selector.copy(true)]).inherit(selector);
  return returnVal;
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
  if ((selector as any)?.type === 'Nil') {
    return selector;
  }
  if ((selector as any)?.type === 'SelectorList') {
    let mutated = false;
    const value = (selector as any).value as Selector[];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        let sel = value[i]!;
        let result = addImplicitAmpersand(sel, collapseNesting, parentSelector);
        if (result !== sel) {
          if (!mutated) {
            selector = selector.clone(true);
          }
          ((selector as any) as SelectorList).value[i] = result;
          mutated = true;
        }
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
