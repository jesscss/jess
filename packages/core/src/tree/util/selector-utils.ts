import { Selector } from '../selector.js';
import { Nil } from '../nil.js';
import { Ampersand } from '../ampersand.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { SelectorList } from '../selector-list.js';
import { F_AMPERSAND, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';
import { isNode } from './is-node.js';
// #region agent log
import { syncLog } from '../util/__tests__/debug-log.js';
// #endregion

// #region agent log
function __agentAmpTrace(location: string, message: string, data: Record<string, unknown>) {
  if (process.env.DEBUG_EXTEND_TRACE !== 'true') return;
  fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'debug-session',
      runId: process.env.DEBUG_RUN_ID || 'extend-trace',
      hypothesisId: 'H-trace',
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
}
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
  // #region agent log
  __agentAmpTrace('selector-utils.ts:addImplicitAmpersand', 'enter', {
    selector: selector.valueOf(),
    selectorType: selector.type,
    collapseNesting,
    hasAmpersandFlag: selector.hasFlag(F_AMPERSAND),
    hasParentSelector: !!parentSelector,
    parentSelector: parentSelector ? parentSelector.valueOf() : null
  });
  // #endregion
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
    amp.value.selector = parentSelector.copy(true);
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
  const returnVal = ComplexSelector.create([amp, comb, selector.copy(true)]).inherit(selector);
  // #region agent log
  __agentAmpTrace('selector-utils.ts:addImplicitAmpersand', 'created', {
    in: selector.valueOf(),
    out: returnVal.valueOf(),
    collapseNesting
  });
  // #endregion
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
