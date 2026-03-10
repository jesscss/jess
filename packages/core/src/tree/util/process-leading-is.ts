/**
 * Centralized unwrapping of generated :is() pseudo-selectors when they are
 * the "first visual" selector (leading). Used after ruleset eval and in
 * extend post-processing. Does NOT recurse into pseudo args; callers that
 * need to process pseudo args (e.g. extend) call processLeadingIs for each
 * selector they care about, including args of :is/:where at processing time.
 */

import type { Selector } from '../selector.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector, type ComplexSelectorComponent } from '../selector-complex.js';
import { CompoundSelector } from '../selector-compound.js';
import { PseudoSelector } from '../selector-pseudo.js';
import { Ampersand } from '../ampersand.js';
import { F_IMPLICIT_AMPERSAND, type Node } from '../node.js';
import { Nil } from '../nil.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

export type ProcessLeadingIsOptions = {
  /** When true, unwrapping a generated :is(SelectorList) merges its items into the outer list (return array). */
  inSelectorList?: boolean;
};

/**
 * Unwrap a generated :is() that is the first visual selector, when safe.
 * - If selector is a SelectorList: process each item with inSelectorList=true; flatten any array returns.
 * - If selector is a single generated :is(): when inSelectorList and arg is SelectorList, return arg.value (array); else return arg.
 * - If first visual component of a CompoundSelector is generated :is (arg not SelectorList): merge :is arg's last part with compound suffix into a new ComplexSelector.
 * - If first visual component of a ComplexSelector is generated :is (arg not SelectorList): unwrap into the complex's components.
 *
 * Does NOT recurse into pseudo-selector args. Only considers the outer selector structure.
 *
 * @returns The processed selector, or an array of selectors when unwrapping :is(SelectorList) in list context (caller merges into list).
 */
export function processLeadingIs(
  selector: Selector,
  options: ProcessLeadingIsOptions = {}
): Selector | Selector[] {
  const { inSelectorList = false } = options;

  const getFirstVisualIndex = (items: ComplexSelectorComponent[]): number => {
    for (let i = 0; i < items.length; i++) {
      if (!isNode(items[i], N.Combinator)) {
        return i;
      }
    }
    return -1;
  };

  const getImplicitAmpPrefix = (complex: ComplexSelector): string | null => {
    for (const part of complex.value) {
      if (isNode(part, N.Ampersand) && (part as unknown as Node).hasFlag(F_IMPLICIT_AMPERSAND)) {
        const resolved = (part as Ampersand).getResolvedSelector();
        return resolved && !(resolved instanceof Nil) ? resolved.valueOf() : null;
      }
    }
    return null;
  };

  const hasEscapedQuoted = (node: Node | undefined, seen = new Set<Node>()): boolean => {
    if (!node || seen.has(node)) {
      return false;
    }
    seen.add(node);
    if (isNode(node, N.Quoted) && Boolean(node.options?.escaped)) {
      return true;
    }
    const value = (node as unknown as { value?: unknown }).value;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && 'type' in (item as Record<string, unknown>)) {
          if (hasEscapedQuoted(item as Node, seen)) {
            return true;
          }
        }
      }
      return false;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) {
        if (item && typeof item === 'object' && 'type' in (item as Record<string, unknown>)) {
          if (hasEscapedQuoted(item as Node, seen)) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const stripImplicitPrefixFromItem = (item: Selector, implicitAmpPrefix: string): Selector => {
    if (!isNode(item, N.ComplexSelector)) {
      return item.copy(true) as Selector;
    }
    const itemComplex = item as ComplexSelector;
    const firstVisualIndex = getFirstVisualIndex(itemComplex.value);
    if (firstVisualIndex < 0) {
      return item.copy(true) as Selector;
    }
    const firstVisual = itemComplex.value[firstVisualIndex] as Selector;
    if (firstVisual.valueOf() !== implicitAmpPrefix) {
      return item.copy(true) as Selector;
    }
    let start = firstVisualIndex + 1;
    if (start < itemComplex.value.length && isNode(itemComplex.value[start], N.Combinator)) {
      start++;
    }
    const tail = itemComplex.value.slice(start).map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
    if (tail.length === 1 && !isNode(tail[0], N.Combinator)) {
      return tail[0] as Selector;
    }
    if (tail.length > 1) {
      return ComplexSelector.create(tail).inherit(itemComplex) as Selector;
    }
    return item.copy(true) as Selector;
  };

  // SelectorList: process each item; merge list results (array or SelectorList) into one list.
  if (isNode(selector, N.SelectorList)) {
    const list = selector as SelectorList;
    const out: Selector[] = [];
    let changed = false;
    for (const item of list.value) {
      const result = processLeadingIs(item, { inSelectorList: true });
      if (Array.isArray(result)) {
        out.push(...result);
        changed = true;
      } else if (isNode(result, N.SelectorList)) {
        out.push(...(result as SelectorList).value.map(s => s.copy(true) as Selector));
        changed = true;
      } else {
        out.push(result);
        if (result !== item) {
          changed = true;
        }
      }
    }
    if (!changed) {
      return selector;
    }
    if (out.length === 1) {
      return out[0]!;
    }
    return SelectorList.create(out.map(s => s.copy(true) as Selector)).inherit(selector) as Selector;
  }

  // Single PseudoSelector :is, generated
  if (isNode(selector, N.PseudoSelector)) {
    const pseudo = selector as PseudoSelector;
    if (pseudo.value.name !== ':is' || !pseudo.generated) {
      return selector;
    }
    const arg = pseudo.value.arg as Selector | undefined;
    if (!arg) {
      return selector;
    }
    if (hasEscapedQuoted(arg)) {
      return selector;
    }
    // :is(SelectorList): in list context merge; else return array for caller to handle
    if (isNode(arg, N.SelectorList)) {
      if (inSelectorList) {
        return arg.value.map(s => s.copy(true) as Selector);
      }
      // Top-level single :is(SelectorList): unwrap to the list (or single if one item)
      if (arg.value.length === 1) {
        return arg.value[0]!.copy(true) as Selector;
      }
      return SelectorList.create(arg.value.map(s => s.copy(true) as Selector)).inherit(selector) as Selector;
    }
    // :is(not list): unwrap to the single selector
    return arg.copy(true) as Selector;
  }

  // CompoundSelector: first component is generated :is (arg not list) → merge suffix into last part of :is, return ComplexSelector.
  // GCD of complex + compound is complex (e.g. parent * b + &[e] → * b[e]), so we unwrap to that shape.
  if (isNode(selector, N.CompoundSelector)) {
    const compound = selector as CompoundSelector;
    const value = compound.value;
    if (value.length === 0) {
      return selector;
    }
    const first = value[0];
    if (
      !isNode(first, N.PseudoSelector)
      || (first as PseudoSelector).value.name !== ':is'
      || !(first as PseudoSelector).generated
    ) {
      return selector;
    }
    const arg = (first as PseudoSelector).value.arg as Selector | undefined;
    if (!arg) {
      return selector;
    }
    if (hasEscapedQuoted(arg)) {
      return selector;
    }
    const normalizedArg = isNode(arg, N.SelectorList) && arg.value.length === 1
      ? (arg.value[0]! as Selector)
      : arg;
    if (isNode(normalizedArg, N.SelectorList)) {
      const suffix = value.slice(1).map(s => (s as Selector).copy(true));
      if (suffix.length === 0) {
        return SelectorList.create(normalizedArg.value.map(s => s.copy(true) as Selector)).inherit(selector) as Selector;
      }
      // Keep :is(list).suffix (e.g. :is(.one,.two).three) as one selector.
      return selector;
    }

    const suffix = value.slice(1).map(s => (s as Selector).copy(true));
    if (suffix.length === 0) {
      return arg.copy(true) as Selector;
    }

    // Merge suffix into last component of arg (complex or compound)
    if (isNode(normalizedArg, N.ComplexSelector)) {
      const complex = normalizedArg as ComplexSelector;
      const comps = complex.value.slice().map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
      for (let i = comps.length - 1; i >= 0; i--) {
        const c = comps[i]!;
        if (isNode(c, N.Combinator)) {
          continue;
        }
        if (isNode(c, N.CompoundSelector)) {
          const compound = c as CompoundSelector;
          const newCompound = CompoundSelector.create([
            ...compound.value.map(s => (s as Selector).copy(true)),
            ...suffix
          ]).inherit(compound);
          comps[i] = newCompound as ComplexSelectorComponent;
          break;
        }
        comps[i] = CompoundSelector.create([
          (c as Selector).copy(true),
          ...suffix
        ]) as ComplexSelectorComponent;
        break;
      }
      return ComplexSelector.create(comps).inherit(selector) as Selector;
    }
    if (isNode(normalizedArg, N.CompoundSelector)) {
      const newCompound = (normalizedArg as CompoundSelector).value.slice().map(s => (s as Selector).copy(true));
      newCompound.push(...suffix);
      return CompoundSelector.create(newCompound).inherit(selector) as Selector;
    }
    const newCompound = CompoundSelector.create([
      normalizedArg.copy(true),
      ...suffix
    ]).inherit(selector);
    return ComplexSelector.create([newCompound as ComplexSelectorComponent]).inherit(selector) as Selector;
  }

  // ComplexSelector: first visual component is generated :is (arg not list) → unwrap into complex
  if (isNode(selector, N.ComplexSelector)) {
    const complex = selector as ComplexSelector;
    const implicitAmpPrefix = getImplicitAmpPrefix(complex);
    if (implicitAmpPrefix) {
      let changed = false;
      const outComponents: ComplexSelectorComponent[] = [];
      for (const part of complex.value) {
        if (isNode(part, N.PseudoSelector) && part.value.name === ':is' && part.generated) {
          const arg = part.value.arg;
          if (arg && hasEscapedQuoted(arg as Node)) {
            outComponents.push((part as Selector).copy(true) as ComplexSelectorComponent);
            continue;
          }
          if (arg && isNode(arg, N.SelectorList)) {
            const normalizedArgs = arg.value.map((item) => {
              const normalized = stripImplicitPrefixFromItem(item as Selector, implicitAmpPrefix);
              if (normalized.valueOf() !== (item as Selector).valueOf()) {
                changed = true;
              }
              return normalized;
            });
            let nonCombinatorCount = 0;
            let hasImplicitAmpPart = false;
            for (const c of complex.value) {
              if (!isNode(c, N.Combinator)) {
                nonCombinatorCount++;
                if (isNode(c, N.Ampersand) && (c as unknown as Node).hasFlag(F_IMPLICIT_AMPERSAND)) {
                  hasImplicitAmpPart = true;
                }
              }
            }
            // `& :is(list)` under collapse should serialize as list headers.
            if (nonCombinatorCount === 2 && hasImplicitAmpPart) {
              return SelectorList.create(normalizedArgs).inherit(selector) as Selector;
            }
            const list = SelectorList.create(normalizedArgs).inherit(arg);
            outComponents.push(...list.value.map(s => s.copy(true) as ComplexSelectorComponent));
            changed = true;
            continue;
          }
        }
        outComponents.push((part as Selector).copy(true) as ComplexSelectorComponent);
      }
      if (changed) {
        if (outComponents.length === 1 && !isNode(outComponents[0], N.Combinator)) {
          return outComponents[0] as Selector;
        }
        return ComplexSelector.create(outComponents).inherit(selector) as Selector;
      }
    }

    const value = complex.value;
    const firstSelIndex = getFirstVisualIndex(value);
    if (firstSelIndex < 0) {
      return selector;
    }
    const first = value[firstSelIndex];
    if (
      isNode(first, N.CompoundSelector)
      && isNode((first as CompoundSelector).value?.[0] as any, N.PseudoSelector)
      && ((first as CompoundSelector).value?.[0] as PseudoSelector).value.name === ':is'
      && ((first as CompoundSelector).value?.[0] as PseudoSelector).generated
    ) {
      const unwrappedFirst = processLeadingIs(first as Selector, { inSelectorList: false });
      if (!Array.isArray(unwrappedFirst)) {
        const prefix = value
          .slice(0, firstSelIndex)
          .map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
        const rest = value
          .slice(firstSelIndex + 1)
          .map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
        const unwrappedComps = isNode(unwrappedFirst, N.ComplexSelector)
          ? (unwrappedFirst as ComplexSelector).value.map(c => (c as Selector).copy(true) as ComplexSelectorComponent)
          : [unwrappedFirst.copy(true) as ComplexSelectorComponent];
        return ComplexSelector.create([
          ...prefix,
          ...unwrappedComps,
          ...rest
        ]).inherit(selector) as Selector;
      }
    }
    if (
      !isNode(first, N.PseudoSelector)
      || (first as PseudoSelector).value.name !== ':is'
      || !(first as PseudoSelector).generated
    ) {
      return selector;
    }
    const arg = (first as PseudoSelector).value.arg as Selector | undefined;
    if (!arg) {
      return selector;
    }
    if (hasEscapedQuoted(arg)) {
      return selector;
    }
    const normalizedArg = isNode(arg, N.SelectorList) && arg.value.length === 1
      ? (arg.value[0]! as Selector)
      : arg;
    if (isNode(normalizedArg, N.SelectorList)) {
      const rest = value.slice(firstSelIndex + 1).map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
      // Keep :is(list) when there is a suffix (e.g. :is(.one,.two) .three) so it serializes as one selector.
      if (rest.length > 0) {
        return selector;
      }
      const expanded: Selector[] = normalizedArg.value.map((item) => {
        if (isNode(item, N.ComplexSelector)) {
          return ComplexSelector.create([
            ...(item as ComplexSelector).value.map(c => (c as Selector).copy(true) as ComplexSelectorComponent),
            ...rest
          ]).inherit(selector) as Selector;
        }
        if (rest.length === 0) {
          return (item as Selector).copy(true) as Selector;
        }
        return ComplexSelector.create([
          (item as Selector).copy(true) as ComplexSelectorComponent,
          ...rest
        ]).inherit(selector) as Selector;
      });
      if (expanded.length === 1) {
        return expanded[0]!;
      }
      return SelectorList.create(expanded).inherit(selector) as Selector;
    }

    if (isNode(normalizedArg, N.ComplexSelector)) {
      const argComplex = normalizedArg as ComplexSelector;
      const rest = value.slice(firstSelIndex + 1);
      const argComps = argComplex.value.slice().map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
      const restComps = rest.map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
      const newValue = [...argComps, ...restComps];
      return ComplexSelector.create(newValue).inherit(selector) as Selector;
    }
    const rest = value.slice(firstSelIndex + 1).map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
    const newValue = [normalizedArg.copy(true) as ComplexSelectorComponent, ...rest];
    return ComplexSelector.create(newValue).inherit(selector) as Selector;
  }

  return selector;
}
