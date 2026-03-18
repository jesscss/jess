import { Selector } from '../selector.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { BasicSelector } from '../selector-basic.js';
import type { Ruleset } from '../ruleset.js';
import type { Node } from '../node.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { F_IMPLICIT_AMPERSAND, F_EXTENDED } from '../node.js';
import type { Ampersand } from '../ampersand.js';

/**
 * Returns true when `sel` is purely `&` with no appendValue — meaning the
 * ruleset's selector is an unmodified mirror of its parent. Such rulesets
 * are updated by refreshNestedRulesetSelectors and should not be directly
 * targeted by the extend loop.
 */
export function isBareAmpersandOwnSelector(sel: Selector | Nil): boolean {
  if (!sel || sel instanceof Nil) {
    return false;
  }
  if (isNode(sel, N.Ampersand)) {
    return !(sel as unknown as Ampersand).appendValue;
  }
  if (isNode(sel, N.CompoundSelector | N.ComplexSelector)) {
    const items = (sel as unknown as { data: unknown[] }).data;
    return items.length === 1
      && isNode(items[0] as Node, N.Ampersand)
      && !(items[0] as unknown as Ampersand).appendValue;
  }
  return false;
}

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

  for (const item of list.data) {
    if (isNode(item, N.PseudoSelector) && item.data.name === ':is' && isNode(item.data.arg, N.SelectorList)) {
      for (const child of (item.data.arg as SelectorList).data) {
        pushUnique(child.copy(true) as Selector);
      }
      continue;
    }

    if (isNode(item, N.CompoundSelector) && item.data.length === 1) {
      const only = item.data[0]!;
      if (isNode(only, N.PseudoSelector) && only.data.name === ':is' && isNode(only.data.arg, N.SelectorList)) {
        for (const child of (only.data.arg as SelectorList).data) {
          pushUnique(child.copy(true) as Selector);
        }
        continue;
      }
    }

    if (isNode(item, N.ComplexSelector) && item.data.length === 1) {
      const only = item.data[0]!;
      if (isNode(only, N.PseudoSelector) && only.data.name === ':is' && isNode(only.data.arg, N.SelectorList)) {
        for (const child of (only.data.arg as SelectorList).data) {
          pushUnique(child.copy(true) as Selector);
        }
        continue;
      }
    }

    pushUnique(item);
  }

  if (flattened.length === list.data.length) {
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
      return [...parentCopy.data] as Selector[];
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

export function selectorHasAuthoredAmpersand(selector: Selector): boolean {
  if (isNode(selector, N.Ampersand)) {
    return !selector.hasFlag(F_IMPLICIT_AMPERSAND);
  }

  if (isNode(selector, N.SelectorList | N.ComplexSelector | N.CompoundSelector)) {
    return (selector.data as readonly Selector[]).some(item => selectorHasAuthoredAmpersand(item));
  }

  if (isNode(selector, N.PseudoSelector)) {
    const arg = (selector as PseudoSelector).arg;
    if (arg && isNode(arg, N.Selector)) {
      return selectorHasAuthoredAmpersand(arg as Selector);
    }
  }

  return false;
}

/**
 * Apply an ampersand's appendValue (suffix like `-1` or template like `.&-foo`)
 * to a resolved parent selector. Mirrors the logic in Ampersand.evalNode but
 * operates on the already-resolved replacement selector.
 */
function applyAppendValue(resolved: Selector, appendValue: string, inherit: Selector): Selector {
  const isTemplateMerge = appendValue.includes('&');
  if (isTemplateMerge) {
    const applyTemplate = (sel: Selector): Selector => {
      const value = sel.toTrimmedString();
      return new BasicSelector(appendValue.split('&').join(value)).inherit(inherit);
    };
    if (isNode(resolved, N.SelectorList)) {
      const items = (resolved as SelectorList).data.map(item => applyTemplate(item as Selector));
      return SelectorList.create(items).inherit(inherit) as Selector;
    }
    return applyTemplate(resolved);
  }

  const doAppend = (n: Selector): void => {
    for (const s of n.nodes(true)) {
      if (isNode(s, N.SimpleSelector)) {
        if (typeof s.data === 'string') {
          s.setData(s.data + appendValue);
          return;
        }
      }
    }
  };

  if (isNode(resolved, N.SelectorList)) {
    (resolved as SelectorList).data.forEach(item => doAppend(item as Selector));
  } else {
    doAppend(resolved);
  }
  resolved.hoistToRoot = true;
  return resolved;
}

function resolveAuthoredAmpersands(
  selector: Selector,
  parentSelector: Selector
): Selector {
  if (isNode(selector, N.Ampersand)) {
    const appendValue = (selector as Ampersand).appendValue;
    const replacement = getParentReplacementForAmpersand(parentSelector, true);
    let resolved = replacement.length === 1
      ? replacement[0]!
      : ComplexSelector.create(replacement as any).inherit(selector) as Selector;
    if (appendValue) {
      resolved = applyAppendValue(resolved, appendValue, selector);
    }
    if (appendValue !== undefined) {
      resolved.hoistToRoot = true;
    }
    return resolved;
  }

  if (isNode(selector, N.SelectorList)) {
    return SelectorList.create(
      (selector as SelectorList).data.map(item => resolveAuthoredAmpersands(item as Selector, parentSelector))
    ).inherit(selector) as Selector;
  }

  if (isNode(selector, N.ComplexSelector | N.CompoundSelector)) {
    const data = selector.data as readonly Selector[];
    const nextData: Selector[] = [];
    let hasAppendValue = false;
    const isCompound = isNode(selector, N.CompoundSelector);
    for (let i = 0; i < data.length; i++) {
      const item = data[i]!;
      if (isNode(item, N.Ampersand) && !item.hasFlag(F_IMPLICIT_AMPERSAND)) {
        const appendValue = (item as Ampersand).appendValue;
        const atStart = !isCompound && i === 0;
        const parts = getParentReplacementForAmpersand(parentSelector, atStart);
        if (appendValue) {
          let resolved = parts.length === 1
            ? parts[0]!
            : ComplexSelector.create(parts as any).inherit(item) as Selector;
          resolved = applyAppendValue(resolved, appendValue, item);
          nextData.push(resolved);
          hasAppendValue = true;
        } else {
          nextData.push(...parts);
        }
        continue;
      }
      // Fuse complex parent into compound at ComplexSelector start position:
      // e.g. &.foo with parent .a .b → .a .b.foo (not :is(.a .b).foo)
      if (
        !isCompound && i === 0
        && isNode(item, N.CompoundSelector)
        && isNode(parentSelector, N.ComplexSelector)
      ) {
        const compoundData = item.data as readonly Selector[];
        if (compoundData.length > 0 && isNode(compoundData[0], N.Ampersand) && !compoundData[0]!.hasFlag(F_IMPLICIT_AMPERSAND)) {
          const ampAppend = (compoundData[0] as Ampersand).appendValue;
          if (!ampAppend) {
            const parentParts = [...parentSelector.data] as Selector[];
            const remaining = compoundData.slice(1).map(d => resolveAuthoredAmpersands(d as Selector, parentSelector));
            const lastParentPart = parentParts[parentParts.length - 1]!.copy(true) as Selector;
            const compoundItems = [lastParentPart, ...remaining];
            const fusedLast = CompoundSelector.create(compoundItems as any).inherit(item) as Selector;
            const prefix = parentParts.slice(0, -1).map(p => p.copy(true) as Selector);
            if (prefix.length > 0) {
              nextData.push(...prefix, fusedLast);
            } else {
              nextData.push(fusedLast);
            }
            continue;
          }
        }
      }
      nextData.push(resolveAuthoredAmpersands(item, parentSelector));
    }
    const ctor = !isCompound ? ComplexSelector : CompoundSelector;
    const result = ctor.create(nextData as any).inherit(selector) as Selector;
    if (hasAppendValue) {
      result.hoistToRoot = true;
    }
    return result;
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
      ? [...parentFragment.data]
      : [parentFragment];

    if (!isNode(childCopy.data[0], N.Combinator)) {
      nextData.push(Combinator.create(' '));
    }

    nextData.push(...childCopy.data);
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
    && selector.data.some(item =>
      isNode(item, N.ComplexSelector) && (item as ComplexSelector).data.length > 1
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
    const next = selector.data.map(item =>
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
    ? [...wrappedParent.data] as Selector[]
    : [wrappedParent];

  const stripParentPrefix = (route: Selector): Selector => {
    if (!isNode(route, N.ComplexSelector)) {
      return route.copy(true) as Selector;
    }

    const data = route.data as Selector[];
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
      selector.data.map(item => stripParentPrefix(item as Selector))
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
    return (sel as SelectorList).data.some(item => item.hasFlag(F_EXTENDED));
  }
  return (sel as Selector).hasFlag(F_EXTENDED);
}
