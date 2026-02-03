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
import { isNode } from './is-node.js';
import { syncLog } from './__tests__/debug-log.js';

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

  // SelectorList: process each item; flatten any array returns
  if (isNode(selector, 'SelectorList')) {
    const list = selector as SelectorList;
    const out: Selector[] = [];
    let changed = false;
    for (const item of list.value) {
      const result = processLeadingIs(item, { inSelectorList: true });
      if (Array.isArray(result)) {
        out.push(...result);
        changed = true;
      } else {
        out.push(result);
        if (result !== item) changed = true;
      }
    }
    if (!changed) return selector;
    if (out.length === 1) return out[0]!;
    return SelectorList.create(out.map(s => s.copy(true) as Selector)).inherit(selector) as Selector;
  }

  // Single PseudoSelector :is, generated
  if (isNode(selector, 'PseudoSelector')) {
    const pseudo = selector as PseudoSelector;
    if (pseudo.value.name !== ':is' || !pseudo.generated) {
      return selector;
    }
    const arg = pseudo.value.arg as Selector | undefined;
    if (!arg) return selector;
    // :is(SelectorList): in list context merge; else return array for caller to handle
    if (isNode(arg, 'SelectorList')) {
      if (inSelectorList) {
        return arg.value.map(s => s.copy(true) as Selector);
      }
      // Top-level single :is(SelectorList): unwrap to the list (or single if one item)
      if (arg.value.length === 1) return arg.value[0]!.copy(true) as Selector;
      return SelectorList.create(arg.value.map(s => s.copy(true) as Selector)).inherit(selector) as Selector;
    }
    // :is(not list): unwrap to the single selector
    return arg.copy(true) as Selector;
  }

  // CompoundSelector: first component is generated :is (arg not list) → merge suffix into last part of :is, return ComplexSelector.
  // GCD of complex + compound is complex (e.g. parent * b + &[e] → * b[e]), so we unwrap to that shape.
  if (isNode(selector, 'CompoundSelector')) {
    const compound = selector as CompoundSelector;
    const value = compound.value;
    if (value.length === 0) return selector;
    const first = value[0];
    if (process.env.DEBUG_LEADING_IS_GENERATED === 'true' && isNode(first, 'PseudoSelector') && (first as PseudoSelector).value.name === ':is') {
      const g = (first as PseudoSelector).generated;
      syncLog({ msg: 'processLeadingIs-compound-first', generated: g });
    }
    if (
      !isNode(first, 'PseudoSelector') ||
      (first as PseudoSelector).value.name !== ':is' ||
      !(first as PseudoSelector).generated
    ) {
      return selector;
    }
    const arg = (first as PseudoSelector).value.arg as Selector | undefined;
    if (!arg || isNode(arg, 'SelectorList')) return selector;

    const suffix = value.slice(1).map(s => (s as Selector).copy(true));
    if (suffix.length === 0) {
      return arg.copy(true) as Selector;
    }

    // Merge suffix into last component of arg (complex or compound)
    if (isNode(arg, 'ComplexSelector')) {
      const complex = arg as ComplexSelector;
      const comps = complex.value.slice().map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
      for (let i = comps.length - 1; i >= 0; i--) {
        const c = comps[i]!;
        if (isNode(c, 'Combinator')) continue;
        if (isNode(c, 'CompoundSelector')) {
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
    if (isNode(arg, 'CompoundSelector')) {
      const newCompound = (arg as CompoundSelector).value.slice().map(s => (s as Selector).copy(true));
      newCompound.push(...suffix);
      return CompoundSelector.create(newCompound).inherit(selector) as Selector;
    }
    const newCompound = CompoundSelector.create([
      arg.copy(true),
      ...suffix
    ]).inherit(selector);
    return ComplexSelector.create([newCompound as ComplexSelectorComponent]).inherit(selector) as Selector;
  }

  // ComplexSelector: first visual component is generated :is (arg not list) → unwrap into complex
  if (isNode(selector, 'ComplexSelector')) {
    const complex = selector as ComplexSelector;
    const value = complex.value;
    let firstSelIndex = -1;
    for (let i = 0; i < value.length; i++) {
      if (!isNode(value[i], 'Combinator')) {
        firstSelIndex = i;
        break;
      }
    }
    if (firstSelIndex < 0) return selector;
    const first = value[firstSelIndex];
    if (
      !isNode(first, 'PseudoSelector') ||
      (first as PseudoSelector).value.name !== ':is' ||
      !(first as PseudoSelector).generated
    ) {
      return selector;
    }
    const arg = (first as PseudoSelector).value.arg as Selector | undefined;
    if (!arg || isNode(arg, 'SelectorList')) return selector;

    if (isNode(arg, 'ComplexSelector')) {
      const argComps = (arg as ComplexSelector).value.slice().map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
      const rest = value.slice(firstSelIndex + 1).map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
      const newValue = [...argComps, ...rest];
      return ComplexSelector.create(newValue).inherit(selector) as Selector;
    }
    const rest = value.slice(firstSelIndex + 1).map(c => (c as Selector).copy(true) as ComplexSelectorComponent);
    const newValue = [arg.copy(true) as ComplexSelectorComponent, ...rest];
    return ComplexSelector.create(newValue).inherit(selector) as Selector;
  }

  return selector;
}
