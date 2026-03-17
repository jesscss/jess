import { Selector } from '../selector.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import type { Ruleset } from '../ruleset.js';
import type { Node } from '../node.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { F_IMPLICIT_AMPERSAND, F_EXTENDED } from '../node.js';

/** Walk node.parent → Rules → Ruleset to find the containing Ruleset, if any. */
export function getParentRuleset(node: Node): Ruleset | undefined {
  const rules = node.parent;
  return rules?.parent && isNode(rules.parent, N.Ruleset)
    ? rules.parent as Ruleset
    : undefined;
}

function flattenSelectorListAlternatives(list: SelectorList): SelectorList {
  const flattened: Selector[] = [];
  const seen = new Set<string>();

  const pushUnique = (selector: Selector): void => {
    const key = selector.valueOf();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    flattened.push(selector);
  };

  for (const item of list.value) {
    if (isNode(item, N.PseudoSelector) && item.name === ':is' && isNode(item.arg, N.SelectorList)) {
      for (const child of (item.arg as SelectorList).value) {
        pushUnique(child.copy(true) as Selector);
      }
      continue;
    }

    if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
      const only = item.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is' && isNode(only.arg, N.SelectorList)) {
        for (const child of (only.arg as SelectorList).value) {
          pushUnique(child.copy(true) as Selector);
        }
        continue;
      }
    }

    if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
      const only = item.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is' && isNode(only.arg, N.SelectorList)) {
        for (const child of (only.arg as SelectorList).value) {
          pushUnique(child.copy(true) as Selector);
        }
        continue;
      }
    }

    pushUnique(item);
  }

  if (flattened.length === list.value.length) {
    return list;
  }

  return SelectorList.create(flattened).inherit(list) as SelectorList;
}

/**
 * Wraps a parent selector into the single selector fragment that should appear
 * inside another selector context.
 *
 * A selector list becomes generated `:is(...)` so it can occupy one selector
 * position without AST mutation. Non-lists are copied directly.
 */
export function wrapParentSelectorForNestedContext(
  parentSelector: Selector,
  collapseNesting: boolean = false
): Selector {
  let parentCopy = parentSelector.copy(true) as Selector;
  if (isNode(parentCopy, N.SelectorList)) {
    parentCopy = flattenSelectorListAlternatives(parentCopy as SelectorList) as Selector;
  }
  if (isNode(parentCopy, N.SelectorList)) {
    const wrapped = PseudoSelector.create({ name: ':is', arg: parentCopy });
    wrapped.generated = true;
    return wrapped;
  }
  return parentCopy;
}

/**
 * Returns the selector fragment(s) that should replace an authored ampersand.
 *
 * Selector-list parents become generated `:is(...)` wrappers so they can occupy
 * one selector position. Complex parents splice directly only when the
 * ampersand is the leading component of the containing route; otherwise they
 * remain wrapped to preserve route validity.
 */
export function getParentReplacementForAmpersand(
  parentSelector: Selector,
  atStart: boolean
): Selector[] {
  const parentCopy = parentSelector.copy(true) as Selector;

  if (isNode(parentCopy, N.SelectorList)) {
    return [wrapParentSelectorForNestedContext(parentCopy)];
  }

  if (isNode(parentCopy, N.ComplexSelector)) {
    if (atStart) {
      return [...(parentCopy as ComplexSelector).value] as Selector[];
    }

    const wrapped = PseudoSelector.create({
      name: ':is',
      arg: parentCopy
    });
    wrapped.generated = true;
    return [wrapped as Selector];
  }

  return [parentCopy];
}

function selectorHasAuthoredAmpersand(selector: Selector): boolean {
  if (isNode(selector, N.Ampersand)) {
    return !selector.hasFlag(F_IMPLICIT_AMPERSAND);
  }

  if (isNode(selector, N.SelectorList | N.ComplexSelector | N.CompoundSelector)) {
    return ((selector as SelectorList | ComplexSelector | CompoundSelector).value as Selector[]).some(item => selectorHasAuthoredAmpersand(item));
  }

  if (isNode(selector, N.PseudoSelector)) {
    const arg = (selector as PseudoSelector).arg;
    if (arg && isNode(arg, N.Selector)) {
      return selectorHasAuthoredAmpersand(arg as Selector);
    }
  }

  return false;
}

function resolveAuthoredAmpersands(
  selector: Selector,
  parentSelector: Selector
): Selector {
  if (isNode(selector, N.Ampersand)) {
    const replacement = getParentReplacementForAmpersand(parentSelector, true);
    return replacement.length === 1
      ? replacement[0]!
      : ComplexSelector.create(replacement as any).inherit(selector) as Selector;
  }

  if (isNode(selector, N.SelectorList)) {
    return SelectorList.create(
      selector.value.map(item => resolveAuthoredAmpersands(item as Selector, parentSelector))
    ).inherit(selector) as Selector;
  }

  if (isNode(selector, N.ComplexSelector | N.CompoundSelector)) {
    const selectorData = (selector as ComplexSelector | CompoundSelector).value as Selector[];
    const nextData: Selector[] = [];
    for (let i = 0; i < selectorData.length; i++) {
      const item = selectorData[i] as Selector;
      if (isNode(item, N.Ampersand) && !item.hasFlag(F_IMPLICIT_AMPERSAND)) {
        const atStart = isNode(selector, N.ComplexSelector) && i === 0;
        nextData.push(...getParentReplacementForAmpersand(parentSelector, atStart));
        continue;
      }
      nextData.push(resolveAuthoredAmpersands(item, parentSelector));
    }
    const ctor = isNode(selector, N.ComplexSelector) ? ComplexSelector : CompoundSelector;
    return ctor.create(nextData as any).inherit(selector) as Selector;
  }

  if (isNode(selector, N.PseudoSelector)) {
    const ps = selector as PseudoSelector;
    if (ps.arg && isNode(ps.arg, N.Selector)) {
      const copy = ps.copy(true) as PseudoSelector;
      copy.setData('arg', resolveAuthoredAmpersands(ps.arg as Selector, parentSelector));
      return copy as Selector;
    }
  }

  return (selector as Selector).copy(true) as Selector;
}

function composeSelectorRouteWithParent(
  selector: Selector,
  parentSelector: Selector,
  collapseNesting: boolean = false
): Selector {
  const childCopy = selector.copy(true) as Selector;
  if (selectorHasAuthoredAmpersand(childCopy)) {
    return resolveAuthoredAmpersands(childCopy, parentSelector);
  }
  const parentFragment = wrapParentSelectorForNestedContext(parentSelector, collapseNesting);

  if (isNode(childCopy, N.ComplexSelector)) {
    const nextData = isNode(parentFragment, N.ComplexSelector)
      ? [...parentFragment.value]
      : [parentFragment];

    if (!isNode(childCopy.value[0], N.Combinator)) {
      nextData.push(Combinator.create(' '));
    }

    nextData.push(...childCopy.value);
    return ComplexSelector.create(nextData).inherit(selector) as Selector;
  }

  return ComplexSelector.create([
    parentFragment,
    Combinator.create(' '),
    childCopy
  ]).inherit(selector) as Selector;
}

/**
 * Composes a selector with its parent selector without inserting implicit
 * ampersands or relying on later `:is(...)` cleanup passes.
 *
 * The historical `getImplicitSelector()` name is kept for compatibility with
 * callers and tests, but the implementation is now pure selector composition.
 *
 * - Selector-list children keep their list shape when each item can be
 *   independently prefixed by the parent.
 * - Selector-list children containing complex items are grouped under one
 *   generated `:is(...)` before the parent is composed so the common parent
 *   does not have to be duplicated across every alternate.
 * @param collapseNesting - Whether to collapse nesting (affects visibility flags)
 * @returns The composed selector
 */
export function getImplicitSelector(
  selector: Selector,
  parent: Ruleset | Selector,
  collapseNesting: boolean = false
): Selector {
  if (isNode(selector, N.Nil)) {
    return selector;
  }

  const parentSelector = isNode(parent, N.Ruleset)
    ? (parent as Ruleset).selector
    : parent as Selector;
  if (!parentSelector || isNode(parentSelector, N.Nil)) {
    return selector.copy(true) as Selector;
  }

  if (
    !collapseNesting
    && isNode(selector, N.SelectorList)
    && selector.value.some(item =>
      isNode(item, N.ComplexSelector) && (item as ComplexSelector).value.length > 1
    )
    && !selectorHasAuthoredAmpersand(selector)
  ) {
    const grouped = PseudoSelector.create({
      name: ':is',
      arg: selector.copy(true) as Selector
    });
    grouped.generated = true;
    selector = grouped as Selector;
  } else if (isNode(selector, N.SelectorList)) {
    const next = selector.value.map(item =>
      composeSelectorRouteWithParent(item as Selector, parentSelector as Selector, collapseNesting)
    );
    const list = SelectorList.create(next).inherit(selector) as Selector;
    if (collapseNesting) {
      list.hoistToRoot = true;
    }
    return list;
  } else {
    selector = composeSelectorRouteWithParent(selector, parentSelector as Selector, collapseNesting);
  }

  if (collapseNesting) {
    selector.hoistToRoot = true;
  }
  return selector;
}

/**
 * Removes one leading parent composition from a selector so nested rulesets can
 * keep rendering local selector shape while their concrete `data.selector`
 * remains fully composed for matching.
 *
 * Only alternatives that actually start with the serialized parent prefix are
 * de-prefixed. Mixed selector lists therefore keep escaped/hoisted alternatives
 * intact while converting same-parent alternatives back to local form.
 */
export function localizeSelectorAgainstParent(
  selector: Selector,
  parent: Selector
): Selector {
  const wrappedParent = wrapParentSelectorForNestedContext(parent, false);
  const parentPrefix = isNode(wrappedParent, N.ComplexSelector)
    ? [...(wrappedParent as ComplexSelector).value] as Selector[]
    : [wrappedParent];

  const stripParentPrefix = (route: Selector): Selector => {
    if (!isNode(route, N.ComplexSelector)) {
      return route.copy(true) as Selector;
    }

    const data = (route as ComplexSelector).value as Selector[];
    if (data.length <= parentPrefix.length) {
      return route.copy(true) as Selector;
    }

    for (let i = 0; i < parentPrefix.length; i++) {
      if (data[i]!.valueOf() !== parentPrefix[i]!.valueOf()) {
        return route.copy(true) as Selector;
      }
    }

    const next = data[parentPrefix.length];
    if (!isNode(next, N.Combinator) || next.valueOf() !== ' ') {
      return route.copy(true) as Selector;
    }

    const remainder = data.slice(parentPrefix.length + 1).map(node => node.copy(true) as Selector);
    if (remainder.length === 0) {
      return route.copy(true) as Selector;
    }
    if (remainder.length === 1) {
      return remainder[0]!;
    }
    return ComplexSelector.create(remainder).inherit(route) as Selector;
  };

  if (isNode(selector, N.SelectorList)) {
    return SelectorList.create(
      selector.value.map(item => stripParentPrefix(item as Selector))
    ).inherit(selector) as Selector;
  }

  return stripParentPrefix(selector);
}

/** Returns true if the selector (or any top-level SelectorList item) has F_EXTENDED. */
export function hasExtendedSelector(sel: Selector | Nil | undefined): boolean {
  if (!sel || sel instanceof Nil) {
    return false;
  }
  if (isNode(sel, N.SelectorList)) {
    return (sel as SelectorList).value.some(item => item.hasFlag(F_EXTENDED));
  }
  return (sel as Selector).hasFlag(F_EXTENDED);
}
