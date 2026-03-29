import { Selector } from '../selector.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { BasicSelector } from '../selector-basic.js';
import { AMPERSAND_TEMPLATE_CONTENTS_REGEX } from './ampersand-template.js';
import type { Ruleset } from '../ruleset.js';
import type { Node } from '../node.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { F_IMPLICIT_AMPERSAND, F_EXTENDED } from '../node.js';
import type { Ampersand } from '../ampersand.js';
import type { Context } from '../../context.js';
import { getParent } from './field-helpers.js';

const ampersandTemplateInterpolationRegex = /[$@]\{[^}]+\}/g;
const ampersandTemplateRegex = new RegExp(`^(?:${AMPERSAND_TEMPLATE_CONTENTS_REGEX.source})$`);

/**
 * Returns true when `sel` is purely `&` with no explicit template — meaning the
 * ruleset's selector is an unmodified mirror of its parent. Such rulesets
 * are updated by refreshNestedRulesetSelectors and should not be directly
 * targeted by the extend loop.
 */
export function isBareAmpersandOwnSelector(sel: Selector | Nil): boolean {
  if (!sel || sel instanceof Nil) {
    return false;
  }
  if (isNode(sel, N.Ampersand)) {
    return (sel as unknown as Ampersand).isPlainAmpersand();
  }
  if (isNode(sel, N.CompoundSelector)) {
    const items = (sel as CompoundSelector).get('value');
    return items.length === 1
      && isNode(items[0] as Node, N.Ampersand)
      && ((items[0] as Node) as Ampersand).isPlainAmpersand();
  }
  if (isNode(sel, N.ComplexSelector)) {
    const items = (sel as ComplexSelector).get('value');
    return items.length === 1
      && isNode(items[0] as Node, N.Ampersand)
      && ((items[0] as Node) as Ampersand).isPlainAmpersand();
  }
  return false;
}

/**
 * Smart `:is()` wrapper. Flattens nested generated `:is()`, deduplicates,
 * and skips wrapping single items.
 */
export function wrapInGeneratedIs(selector: Selector): Selector {
  const items: Selector[] = [];
  const seen = new Set<string>();

  const addItem = (item: Selector): void => {
    let pseudo: PseudoSelector | undefined;
    if (isNode(item, N.PseudoSelector) && item.generated && item.get('name') === ':is') {
      pseudo = item;
    } else if (isNode(item, N.CompoundSelector) && (item as CompoundSelector).get('value').length === 1) {
      const only = (item as CompoundSelector).get('value')[0]!;
      if (isNode(only, N.PseudoSelector) && only.generated && only.get('name') === ':is') {
        pseudo = only;
      }
    }
    if (pseudo && isNode(pseudo.get('arg'), N.SelectorList)) {
      for (const child of (pseudo.get('arg') as SelectorList).get('value')) {
        addItem(child as Selector);
      }
      return;
    }
    const key = item.valueOf();
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  };

  if (isNode(selector, N.SelectorList)) {
    for (const item of (selector as SelectorList).get('value')) {
      addItem(item as Selector);
    }
  } else {
    addItem(selector);
  }

  if (items.length === 1) {
    return items[0]!;
  }

  const list = SelectorList.create(items).inherit(selector) as SelectorList;
  list.pre = undefined;
  list.post = undefined;
  const wrapper = PseudoSelector.create({ name: ':is', arg: list });
  wrapper.generated = true;
  return wrapper.inherit(selector) as Selector;
}

/** Walk node.parent → Rules → Ruleset to find the containing Ruleset, if any. */
export function getParentRuleset(node: Node, context?: Context): Ruleset | undefined {
  const rules = context ? getParent(node, context) : node.parent;
  const parent = rules && (context ? getParent(rules, context) : rules.parent);
  return parent && isNode(parent, N.Ruleset)
    ? parent as Ruleset
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

  for (const item of list.get('value')) {
    if (isNode(item, N.PseudoSelector) && item.get('name') === ':is' && isNode(item.get('arg'), N.SelectorList)) {
      for (const child of (item.get('arg') as SelectorList).get('value')) {
        pushUnique(child as Selector);
      }
      continue;
    }

    if (isNode(item, N.CompoundSelector) && (item as CompoundSelector).get('value').length === 1) {
      const only = (item as CompoundSelector).get('value')[0]!;
      if (isNode(only, N.PseudoSelector) && only.get('name') === ':is' && isNode(only.get('arg'), N.SelectorList)) {
        for (const child of (only.get('arg') as SelectorList).get('value')) {
          pushUnique(child as Selector);
        }
        continue;
      }
    }

    if (isNode(item, N.ComplexSelector) && (item as ComplexSelector).get('value').length === 1) {
      const only = (item as ComplexSelector).get('value')[0]!;
      if (isNode(only, N.PseudoSelector) && only.get('name') === ':is' && isNode(only.get('arg'), N.SelectorList)) {
        for (const child of (only.get('arg') as SelectorList).get('value')) {
          pushUnique(child as Selector);
        }
        continue;
      }
    }

    pushUnique(item);
  }

  if (flattened.length === list.get('value').length) {
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
      return [...(parentCopy as ComplexSelector).get('value')] as Selector[];
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
    return ((selector as SelectorList | ComplexSelector | CompoundSelector).get('value') as Selector[]).some(item => selectorHasAuthoredAmpersand(item));
  }

  if (isNode(selector, N.PseudoSelector)) {
    const arg = (selector as PseudoSelector).get('arg');
    if (arg && isNode(arg, N.Selector)) {
      return selectorHasAuthoredAmpersand(arg as Selector);
    }
  }

  return false;
}

/**
 * Apply an ampersand's template (suffix like `-1` or template like `.&-foo`)
 * to a resolved parent selector. Mirrors the logic in Ampersand.evalNode but
 * operates on the already-resolved replacement selector.
 */
function applyTemplate(resolved: Selector, template: string, inherit: Selector): Selector {
  const normalizedTemplate = template.replace(ampersandTemplateInterpolationRegex, 'x');
  if (!ampersandTemplateRegex.test(normalizedTemplate)) {
    throw new SyntaxError(`Invalid ampersand template "${template}"`);
  }

  const isTemplateMerge = template.includes('&');
  if (isTemplateMerge) {
    const isIdentJoinChar = (char: string | undefined): boolean =>
      !!char && /[a-zA-Z0-9_-]/.test(char);
    const assertValidTemplateJoin = (template: string, replacement: string): void => {
      if (!replacement) {
        return;
      }
      let searchFrom = 0;
      while (true) {
        const idx = template.indexOf('&', searchFrom);
        if (idx === -1) {
          break;
        }
        const before = idx > 0 ? template[idx - 1] : undefined;
        const after = idx < template.length - 1 ? template[idx + 1] : undefined;
        const first = replacement[0];
        const last = replacement[replacement.length - 1];
        const invalidHeadJoin = (first === '.' || first === '#') && isIdentJoinChar(before);
        const invalidTailJoin = (last === '.' || last === '#') && isIdentJoinChar(after);
        if (invalidHeadJoin || invalidTailJoin) {
          throw new SyntaxError(`Invalid ampersand merge template "${template}" with parent selector "${replacement}"`);
        }
        searchFrom = idx + 1;
      }
    };
    const applyTemplate = (sel: Selector): Selector => {
      const value = sel.toTrimmedString();
      assertValidTemplateJoin(template, value);
      return new BasicSelector(template.split('&').join(value)).inherit(inherit);
    };
    const distributeTemplate = (sel: Selector): Selector => {
      if (
        isNode(sel, N.PseudoSelector)
        && sel.generated
        && sel.get('name') === ':is'
        && isNode(sel.get('arg'), N.SelectorList)
      ) {
        return distributeTemplate(sel.get('arg') as Selector);
      }
      if (isNode(sel, N.SelectorList)) {
        const items = (sel as SelectorList).get('value').map(item => distributeTemplate(item as Selector));
        const result = SelectorList.create(
          items.flatMap(item => isNode(item, N.SelectorList) ? (item as SelectorList).get('value') : [item])
        ).inherit(inherit) as Selector;
        return result;
      }
      const selectorStr = sel.toTrimmedString();
      if (selectorStr.includes(',')) {
        const parts = selectorStr.split(',').map(s => s.trim()).filter(Boolean);
        const mapped = parts.map((part) => {
          assertValidTemplateJoin(template, part);
          return new BasicSelector(template.split('&').join(part)).inherit(inherit);
        });
        return mapped.length === 1 ? mapped[0]! : SelectorList.create(mapped).inherit(inherit) as Selector;
      }
      return applyTemplate(sel);
    };
    return distributeTemplate(resolved);
  }

  const doAppend = (n: Selector): void => {
    for (const s of n.nodes(true)) {
      if (isNode(s, N.SimpleSelector)) {
        if (isNode(s, N.BasicSelector)) {
          (s as BasicSelector).setData((s as BasicSelector).value + template);
          return;
        }
        throw new SyntaxError(`Cannot append "${template}" to this type of selector`);
      }
    }
    throw new SyntaxError(`Cannot append "${template}" to this type of selector`);
  };

  // Unwrap generated :is(SelectorList) so append distributes to all items
  let target = resolved;
  if (
    isNode(target, N.PseudoSelector)
    && target.generated
    && target.get('name') === ':is'
    && isNode(target.get('arg'), N.SelectorList)
  ) {
    target = target.get('arg') as Selector;
  }
  if (isNode(target, N.SelectorList)) {
    (target as SelectorList).get('value').forEach(item => doAppend(item as Selector));
  } else {
    doAppend(target);
  }
  resolved.hoistToRoot = true;
  return resolved;
}

function resolveAuthoredAmpersands(
  selector: Selector,
  parentSelector: Selector,
  atTopLevel: boolean = true
): Selector {
  if (isNode(selector, N.Ampersand)) {
    const template = (selector as Ampersand).template;
    if (isNode(template as Node | undefined, N.Nil)) {
      const nilResult = new Nil().inherit(selector) as unknown as Selector;
      (nilResult as unknown as Nil).hoistToRoot = true;
      return nilResult;
    }
    const replacement = getParentReplacementForAmpersand(parentSelector, true);
    let resolved = replacement.length === 1
      ? replacement[0]!
      : ComplexSelector.create(replacement as any).inherit(selector) as Selector;
    if (typeof template === 'string' && template) {
      resolved = applyTemplate(resolved, template, selector);
    }
    if (template !== undefined) {
      resolved.hoistToRoot = true;
    }
    return resolved;
  }

  if (isNode(selector, N.SelectorList)) {
    return SelectorList.create(
      (selector as SelectorList).get('value').map(item => resolveAuthoredAmpersands(item as Selector, parentSelector))
    ).inherit(selector) as Selector;
  }

  // CompoundSelector with leading bare & and ComplexSelector parent at top level:
  // Fuse parent's last part with compound suffix → * b[e] instead of :is(* b)[e]
  // Only at top level — inside a ComplexSelector (e.g. after +), keep :is() wrapping.
  if (atTopLevel && isNode(selector, N.CompoundSelector)) {
    const compoundData = (selector as CompoundSelector).get('value') as Selector[];
    if (
      compoundData.length >= 2
      && isNode(compoundData[0], N.Ampersand)
      && !compoundData[0]!.hasFlag(F_IMPLICIT_AMPERSAND)
      && (compoundData[0] as Ampersand).isPlainAmpersand()
      && isNode(parentSelector, N.ComplexSelector)
    ) {
      const parentParts = [...(parentSelector as ComplexSelector).get('value')] as Selector[];
      const remaining = compoundData.slice(1).map(d => resolveAuthoredAmpersands(d as Selector, parentSelector));
      const lastParentPart = parentParts[parentParts.length - 1]!.clone(false) as Selector;
      const fusedLast = CompoundSelector.create([lastParentPart, ...remaining] as any).inherit(selector) as Selector;
      const prefix = parentParts.slice(0, -1).map(p => p.clone(false) as Selector);
      if (prefix.length > 0) {
        return ComplexSelector.create([...prefix, fusedLast] as any).inherit(selector) as Selector;
      }
      return fusedLast;
    }
  }

  if (isNode(selector, N.ComplexSelector | N.CompoundSelector)) {
    const selectorData = (selector as ComplexSelector | CompoundSelector).get('value') as Selector[];
    const nextData: Selector[] = [];
    let hasAppendValue = false;
    const isCompound = isNode(selector, N.CompoundSelector);
    for (let i = 0; i < selectorData.length; i++) {
      const item = selectorData[i] as Selector;
      if (isNode(item, N.Ampersand) && !item.hasFlag(F_IMPLICIT_AMPERSAND)) {
        const template = (item as Ampersand).template;
        const atStart = !isCompound && i === 0;
        if (isNode(template as Node | undefined, N.Nil)) {
          hasAppendValue = true;
          continue;
        }
        const parts = getParentReplacementForAmpersand(parentSelector, atStart);
        if (typeof template === 'string' && template) {
          let resolved = parts.length === 1
            ? parts[0]!
            : ComplexSelector.create(parts as any).inherit(item) as Selector;
          resolved = applyTemplate(resolved, template, item);
          nextData.push(resolved);
          hasAppendValue = true;
        } else {
          nextData.push(...parts);
          if (template !== undefined) {
            hasAppendValue = true;
          }
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
        const compoundData = (item as CompoundSelector).get('value') as readonly Selector[];
        if (compoundData.length > 0 && isNode(compoundData[0], N.Ampersand) && !compoundData[0]!.hasFlag(F_IMPLICIT_AMPERSAND)) {
          const ampTemplate = (compoundData[0] as Ampersand).template;
          if (ampTemplate === undefined) {
            const parentParts = [...(parentSelector as ComplexSelector).get('value')] as Selector[];
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
      nextData.push(resolveAuthoredAmpersands(item, parentSelector, false));
    }
    // For compounds, sort type/element selectors before class/id/pseudo
    if (isCompound) {
      nextData.sort((a, b) => {
        const aIsTag = isNode(a, N.BasicSelector) && (a as BasicSelector).isTag ? 0 : 1;
        const bIsTag = isNode(b, N.BasicSelector) && (b as BasicSelector).isTag ? 0 : 1;
        return aIsTag - bIsTag;
      });
    }
    if (nextData.length === 0) {
      const nilResult = new Nil().inherit(selector) as unknown as Selector;
      (nilResult as unknown as Nil).hoistToRoot = hasAppendValue;
      return nilResult;
    }
    const ctor = !isCompound ? ComplexSelector : CompoundSelector;
    const result = ctor.create(nextData as any).inherit(selector) as Selector;
    if (hasAppendValue) {
      result.hoistToRoot = true;
    }
    return result;
  }

  if (isNode(selector, N.PseudoSelector)) {
    const arg = (selector as PseudoSelector).get('arg');
    if (arg && isNode(arg, N.Selector)) {
      const copy = (selector as PseudoSelector).copy(true) as PseudoSelector;
      copy.setData('arg', resolveAuthoredAmpersands(arg as Selector, parentSelector));
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
      ? [...(parentFragment as ComplexSelector).get('value')]
      : [parentFragment];

    if (!isNode((childCopy as ComplexSelector).get('value')[0], N.Combinator)) {
      nextData.push(Combinator.create(' '));
    }

    nextData.push(...(childCopy as ComplexSelector).get('value'));
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
  parent: Selector,
  collapseNesting: boolean = false
): Selector {
  if (isNode(selector, N.Nil)) {
    return selector;
  }

  const parentSelector = parent;
  if (!parentSelector || isNode(parentSelector, N.Nil)) {
    return selector.copy(true) as Selector;
  }

  if (
    !collapseNesting
    && isNode(selector, N.SelectorList)
    && (selector as SelectorList).get('value').some(item =>
      isNode(item, N.ComplexSelector) && (item as ComplexSelector).get('value').length > 1
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
    const next = (selector as SelectorList).get('value').map(item =>
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
    ? [...(wrappedParent as ComplexSelector).get('value')] as Selector[]
    : [wrappedParent];

  const stripParentPrefix = (route: Selector): Selector => {
    if (!isNode(route, N.ComplexSelector)) {
      return route.copy(true) as Selector;
    }

    const data = (route as ComplexSelector).get('value') as Selector[];
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
      (selector as SelectorList).get('value').map(item => stripParentPrefix(item as Selector))
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
    return (sel as SelectorList).get('value').some(item => item.hasFlag(F_EXTENDED));
  }
  return (sel as Selector).hasFlag(F_EXTENDED);
}
