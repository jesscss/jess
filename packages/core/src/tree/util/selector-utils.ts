import { Selector } from '../selector.js';
import { Nil } from '../nil.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { SelectorList } from '../selector-list.js';
import { F_AMPERSAND, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';

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
    amp.value.selector = parentSelector;
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
    if ((complex.value[0] as any)?.type === 'Combinator') {
      return ComplexSelector.create([amp, ...complex.value]).inherit(selector);
    }
    return ComplexSelector.create([amp, comb, ...complex.value]).inherit(selector);
  }
  const returnVal = ComplexSelector.create([amp, comb, selector]).inherit(selector);
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
