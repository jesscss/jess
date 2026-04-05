import { Selector } from '../selector.js';
import { Combinator } from '../combinator.js';
import { ComplexSelector } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { SelectorList } from '../selector-list.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { BasicSelector } from '../selector-basic.js';
import { AMPERSAND_TEMPLATE_CONTENTS_REGEX } from './ampersand-template.js';
import type { Rules } from '../rules.js';
import type { Ruleset } from '../ruleset.js';
import type { Node, RenderKey } from '../node.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { F_IMPLICIT_AMPERSAND, F_EXTENDED } from '../node.js';
import type { Context } from '../../context.js';
import { getParent } from './field-helpers.js';
import { getParentEdge } from './cursor.js';
import { activeExtendWorkCounters } from './extend-work-counters.js';

const ampersandTemplateInterpolationRegex = /[$@]\{[^}]+\}/g;
const ampersandTemplateRegex = new RegExp(`^(?:${AMPERSAND_TEMPLATE_CONTENTS_REGEX.source})$`);
const sourceExtendWrapperParentCache = new WeakMap<readonly Node[], boolean>();

function getSelectorListArgNode(target: Selector): SelectorList | undefined {
  const arg = (target as Selector & { arg?: unknown }).arg;
  return isNode(arg, N.SelectorList) ? arg : undefined;
}

function getPseudoSelectorNode(node: Selector): PseudoSelector | undefined {
  return isNode(node, N.PseudoSelector) ? node : undefined;
}

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
    return sel.isPlainAmpersand();
  }
  if (isNode(sel, N.CompoundSelector)) {
    const items = sel.value;
    return items.length === 1
      && isNode(items[0], N.Ampersand)
      && items[0].isPlainAmpersand();
  }
  if (isNode(sel, N.ComplexSelector)) {
    const items = sel.value;
    return items.length === 1
      && isNode(items[0], N.Ampersand)
      && items[0].isPlainAmpersand();
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
    let pseudo = getPseudoSelectorNode(item);
    if (pseudo && !(pseudo.generated && pseudo.name === ':is')) {
      pseudo = undefined;
    }
    if (!pseudo) {
      const compound = isNode(item, N.CompoundSelector) ? item : undefined;
      if (compound && compound.value.length === 1) {
        const only = compound.value[0];
        pseudo = isNode(only, N.PseudoSelector) ? only : undefined;
        if (!(pseudo && pseudo.generated && pseudo.name === ':is')) {
          pseudo = undefined;
        }
      }
    }
    const pseudoArg = pseudo ? getSelectorListArgNode(pseudo) : undefined;
    if (pseudoArg) {
      for (const child of pseudoArg.value) {
        addItem(child);
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
    for (const item of selector.value) {
      addItem(item);
    }
  } else {
    addItem(selector);
  }

  if (items.length === 1) {
    return items[0]!;
  }

  const list = SelectorList.create(items).inherit(selector);
  list.pre = undefined;
  list.post = undefined;
  const wrapper = PseudoSelector.create({ name: ':is', arg: list });
  wrapper.generated = true;
  return wrapper.inherit(selector);
}

/** Walk node.parent → Rules → Ruleset to find the containing Ruleset, if any. */
export function getCurrentParentNode(node: Node, context?: Context | RenderKey): Node | undefined {
  if (context && typeof context !== 'object') {
    return getParentEdge({ node, renderKey: context })?.node;
  }
  return context ? getParent(node, context) : node.parent;
}

/** Walk node.parent → Rules → Ruleset to find the containing Ruleset, if any. */
export function getParentRuleset(node: Node, context?: Context): Ruleset | undefined {
  const visited = new Set<Node>();
  let current = getCurrentParentNode(node, context);

  while (current && !visited.has(current)) {
    if (isNode(current, N.Ruleset)) {
      return current;
    }
    visited.add(current);
    current = getCurrentParentNode(current, context);
  }

  return undefined;
}

export function hasSourceExtendWrapperParent(node: Node): boolean {
  const parent = node.parent;
  if (!isNode(parent, N.Rules)) {
    return false;
  }

  const sourceRules = isNode(parent.sourceNode, N.Rules)
    ? parent.sourceNode as Rules
    : parent;
  const sourceChildren = sourceRules.value;
  const cached = sourceExtendWrapperParentCache.get(sourceChildren);
  if (cached !== undefined) {
    return cached;
  }

  let sawExtend = false;
  let sawRuleset = false;
  for (const child of sourceChildren) {
    if (isNode(child, N.Extend)) {
      sawExtend = true;
    } else if (isNode(child, N.Ruleset)) {
      sawRuleset = true;
    }
    if (sawExtend && sawRuleset) {
      sourceExtendWrapperParentCache.set(sourceChildren, true);
      return true;
    }
  }

  sourceExtendWrapperParentCache.set(sourceChildren, false);
  return false;
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
      const arg = item.arg;
      if (isNode(arg, N.SelectorList)) {
        for (const child of arg.value) {
          pushUnique(child);
        }
      }
      continue;
    }

    if (isNode(item, N.CompoundSelector) && item.value.length === 1) {
      const only = item.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is' && isNode(only.arg, N.SelectorList)) {
        const arg = only.arg;
        if (isNode(arg, N.SelectorList)) {
          for (const child of arg.value) {
            pushUnique(child);
          }
        }
        continue;
      }
    }

    if (isNode(item, N.ComplexSelector) && item.value.length === 1) {
      const only = item.value[0]!;
      if (isNode(only, N.PseudoSelector) && only.name === ':is' && isNode(only.arg, N.SelectorList)) {
        const arg = only.arg;
        if (isNode(arg, N.SelectorList)) {
          for (const child of arg.value) {
            pushUnique(child);
          }
        }
        continue;
      }
    }

    pushUnique(item);
  }

  if (flattened.length === list.value.length) {
    return list;
  }

  return SelectorList.create(flattened).inherit(list);
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
  _collapseNesting: boolean = false
): Selector {
  let parentCopy = parentSelector.copy(true);
  if (isNode(parentCopy, N.SelectorList)) {
    parentCopy = flattenSelectorListAlternatives(parentCopy);
  }
  if (isNode(parentCopy, N.ComplexSelector)) {
    const requiresGrouping = parentCopy.value.some(
      part => isNode(part, N.Combinator) && part.valueOf() !== ' '
    );
    if (requiresGrouping) {
      const wrapped = PseudoSelector.create({ name: ':is', arg: parentCopy });
      wrapped.generated = true;
      return wrapped;
    }
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
  const parentCopy = parentSelector.copy(true);

  if (isNode(parentCopy, N.SelectorList)) {
    return [wrapParentSelectorForNestedContext(parentCopy)];
  }

  if (isNode(parentCopy, N.ComplexSelector)) {
    if (atStart) {
      return [...parentCopy.value];
    }

    const wrapped = PseudoSelector.create({
      name: ':is',
      arg: parentCopy
    });
    wrapped.generated = true;
    return [wrapped];
  }

  return [parentCopy];
}

export function selectorHasAuthoredAmpersand(selector: Selector): boolean {
  if (isNode(selector, N.Ampersand)) {
    return !selector.hasFlag(F_IMPLICIT_AMPERSAND);
  }

  if (isNode(selector, N.SelectorList | N.ComplexSelector | N.CompoundSelector)) {
    return selector.value.some(item => selectorHasAuthoredAmpersand(item));
  }

  if (isNode(selector, N.PseudoSelector)) {
    const arg = (selector as PseudoSelector).arg;
    if (arg && isNode(arg, N.Selector)) {
      return selectorHasAuthoredAmpersand(arg);
    }
  }

  return false;
}

function selectorContainsGeneratedIs(selector: Selector): boolean {
  if (isNode(selector, N.PseudoSelector)) {
    return selector.generated && selector.name === ':is';
  }

  if (isNode(selector, N.SelectorList | N.ComplexSelector | N.CompoundSelector)) {
    return selector.value.some(item => selectorContainsGeneratedIs(item));
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
  if (normalizedTemplate === 'nil' || !ampersandTemplateRegex.test(normalizedTemplate)) {
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
        && sel.name === ':is'
        && isNode(sel.arg, N.SelectorList)
      ) {
        const arg = sel.arg;
        return isNode(arg, N.Selector) ? distributeTemplate(arg) : sel;
      }
      if (isNode(sel, N.SelectorList)) {
        const items = sel.value.map(item => distributeTemplate(item));
        const result = SelectorList.create(
          items.flatMap(item => isNode(item, N.SelectorList) ? item.value : [item])
        ).inherit(inherit);
        return result;
      }
      const selectorStr = sel.toTrimmedString();
      if (selectorStr.includes(',')) {
        const parts = selectorStr.split(',').map(s => s.trim()).filter(Boolean);
        const mapped = parts.map((part) => {
          assertValidTemplateJoin(template, part);
          return new BasicSelector(template.split('&').join(part)).inherit(inherit);
        });
        return mapped.length === 1 ? mapped[0]! : SelectorList.create(mapped).inherit(inherit);
      }
      return applyTemplate(sel);
    };
    return distributeTemplate(resolved);
  }

  const doAppend = (n: Selector): void => {
    for (const s of n.nodes(true)) {
      if (isNode(s, N.SimpleSelector)) {
        if (isNode(s, N.BasicSelector)) {
          (s as BasicSelector).value = (s as BasicSelector).value + template;
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
    && target.name === ':is'
    && isNode(target.arg, N.SelectorList)
  ) {
    const arg = target.arg;
    if (isNode(arg, N.Selector)) {
      target = arg;
    }
  }
  if (isNode(target, N.SelectorList)) {
    target.value.forEach(item => doAppend(item));
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
    const template = selector.template;
    if (template instanceof Nil) {
      const nilResult = new Nil().inherit(selector);
      nilResult.hoistToRoot = true;
      return nilResult;
    }
    const replacement = getParentReplacementForAmpersand(parentSelector, true);
    let resolved = replacement.length === 1
      ? replacement[0]!
      : ComplexSelector.create(replacement).inherit(selector);
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
      selector.value.map(item => resolveAuthoredAmpersands(item, parentSelector))
    ).inherit(selector);
  }

  // CompoundSelector with leading bare & and ComplexSelector parent at top level:
  // Fuse parent's last part with compound suffix → * b[e] instead of :is(* b)[e]
  // Only at top level — inside a ComplexSelector (e.g. after +), keep :is() wrapping.
  if (atTopLevel && isNode(selector, N.CompoundSelector)) {
    const compoundData = selector.value;
    if (
      compoundData.length >= 2
      && isNode(compoundData[0], N.Ampersand)
      && !compoundData[0]!.hasFlag(F_IMPLICIT_AMPERSAND)
      && compoundData[0].isPlainAmpersand()
      && isNode(parentSelector, N.ComplexSelector)
    ) {
      const parentParts = [...parentSelector.value];
      const remaining = compoundData.slice(1).map(d => resolveAuthoredAmpersands(d, parentSelector));
      const lastParentPart = parentParts[parentParts.length - 1]!.clone(false);
      const fusedLast = CompoundSelector.create([lastParentPart, ...remaining]).inherit(selector);
      const prefix = parentParts.slice(0, -1).map(p => p.clone(false));
      if (prefix.length > 0) {
        return ComplexSelector.create([...prefix, fusedLast]).inherit(selector);
      }
      return fusedLast;
    }
  }

  if (isNode(selector, N.ComplexSelector | N.CompoundSelector)) {
    const selectorData = selector.value;
    const nextData: Selector[] = [];
    let hasAppendValue = false;
    const isCompound = isNode(selector, N.CompoundSelector);
    for (let i = 0; i < selectorData.length; i++) {
      const item = selectorData[i];
      if (isNode(item, N.Ampersand) && !item.hasFlag(F_IMPLICIT_AMPERSAND)) {
        const template = item.template;
        const atStart = !isCompound && i === 0;
        if (template instanceof Nil) {
          hasAppendValue = true;
          continue;
        }
        const parts = getParentReplacementForAmpersand(parentSelector, atStart);
        if (typeof template === 'string' && template) {
          let resolved = parts.length === 1
            ? parts[0]!
            : ComplexSelector.create(parts).inherit(item);
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
        const compoundData = item.value;
        if (compoundData.length > 0 && isNode(compoundData[0], N.Ampersand) && !compoundData[0]!.hasFlag(F_IMPLICIT_AMPERSAND)) {
          const ampTemplate = compoundData[0].template;
          if (ampTemplate === undefined) {
            const parentParts = [...parentSelector.value];
            const remaining = compoundData.slice(1).map(d => resolveAuthoredAmpersands(d, parentSelector));
            const lastParentPart = parentParts[parentParts.length - 1]!.copy(true);
            const compoundItems = [lastParentPart, ...remaining];
            const fusedLast = CompoundSelector.create(compoundItems).inherit(item);
            const prefix = parentParts.slice(0, -1).map(p => p.copy(true));
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
        const aIsTag = isNode(a, N.BasicSelector) && a.isTag ? 0 : 1;
        const bIsTag = isNode(b, N.BasicSelector) && b.isTag ? 0 : 1;
        return aIsTag - bIsTag;
      });
    }
    if (nextData.length === 0) {
      const nilResult = new Nil().inherit(selector);
      nilResult.hoistToRoot = hasAppendValue;
      return nilResult;
    }
    const ctor = !isCompound ? ComplexSelector : CompoundSelector;
    const result = ctor.create(nextData).inherit(selector);
    if (hasAppendValue) {
      result.hoistToRoot = true;
    }
    return result;
  }

  if (isNode(selector, N.PseudoSelector)) {
    const arg = selector.arg;
    if (arg && isNode(arg, N.Selector)) {
      const copy = selector.copy(true);
      const nextArg = resolveAuthoredAmpersands(arg, parentSelector);
      copy.adopt(nextArg);
      copy.arg = nextArg;
      return copy;
    }
  }

  return selector.copy(true);
}

function composeSelectorRouteWithParent(
  selector: Selector,
  parentSelector: Selector
): Selector {
  if (activeExtendWorkCounters) {
    activeExtendWorkCounters.selectorCompositionCalls++;
  }
  const childCopy = selector.copy(true);
  if (selectorHasAuthoredAmpersand(childCopy)) {
    return resolveAuthoredAmpersands(childCopy, parentSelector);
  }
  const parentParts = getParentReplacementForAmpersand(parentSelector, true);

  if (isNode(childCopy, N.ComplexSelector)) {
    const nextData = [...parentParts];

    if (!isNode(childCopy.value[0], N.Combinator)) {
      nextData.push(Combinator.create(' '));
    }

    nextData.push(...childCopy.value);
    return ComplexSelector.create(nextData).inherit(selector);
  }

  return ComplexSelector.create([
    ...parentParts,
    Combinator.create(' '),
    childCopy
  ]).inherit(selector);
}

/**
 * Composes a selector with its parent selector without inserting implicit
 * ampersands or relying on later `:is(...)` cleanup passes.
 *
 * The historical `getImplicitSelector()` name is kept for compatibility with
 * callers and tests, but the implementation is now pure selector composition.
 *
 * - Start-position parent composition follows the same rule as authored `&`:
 *   selector-list parents stay one fragment via generated `:is(...)`, while
 *   non-list parents splice directly.
 * - Selector-list children keep their list shape after composition.
 * - Selector-list children containing complex items are grouped under one
 *   generated `:is(...)` before the parent is composed so the common parent
 *   stays shared.
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
    return selector.copy(true);
  }

  if (isNode(selector, N.SelectorList)) {
    const shouldGroupSelectorListBeforeComposition = (
      !selectorHasAuthoredAmpersand(selector)
      && (
        !collapseNesting
          ? selector.value.some(item =>
              isNode(item, N.ComplexSelector) && item.value.length > 1
            )
          : (
              !isNode(parentSelector, N.SelectorList)
              && !selectorContainsGeneratedIs(parentSelector)
            )
      )
    );

    if (shouldGroupSelectorListBeforeComposition) {
      const grouped = PseudoSelector.create({
        name: ':is',
        arg: selector.copy(true)
      });
      grouped.generated = true;
      selector = composeSelectorRouteWithParent(grouped, parentSelector);
      if (collapseNesting) {
        selector.hoistToRoot = true;
      }
      return selector;
    }

    const next = selector.value.map(item =>
      composeSelectorRouteWithParent(item, parentSelector)
    );
    const list = SelectorList.create(next).inherit(selector);
    if (collapseNesting) {
      list.hoistToRoot = true;
    }
    return list;
  }

  selector = composeSelectorRouteWithParent(selector, parentSelector);

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
    ? [...wrappedParent.value]
    : [wrappedParent];

  const stripParentPrefix = (route: Selector): Selector => {
    if (!isNode(route, N.ComplexSelector)) {
      return route.copy(true);
    }

    const data = route.value;
    if (data.length <= parentPrefix.length) {
      return route.copy(true);
    }

    for (let i = 0; i < parentPrefix.length; i++) {
      if (data[i]!.valueOf() !== parentPrefix[i]!.valueOf()) {
        return route.copy(true);
      }
    }

    const next = data[parentPrefix.length];
    if (!isNode(next, N.Combinator) || next.valueOf() !== ' ') {
      return route.copy(true);
    }

    const remainder = data.slice(parentPrefix.length + 1).map(node => node.copy(true));
    if (remainder.length === 0) {
      return route.copy(true);
    }
    if (remainder.length === 1) {
      return remainder[0]!;
    }
    return ComplexSelector.create(remainder).inherit(route);
  };

  if (isNode(selector, N.SelectorList)) {
    return SelectorList.create(
      selector.value.map(item => stripParentPrefix(item))
    ).inherit(selector);
  }

  return stripParentPrefix(selector);
}

/** Returns true if the selector (or any top-level SelectorList item) has F_EXTENDED. */
export function hasExtendedSelector(sel: Selector | Nil | undefined, context?: Context): boolean {
  if (!sel || sel instanceof Nil) {
    return false;
  }
  if (isNode(sel, N.SelectorList)) {
    return sel.value.some(item =>
      context ? item._hasFlag(F_EXTENDED, context) : item.hasFlag(F_EXTENDED)
    );
  }
  return context
    ? sel._hasFlag(F_EXTENDED, context)
    : sel.hasFlag(F_EXTENDED);
}
