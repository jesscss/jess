import type { Rules } from '../rules.js';
import type { AtRule } from '../at-rule.js';
import { isNode } from './is-node.js';
import type { Context } from '../../context.js';
import type { Ruleset } from '../ruleset.js';
import { Selector } from '../selector.js';
import { Node, F_IMPLICIT_AMPERSAND, F_VISIBLE } from '../node.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector } from '../selector-complex.js';
import { Combinator } from '../combinator.js';
import { PseudoSelector, is as isSelectorPseudo } from '../selector-pseudo.js';
import { Ampersand } from '../ampersand.js';
import { Nil } from '../nil.js';
import type { Extend } from '../extend.js';
import { tryExtendSelector, findChainedExtends, createProcessedSelector, setExtendOrderMap } from './extend.js';
import { processLeadingIs } from './process-leading-is.js';
import { WARN, toDiagnostic } from '../../jess-error.js';
import { syncLog } from './__tests__/debug-log.js';
import { serializeTypes } from './serialize-types.js';
import { shouldTraceExtend, shouldTraceExtendMd, getExtendTraceRunId } from './extend-trace-debug.js';

function rulesStructureSummary(r: Rules): Record<string, unknown> {
  const len = r.value?.length ?? 0;
  const first = r.value?.[0];
  const firstType = first != null && typeof (first as Node).type === 'string' ? (first as Node).type : undefined;
  const firstRules = first != null && (first as Ruleset).value?.rules;
  const firstValueRulesType = firstRules != null && typeof (firstRules as Node).type === 'string' ? (firstRules as Node).type : undefined;
  const firstValueRulesLen = firstRules != null && Array.isArray((firstRules as Rules).value) ? (firstRules as Rules).value.length : undefined;
  return { valueLen: len, firstType, firstValueRulesType, firstValueRulesLen };
}

/**
 * Recursively ensure all selector nodes have F_VISIBLE so they serialize.
 * Extended selectors can include items from the original target that lacked F_VISIBLE
 * (e.g. nested context), causing components to render as '' and produce wrong output (.c, .rep_ace).
 */
function ensureSelectorVisible(selector: Selector): void {
  if (!selector || typeof (selector as Node).addFlag !== 'function') return;
  const n = selector as Node;
  if (!n.hasFlag(F_VISIBLE)) {
    n.addFlag(F_VISIBLE);
  }
  if (isNode(selector, 'SelectorList')) {
    const items = (selector as SelectorList).value;
    if (Array.isArray(items)) {
      for (const item of items) ensureSelectorVisible(item);
    }
    return;
  }
  if (isNode(selector, 'ComplexSelector')) {
    const comps = (selector as ComplexSelector).value;
    if (Array.isArray(comps)) {
      for (const c of comps) {
        if (c && typeof (c as Node).addFlag === 'function') ensureSelectorVisible(c as Selector);
      }
    }
    return;
  }
  const selWithValue = selector as Selector & { value?: Selector[] };
  if (Array.isArray(selWithValue.value)) {
    for (const c of selWithValue.value) ensureSelectorVisible(c);
  }
}

/** Ensure top-level items in a SelectorList (and their descendants) have F_VISIBLE so they serialize. */
function ensureSelectorListItemsVisible(selector: Selector): void {
  if (!isNode(selector, 'SelectorList')) return;
  const list = selector as SelectorList;
  const items = list.value;
  if (!Array.isArray(items)) return;
  for (const item of items) {
    ensureSelectorVisible(item);
  }
}

/** Preserve F_IMPLICIT_AMPERSAND on cloned selector(s) so createProcessedSelector keeps implicit ampersand (extend.less .dd,.ee,.ff). */
function preserveImplicitAmpersandOnClone(extendedSelector: Selector, clonedSelector: Selector): void {
  const preserveOne = (orig: Selector, clone: Selector) => {
    if (!isNode(orig, 'ComplexSelector') || !isNode(clone, 'ComplexSelector')) return;
    const origFirst = (orig as ComplexSelector).value[0];
    const cloneFirst = (clone as ComplexSelector).value[0];
    if (origFirst instanceof Ampersand && cloneFirst instanceof Ampersand && origFirst.hasFlag(F_IMPLICIT_AMPERSAND)) {
      (cloneFirst as Ampersand).addFlag(F_IMPLICIT_AMPERSAND);
      (cloneFirst as Ampersand).removeFlag(F_VISIBLE);
    }
  };
  if (isNode(clonedSelector, 'ComplexSelector') && isNode(extendedSelector, 'ComplexSelector')) {
    preserveOne(extendedSelector, clonedSelector);
  } else if (isNode(clonedSelector, 'SelectorList') && isNode(extendedSelector, 'SelectorList')) {
    const origList = extendedSelector as SelectorList;
    const cloneList = clonedSelector as SelectorList;
    const origItems = origList.value;
    const cloneItems = cloneList.value;
    if (Array.isArray(origItems) && Array.isArray(cloneItems) && origItems.length === cloneItems.length) {
      for (let i = 0; i < origItems.length; i++) {
        preserveOne(origItems[i]!, cloneItems[i]!);
      }
    }
  }
}

/**
 * Before updating a ruleset's selector, ensure any descendant rulesets that share
 * this ruleset's value object get their own value so they keep their current
 * selector when we assign ruleset.value.selector.
 */
function ensureDescendantRulesetsHaveOwnValue(ruleset: Ruleset, sharedValue: Ruleset['value']): void {
  const rules = ruleset.value?.rules;
  if (!rules || !isNode(rules, 'Rules')) {
    return;
  }
  const children = (rules as Rules).value;
  if (!Array.isArray(children)) {
    return;
  }
  for (const child of children) {
    if (!isNode(child, 'Ruleset')) {
      continue;
    }
    const rs = child as Ruleset;
    if (rs.value === sharedValue) {
      rs.value = {
        selector: rs.value.selector,
        rules: rs.value.rules,
        ...(rs.value.guard !== undefined && { guard: rs.value.guard })
      };
    }
    ensureDescendantRulesetsHaveOwnValue(rs, sharedValue);
  }
}

function maybeHoistMixedNestingSelectorList(
  ruleset: Ruleset,
  selector: Selector,
  partial: boolean
): Selector {
  // Only relevant for nested rulesets whose selector becomes a mixed selector list:
  // e.g. inside `.header { .header-nav { ... } }`, after extend we might have:
  // `.header-nav, .footer .footer-nav { ... }`
  //
  // Less/jess expectations for the Less test-data are to hoist to root and materialize the
  // implicit parent on relative selectors, producing:
  // `:is(.header .header-nav, .footer .footer-nav) { ... }`
  const parentRules = ruleset.parent;
  const parentRuleset = parentRules?.parent;
  if (!parentRuleset || !isNode(parentRuleset, 'Ruleset')) {
    return selector;
  }
  const parentSel = parentRuleset.selector as Selector;
  if (!parentSel || isNode(parentSel, 'Nil')) {
    return selector;
  }

  // Selector may already be wrapped in :is(...) for partial-extend output.
  let wrapper: PseudoSelector | null = null;
  let list: SelectorList | null = null;
  if (isNode(selector, 'SelectorList')) {
    list = selector as SelectorList;
  } else if (isNode(selector, 'PseudoSelector') && selector.value.name === ':is') {
    const arg = selector.value.arg;
    if (arg && isNode(arg, 'SelectorList')) {
      wrapper = selector as unknown as PseudoSelector;
      list = arg;
    }
  }
  if (!list) {
    return selector;
  }

  const materializeImplicitAmpersand = (s: Selector): Selector => {
    if (isNode(s, 'ComplexSelector')) {
      const cs = s;
      const first = cs.value[0];
      const second = cs.value[1];
      if (
        first instanceof Ampersand
        && first.hasFlag(F_IMPLICIT_AMPERSAND)
      ) {
        const resolved = first.getResolvedSelector();
        if (!resolved || resolved instanceof Nil) {
          return s;
        }
        // Same context: ampersand resolves to this ruleset's parent selector. Keep implicit
        // so nested output stays short (.dd, .ee not :is(.aa, .cc) .dd). Do not add F_VISIBLE.
        const resolvedCanonical = canonicalSelectorValueOf(resolved);
        const parentCanonical = canonicalSelectorValueOf(parentSel);
        if (resolvedCanonical !== '' && parentCanonical !== '' && resolvedCanonical === parentCanonical) {
          return s;
        }
        // Replace implicit ampersand with its concrete parent selector so
        // serialization at root doesn't drop it.
        let parentSelConcrete: Selector = resolved.copy(true);
        if (parentSelConcrete instanceof Nil) {
          return s;
        }
        // If the parent selector is itself a SelectorList, materialize it as `:is(...)`
        // so it remains a single selector component when hoisted to root.
        if (isNode(parentSelConcrete, 'SelectorList')) {
          parentSelConcrete = isSelectorPseudo(parentSelConcrete);
        }
        const out = cs.copy(true);
        out.value[0] = parentSelConcrete;
        // Ensure the combinator is visible when we materialize the parent.
        const outSecond = out.value[1];
        if (outSecond instanceof Node) {
          outSecond.addFlag(F_VISIBLE);
        }
        return out as unknown as Selector;
      }
      // For hoisted selector serialization we need leading components to be visible,
      // otherwise `toString()` can drop the parent prefix.
      if (first instanceof Node) {
        first.addFlag(F_VISIBLE);
      }
      if (second instanceof Node) {
        second.addFlag(F_VISIBLE);
      }
      return s;
    }
    // For simple selectors in nested context with SelectorList parent, we need to prepend the parent
    // and materialize it as :is(...) if it's a SelectorList
    if (isNode(parentSel, 'SelectorList')) {
      let parentSelConcrete: Selector = parentSel.copy(true);
      if (isNode(parentSelConcrete, 'SelectorList')) {
        parentSelConcrete = isSelectorPseudo(parentSelConcrete);
      }
      const out = ComplexSelector.create([
        parentSelConcrete,
        Combinator.create(' '),
        s.copy(true)
      ]).inherit(s);
      // Make components visible for serialization
      const outFirst = (out as ComplexSelector).value[0];
      const outSecond = (out as ComplexSelector).value[1];
      if (outFirst instanceof Node) {
        outFirst.addFlag(F_VISIBLE);
      }
      if (outSecond instanceof Node) {
        outSecond.addFlag(F_VISIBLE);
      }
      return out as unknown as Selector;
    }
    return s;
  };

  const items = list.value;
  if (!Array.isArray(items) || items.length < 2) {
    return selector;
  }

  // Special-case: when the parent selector is a selector list, a nested selector list can become
  // "mixed" after extend (some items are relative via implicit `&`, some are absolute like `.rep_ace`).
  // If we serialize that nested, we would incorrectly apply the parent frame to the absolute items.
  // Hoist to root and materialize the implicit parent as `:is(parentSelectors)`.
  if (isNode(parentSel, 'SelectorList')) {
    const startsWithImplicitParent = (s: Selector): boolean => {
      if (isNode(s, 'ComplexSelector')) {
        const first = (s as ComplexSelector).value[0];
        return first instanceof Ampersand && first.hasFlag(F_IMPLICIT_AMPERSAND);
      }
      // Simple selectors in nested context are relative (need parent materialization)
      return false;
    };
    // Check if we have a mix: some items with implicit parent (relative) and some without (absolute)
    const anyImplicit = items.some(startsWithImplicitParent);
    // An item is "absolute" if it's a ComplexSelector without implicit ampersand, or a simple selector
    // that doesn't match the nested pattern.
    const hasComplexWithoutImplicit = items.some((s) => {
      if (isNode(s, 'ComplexSelector')) {
        const first = (s as ComplexSelector).value[0];
        return !(first instanceof Ampersand && first.hasFlag(F_IMPLICIT_AMPERSAND));
      }
      return false;
    });
    const hasSimpleSelectors = items.some(s => !isNode(s, 'ComplexSelector'));

    // If we ended up with a selector-list where some items are plain selectors (e.g. `.replace`)
    // but others are just the parent prefix materialized as `:is(parentSel) <child>` (e.g. `:is(parentSel) .c`),
    // prefer normalizing back to plain nested selectors rather than hoisting/distributing.
    //
    // Runtime evidence (core-hoist-check):
    // - parentSelV = `:is(.replace,.rep_ace):is(.replace,.rep_ace),.c:is(...)+:is(...)`
    // - items = [`.replace`, `.rep_ace`, `:is(parentSelV) .c`]
    //
    // This is not a true "mixed absolute/relative" list; it's an internal representation artifact.
    if (hasSimpleSelectors) {
      // Special-case: factorize a cartesian-product expansion back into `:is(parentSel) :is(children)`
      // so `extend-exact` matches Less output (avoid full distribution).
      //
      // Example items:
      // - `.replace.replace .replace`
      // - `.c.replace + .replace .replace`
      // - `.replace.replace .c`
      // - `.c.replace + .replace .c`
      // plus an absolute `.rep_ace` selector.
      try {
        const complexItems = items.filter(s => isNode(s, 'ComplexSelector')) as ComplexSelector[];
        if (complexItems.length >= 4) {
          const parentAlts = (parentSel as SelectorList).value.map(v => v.valueOf());
          const lastBasics: { node: Selector; v: string }[] = [];
          const complexThatMatch: ComplexSelector[] = [];
          for (const cs of complexItems) {
            const last = cs.value[cs.value.length - 1];
            if (!isNode(last as any, 'BasicSelector')) {
              continue;
            }
            const v = (last as any).valueOf();
            lastBasics.push({ node: last as any, v });
            // Only consider if it starts with one of the parent alternatives.
            const sV = cs.valueOf();
            if (parentAlts.some(p => sV.startsWith(`${p} `))) {
              complexThatMatch.push(cs);
            }
          }
          const uniqLast = [...new Map(lastBasics.map(b => [b.v, b.node])).entries()].map(([, n]) => n);
          // If we can explain the complex items as parentAlts x uniqLast (cartesian product), factorize.
          if (uniqLast.length >= 2 && complexThatMatch.length >= parentAlts.length * uniqLast.length) {
            const parentIs = new PseudoSelector({ name: ':is', arg: (parentSel as SelectorList).copy(true) }).inherit(parentSel);
            const childIs = new PseudoSelector({
              name: ':is',
              arg: SelectorList.create(uniqLast.map(n => n.copy(true) as any)).inherit(parentSel)
            }).inherit(parentSel);
            const combined = ComplexSelector.create([
              parentIs,
              Combinator.create(' ').inherit(parentSel as any),
              childIs
            ]).inherit(parentSel);

            const kept: Selector[] = [];
            let inserted = false;
            for (const it of items) {
              if (!isNode(it, 'ComplexSelector')) {
                if (!inserted) {
                  kept.push(combined);
                  inserted = true;
                }
                kept.push(it);
                continue;
              }
              // Drop the distributed combinations.
              const itV = (it as any).valueOf?.() ?? '';
              if (parentAlts.some(p => itV.startsWith(`${p} `))) {
                continue;
              }
              if (!inserted) {
                kept.push(combined);
                inserted = true;
              }
              kept.push(it);
            }
            const listOut = SelectorList.create(kept.map(s => s.clone(true))).inherit(list);
            // We created selectors that already materialize the parent selector list via `:is(parentSel) ...`.
            // If we keep this nested, serialization will incorrectly treat them as relative to the parent frame.
            // Hoist to root.
            listOut.hoistToRoot = true;
            ruleset.hoistToRoot = true;
            if (wrapper) {
              wrapper.value.arg = listOut;
              wrapper.hoistToRoot = true;
              return wrapper;
            }
            return listOut;
          }
        }
      } catch {}

      let changed = false;
      const normalized = items.map((s) => {
        if (!isNode(s, 'ComplexSelector')) {
          return s;
        }
        const cs = s as ComplexSelector;
        const a = cs.value[0];
        const b = cs.value[1];
        const c = cs.value[2];
        if (
          isNode(a, 'PseudoSelector')
          && (a as any).value?.name === ':is'
          && isNode((a as any).value?.arg, 'SelectorList')
          && ((a as any).value.arg as SelectorList).valueOf() === parentSel.valueOf()
          && isNode(b, 'Combinator')
          && (b as any).value === ' '
          && isNode(c as any, 'BasicSelector')
        ) {
          changed = true;
          return (c as any).copy(true) as Selector;
        }
        return s;
      });
      if (changed) {
        const listOut = SelectorList.create(normalized.map(s => s.clone(true)));
        if (wrapper) {
          wrapper.value.arg = listOut;
          return wrapper;
        }
        return listOut;
      }
    }

    // If we have both items with implicit parent (relative) and items without (absolute), hoist and materialize.
    // This covers:
    // - ComplexSelector with implicit ampersand + ComplexSelector without (mixed relative/absolute)
    // - ComplexSelector with implicit ampersand + simple selector (relative + absolute)
    // - Simple selectors (which are relative in nested context) + ComplexSelector without implicit (relative + absolute)
    if (anyImplicit && (hasComplexWithoutImplicit || hasSimpleSelectors)) {
      const listOut = SelectorList.create(items.map(s => materializeImplicitAmpersand(s).clone(true)));
      if (partial) {
        if (!wrapper) {
          listOut.hoistToRoot = true;
          ruleset.hoistToRoot = true;
          return listOut;
        }
        wrapper.value.arg = listOut;
        wrapper.hoistToRoot = true;
        ruleset.hoistToRoot = true;
        return wrapper;
      }
      listOut.hoistToRoot = true;
      ruleset.hoistToRoot = true;
      return listOut;
    }
    // Also hoist if we have simple selectors mixed with ComplexSelector items without implicit ampersand
    // (both could be absolute, but if parent is SelectorList and we're nested, simple selectors are relative)
    if (hasSimpleSelectors && hasComplexWithoutImplicit) {
      const listOut = SelectorList.create(items.map(s => materializeImplicitAmpersand(s).clone(true)));
      if (partial) {
        if (!wrapper) {
          listOut.hoistToRoot = true;
          ruleset.hoistToRoot = true;
          return listOut;
        }
        wrapper.value.arg = listOut;
        wrapper.hoistToRoot = true;
        ruleset.hoistToRoot = true;
        return wrapper;
      }
      listOut.hoistToRoot = true;
      ruleset.hoistToRoot = true;
      return listOut;
    }
  }

  // Heuristic: if we have a mix of "relative" selectors (no descendant combinator)
  // and "absolute" selectors (has descendant combinator), hoist and materialize parent.
  const hasDescendantCombinator = (s: Selector) =>
    isNode(s, 'ComplexSelector') && (s as ComplexSelector).value.some(c => isNode(c, 'Combinator') && c.value === ' ');
  const anyAbsolute = items.some(hasDescendantCombinator);
  const anyRelative = items.some(s => !hasDescendantCombinator(s));
  const parentPrefix = `${parentSel.valueOf()} `;
  const parentNorm = normalizedSelectorValueOf(parentSel);
  const parentPrefixNorm = parentNorm ? parentNorm + ' ' : '';
  // Use materialized form so relative selectors (e.g. .header-nav with implicit &) count as prefixed.
  // Use normalized comparison so spacing differences don't prevent match (e.g. ".header  .header-nav").
  const itemPrefixedByParent = (s: Selector): boolean => {
    if (!parentPrefix && !parentPrefixNorm) {
      return false;
    }
    const mat = materializeImplicitAmpersand(s);
    const v = String(mat.valueOf()).replace(/\s+/g, ' ').trim();
    const vNorm = v.replace(/\s+/g, '');
    if (v.startsWith(parentPrefix)) {
      return true;
    }
    if (parentPrefixNorm && vNorm.startsWith(parentPrefixNorm.replace(/\s+/g, ''))) {
      return true;
    }
    return false;
  };
  const anyPrefixedByParent = items.some(itemPrefixedByParent);
  const anyNotPrefixedByParent = items.some(s => !itemPrefixedByParent(s));
  // If the selector list mixes selectors that are under the parent prefix and selectors that are not,
  // hoist to root so we don't serialize them inside the parent's frame (which would strip the prefix
  // from the prefixed selectors, producing `.header-nav, .footer .footer-nav`).
  if (anyPrefixedByParent && anyNotPrefixedByParent) {
    const listOut = SelectorList.create(items.map(s => materializeImplicitAmpersand(s).clone(true)));
    if (partial) {
      // If we were going to introduce a wrapper just for partial-mode output,
      // prefer returning a plain selector list. A top-level `:is(...)` wrapper
      // is unnecessary when it is the entire selector.
      if (!wrapper) {
        listOut.hoistToRoot = true;
        ruleset.hoistToRoot = true;
        return listOut;
      }
      // If the selector was already wrapped, preserve that structure.
      wrapper.value.arg = listOut;
      wrapper.hoistToRoot = true;
      ruleset.hoistToRoot = true;
      return wrapper;
    }
    listOut.hoistToRoot = true;
    ruleset.hoistToRoot = true;
    return listOut;
  }

  if (!anyAbsolute || !anyRelative) {
    return selector;
  }

  const rewritten = items.map((s) => {
    if (hasDescendantCombinator(s)) {
      return materializeImplicitAmpersand(s);
    }
    // Prefix the nested parent selector.
    const out = ComplexSelector.create([parentSel.copy(true), Combinator.create(' '), s.copy(true)]).inherit(s);
    return materializeImplicitAmpersand(out as unknown as Selector);
  });

  const listOut = SelectorList.create(rewritten);
  if (partial) {
    // Same rationale as above: don't introduce a top-level `:is(...)` wrapper
    // if it would be the entire selector.
    if (!wrapper) {
      listOut.hoistToRoot = true;
      ruleset.hoistToRoot = true;
      return listOut;
    }
    wrapper.value.arg = listOut;
    wrapper.hoistToRoot = true;
    ruleset.hoistToRoot = true;
    return wrapper;
  }
  listOut.hoistToRoot = true;
  ruleset.hoistToRoot = true;
  return listOut;
}

/** Normalize selector valueOf for comparison (whitespace and comma spacing can differ between clones). */
function normalizedSelectorValueOf(sel: Selector | undefined): string {
  if (sel == null || typeof (sel as Selector).valueOf !== 'function') return '';
  const v = (sel as Selector).valueOf();
  return String(v).replace(/\s+/g, '').trim();
}

/** Canonical form for same-context comparison: unwrap :is(...) so :is(.a,.b) and .a,.b compare equal. */
function canonicalSelectorValueOf(sel: Selector | undefined): string {
  if (sel == null) return '';
  if (isNode(sel, 'PseudoSelector') && (sel as PseudoSelector).value?.name === ':is') {
    const arg = (sel as PseudoSelector).value?.arg;
    if (arg && typeof (arg as Selector).valueOf === 'function') {
      return normalizedSelectorValueOf(arg as Selector);
    }
  }
  return normalizedSelectorValueOf(sel);
}

/** Get the selector of the ruleset that contains this ruleset (parent context), or undefined if at root. */
function getRulesetParentSelector(ruleset: Ruleset): Selector | undefined {
  const parentRules = ruleset.parent;
  const parentRuleset = parentRules?.parent;
  if (!parentRuleset || !isNode(parentRuleset, 'Ruleset')) {
    return undefined;
  }
  const sel = (parentRuleset as Ruleset).value?.selector;
  return sel && !isNode(sel, 'Nil') ? (sel as Selector) : undefined;
}

/** Leading prefix of a ruleset's selector: canonical value of the first consecutive items that do NOT start with implicit ampersand. Used so nested items (& .dd) under a merged list (.aa, .cc, & .dd, ...) are not materialized when & resolves to that prefix. */
function getRulesetSelectorLeadingPrefixNormalized(ruleset: Ruleset): string {
  const sel = ruleset.value?.selector;
  if (!sel || isNode(sel, 'Nil')) return '';
  if (!isNode(sel, 'SelectorList')) return canonicalSelectorValueOf(sel as Selector);
  const items = (sel as SelectorList).value;
  if (!Array.isArray(items) || items.length === 0) return '';
  const leading: Selector[] = [];
  for (const s of items) {
    if (isNode(s, 'Nil')) continue;
    if (isNode(s, 'ComplexSelector')) {
      const first = (s as ComplexSelector).value[0];
      if (first instanceof Ampersand && first.hasFlag(F_IMPLICIT_AMPERSAND)) break;
    }
    leading.push(s as Selector);
  }
  if (leading.length === 0) return '';
  if (leading.length === 1) return canonicalSelectorValueOf(leading[0]);
  return canonicalSelectorValueOf(SelectorList.create(leading.map(s => s.copy(true))).inherit(sel));
}

/**
 * When createProcessedSelector has already resolved an implicit & to :is(ctx) + combinator + rest,
 * convert it back to implicit ampersand when ctx matches the ruleset context so output stays short
 * (.dd not :is(.aa, .cc) .dd).
 */
function dematerializeSameContextIsPrefix(
  s: Selector,
  rulesetParentSelector: Selector | undefined,
  rulesetLeadingPrefixNormalized: string
): Selector {
  if (!isNode(s, 'ComplexSelector') || s.value.length < 2) {
    return s;
  }
  const first = s.value[0];
  const second = s.value[1];
  if (
    !isNode(first, 'PseudoSelector')
    || (first as PseudoSelector).value?.name !== ':is'
    || !(first as PseudoSelector).value?.arg
    || !isNode(second, 'Combinator')
  ) {
    return s;
  }
  const isArg = (first as PseudoSelector).value!.arg as Selector;
  const isArgCanonical = canonicalSelectorValueOf(isArg);
  const ctxVal = rulesetParentSelector ? canonicalSelectorValueOf(rulesetParentSelector) : '';
  const matchCtx = isArgCanonical !== '' && isArgCanonical === ctxVal;
  const matchLeading = isArgCanonical !== '' && rulesetLeadingPrefixNormalized !== '' && isArgCanonical === rulesetLeadingPrefixNormalized;
  if (isArgCanonical === '' || (!matchCtx && !matchLeading)) {
    return s;
  }
  const amp = Ampersand.create({
    selector: isArg.copy(true),
    getResolvedSelector: () => isArg.copy(true)
  }).inherit(first);
  amp.addFlag(F_IMPLICIT_AMPERSAND);
  amp.removeFlag(F_VISIBLE);
  const comb = second.copy(true) as Combinator;
  comb.removeFlag(F_VISIBLE);
  const out = (s as ComplexSelector).copy(true) as ComplexSelector;
  out.value[0] = amp;
  out.value[1] = comb;
  return out as unknown as Selector;
}

const DEBUG_AMPERSAND_EXTEND = process.env.DEBUG_AMPERSAND_EXTEND === '1';

/**
 * If the selector item starts with an implicit ampersand and that ampersand's context (getResolvedSelector)
 * is different from the ruleset we're extending, materialize the ampersand so it serializes correctly
 * (e.g. extendWith from another ruleset becomes ".issue-2586-somepage .content" not ".content").
 * If same context (nested ruleset's own selector), keep implicit so output stays short (".a, .c").
 * @param rulesetOwnSelectorNormalized - optional normalized valueOf of the ruleset's own selector (so we don't materialize when & resolves to same ruleset)
 * @param rulesetLeadingPrefixNormalized - when ruleset has a mixed selector list (.aa, .cc, & .dd, ...), canonical of leading items (.aa, .cc) so we don't materialize when & resolves to that prefix
 */
function materializeImplicitAmpersandWhenDifferentContext(
  s: Selector,
  rulesetParentSelector: Selector | undefined,
  rulesetOwnSelectorNormalized: string = '',
  rulesetLeadingPrefixNormalized: string = ''
): Selector {
  if (!isNode(s, 'ComplexSelector') || s.value.length < 2) {
    return s;
  }
  const first = s.value[0];
  const second = s.value[1];
  if (
    !(first instanceof Ampersand)
    || !first.hasFlag(F_IMPLICIT_AMPERSAND)
    || !isNode(second, 'Combinator')
  ) {
    return s;
  }
  // Use live getter when present (extendWith from another ruleset); else snapshot (value.selector) after clone.
  const ampResolved = first.getResolvedSelector() ?? (first.value?.selector as Selector | undefined);
  const ampValRaw = ampResolved?.valueOf?.();
  const ctxValRaw = rulesetParentSelector?.valueOf?.();
  const ampVal = ampResolved && !isNode(ampResolved, 'Nil') ? canonicalSelectorValueOf(ampResolved as Selector) : '';
  const ctxVal = rulesetParentSelector ? canonicalSelectorValueOf(rulesetParentSelector) : '';
  // Same context when: (1) both undefined, (2) ampersand resolves to ruleset's parent, or
  // (3) ampersand resolves to this ruleset's own selector, or (4) ruleset has mixed list (.aa, .cc, & .dd, ...) and & resolves to leading prefix (.aa,.cc).
  const sameContext =
    (ampValRaw === undefined && ctxValRaw === undefined)
    || (ampVal !== '' && ctxVal !== '' && ampVal === ctxVal)
    || (ampVal !== '' && rulesetOwnSelectorNormalized !== '' && ampVal === rulesetOwnSelectorNormalized)
    || (ampVal !== '' && rulesetLeadingPrefixNormalized !== '' && ampVal === rulesetLeadingPrefixNormalized);
  if (DEBUG_AMPERSAND_EXTEND) {
    syncLog({
      trace: 'materializeImplicit',
      sVal: String((s as Selector).valueOf?.() ?? '').slice(0, 80),
      ampVal: ampVal.slice(0, 80),
      ctxVal: ctxVal.slice(0, 80),
      sameContext,
      willMaterialize: !sameContext && !!ampResolved && !isNode(ampResolved, 'Nil')
    });
  }
  if (sameContext) {
    return s;
  }
  if (!ampResolved || isNode(ampResolved, 'Nil')) {
    return s;
  }
  let parentSelConcrete: Selector = ampResolved.copy(true);
  if (isNode(parentSelConcrete, 'SelectorList')) {
    parentSelConcrete = isSelectorPseudo(parentSelConcrete);
  }
  const out = (s as ComplexSelector).copy(true) as ComplexSelector;
  out.value[0] = parentSelConcrete;
  const outSecond = out.value[1];
  if (outSecond instanceof Node) {
    outSecond.addFlag(F_VISIBLE);
  }
  return out as unknown as Selector;
}

/**
 * Apply materializeImplicitAmpersandWhenDifferentContext to each item in the normalized result
 * so extendWith selectors (different context) are materialized and nested-own selectors (same context) stay implicit.
 */
function materializeNormalizedWhenDifferentContext(
  normalized: Selector | Selector[],
  ruleset: Ruleset
): Selector | Selector[] {
  const rulesetParentSelector = getRulesetParentSelector(ruleset);
  const rulesetOwnSel = ruleset.value?.selector;
  const rulesetOwnSelectorNormalized =
    rulesetOwnSel && !isNode(rulesetOwnSel, 'Nil') ? canonicalSelectorValueOf(rulesetOwnSel as Selector) : '';
  const rulesetLeadingPrefixNormalized = getRulesetSelectorLeadingPrefixNormalized(ruleset);
  if (DEBUG_AMPERSAND_EXTEND) {
    const ctxStr = rulesetParentSelector ? normalizedSelectorValueOf(rulesetParentSelector).slice(0, 80) : 'undefined';
    const isList = isNode(normalized, 'SelectorList');
    const items = isList ? (normalized as SelectorList).value : (Array.isArray(normalized) ? normalized : [normalized]);
    const itemVals = items.slice(0, 5).map((sel: Selector) => String(sel.valueOf?.() ?? '').slice(0, 60));
    syncLog({
      trace: 'materializeNormalized',
      ctxVal: ctxStr,
      ownVal: rulesetOwnSelectorNormalized.slice(0, 80),
      isSelectorList: isList,
      itemCount: items.length,
      itemVals
    });
  }
  const mapOne = (s: Selector) => {
    const cloned = s.clone(true);
    const demat = dematerializeSameContextIsPrefix(cloned, rulesetParentSelector, rulesetLeadingPrefixNormalized);
    return materializeImplicitAmpersandWhenDifferentContext(demat.clone(true), rulesetParentSelector, rulesetOwnSelectorNormalized, rulesetLeadingPrefixNormalized);
  };
  if (Array.isArray(normalized)) {
    return normalized.map(mapOne);
  }
  // createProcessedSelector can return a SelectorList; materialize each item, not the list itself.
  if (isNode(normalized, 'SelectorList')) {
    const list = normalized as SelectorList;
    const items = list.value;
    if (Array.isArray(items) && items.length > 0) {
      return SelectorList.create(items.map(mapOne)).inherit(list) as Selector;
    }
  }
  return mapOne(normalized);
}

/**
 * Extend Roots Registry
 *
 * Manages extend root relationships and visibility (like ruleset .frames).
 * Uses Rules node object identity (no wrapper class needed).
 *
 * Data architecture (mirrors ruleset frames):
 * - Tree: each extend root has a parent (except document root) and children.
 *   parentRoot: Rules -> parent Rules, childrenRoots: Rules -> Set<Rules>.
 * - Accessible roots: for a given extend root, the set of roots where we look up
 *   extend targets = the extend root itself + its descendants only (self + descendants).
 *   No ancestor targeting. So document root can see itself and all @media/child roots;
 *   a @media body root can see only itself and nested at-rules inside it.
 * - Merge: we only merge (add selector) into rulesets whose root is extendRoot or
 *   a descendant (isSameOrDescendantRoot).
 */
export class ExtendRootRegistry {
  // Map Rules -> parent Rules (tree)
  private parentRoot = new WeakMap<Rules, Rules>();

  // Map Rules -> Set of child Rules (tree)
  private childrenRoots = new WeakMap<Rules, Set<Rules>>();

  // Map Rules -> layer name string
  private layerName = new WeakMap<Rules, string>();

  // Map Rules -> protected flag
  private isProtected = new WeakMap<Rules, boolean>();

  // Map Rules -> isCompose flag (compose roots create boundaries and are not accessible as children)
  private isCompose = new WeakMap<Rules, boolean>();

  // Map layer name -> Set of Rules with that name
  private rootsByLayerName = new Map<string, Set<Rules>>();

  // Map namespace identifier -> Set of Rules registered under that namespace
  private rootsByNamespace = new Map<string, Set<Rules>>();

  // Map AtRule node -> layer name (temporary storage from preEval to evalNode)
  // We use AtRule as the key since we have access to it in both preEval and evalNode
  private layerNames = new WeakMap<AtRule, string>();

  // Root of the tree
  root?: Rules;

  // Stack for tracking current extend root (like rulesetFrames)
  extendRootStack: Rules[] = [];

  /**
   * Get current extend root from stack
   */
  getCurrentExtendRoot(): Rules | undefined {
    return this.extendRootStack[this.extendRootStack.length - 1];
  }

  /**
   * Register a new extend root
   */
  registerRoot(
    rules: Rules,
    parent?: Rules,
    options?: { layerName?: string; isProtected?: boolean; isCompose?: boolean; namespace?: string }
  ): void {
    // Set as root if this is the first root
    if (!this.root) {
      this.root = rules;
    }

    // Set parent relationship
    if (parent) {
      this.parentRoot.set(rules, parent);
      // Add to parent's children
      let children = this.childrenRoots.get(parent);
      if (!children) {
        children = new Set<Rules>();
        this.childrenRoots.set(parent, children);
      }
      children.add(rules);
    } else {
    }

    // Set layer name if provided
    if (options?.layerName) {
      this.layerName.set(rules, options.layerName);
      // Add to layer name map
      let layerRoots = this.rootsByLayerName.get(options.layerName);
      if (!layerRoots) {
        layerRoots = new Set<Rules>();
        this.rootsByLayerName.set(options.layerName, layerRoots);
      }
      layerRoots.add(rules);
    }

    // Set namespace if provided
    if (options?.namespace) {
      let nsRoots = this.rootsByNamespace.get(options.namespace);
      if (!nsRoots) {
        nsRoots = new Set<Rules>();
        this.rootsByNamespace.set(options.namespace, nsRoots);
      }
      nsRoots.add(rules);
    }

    // Set protected flag if provided
    if (options?.isProtected) {
      this.isProtected.set(rules, true);
    }

    // Set compose flag if provided (compose roots create boundaries)
    if (options?.isCompose) {
      this.isCompose.set(rules, true);
    }
  }

  /**
   * Push extend root to stack
   */
  pushExtendRoot(rules: Rules): void {
    this.extendRootStack.push(rules);
  }

  /**
   * Pop extend root from stack
   */
  popExtendRoot(): void {
    this.extendRootStack.pop();
  }

  /**
   * Get roots visible to a given extend root (like ruleset .frames).
   * Alias for getAccessibleRoots; use when you mean "visible to this root".
   */
  getVisibleRoots(root: Rules): Set<Rules> {
    return this.getAccessibleRoots(root);
  }

  /**
   * Get accessible (visible) roots for a given root.
   *
   * Visible roots = where we can look up rulesets for extend targets:
   * - Self (the current root)
   * - Self (the root)
   * - Descendant roots (children, recursively; stop at protected)
   * - Roots with same layer name (for @layer, if accessible)
   *
   * Excludes:
   * - Ancestor roots (we do not support extend targeting ancestors)
   * - Roots behind protected boundaries (stop traversal at protected roots)
   * - Siblings (other children of ancestors, unless same layer)
   *
   * Note: @import type uses parent's root, so extends inside @import use that root's
   * self + descendants. @compose type creates its own root and may be protected.
   */
  getAccessibleRoots(root: Rules): Set<Rules> {
    const accessible = new Set<Rules>();
    const visited = new Set<Rules>();

    // Helper to traverse children recursively (downward)
    const traverseChildren = (currentRoot: Rules): void => {
      if (visited.has(currentRoot)) {
        return;
      }
      visited.add(currentRoot);

      // Add self
      accessible.add(currentRoot);

      // Check if this root is protected - if so, stop traversal into children
      if (this.isProtected.get(currentRoot)) {
        return;
      }

      // Add children (recursively)
      // Only add non-protected children
      // - Protected roots block access (including protected compose roots)
      // - Non-protected compose roots (mutable: true) ARE accessible as children
      // - Import type roots: protected imports (mutable: false) are NOT accessible, non-protected imports are accessible
      const children = this.childrenRoots.get(currentRoot);
      if (children) {
        for (const child of children) {
          // Skip protected children - they should not be accessible
          // This includes protected compose roots (mutable: false or default)
          if (this.isProtected.get(child)) {
            continue;
          }
          // Non-protected compose roots (mutable: true) ARE accessible
          // Only protected compose roots create boundaries
          // So we don't skip compose children here - we only skip if they're protected
          traverseChildren(child);
        }
      }

      // When collapseNesting wraps at-rule body in Ruleset(&), rulesets live in the inner Rules.
      // Include inner Rules of every child Ruleset so extends find nested rulesets (e.g. .rep_ace:extend(.replace all)
      // must find the nested ruleset with selector .replace, .c and extend it to .replace, .rep_ace, .c).
      // Also when a root has one child that is Rules (post-eval unwrapped), include that child.
      if (currentRoot.value?.length) {
        for (const node of currentRoot.value) {
          if (node && isNode(node, 'Ruleset') && node.value?.rules && isNode(node.value.rules, 'Rules')) {
            const innerRules = node.value.rules as Rules;
            if (!visited.has(innerRules)) {
              accessible.add(innerRules);
              traverseChildren(innerRules);
            }
          } else if (node && isNode(node, 'Rules')) {
            const innerRules = node as Rules;
            if (!visited.has(innerRules)) {
              accessible.add(innerRules);
              traverseChildren(innerRules);
            }
          }
        }
      }

      // Add roots with same layer name (if this root has a layer name)
      const layerName = this.layerName.get(currentRoot);
      if (layerName) {
        const sameLayerRoots = this.rootsByLayerName.get(layerName);
        if (sameLayerRoots) {
          for (const layerRoot of sameLayerRoots) {
            if (layerRoot !== currentRoot && !visited.has(layerRoot)) {
              // Check if layer root is accessible (not behind protected boundary)
              if (!this.isProtected.get(layerRoot)) {
                accessible.add(layerRoot);
                // Also traverse its children
                traverseChildren(layerRoot);
              }
            }
          }
        }
      }
    };

    // Self + descendants only. No ancestor targeting.
    traverseChildren(root);

    return accessible;
  }

  /**
   * True if rulesetRoot is extendRoot or any descendant of extendRoot.
   * Used to only merge extend into rulesets in the same or a child root (not ancestor).
   */
  isSameOrDescendantRoot(rulesetRoot: Rules, extendRoot: Rules): boolean {
    if (rulesetRoot === extendRoot) {
      return true;
    }
    // Same-layer roots share extend scope (e.g. two @layer one { } blocks merge).
    const layerA = this.layerName.get(rulesetRoot);
    const layerB = this.layerName.get(extendRoot);
    if (layerA && layerB && layerA === layerB) {
      return true;
    }
    const children = this.childrenRoots.get(extendRoot);
    if (!children) {
      return false;
    }
    for (const child of children) {
      if (this.isSameOrDescendantRoot(rulesetRoot, child)) {
        return true;
      }
    }
    return false;
  }

  /**
   * True if possibleAncestor is an ancestor of root (walking parentRoot up from root).
   * Used only to reject merging into rulesets in an ancestor root (we do not support
   * ancestor targeting or copying declarations from ancestor targets).
   */
  isAncestorRoot(possibleAncestor: Rules, root: Rules): boolean {
    let current: Rules | undefined = this.parentRoot.get(root);
    while (current) {
      if (current === possibleAncestor) {
        return true;
      }
      current = this.parentRoot.get(current);
    }
    return false;
  }

  /**
   * Get parent extend root (for same-block detection when collapseNesting creates two inner Rules refs).
   */
  getParentRoot(root: Rules): Rules | undefined {
    return this.parentRoot.get(root);
  }

  /**
   * Get layer name for a Rules root
   */
  getRootLayerName(root: Rules): string | undefined {
    return this.layerName.get(root);
  }

  /**
   * Store pending layer name for an AtRule node (from preEval)
   * This will be used when the actual Rules is registered in evalNode
   */
  setLayerName(atRule: AtRule, layerName: string): void {
    this.layerNames.set(atRule, layerName);
  }

  /**
   * Get layer name for an AtRule (stored during preEval, retrieved in evalNode)
   * Does NOT delete - use takeLayerName to get and delete
   */
  getLayerName(atRule: AtRule): string | undefined {
    return this.layerNames.get(atRule);
  }

  /**
   * Get and delete layer name for an AtRule (used when registering the root)
   */
  takeLayerName(atRule: AtRule): string | undefined {
    const layerName = this.layerNames.get(atRule);
    if (layerName) {
      this.layerNames.delete(atRule);
    }
    return layerName;
  }

  /**
   * Get all registered roots (for checking if a target exists anywhere)
   * This includes all roots regardless of accessibility
   */
  getAlts(): Set<Rules> {
    const allRoots = new Set<Rules>();

    // Start from the main root and traverse all children
    if (this.root) {
      const traverse = (currentRoot: Rules): void => {
        if (allRoots.has(currentRoot)) {
          return;
        }
        allRoots.add(currentRoot);

        const children = this.childrenRoots.get(currentRoot);
        if (children) {
          for (const child of children) {
            traverse(child);
          }
        }
      };

      traverse(this.root);
    }

    return allRoots;
  }

  /**
   * Get roots registered for a given namespace identifier.
   */
  getByNamespace(namespace: string): Set<Rules> {
    return this.rootsByNamespace.get(namespace) ?? new Set<Rules>();
  }

  /**
   * Extract layer name from AtRule prelude
   * Returns undefined for anonymous layers
   */
  extractLayerName(atRule: AtRule, parentLayerName?: string): string | undefined {
    const { prelude } = atRule.value;
    if (!prelude) {
      // Anonymous layer - no name
      return undefined;
    }

    // Evaluate prelude if needed (should be static by extend time)
    // For now, assume it's already evaluated or can be converted to string
    const preludeStr = prelude.toTrimmedString();

    // If parent layer name provided, concatenate
    if (parentLayerName) {
      return `${parentLayerName}.${preludeStr}`;
    }

    return preludeStr;
  }
}

/**
 * Processes all extends registered in the context.
 * This function handles the complete extend processing pipeline:
 * 1. Depth-first processing of all original extends
 * 2. Iterative multi-pass processing of extended rulesets
 *
 * All extend processing logic is centralized here, not in rules.ts
 */
export function processExtends(context: Context): void {
  const allExtends = [...context.extends]; // All original extends
  const trace = shouldTraceExtend(context);
  const runId = getExtendTraceRunId(context);
  if (trace) {
    const opts = context.opts as { collapseNesting?: boolean; output?: { collapseNesting?: boolean } } | undefined;
    const collapseNesting = Boolean(opts?.collapseNesting ?? opts?.output?.collapseNesting);
    const allRootsForLog = context.extendRoots.getAlts();
    const allRootsArrForLog = Array.isArray(allRootsForLog) ? allRootsForLog : [...allRootsForLog];
    const rootSummaries: Array<{ summary: Record<string, unknown>; serializedHead: string; registryIndexSize: number; registryPendingSize: number; registryKeys: string[] }> = [];
    for (const r of allRootsArrForLog) {
      let serializedHead = '';
      try {
        serializedHead = serializeTypes(r, { maxStringLength: 80, indentSize: 1 }).slice(0, 500);
      } catch {
        serializedHead = '(serialize error)';
      }
      const reg = r.getRegistry('ruleset');
      const indexSize = reg.index?.size ?? 0;
      const pendingSize = (reg as { pendingItems?: Set<Ruleset> }).pendingItems?.size ?? 0;
      const keys: string[] = [];
      if (reg.index) {
        for (const k of reg.index.keys()) {
          keys.push(k);
          if (keys.length >= 20) {
            break;
          }
        }
      }
      rootSummaries.push({
        summary: rulesStructureSummary(r),
        serializedHead,
        registryIndexSize: indexSize,
        registryPendingSize: pendingSize,
        registryKeys: keys
      });
    }
    const extendsSummary = allExtends.map(([target, sel, partial, extRoot]) => ({
      target: typeof target?.valueOf === 'function' ? target.valueOf() : '',
      selectorWithExtend: typeof sel?.valueOf === 'function' ? sel.valueOf() : '',
      partial,
      extendRootSummary: rulesStructureSummary(extRoot)
    }));
    syncLog({
      trace: 'processExtends_enter',
      runId,
      collapseNesting,
      allRootsCount: allRootsArrForLog.length,
      rootSummaries,
      extendsCount: allExtends.length,
      extendsSummary
    });
  }

  // NOTE: We must NOT globally de-dupe extends by (target, extendWith, partial).
  // The same extend relationship must be applied to *any* ruleset whose selector matches
  // the target, including selectors that become matchable only after previous extends.
  // De-duping happens per-ruleset via `transformedByExtend`.
  const processedExtends = new Set<string>(); // Track in-flight recursion only (used as a stack guard)
  const extendedRulesets = new Set<Ruleset>(); // Track rulesets that were extended
  // Track extend order for source-order preservation when merging into :is()
  // Maps extendWith selector -> extend index in allExtends (which should be source order with depth-first preEval)
  const extendOrderMap = new WeakMap<Selector, number>();
  for (let i = 0; i < allExtends.length; i++) {
    const [, selectorWithExtend] = allExtends[i]!;
    extendOrderMap.set(selectorWithExtend, i);
  }
  // Set the extend order map in extend.ts module for use during merging
  setExtendOrderMap(extendOrderMap);

  // Track which extends have already transformed which rulesets: Map<rulesetId, Set<extendKey>>
  // Each extend can only transform a particular ruleset's selector once
  const transformedByExtend = new Map<Ruleset, Set<string>>();
  // Track exact extends that were rejected for a ruleset (e.g. .bb .bb rejected .bb:extend(.ee)).
  // Phase 2 must not re-apply those to the same ruleset when its selector is later flattened to a list.
  const rejectedExactExtendByRuleset = new Map<Ruleset, Set<string>>();
  const allRoots = context.extendRoots.getAlts();
  const allRootsArr = Array.isArray(allRoots) ? allRoots : [...allRoots];
  /** Walk up from a ruleset to the nearest Rules that is a registered extend root. */
  const getEffectiveExtendRoot = (ruleset: Ruleset): Rules | undefined => {
    let n: Node | undefined = ruleset;
    while (n) {
      const p: Node | undefined = n.parent;
      if (p && isNode(p, 'Rules') && allRoots.has(p)) {
        return p;
      }
      n = p;
    }
    return undefined;
  };
  /**
   * Helper to re-index a ruleset's registry after selector update
   * Simply adds the ruleset back to the registry - it will be indexed automatically
   * when searched. Since the ruleset object is the same, existing keys remain,
   * and new keys from the updated selector will be added automatically.
   */
  const reindexRuleset = (ruleset: Ruleset): void => {
    // Find which extend root this ruleset is registered to and add it back
    for (const root of allRootsArr) {
      const registry = root.getRegistry('ruleset');
      // Check if ruleset is already indexed in this registry
      for (const rulesetSet of registry.index.values()) {
        if (rulesetSet.has(ruleset)) {
          // Add back to pendingItems - will be indexed with new selector's keySet automatically
          registry.add(ruleset);
          return;
        }
      }
    }
  };

  /**
   * Logical exclusion rule: A ruleset should not be extended if the extend is associated with that ruleset
   * (either as a child or as a prepended sibling). This prevents self-modification.
   * The extend utility handles selector matching - we just check structural association here.
   */
  const shouldSkipRuleset = (ruleset: Ruleset, extendNode: Node): boolean => {
    // Check 1: Is extend a child of the ruleset?
    if (ruleset.value.rules && 'value' in ruleset.value.rules) {
      const rules = ruleset.value.rules.value;
      if (Array.isArray(rules)) {
        const findNode = (nodes: Node[]): boolean => {
          for (const node of nodes) {
            if (node === extendNode) {
              return true;
            }
            if ('value' in node && Array.isArray(node.value)) {
              if (findNode(node.value)) {
                return true;
              }
            }
          }
          return false;
        };
        if (findNode(rules)) {
          return true; // Extend is a child - skip this ruleset
        }
      }
    }

    // Check 2: Is extend a sibling that precedes this ruleset in a Rules parent?
    const parent = ruleset.parent;
    if (parent && isNode(parent, 'Rules')) {
      const siblings = parent.value;
      const rulesetIndex = siblings.indexOf(ruleset);
      if (rulesetIndex > 0) {
        // Search backwards from the ruleset
        for (let i = rulesetIndex - 1; i >= 0; i--) {
          const sibling = siblings[i];
          if (!sibling) {
            continue;
          }

          // If we encounter an at-rule or another ruleset, the extend is NOT prepended
          if (isNode(sibling, 'AtRule') || isNode(sibling, 'Ruleset')) {
            break; // Stop searching - extend can apply
          }

          // If we find the extend node, it's prepended
          if (sibling === extendNode) {
            return true;
          }

          // Also check if sibling is a Rules containing the extend
          if (isNode(sibling, 'Rules')) {
            const findInRules = (rules: Rules): boolean => {
              for (const node of rules.value) {
                if (node === extendNode) {
                  return true;
                }
                if (isNode(node, 'Rules')) {
                  if (findInRules(node)) {
                    return true;
                  }
                }
              }
              return false;
            };
            if (findInRules(sibling)) {
              return true; // Extend is prepended - skip this ruleset
            }
          }
        }
      }
    }

    // Selectors match but extend is not associated with this ruleset
    return false;
  };

  /**
   * Process a single extend recursively (depth-first)
   */
  const processExtend = (
    target: Selector,
    selectorWithExtend: Selector,
    partial: boolean,
    extendRoot: Rules,
    extendNode: Node,
    depth: number = 0
  ): void => {
    const maxDepth = 100; // Prevent infinite loops
    if (depth >= maxDepth) {
      throw new Error(`Extend chaining exceeded maximum depth (${maxDepth}). Possible circular reference.`);
    }

    // Skip self-referencing extends
    if (target.valueOf() === selectorWithExtend.valueOf()) {
      return;
    }

    // Create a recursion-guard key. This is NOT a global "already applied" key.
    // It's only meant to prevent infinite recursion for cyclic chaining.
    const extendKey = `${target.valueOf()}:${selectorWithExtend.valueOf()}:${partial}:${extendRoot === context.root ? 'root' : 'nested'}`;
    if (processedExtends.has(extendKey)) {
      return;
    }
    processedExtends.add(extendKey);

    // Determine which roots to search for this extend.
    // - If extend specifies a namespace:
    //   - '*' searches all file roots
    //   - otherwise search only roots registered for that namespace
    // - Otherwise, use the accessibility model from the extend's own root.
    const extendNamespace = (extendNode as Extend).type === 'Extend'
      ? (extendNode as Extend).value.namespace
      : undefined;
    let accessibleRoots = extendNamespace
      ? (extendNamespace === '*' ? context.extendRoots.getAlts() : context.extendRoots.getByNamespace(extendNamespace))
      : context.extendRoots.getAccessibleRoots(extendRoot);
    // When collapseNesting wraps at-rule rules in Ruleset(&), rulesets register to the inner Rules.
    // Ensure we search those inner Rules so same-root extends (e.g. .ma:extend(.md) in @media) find targets.
    const rootsToSearch = new Set(accessibleRoots);
    // Explicitly walk extendRoot's tree to add every descendant Rules (ruleset.value.rules) so we
    // always find nested rulesets (e.g. .rep_ace:extend(.replace all) must extend the inner .replace, .c ruleset).
    const walkRules = (rules: Rules, visited: Set<Rules>): void => {
      if (visited.has(rules)) return;
      visited.add(rules);
      rootsToSearch.add(rules);
      for (const node of rules.value) {
        if (node && isNode(node, 'Ruleset') && node.value?.rules && isNode(node.value.rules, 'Rules')) {
          walkRules(node.value.rules as Rules, visited);
        }
      }
    };
    walkRules(extendRoot, new Set());
    accessibleRoots = rootsToSearch;

    // If target is a SelectorList (e.g., .aa, .bb), process each selector separately
    const targetSelectors: Selector[] = isNode(target, 'SelectorList')
      ? target.value
      : [target];

    for (const singleTarget of targetSelectors) {
      // Skip self-referencing extends for individual selectors too
      if (singleTarget.valueOf() === selectorWithExtend.valueOf()) {
        continue;
      }

      const singleTargetStr = typeof singleTarget.valueOf === 'function' ? singleTarget.valueOf() : '';
      const traceMd = shouldTraceExtendMd(context, singleTargetStr);

      if (traceMd) {
        let extendRootSerialized: string;
        try {
          extendRootSerialized = serializeTypes(extendRoot, { maxStringLength: 60, indentSize: 1 }).slice(0, 800);
        } catch {
          extendRootSerialized = '(serialize error)';
        }
        const opts = context.opts as { collapseNesting?: boolean; output?: { collapseNesting?: boolean } } | undefined;
        syncLog({
          trace: 'processExtend_start',
          runId: getExtendTraceRunId(context),
          collapseNesting: Boolean(opts?.collapseNesting ?? opts?.output?.collapseNesting),
          target: singleTargetStr,
          selectorWithExtend: typeof selectorWithExtend.valueOf === 'function' ? selectorWithExtend.valueOf() : '',
          extendRootSummary: rulesStructureSummary(extendRoot),
          extendRootSerialized,
          rootsToSearchCount: accessibleRoots.size,
          rootsToSearchSummaries: [...accessibleRoots].map(r => rulesStructureSummary(r))
        });
      }

      // Find rulesets matching this single target in accessible roots
      let rulesetSet: Ruleset[] | undefined;

      for (const searchRoot of accessibleRoots) {
        const searchKeySet = singleTarget.keySet;
        let found = searchRoot.find('ruleset', searchKeySet);
        // Fallback: scan searchRoot (and all nested Rules) for matching rulesets so we find
        // nested rulesets at any depth, even when the registry was built on a different Rules
        // instance (e.g. after eval clone) or when collapseNesting wraps at-rule body in Ruleset(&).
        // Always recurse into every Ruleset's rules and every direct Rules child—no special cases for root shape.
        if (searchRoot.value?.length) {
          const keySet = searchKeySet instanceof Set ? searchKeySet : new Set(searchKeySet);
          const targetValue = singleTarget.valueOf();
          const targetNormalized = normalizedSelectorValueOf(singleTarget as Selector);
          const scanRules = (rules: Rules): void => {
            for (const node of rules.value) {
              if (isNode(node, 'Ruleset')) {
                const rs = node as Ruleset;
                const sel = rs.selector;
                if (sel && !isNode(sel, 'Nil')) {
                  let matches = false;
                  if ('keySet' in sel) {
                    let isSubset = true;
                    for (const k of keySet) {
                      if (!(sel as Selector).keySet.has(k as string)) {
                        isSubset = false;
                        break;
                      }
                    }
                    matches = isSubset;
                  }
                  if (!matches && typeof sel.valueOf === 'function') {
                    const selNorm = normalizedSelectorValueOf(sel);
                    const selCanon = canonicalSelectorValueOf(sel);
                    const targetCanon = canonicalSelectorValueOf(singleTarget as Selector);
                    if (
                      sel.valueOf() === targetValue
                      || (targetNormalized && (selNorm === targetNormalized || (targetCanon && selCanon === targetCanon)))
                    ) {
                      matches = true;
                    }
                    // Match when selector is ComplexSelector with leading Ampersand: resolve and compare (selector may not have valueOf resolved at scan time).
                    if (!matches && isNode(sel, 'ComplexSelector')) {
                      const cs = sel as ComplexSelector;
                      const first = cs.value[0];
                      if (first && typeof (first as Ampersand).getResolvedSelector === 'function') {
                        const resolved = (first as Ampersand).getResolvedSelector();
                        if (resolved && !isNode(resolved, 'Nil')) {
                          const rest = cs.value.slice(1);
                          const restStr = rest.map((c: Node) => (c as Selector).valueOf?.() ?? '').join(' ').trim();
                          const resolvedStr = `${(resolved as Selector).valueOf?.() ?? ''} ${restStr}`.trim();
                          const resolvedNorm = String(resolvedStr).replace(/\s+/g, '').trim();
                          if (resolvedNorm && targetNormalized && resolvedNorm === targetNormalized) {
                            matches = true;
                          }
                        }
                      }
                    }
                  }
                  if (matches) {
                    const existing = found ?? [];
                    if (!existing.includes(rs)) {
                      found = existing.length ? [...existing, rs] : [rs];
                    }
                  }
                }
                if (rs.value?.rules && isNode(rs.value.rules, 'Rules')) {
                  scanRules(rs.value.rules as Rules);
                }
              } else if (isNode(node, 'Rules')) {
                scanRules(node as Rules);
              }
            }
          };
          scanRules(searchRoot);
        }
        if (traceMd) {
          syncLog({
            trace: 'search_root',
            runId: getExtendTraceRunId(context),
            searchRootSummary: rulesStructureSummary(searchRoot),
            foundCount: found ? found.length : 0,
            foundSelectors: found ? found.map(rs => typeof rs.selector?.valueOf === 'function' ? rs.selector.valueOf() : '') : []
          });
        }
        if (found) {
          // Only merge into rulesets in extendRoot or in a descendant root of extendRoot.
          // Do NOT merge into rulesets in an ancestor root (e.g. .ma in @media extending .a at root
          // must not add .ma to the root .a ruleset; .tv-lowres in @media must not add to root).
          // Root .all:extend(.ext1) may add .all to .ext1 rulesets in root and in nested @media (descendants).
          const filterRejectsTrace: { sel: string; reason: string }[] = [];
          const sameOrDescendantRoot = found.filter((rs: Ruleset) => {
            // When extendRoot is a wrapper (Ruleset(&) with inner Rules), target in that inner Rules
            // is same-root; allow merge so .ma:extend(.md) in @media finds .md. Check first so we
            // don't reject due to effectiveRoot walking up to an unregistered clone.
            if (
              extendRoot.value?.length === 1
              && extendRoot.value[0] != null
              && isNode(extendRoot.value[0], 'Ruleset')
            ) {
              const innerRules = (extendRoot.value[0] as Ruleset).value?.rules;
              if (innerRules != null && rs.parent === innerRules) {
                return true;
              }
            }
            // When extendRoot is a Rules with one child that is Rules (post-eval unwrapped body),
            // target in that child is same-root.
            if (
              extendRoot.value?.length === 1
              && extendRoot.value[0] != null
              && isNode(extendRoot.value[0], 'Rules')
              && rs.parent === extendRoot.value[0]
            ) {
              return true;
            }
            const effectiveRoot = getEffectiveExtendRoot(rs);
            if (!effectiveRoot) {
              return true;
            }
            // Extend at document root can target any ruleset in the same root (e.g. .footer-nav:extend(.header .header-nav) finding nested .header-nav).
            if (extendRoot === context.root && effectiveRoot === context.root) {
              return true;
            }
            if (
              context.extendRoots.isAncestorRoot(effectiveRoot, extendRoot)
              && effectiveRoot !== extendRoot
            ) {
              if (traceMd) {
                filterRejectsTrace.push({
                  sel: typeof rs.selector?.valueOf === 'function' ? rs.selector.valueOf() : '',
                  reason: 'isAncestorRoot'
                });
              }
              return false;
            }
            // Same or descendant: merge into rulesets in extendRoot or its descendants.
            if (context.extendRoots.isSameOrDescendantRoot(effectiveRoot, extendRoot)) {
              return true;
            }
            // effectiveRoot is extendRoot's inner Rules (same object).
            if (
              extendRoot.value?.length === 1
              && extendRoot.value[0] != null
              && isNode(extendRoot.value[0], 'Ruleset')
            ) {
              const innerRules = (extendRoot.value[0] as Ruleset).value?.rules;
              if (innerRules === effectiveRoot) {
                return true;
              }
            }
            // When collapseNesting wraps at-rule body in a wrapper, rulesets can live in a clone that's
            // not in allRoots, so getEffectiveExtendRoot walks up to the wrapper. Allow merge only when
            // effectiveRoot is that wrapper (one child Ruleset with inner Rules), not any ancestor.
            const isAncestor = context.extendRoots.isAncestorRoot(effectiveRoot, extendRoot);
            const isDocRoot = effectiveRoot === context.root;
            const effIsWrapper =
              effectiveRoot.value?.length === 1
              && effectiveRoot.value[0] != null
              && isNode(effectiveRoot.value[0], 'Ruleset')
              && (effectiveRoot.value[0] as Ruleset).value?.rules != null
              && isNode((effectiveRoot.value[0] as Ruleset).value!.rules, 'Rules');
            if (isAncestor && !isDocRoot && effIsWrapper) {
              return true;
            }
            const effectiveParent = context.extendRoots.getParentRoot(effectiveRoot);
            const extendParent = context.extendRoots.getParentRoot(extendRoot);
            if (effectiveParent && extendParent && effectiveParent === extendParent) {
              return true;
            }
            // Same AST parent: two inner Rules (e.g. clone A vs clone B) under the same wrapper.
            if (effectiveRoot.parent === extendRoot.parent) {
              return true;
            }
            // Same wrapper (grandparent): inner Rules may have different Ruleset parents after eval.
            const ep = effectiveRoot.parent;
            const xp = extendRoot.parent;
            if (
              ep
              && xp
              && ep !== xp
              && isNode(ep, 'Ruleset')
              && isNode(xp, 'Ruleset')
              && ep.parent === xp.parent
            ) {
              return true;
            }
            // extendRoot is detached (preEval clone never attached after eval); target is in inner Rules under wrapper.
            const effectiveIsInner =
              ep
              && isNode(ep, 'Ruleset')
              && ep.parent
              && isNode(ep.parent, 'Rules')
              && (ep.parent as Rules).value?.length === 1;
            if (!extendRoot.parent && effectiveIsInner) {
              return true;
            }
            // Target's root has no parent (detached inner Rules); allow. Exclude document root.
            if (!effectiveRoot.parent && effectiveRoot !== context.root) {
              return true;
            }
            // Target ruleset's direct parent (inner Rules) not in allRoots; getEffectiveExtendRoot walked to doc root.
            const targetInner = rs.parent;
            const targetWrapper =
              targetInner?.parent?.parent
              && isNode(targetInner.parent, 'Ruleset')
              && isNode(targetInner.parent.parent, 'Rules')
                ? (targetInner.parent.parent as Rules)
                : undefined;
            const extendWrapper =
              xp?.parent && isNode(xp.parent, 'Rules') ? (xp.parent as Rules) : undefined;
            if (
              targetWrapper
              && extendWrapper
              && targetWrapper === extendWrapper
              && targetInner
              && isNode(targetInner, 'Rules')
              && !allRoots.has(targetInner)
            ) {
              return true;
            }
            // effectiveRoot === context.root but target is nested; extendRoot is nested. Only when target's parent Rules is not in allRoots (collapseNesting inner clone).
            if (
              effectiveRoot === context.root
              && rs.parent !== context.root
              && extendRoot.parent?.parent != null
              && rs.parent
              && isNode(rs.parent, 'Rules')
              && !allRoots.has(rs.parent)
            ) {
              return true;
            }
            if (traceMd) {
              const effInAll = allRoots.has(effectiveRoot);
              const extInAll = allRoots.has(extendRoot);
              filterRejectsTrace.push({
                sel: typeof rs.selector?.valueOf === 'function' ? rs.selector.valueOf() : '',
                reason: `fallthrough effInAll=${effInAll} extInAll=${extInAll} effLen=${effectiveRoot.value?.length} extLen=${extendRoot.value?.length} rsParentLen=${(rs.parent as Rules)?.value?.length}`
              });
            }
            return false;
          });
          if (traceMd) {
            syncLog({
              trace: 'filter_result',
              runId: getExtendTraceRunId(context),
              foundCount: found.length,
              sameOrDescendantRootCount: sameOrDescendantRoot.length,
              filterRejects: filterRejectsTrace
            });
          }
          if (sameOrDescendantRoot.length > 0) {
            if (rulesetSet) {
              rulesetSet.push(...sameOrDescendantRoot);
            } else {
              rulesetSet = sameOrDescendantRoot;
            }
          }
        }
      }
      if (traceMd) {
        syncLog({
          trace: 'after_search',
          runId: getExtendTraceRunId(context),
          rulesetSetLength: rulesetSet?.length ?? 0
        });
      }
      // Handle warnings for Less compatibility (only on first processing)

      if (!rulesetSet || rulesetSet.length === 0) {
        // Check if target exists anywhere (not just in accessible roots)
        const allRootsForWarning = context.extendRoots.getAlts();
        let targetExistsElsewhere = false;
        let existsCount = 0;

        for (const searchRoot of allRootsForWarning) {
          if (!accessibleRoots.has(searchRoot)) {
            const found = searchRoot.find('ruleset', singleTarget.keySet);
            if (found && found.length > 0) {
              targetExistsElsewhere = true;
              existsCount += found.length;
              break;
            }
          }
        }

        // Collect warnings (only on first processing)
        if (depth === 0) {
          if (targetExistsElsewhere) {
            const warning = WARN.extendNotAccessible({
              ctx: context.treeContext?.file ? { file: context.treeContext.file } : undefined,
              node: extendNode.location && extendNode.location.length === 6 ? { location: extendNode.location } : undefined,
              meta: { target: singleTarget.valueOf() }
            });
            const warningDiag = toDiagnostic(warning);
            if (!('errors' in warningDiag)) {
              context.warnings.push(warningDiag);
            }
          } else {
            const warning = WARN.extendNotFound({
              ctx: context.treeContext?.file ? { file: context.treeContext.file } : undefined,
              node: extendNode.location && extendNode.location.length === 6 ? { location: extendNode.location } : undefined,
              meta: { target: singleTarget.valueOf() }
            });
            const warningDiag = toDiagnostic(warning);
            if (!('errors' in warningDiag)) {
              context.warnings.push(warningDiag);
            }
          }
        }
      }

      // Capture each ruleset's parent selector string before we update any (so we can detect
      // nested rulesets whose selector equals parent's and use ownSelector for extend).
      const parentSelectorAtStart = new Map<Ruleset, string>();
      if (rulesetSet) {
        for (const rs of rulesetSet) {
          const pr = rs.parent?.parent;
          if (pr && isNode(pr, 'Ruleset')) {
            const sel = (pr as Ruleset).selector;
            parentSelectorAtStart.set(rs, typeof sel?.valueOf === 'function' ? sel.valueOf() : '');
          }
        }
      }

      // Apply extends to rulesets directly
      if (rulesetSet) {
        rulesetSet.forEach((ruleset) => {
          if (shouldSkipRuleset(ruleset, extendNode)) {
            if (traceMd) {
              syncLog({
                trace: 'apply_skip',
                runId: getExtendTraceRunId(context),
                reason: 'shouldSkipRuleset',
                rulesetSel: typeof ruleset.selector?.valueOf === 'function' ? ruleset.selector.valueOf() : ''
              });
            }
            return; // Skip this ruleset - it's the source of the extend
          }

          // When this ruleset's selector equals its parent's (at start), use own selector so we
          // extend .replace,.c not the resolved form (rep_ace bug).
          const rawSelector = ruleset.selector as Selector;
          const ownSel = (ruleset.options as { ownSelector?: Selector })?.ownSelector;
          const rawStr = typeof rawSelector?.valueOf === 'function' ? rawSelector.valueOf() : '';
          const parentSelAtStart = parentSelectorAtStart.get(ruleset) ?? '';
          const ownStr = ownSel && typeof ownSel.valueOf === 'function' ? ownSel.valueOf() : '';
          const sameAsParentAtStart = rawStr === parentSelAtStart && parentSelAtStart.length > 0;
          // Nested ruleset's selector can be "resolved" (longer than own); use own so we extend
          // .replace,.c not the resolved form (rep_ace bug). Only when we have a parent (in map).
          const isNestedWithResolvedSelector =
            parentSelAtStart.length > 0 && ownStr.length > 0 && rawStr.length > ownStr.length;
          let useOwn = (sameAsParentAtStart || isNestedWithResolvedSelector) && !!ownSel;
          // If extend target is the full resolved selector (e.g. .header .header-nav), we must pass
          // the resolved selector to tryExtendSelector so the match succeeds; passing own (.header-nav) would not match.
          const targetNorm = normalizedSelectorValueOf(singleTarget as Selector);
          const rawNorm = normalizedSelectorValueOf(rawSelector);
          if (useOwn && targetNorm && rawNorm === targetNorm) {
            useOwn = false;
          }
          const originalSelector = (useOwn ? ownSel : rawSelector) as Selector;
          const origStr = typeof originalSelector?.valueOf === 'function' ? originalSelector.valueOf() : '';

          // Check if this extend has already transformed this ruleset's selector
          const extendKey = `${singleTarget.valueOf()}:${selectorWithExtend.valueOf()}:${partial}`;
          if (!transformedByExtend.has(ruleset)) {
            transformedByExtend.set(ruleset, new Set());
          }
          const transformsForRuleset = transformedByExtend.get(ruleset)!;

          // Skip if this extend has already transformed this ruleset
          if (transformsForRuleset.has(extendKey)) {
            if (traceMd) {
              syncLog({
                trace: 'apply_skip',
                runId: getExtendTraceRunId(context),
                reason: 'alreadyTransformed',
                rulesetSel: typeof ruleset.selector?.valueOf === 'function' ? ruleset.selector.valueOf() : ''
              });
            }
            return; // This extend already transformed this ruleset - skip
          }

          // Skip if this exact extend was previously rejected for this ruleset (e.g. .bb .bb for .bb:extend(.ee)).
          // Phase 2 would otherwise re-apply it when the selector is flattened to [.bb, .ff] and wrongly add .ee.
          if (!partial && rejectedExactExtendByRuleset.get(ruleset)?.has(extendKey)) {
            return;
          }

          // Track object identity and structure to detect transformations

          let result = tryExtendSelector(originalSelector, singleTarget, selectorWithExtend, partial);
          const changed = result && !result.error && result.value.valueOf() !== originalSelector.valueOf();
          // Record exact extends we rejected only when the selector was "find find" (e.g. .bb .bb).
          // Phase 2 must not re-apply those when the selector is later flattened to [.bb, .ff].
          // Do not record for other complex selectors (e.g. .aa .dd) so .dd:extend(.ff) still applies there.
          const findVal = singleTarget.valueOf();
          const wasSameNestedSelector =
            typeof findVal === 'string'
            && origStr.includes(' ')
            && isNode(originalSelector, 'ComplexSelector')
            && origStr === `${findVal} ${findVal}`;
          if (!partial && result && !result.error && !changed && wasSameNestedSelector) {
            if (!rejectedExactExtendByRuleset.has(ruleset)) {
              rejectedExactExtendByRuleset.set(ruleset, new Set());
            }
            rejectedExactExtendByRuleset.get(ruleset)!.add(extendKey);
          }
          if (traceMd) {
            syncLog({
              trace: 'tryExtend',
              runId: getExtendTraceRunId(context),
              rulesetSel: typeof ruleset.selector?.valueOf === 'function' ? ruleset.selector.valueOf() : '',
              hasResult: !!result,
              error: result?.error ?? null,
              changed: result && !result.error ? result.value.valueOf() !== originalSelector.valueOf() : null
            });
          }

          if (result && !result.error) {
            const extendedSelector = result.value;
            const origStr = typeof originalSelector?.valueOf === 'function' ? String(originalSelector.valueOf()) : '';
            const extStr = typeof extendedSelector?.valueOf === 'function' ? String(extendedSelector.valueOf()) : '';
            const traceDd = origStr.includes('dd') && (origStr.includes('aa') || origStr.includes('.dd'));
            if (traceDd) {
              const extItemCount = isNode(extendedSelector, 'SelectorList') ? (extendedSelector as SelectorList).value?.length : 1;
              syncLog({
                trace: 'phase1_extend_dd',
                target: String(singleTarget.valueOf?.() ?? '').slice(0, 40),
                origLen: origStr.length,
                extLen: extStr.length,
                extItemCount,
                changed: extendedSelector.valueOf() !== originalSelector.valueOf()
              });
            }

            // Only update if selector actually changed
            if (extendedSelector.valueOf() !== originalSelector.valueOf()) {
              // Mark that this extend has transformed this ruleset
              transformsForRuleset.add(extendKey);

              const shouldHoist = !!extendedSelector.hoistToRoot;
              // CRITICAL: Clone the selector to avoid object reference issues
              const clonedSelector = extendedSelector.clone(true);
              preserveImplicitAmpersandOnClone(extendedSelector as Selector, clonedSelector as Selector);
              if (shouldHoist) {
                // NOTE: Node.clone()/inherit() does not currently copy hoistToRoot.
                clonedSelector.hoistToRoot = true;
              }
              // Update the ruleset's selector directly
              const origStrForHoist = typeof originalSelector?.valueOf === 'function' ? String(originalSelector.valueOf()) : '';
              const clonedStr = typeof clonedSelector?.valueOf === 'function' ? String(clonedSelector.valueOf()) : '';
              const hoisted = maybeHoistMixedNestingSelectorList(ruleset, clonedSelector as Selector, partial);
              const hoistStr = typeof hoisted?.valueOf === 'function' ? String(hoisted.valueOf()) : '';
              const parentRules = ruleset.parent;
              const parentLen = parentRules && isNode(parentRules, 'Rules') ? (parentRules as Rules).value?.length : 0;
              const traceDdPipeline = hoistStr.includes('dd') && (hoistStr.includes('aa') || hoistStr.includes('.dd'));
              if (traceDdPipeline) {
                const hoistItemCount = isNode(hoisted, 'SelectorList') ? (hoisted as SelectorList).value?.length : 1;
                syncLog({
                  trace: 'phase1_after_hoist_dd',
                  hoistItemCount,
                  hoistSlice: hoistStr.slice(0, 120)
                });
              }
              // Normalize selectors after extend so generated :is() wrappers can be unwrapped/merged
              // when they are the only simple selector in a selector-list item (Less expectations).
              const normalized = createProcessedSelector(hoisted, true);
              if (traceDdPipeline) {
                const normStr = typeof normalized?.valueOf === 'function' ? String(normalized.valueOf()) : '';
                const normItemCount = isNode(normalized, 'SelectorList') ? (normalized as SelectorList).value?.length : Array.isArray(normalized) ? normalized.length : 1;
                syncLog({
                  trace: 'phase1_after_createProcessed_dd',
                  normItemCount,
                  normSlice: normStr.slice(0, 120)
                });
              }
              // Materialize implicit ampersand in items from a different context (e.g. extendWith)
              // so they serialize correctly; keep implicit when same context (nested .a, .c).
              const materialized = materializeNormalizedWhenDifferentContext(normalized, ruleset);
              if (traceDdPipeline) {
                const matItemCount = Array.isArray(materialized) ? materialized.length : (isNode(materialized, 'SelectorList') ? (materialized as SelectorList).value?.length : 1);
                const matStr = Array.isArray(materialized) ? materialized.map((s: Selector) => String(s.valueOf?.() ?? '')).join(' | ') : String((materialized as Selector).valueOf?.() ?? '');
                syncLog({
                  trace: 'phase1_after_materialize_dd',
                  matItemCount,
                  matSlice: matStr.slice(0, 160)
                });
              }
              let normalizedSelector: Selector;
              if (Array.isArray(materialized)) {
                normalizedSelector = SelectorList.create(materialized.map(s => s.clone(true))).inherit(hoisted);
              } else {
                normalizedSelector = materialized as Selector;
              }
              // NOTE: Node.clone()/inherit() does not currently copy hoistToRoot.
              if (hoisted.hoistToRoot) {
                normalizedSelector.hoistToRoot = true;
              }
              const leadingIsResult = processLeadingIs(normalizedSelector);
              normalizedSelector = Array.isArray(leadingIsResult)
                ? SelectorList.create(leadingIsResult.map(s => s.copy(true) as Selector)).inherit(normalizedSelector) as Selector
                : leadingIsResult;
              // Debug rep_ace: log when we update a ruleset that looks like the nested .replace,.c one
              const origStr = typeof originalSelector?.valueOf === 'function' ? String(originalSelector.valueOf()) : '';
              const normStr = typeof normalizedSelector?.valueOf === 'function' ? String(normalizedSelector.valueOf()) : '';
              const parentRuleset =
                ruleset.parent?.parent && isNode(ruleset.parent.parent, 'Ruleset')
                  ? (ruleset.parent.parent as Ruleset)
                  : null;
              let valueSharedWithAncestor = false;
              for (let p: typeof ruleset.parent = ruleset.parent; p; p = p.parent) {
                if (isNode(p, 'Ruleset') && (p as Ruleset).value === ruleset.value) {
                  valueSharedWithAncestor = true;
                  break;
                }
              }
              const valueSharedWithParent = parentRuleset !== null && ruleset.value === parentRuleset.value;
              // If this ruleset shares its value object with an ancestor ruleset, assigning
              // value.selector would overwrite the ancestor's selector too. Give this ruleset
              // its own value object so we only update this ruleset's selector.
              if (valueSharedWithAncestor) {
                ruleset.value = {
                  selector: ruleset.value.selector,
                  rules: ruleset.value.rules,
                  ...(ruleset.value.guard !== undefined && { guard: ruleset.value.guard })
                };
              }
              // Before we overwrite this ruleset's selector, give any descendant rulesets that
              // share this value their own value so they keep their current selector.
              ensureDescendantRulesetsHaveOwnValue(ruleset, ruleset.value);
              ensureSelectorListItemsVisible(normalizedSelector);
              ruleset.value.selector = normalizedSelector;
              ruleset.invalidateSelectorValueCache();
              if (normalizedSelector.hoistToRoot) {
                ruleset.hoistToRoot = true;
              }

              extendedRulesets.add(ruleset); // Track that this ruleset was extended
              reindexRuleset(ruleset);

              // NOTE: Do not apply chained extends depth-first.
              //
              // Chaining must not reorder independent extends that share a target and must not
              // cause later extends to be applied early. Phase 2 is responsible for reaching
              // a fixed point by extending already-extended selectors (including cycles).
            } else {
            }
          } else {
          }
        });
      }
    }
    processedExtends.delete(extendKey);
  };

  // Phase 1: Process all original extends depth-first
  for (const [target, selectorWithExtend, partial, extendRoot, extendNode] of allExtends) {
    processExtend(target, selectorWithExtend, partial, extendRoot, extendNode);
  }

  // Phase 2: Iterative multi-pass on extended rulesets
  let rulesetsToCheck = new Set<Ruleset>(extendedRulesets);
  const seenSelectorStates = new Map<Ruleset, Set<string>>(); // Track selector states per ruleset to detect loops
  const maxIterations = 100; // Prevent infinite loops
  let iteration = 0;

  while (rulesetsToCheck.size > 0 && iteration < maxIterations) {
    iteration++;

    const nextIteration = new Set<Ruleset>();

    // Initialize seen states for new rulesets
    for (const ruleset of rulesetsToCheck) {
      if (!seenSelectorStates.has(ruleset)) {
        seenSelectorStates.set(ruleset, new Set<string>());
      }
    }

    for (const ruleset of rulesetsToCheck) {
      const currentSelector = ruleset.selector as Selector;
      const currentSelectorValue = currentSelector.valueOf();
      const seenStates = seenSelectorStates.get(ruleset)!;
      let phase2ConsideredTargets = 0;
      let phase2SkipKeySet = 0;
      let phase2SkipInaccessible = 0;
      let phase2SkipAlreadyTransformed = 0;
      let phase2TryExtendSelector = 0;
      let phase2SelectorChanged = 0;

      // Check if we've seen this selector state before (infinite loop detection)
      if (seenStates.has(currentSelectorValue)) {
        continue; // Infinite loop detected - skip this ruleset
      }
      seenStates.add(currentSelectorValue);

      // Check if this ruleset's selector matches any extend targets
      const currentSelectors: Selector[] = isNode(currentSelector, 'SelectorList')
        ? currentSelector.value
        : [currentSelector];

      // Check each selector in the current ruleset against all extend targets.
      // NOTE: This loop is used ONLY for fast keySet rejection. We must not run
      // tryExtendSelector multiple times for the same (ruleset, extendKey).
      // The first iteration does the work; subsequent iterations are redundant because
      // we always call tryExtendSelector on `currentSelector` (not on `currentSel`).
      // We'll keep the loop but ensure we only attempt each extend once.
      const attemptedPhase2ExtendKeys = new Set<string>();
      // KeySet rejection must consider *any* selector-list item, but we must not "attempt"
      // an extendKey based on a non-matching representative item (that would skip real matches).
      for (const [target, selectorWithExtend, partial, extendRoot, extendNode] of allExtends) {
        if (shouldSkipRuleset(ruleset, extendNode)) {
          continue; // Skip this extend for this ruleset
        }

        const targetSelectors: Selector[] = isNode(target, 'SelectorList')
          ? target.value
          : [target];

        for (const singleTarget of targetSelectors) {
          const phase2ExtendKey = `${singleTarget.valueOf()}:${selectorWithExtend.valueOf()}:${partial}`;
          if (attemptedPhase2ExtendKeys.has(phase2ExtendKey)) {
            continue;
          }

          // Fast rejection: check overlap against any selector-list item.
          const targetKeySet = singleTarget.keySet;
          const keySetOverlaps = currentSelectors.some((currentSel) => {
            const currentSelKeySet = currentSel.keySet;
            return partial
              ? targetKeySet.isSubsetOf(currentSelKeySet)
              : targetKeySet.size === currentSelKeySet.size && targetKeySet.isSubsetOf(currentSelKeySet);
          });

          if (!keySetOverlaps) {
            phase2SkipKeySet++;
            continue; // Fast rejection - keys don't overlap
          }

          // Mark as attempted only once we know it's plausible to match.
          attemptedPhase2ExtendKeys.add(phase2ExtendKey);
          phase2ConsideredTargets++;

          // Check if ruleset is accessible for this extend and in same/child root (not ancestor).
          // Prefer finding via registry; if the ruleset was extended in Phase 1 its keySet may have changed
          // so find(singleTarget.keySet) may not return it (e.g. .ma,.mb ruleset not found when searching for .mb).
          const accessibleRoots = context.extendRoots.getAccessibleRoots(extendRoot);
          let foundRuleset = false;

          for (const searchRoot of accessibleRoots) {
            const found = searchRoot.find('ruleset', singleTarget.keySet);
            if (found && found.includes(ruleset)) {
              const effectiveRoot = getEffectiveExtendRoot(ruleset);
              if (effectiveRoot && context.extendRoots.isSameOrDescendantRoot(effectiveRoot, extendRoot)) {
                foundRuleset = true;
              }
              break;
            }
          }
          // Phase 2: we already have the ruleset; if keySetOverlaps and it's in an accessible root, allow apply.
          if (!foundRuleset) {
            const effectiveRoot = getEffectiveExtendRoot(ruleset);
            if (effectiveRoot && context.extendRoots.isSameOrDescendantRoot(effectiveRoot, extendRoot)) {
              foundRuleset = true;
            }
          }

          if (!foundRuleset) {
            phase2SkipInaccessible++;
            continue; // Ruleset not accessible for this extend
          }

          // Check if this extend has already transformed this ruleset's selector
          const extendKey = `${singleTarget.valueOf()}:${selectorWithExtend.valueOf()}:${partial}`;
          if (!transformedByExtend.has(ruleset)) {
            transformedByExtend.set(ruleset, new Set());
          }
          const transformsForRuleset = transformedByExtend.get(ruleset)!;

          // Skip if this extend has already transformed this ruleset
          if (transformsForRuleset.has(extendKey)) {
            phase2SkipAlreadyTransformed++;
            continue; // This extend already transformed this ruleset - skip
          }

          // Skip if this exact extend was rejected for this ruleset in Phase 1 (e.g. .bb .bb for .bb:extend(.ee)).
          // The selector may now be flattened to [.bb, .ff]; re-applying would wrongly add .ee.
          if (!partial && rejectedExactExtendByRuleset.get(ruleset)?.has(extendKey)) {
            continue;
          }

          // Try to extend - tryExtendSelector will check for actual matches (including combinators)
          // and return an error if there's no match
          phase2TryExtendSelector++;
          const result = tryExtendSelector(currentSelector, singleTarget, selectorWithExtend, partial);

          if (result && !result.error) {
            const extendedSelector = result.value;

            // Only update if selector actually changed
            if (extendedSelector.valueOf() !== currentSelectorValue) {
              phase2SelectorChanged++;
              // Mark that this extend has transformed this ruleset
              transformsForRuleset.add(extendKey);

              const shouldHoist = !!extendedSelector.hoistToRoot;
              // CRITICAL: Clone the selector to avoid object reference issues
              const clonedSelector = extendedSelector.clone(true);
              preserveImplicitAmpersandOnClone(extendedSelector as Selector, clonedSelector as Selector);
              if (shouldHoist) {
                // NOTE: Node.clone()/inherit() does not currently copy hoistToRoot.
                clonedSelector.hoistToRoot = true;
              }
              // Normalize selectors after extend so generated :is() wrappers can be unwrapped/merged
              // when they are the only simple selector in a selector-list item (Less expectations).
              const normalized = createProcessedSelector(clonedSelector, true);
              const materialized = materializeNormalizedWhenDifferentContext(normalized, ruleset);
              let normalizedSelector: Selector;
              if (Array.isArray(materialized)) {
                normalizedSelector = SelectorList.create(materialized.map(s => s.clone(true))).inherit(clonedSelector);
              } else {
                normalizedSelector = materialized as Selector;
              }
              ensureSelectorListItemsVisible(normalizedSelector);
              ruleset.value.selector = normalizedSelector;
              ruleset.invalidateSelectorValueCache();
              if (normalizedSelector.hoistToRoot) {
                ruleset.hoistToRoot = true;
              }

              reindexRuleset(ruleset);
              nextIteration.add(ruleset); // Keep in next iteration
              break; // Found a match, no need to check other targets
            }
          }
        }
      }

      // If we added to nextIteration, break out of outer loop
      if (nextIteration.has(ruleset)) {
        continue;
      }
    }

    rulesetsToCheck = nextIteration;
  }

  if (iteration >= maxIterations) {
    throw new Error(`Extend chaining exceeded maximum iterations (${maxIterations}). Possible infinite loop.`);
  }
  setExtendOrderMap(null);
}
