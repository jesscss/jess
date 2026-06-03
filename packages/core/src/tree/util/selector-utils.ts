import { attachSelectorBitLibrary, Selector } from '../selector.js';
import { Ampersand } from '../ampersand.js';
import type { AmpersandValue } from '../ampersand.js';
import type { Ruleset } from '../ruleset.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { F_AMPERSAND, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';
import { Nil } from '../nil.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { copyOwnedWithReusableLeaves } from './cloning.js';
import type { BitSetLibrary } from './bitset.js';

/** Container object whose .selector is read by the ampersand (e.g. ruleset value for live connection). */
export type SelectorContainer = AmpersandValue['selectorContainer'];

/** Parent ruleset (live container) or a snapshot { value: SelectorContainer } when no ruleset is available. */
export type ParentSource = Ruleset | { value: SelectorContainer };

export function copySelectorForPlacement(
  selector: Selector,
  keySetLibrary?: BitSetLibrary<string>
): Selector {
  const copied = copyOwnedWithReusableLeaves(selector);
  if (!copied || typeof copied !== 'object' || Reflect.get(copied, 'isSelector') !== true) {
    throw new TypeError('Expected selector copy');
  }
  return attachSelectorBitLibrary(copied, keySetLibrary ?? selector.keySetLibrary);
}

/**
 * Adds an implicit ampersand to a selector if it doesn't already have one.
 * This is used by rulesets and extends to prepend the parent selector.
 *
 * @param selector - The selector to add the ampersand to
 * @param collapseNesting - Whether to collapse nesting (affects visibility flags)
 * @param parentSource - Optional parent ruleset (live) or snapshot { value: { selector } }; ampersand reads .selector from parentSource.value so extend sees the updated parent when ruleset is extended
 * @returns The selector with implicit ampersand added
 */
export function addImplicitAmpersand(
  selector: Selector,
  collapseNesting: boolean = false,
  parentSource?: ParentSource
): Selector {
  if (selector.hasFlag(F_AMPERSAND)) {
    return selector;
  }
  const selectorContainer = parentSource?.value;
  let ampInit: { selectorContainer?: SelectorContainer } = {};
  if (selectorContainer) {
    ampInit.selectorContainer = selectorContainer;
  }
  let amp = Ampersand.create(ampInit);
  // Mark as implicit so it can be excluded from visibleKeySet for indexing
  amp.addFlag(F_IMPLICIT_AMPERSAND);
  if (!collapseNesting) {
    amp.removeFlag(F_VISIBLE);
  }
  let comb = Combinator.create(' ');
  if (!collapseNesting) {
    comb.removeFlag(F_VISIBLE);
  }
  if (isNode(selector, N.ComplexSelector)) {
    const complex = selector;
    const complexCopy = copySelectorForPlacement(complex);
    if (!isNode(complexCopy, N.ComplexSelector)) {
      throw new TypeError('Expected complex selector copy');
    }
    if (isNode(complexCopy.value[0], N.Combinator)) {
      return ComplexSelector.create([amp, ...complexCopy.value]).inherit(selector);
    }
    return ComplexSelector.create([amp, comb, ...complexCopy.value]).inherit(selector);
  }
  return ComplexSelector.create([amp, comb, copySelectorForPlacement(selector)]).inherit(selector);
}

/**
 * Builds a snapshot parent source from a selector when no parent ruleset is available (e.g. tests or Ruleset.getImplicitSelector(selector)).
 */
function snapshotParentSource(parentSelector: Selector, collapseNesting: boolean): ParentSource {
  const parentCopy = copySelectorForPlacement(parentSelector);
  const sel: Selector | Nil | undefined = !collapseNesting && isNode(parentCopy, N.SelectorList)
    ? PseudoSelector.create({ name: ':is', arg: parentCopy })
    : parentCopy;
  const container: SelectorContainer = { selector: sel };
  return { value: container };
}

function isSnapshotParentSource(parent: ParentSource | Selector): parent is { value: SelectorContainer } {
  return !isNode(parent) && typeof parent === 'object' && parent !== null && 'value' in parent;
}

/**
 * Gets the implicit selector by adding an implicit ampersand from the parent.
 * This is used by rulesets and extends to prepend the parent selector to their own selector.
 *
 * @param selector - The selector to add the implicit ampersand to
 * @param parent - Parent ruleset (live) or parent selector (snapshot when no ruleset available)
 * @param collapseNesting - Whether to collapse nesting (affects visibility flags)
 * @returns The selector with implicit ampersand added
 */
export function getImplicitSelector(
  selector: Selector,
  parent: ParentSource | Selector,
  collapseNesting: boolean = false
): Selector {
  if (isNode(selector, N.Nil)) {
    return selector;
  }
  const parentSource: ParentSource | undefined = isNode(parent, N.Ruleset)
    ? parent
    : isSnapshotParentSource(parent)
      ? parent
      : snapshotParentSource(parent, collapseNesting);
  if (isNode(selector, N.SelectorList)) {
    let mutated = false;
    const value = selector.value;
    const nextValue: Selector[] = [];
    for (let i = 0; i < value.length; i++) {
      const sel = value[i]!;
      const result = addImplicitAmpersand(sel, collapseNesting, parentSource);
      nextValue.push(result);
      if (result !== sel) {
        mutated = true;
      }
    }
    if (mutated) {
      selector = SelectorList.create(nextValue).inherit(selector);
    }
  } else {
    selector = addImplicitAmpersand(selector, collapseNesting, parentSource);
  }
  if (collapseNesting) {
    selector.hoistToRoot = true;
  }
  return selector;
}
