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
import { WARN, toDiagnostic } from '../../jess-error.js';
import { syncLog } from './__tests__/debug-log.js';

// NOTE: extend tracing instrumentation removed (debug-only).

function __agentTraceContextId(_context: object): number {
  return 0;
}

function __agentExtendTrace(_location: string, _message: string, _data: Record<string, unknown>) {
  // noop
}

// #region agent log
let __agentRootSeq = 0;
const __agentRootIds = new WeakMap<object, number>();
function __agentRootId(root: object | undefined): number | null {
  if (!root) {
    return null;
  }
  let id = __agentRootIds.get(root);
  if (id == null) {
    id = ++__agentRootSeq;
    __agentRootIds.set(root, id);
  }
  return id;
}
function __agentAccessLog(message: string, data: Record<string, unknown>) {
  void message;
  void data;
  // (debug log removed)
}
// #endregion

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
      // For hoisted selector serialization we need leading components to be visible,
      // otherwise `toString()` can drop the parent prefix.
      if (first instanceof Node) {
        first.addFlag(F_VISIBLE);
      }
      if (second instanceof Node) {
        second.addFlag(F_VISIBLE);
      }
      if (
        first instanceof Ampersand
        && first.hasFlag(F_IMPLICIT_AMPERSAND)
        && first.value.selector
        && !(first.value.selector instanceof Nil)
      ) {
        // Replace implicit ampersand with its concrete parent selector so
        // serialization at root doesn't drop it.
        let parentSelConcrete: Selector = first.value.selector.copy(true);
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

  // #region agent log
  try {
    if (process.env.DEBUG_EXTEND_EXACT_DEEP === 'true') {
      const selV = (selector as any)?.valueOf?.() ?? '';
      if (typeof selV === 'string' && (selV.includes('rep_ace') || selV.includes('replace'))) {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H36',
          location: 'extend-roots.ts:maybeHoistMixedNestingSelectorList',
          message: 'hoist-enter',
          data: {
            partial,
            selectorV: selV,
            selectorType: (selector as any)?.type ?? null,
            listV: (list as any)?.valueOf?.() ?? null,
            parentSelType: (parentSel as any)?.type ?? null,
            parentSelV: (() => { try { return (parentSel as any)?.valueOf?.() ?? null; } catch { return null; } })(),
            anyImplicit: items.some((s) => {
              try {
                if (isNode(s, 'ComplexSelector')) {
                  const first = (s as ComplexSelector).value[0];
                  return first instanceof Ampersand && first.hasFlag(F_IMPLICIT_AMPERSAND);
                }
                return false;
              } catch {
                return false;
              }
            }),
            hasSimple: items.some(s => !isNode(s, 'ComplexSelector')),
            item0: (() => { try { return items[0]?.valueOf?.() ?? null; } catch { return null; } })(),
            itemLast: (() => { try { return items[items.length - 1]?.valueOf?.() ?? null; } catch { return null; } })()
          },
          timestamp: Date.now()
        });
      }
    }
  } catch {}
  // #endregion

  // #region agent log
  if (process.env.DEBUG_EXTEND_BOOT === 'true') {
    const selV = (() => {
      try { return (selector as any)?.valueOf?.() ?? null; } catch { return null; }
    })();
    if (typeof selV === 'string' && (selV.includes('rep_ace') || selV.includes('replace'))) {
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
        hypothesisId: 'H9',
        location: 'extend-roots.ts:maybeHoistMixedNestingSelectorList',
        message: 'hoist-check',
        data: {
          partial,
          parentSelType: (parentSel as any)?.type ?? null,
          parentSelV: (() => { try { return (parentSel as any)?.valueOf?.() ?? null; } catch { return null; } })(),
          itemsV: items.slice(0, 6).map((s) => {
            try { return (s as any)?.valueOf?.() ?? null; } catch { return null; }
          }),
          itemsType: items.slice(0, 6).map((s) => (s as any)?.type ?? null)
        },
        timestamp: Date.now()
      });
    }
  }
  // #endregion

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
            if (!isNode(last as any, 'BasicSelector')) continue;
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
            // #region agent log
            try {
              if (process.env.DEBUG_EXTEND_EXACT_DEEP === 'true') {
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'run',
                  hypothesisId: 'H36',
                  location: 'extend-roots.ts:maybeHoistMixedNestingSelectorList',
                  message: 'factorized-cartesian',
                  data: {
                    parentAlts,
                    childCount: uniqLast.length,
                    out: (listOut as any)?.valueOf?.() ?? null
                  },
                  timestamp: Date.now()
                });
              }
            } catch {}
            // #endregion
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
        if (!isNode(s, 'ComplexSelector')) return s;
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
      // #region agent log
      if (process.env.DEBUG_EXTEND_BOOT === 'true') {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'pre-fix',
          hypothesisId: 'H9',
          location: 'extend-roots.ts:maybeHoistMixedNestingSelectorList',
          message: 'hoist-triggered',
          data: {
            anyImplicit,
            hasComplexWithoutImplicit,
            hasSimpleSelectors
          },
          timestamp: Date.now()
        });
      }
      // #endregion
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
  const anyPrefixedByParent = parentPrefix
    ? items.some(s => String(s.valueOf()).startsWith(parentPrefix))
    : false;
  const anyNotPrefixedByParent = parentPrefix
    ? items.some(s => !String(s.valueOf()).startsWith(parentPrefix))
    : false;
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

/**
 * Extend Roots Registry
 *
 * Manages extend root relationships and accessible roots computation.
 * Uses Rules node object identity (no wrapper class needed).
 */
export class ExtendRootRegistry {
  // Map Rules -> parent Rules
  private parentRoot = new WeakMap<Rules, Rules>();

  // Map Rules -> Set of child Rules
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
    // #region agent log
    if (process.env.DEBUG_EXTEND_ACCESS === 'true') {
      __agentAccessLog('register-root', {
        rulesId: __agentRootId(rules as unknown as object),
        parentId: __agentRootId(parent as unknown as object),
        isProtected: !!options?.isProtected,
        isCompose: !!options?.isCompose,
        layerName: options?.layerName ?? null
      });
    }
    // #endregion
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
    // #region agent log
    if (process.env.DEBUG_EXTEND_BOOT === 'true') {
      try {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H42',
          location: 'extend-roots.ts:pushExtendRoot',
          message: 'extend-root-pushed',
          data: {
            rulesId: String(rules),
            stackDepth: this.extendRootStack.length,
            previousRoot: this.extendRootStack.length > 1 ? String(this.extendRootStack[this.extendRootStack.length - 2]) : null
          },
          timestamp: Date.now()
        });
      } catch {}
    }
    // #endregion
  }

  /**
   * Pop extend root from stack
   */
  popExtendRoot(): void {
    const popped = this.extendRootStack.pop();
    // #region agent log
    if (process.env.DEBUG_EXTEND_BOOT === 'true') {
      try {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H42',
          location: 'extend-roots.ts:popExtendRoot',
          message: 'extend-root-popped',
          data: {
            poppedId: popped ? String(popped) : null,
            stackDepth: this.extendRootStack.length,
            newCurrentRoot: this.extendRootStack.length > 0 ? String(this.extendRootStack[this.extendRootStack.length - 1]) : null
          },
          timestamp: Date.now()
        });
      } catch {}
    }
    // #endregion
  }

  /**
   * Get accessible roots for a given root
   *
   * Accessible roots include:
   * - Self (the current root)
   * - Children roots (recursively, if not protected)
   * - Roots with same layer name (for @layer, if accessible)
   *
   * Excludes:
   * - Parents/ancestors (compose boundary prevents extending up)
   * - Siblings (other children of ancestors, unless same layer)
   * - Roots behind protected boundaries (stop traversal at protected roots)
   *
   * Note: @import type uses parent's root, so extends inside @import
   * can reach the parent. But @compose type creates its own root,
   * so extends inside @compose cannot reach the parent.
   *
   * IMPORTANT: Extends registered OUTSIDE media queries (in parent roots)
   * should be able to extend selectors INSIDE media queries (in child roots).
   * But extends registered INSIDE media queries should NOT extend selectors
   * OUTSIDE (in parent roots).
   * 
   * NOTE: The ordering fix (extendOrderMap) only affects the order of selectors
   * within :is() pseudo-classes, not which rulesets get extended.
   */
  getAccessibleRoots(root: Rules): Set<Rules> {
    const accessible = new Set<Rules>();
    const visited = new Set<Rules>();
    // #region agent log
    if (process.env.DEBUG_EXTEND_ACCESS === 'true') {
      __agentAccessLog('accessible-enter', {
        rootId: __agentRootId(root as unknown as object)
      });
    }
    // #endregion

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
        // #region agent log
        if (process.env.DEBUG_EXTEND_ACCESS === 'true') {
          __agentAccessLog('stop-at-protected', {
            currentId: __agentRootId(currentRoot as unknown as object)
          });
        }
        // #endregion
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
            // #region agent log
            if (process.env.DEBUG_EXTEND_ACCESS === 'true') {
              __agentAccessLog('skip-protected-child', {
                parentId: __agentRootId(currentRoot as unknown as object),
                childId: __agentRootId(child as unknown as object)
              });
            }
            // #endregion
            continue;
          }
          // Non-protected compose roots (mutable: true) ARE accessible
          // Only protected compose roots create boundaries
          // So we don't skip compose children here - we only skip if they're protected
          traverseChildren(child);
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

    // Traverse down from self to add children (compose boundary prevents going up)
    traverseChildren(root);

    return accessible;
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
  // #region agent log
  if (process.env.DEBUG_EXTEND_BOOT === 'true') {
    const filePath = context.treeContext?.file?.fullPath
      || (context.treeContext?.file?.path && context.treeContext?.file?.name
        ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
        : context.treeContext?.file?.path)
      || '';
    if (filePath.includes('extend-media')) {
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'run',
        hypothesisId: 'H46',
        location: 'extend-roots.ts:processExtends',
        message: 'processExtends-called',
        data: {
          filePath: String(filePath).substring(0, 150),
          extendsCount: context.extends.length
        },
        timestamp: Date.now()
      });
    }
  }
  // #endregion
  const allExtends = [...context.extends]; // All original extends
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
  const allRoots = context.extendRoots.getAlts();
  const allRootsArr = Array.isArray(allRoots) ? allRoots : [...allRoots];
  const file = context.treeContext?.file;
  const debugFilePath =
    file?.fullPath
    || (file?.path && file?.name ? `${file.path}/${file.name}` : '')
    || file?.path
    || '';
  const debugThisFile = typeof debugFilePath === 'string'
    && (
      debugFilePath.includes('tests-unit/extend-selector/extend-selector.less')
      || debugFilePath.includes('tests-unit/extend-selector')
      || debugFilePath.includes('tests-unit/extend-exact/extend-exact.less')
      || debugFilePath.includes('tests-unit/extend-media/extend-media.less')
      || debugFilePath.includes('tests-unit/extend-chaining/extend-chaining.less')
    );
  // #region agent log
  if (process.env.DEBUG_EXTEND_BOOT === 'true') {
    syncLog({
      sessionId: 'debug-session',
      runId: process.env.DEBUG_RUN_ID || 'pre-fix',
      hypothesisId: 'H8',
      location: 'extend-roots.ts:processExtends',
      message: 'processExtends-context',
      data: {
        debugFilePath: debugFilePath || null,
        debugThisFile,
        extendsCount: allExtends.length
      },
      timestamp: Date.now()
    });
  }
  // #endregion

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
          // #region agent log
          if (process.env.DEBUG_EXTEND_SKIP === 'true' && debugThisFile) {
            try {
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H25',
                location: 'extend-roots.ts:shouldSkipRuleset',
                message: 'skip-ruleset-extend-is-child',
                data: {
                  selector: (ruleset.selector as any)?.valueOf?.() ?? null
                },
                timestamp: Date.now()
              });
            } catch {}
          }
          // #endregion
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
            // #region agent log
            if (process.env.DEBUG_EXTEND_SKIP === 'true' && debugThisFile) {
              try {
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'run',
                  hypothesisId: 'H25',
                  location: 'extend-roots.ts:shouldSkipRuleset',
                  message: 'skip-ruleset-extend-is-prepended-sibling',
                  data: {
                    selector: (ruleset.selector as any)?.valueOf?.() ?? null
                  },
                  timestamp: Date.now()
                });
              } catch {}
            }
            // #endregion
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
              // #region agent log
              if (process.env.DEBUG_EXTEND_SKIP === 'true' && debugThisFile) {
                try {
                  syncLog({
                    sessionId: 'debug-session',
                    runId: process.env.DEBUG_RUN_ID || 'run',
                    hypothesisId: 'H25',
                    location: 'extend-roots.ts:shouldSkipRuleset',
                    message: 'skip-ruleset-extend-is-prepended-in-rules-sibling',
                    data: {
                      selector: (ruleset.selector as any)?.valueOf?.() ?? null
                    },
                    timestamp: Date.now()
                  });
                } catch {}
              }
              // #endregion
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
    // #region agent log
    const targetV = String(target.valueOf());
    if (process.env.DEBUG_EXTEND_BOOT === 'true' && targetV.includes('ext')) {
      try {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H47',
          location: 'extend-roots.ts:processExtend',
          message: 'processExtend-called',
          data: {
            target: targetV,
            extendWith: String(selectorWithExtend.valueOf()),
            partial: partial ? 'true' : 'false',
            depth: String(depth)
          },
          timestamp: Date.now()
        });
      } catch (e) {
        console.error('syncLog failed in processExtend:', e);
      }
    }
    // #endregion

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

    // #region agent log
    if (process.env.DEBUG_EXTEND_LOOP === 'true' && debugThisFile) {
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
        hypothesisId: 'H2',
        location: 'extend-roots.ts:processExtend',
        message: 'processExtend-enter',
        data: {
          depth,
          partial,
          target: target.valueOf(),
          extendWith: selectorWithExtend.valueOf()
        },
        timestamp: Date.now()
      });
    }
    // #endregion

    // Determine which roots to search for this extend.
    // - If extend specifies a namespace:
    //   - '*' searches all file roots
    //   - otherwise search only roots registered for that namespace
    // - Otherwise, use the accessibility model from the extend's own root.
    const extendNamespace = (extendNode as Extend).type === 'Extend'
      ? (extendNode as Extend).value.namespace
      : undefined;
    const accessibleRoots = extendNamespace
      ? (extendNamespace === '*' ? context.extendRoots.getAlts() : context.extendRoots.getByNamespace(extendNamespace))
      : context.extendRoots.getAccessibleRoots(extendRoot);

    // If target is a SelectorList (e.g., .aa, .bb), process each selector separately
    const targetSelectors: Selector[] = isNode(target, 'SelectorList')
      ? target.value
      : [target];

    for (const singleTarget of targetSelectors) {
      // Skip self-referencing extends for individual selectors too
      if (singleTarget.valueOf() === selectorWithExtend.valueOf()) {
        continue;
      }

      // Find rulesets matching this single target in accessible roots
      let rulesetSet: Ruleset[] | undefined;

      // #region agent log
      const targetV = singleTarget.valueOf();
      const targetStr = String(targetV);
      // Log ANY target that contains 'ext' to test logging
      if (process.env.DEBUG_EXTEND_BOOT === 'true' && targetStr.includes('ext')) {
        try {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H47',
            location: 'extend-roots.ts:processExtends',
            message: 'processing-target-ext',
            data: {
              target: targetStr,
              extendWith: String(selectorWithExtend.valueOf()),
              partial: partial ? 'true' : 'false'
            },
            timestamp: Date.now()
          });
        } catch (e) {
          // Log error if syncLog fails
          console.error('syncLog failed:', e);
        }
      }
      // #endregion

      for (const searchRoot of accessibleRoots) {
        const searchKeySet = singleTarget.keySet;
        // #region agent log
        if (targetStr.includes('ext1') && process.env.DEBUG_EXTEND_BOOT === 'true') {
          // Check what rulesets are registered in this root
          const registry = searchRoot.getRegistry('ruleset');
          const allRulesets: any[] = [];
          try {
            // Try to get all registered rulesets to see what's available
            if (registry && (registry as any).index) {
              for (const rulesetSet of (registry as any).index.values()) {
                if (rulesetSet && typeof rulesetSet.forEach === 'function') {
                  rulesetSet.forEach((rs: any) => {
                    try {
                      const sel = rs?.value?.selector?.valueOf?.();
                      if (sel && String(sel).includes('ext1')) {
                        allRulesets.push(String(sel));
                      }
                    } catch {}
                  });
                }
              }
            }
          } catch {}
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H47',
            location: 'extend-roots.ts:processExtends',
            message: 'before-search',
            data: {
              target: targetStr,
              extendWith: String(selectorWithExtend.valueOf()),
              rootId: String(searchRoot).substring(0, 80),
              registeredExt1Rulesets: allRulesets.slice(0, 5),
              searchKeySetType: typeof searchKeySet,
              searchKeySetSize: searchKeySet instanceof Set ? searchKeySet.size : 'not-a-set'
            },
            timestamp: Date.now()
          });
        }
        // #endregion
        const found = searchRoot.find('ruleset', searchKeySet);
        // #region agent log
        if (targetStr.includes('ext1') && process.env.DEBUG_EXTEND_BOOT === 'true') {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H47',
            location: 'extend-roots.ts:processExtends',
            message: 'search-root-result',
            data: {
              target: targetStr,
              extendWith: String(selectorWithExtend.valueOf()),
              rootId: String(searchRoot).substring(0, 80),
              foundCount: found ? found.length : 0,
              foundRulesets: found ? found.map((r: any) => {
                try {
                  return String((r as any).value?.selector?.valueOf?.() ?? 'unknown');
                } catch {
                  return 'unknown';
                }
              }).slice(0, 3) : []
            },
            timestamp: Date.now()
          });
        }
        // #endregion
        if (found) {
          if (rulesetSet) {
            rulesetSet.push(...found);
          } else {
            rulesetSet = found;
          }
          // #region agent log
          if (targetV === '.ext1' && process.env.DEBUG_EXTEND_BOOT === 'true') {
            syncLog({
              sessionId: 'debug-session',
              runId: process.env.DEBUG_RUN_ID || 'run',
              hypothesisId: 'H47',
              location: 'extend-roots.ts:processExtends',
              message: 'ruleset-added',
              data: {
                target: targetV,
                extendWith: selectorWithExtend.valueOf(),
                foundCount: found.length,
                rulesetSetAfter: rulesetSet ? rulesetSet.length : 0,
                rulesets: found.map((r: any) => {
                  try {
                    return String((r as any).value?.selector?.valueOf?.() ?? 'unknown');
                  } catch {
                    return 'unknown';
                  }
                })
              },
              timestamp: Date.now()
            });
          }
          // #endregion
        }
      }
      if (process.env.DEBUG && debugThisFile) {
        syncLog({
          kind: 'extend:lookup',
          target: singleTarget.valueOf(),
          extendWith: selectorWithExtend.valueOf(),
          partial,
          foundCount: rulesetSet?.length ?? 0
        });
      }
      // #region agent log
      if (process.env.DEBUG_EXTEND_BOOT === 'true' && debugThisFile) {
        try {
          const t = singleTarget.valueOf();
          if (t === '.ma' || t === '.mb' || t === '.mc' || t === '.x' || t === '.y' || t === '.z') {
            syncLog({
              sessionId: 'debug-session',
              runId: process.env.DEBUG_RUN_ID || 'run',
              hypothesisId: 'H22',
              location: 'extend-roots.ts:processExtends',
              message: 'extend-chaining-target-lookup',
              data: {
                depth,
                target: t,
                extendWith: selectorWithExtend.valueOf(),
                partial,
                foundCount: rulesetSet?.length ?? 0,
                accessibleRootsCount: accessibleRoots.size,
                allRootsCount: allRootsArr.length
              },
              timestamp: Date.now()
            });
          }
        } catch {}
      }
      // #endregion

      // Handle warnings for Less compatibility (only on first processing)
      // #region agent log
      if (process.env.DEBUG_EXTEND_BOOT === 'true' && targetStr.includes('ext1')) {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H47',
          location: 'extend-roots.ts:processExtends',
          message: 'ext1-search-result',
          data: {
            target: targetStr,
            extendWith: String(selectorWithExtend.valueOf()),
            foundInAccessible: rulesetSet ? rulesetSet.length : 0,
            accessibleRootsCount: accessibleRoots.size,
            willCheckElsewhere: !rulesetSet || rulesetSet.length === 0
          },
          timestamp: Date.now()
        });
      }
      // #endregion

      if (!rulesetSet || rulesetSet.length === 0) {
        // Check if target exists anywhere (not just in accessible roots)
        const allRootsForWarning = context.extendRoots.getAlts();
        let targetExistsElsewhere = false;
        let existsCount = 0;

        // #region agent log
        if (targetV === '.ext1' && process.env.DEBUG_EXTEND_BOOT === 'true') {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H47',
            location: 'extend-roots.ts:processExtends',
            message: 'ext1-not-found-in-accessible',
            data: {
              target: targetV,
              extendWith: selectorWithExtend.valueOf(),
              allRootsCount: allRootsForWarning.size,
              checkingOtherRoots: true
            },
            timestamp: Date.now()
          });
        }
        // #endregion

        for (const searchRoot of allRootsForWarning) {
          if (!accessibleRoots.has(searchRoot)) {
            const found = searchRoot.find('ruleset', singleTarget.keySet);
            // #region agent log
            if (targetV === '.ext1' && process.env.DEBUG_EXTEND_BOOT === 'true' && found && found.length > 0) {
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H46',
                location: 'extend-roots.ts:processExtends',
                message: 'ext1-found-in-inaccessible-root',
                data: {
                  target: targetV,
                  extendWith: selectorWithExtend.valueOf(),
                  foundCount: found.length,
                  rootId: String(searchRoot).substring(0, 50),
                  rulesets: found.map((r: any) => {
                    try {
                      return String((r as any).value?.selector?.valueOf?.() ?? 'unknown');
                    } catch {
                      return 'unknown';
                    }
                  })
                },
                timestamp: Date.now()
              });
            }
            // #endregion
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
            // #region agent log
            if (process.env.DEBUG_EXTEND_BOOT === 'true' && debugThisFile) {
              try {
                const t = singleTarget.valueOf();
                if (t === '.mb' || t === '.mc' || t === '.ma' || t === '.x' || t === '.y' || t === '.z') {
                  syncLog({
                    sessionId: 'debug-session',
                    runId: process.env.DEBUG_RUN_ID || 'run',
                    hypothesisId: 'H22',
                    location: 'extend-roots.ts:processExtends',
                    message: 'extend-target-exists-but-not-accessible',
                    data: { target: t, existsCount },
                    timestamp: Date.now()
                  });
                }
              } catch {}
            }
            // #endregion
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

      // Apply extends to rulesets directly
      if (rulesetSet) {
        rulesetSet.forEach((ruleset) => {
          if (shouldSkipRuleset(ruleset, extendNode)) {
            return; // Skip this ruleset - it's the source of the extend
          }

          const originalSelector = ruleset.selector as Selector;

          // Check if this extend has already transformed this ruleset's selector
          const extendKey = `${singleTarget.valueOf()}:${selectorWithExtend.valueOf()}:${partial}`;
          if (!transformedByExtend.has(ruleset)) {
            transformedByExtend.set(ruleset, new Set());
          }
          const transformsForRuleset = transformedByExtend.get(ruleset)!;

          // Skip if this extend has already transformed this ruleset
          if (transformsForRuleset.has(extendKey)) {
            return; // This extend already transformed this ruleset - skip
          }

          // Track object identity and structure to detect transformations

          // #region agent log
          if (process.env.DEBUG_EXTEND_LOOP === 'true' && debugThisFile) {
            syncLog({
              sessionId: 'debug-session',
              runId: process.env.DEBUG_RUN_ID || 'pre-fix',
              hypothesisId: 'H3',
              location: 'extend-roots.ts:processExtend',
              message: 'tryExtendSelector-enter',
              data: {
                partial,
                singleTarget: singleTarget.valueOf(),
                extendWith: selectorWithExtend.valueOf(),
                selector: originalSelector.valueOf()
              },
              timestamp: Date.now()
            });
          }
          // #endregion

          let result = tryExtendSelector(originalSelector, singleTarget, selectorWithExtend, partial);

          // #region agent log
          if (
            process.env.DEBUG_EXTEND_LOOP === 'true'
            && debugThisFile
            && (
              singleTarget.valueOf().includes('replace.replace')
              || singleTarget.valueOf() === '.replace'
              || selectorWithExtend.valueOf().includes('rep_ace')
            )
          ) {
            syncLog({
              sessionId: 'debug-session',
              runId: process.env.DEBUG_RUN_ID || 'pre-fix',
              hypothesisId: 'H7',
              location: 'extend-roots.ts:processExtend',
              message: 'tryExtendSelector-focus',
              data: {
                partial,
                target: singleTarget.valueOf(),
                extendWith: selectorWithExtend.valueOf(),
                from: originalSelector.valueOf(),
                ok: !!result && !result.error,
                errType: result?.error?.type || null,
                out: result && !result.error ? result.value.valueOf() : null,
                outType: result && !result.error ? (result.value as any).type ?? null : null,
                outHoistToRoot: result && !result.error ? !!(result.value as any).hoistToRoot : null
              },
              timestamp: Date.now()
            });
          }
          // #endregion

          // #region agent log
          if (process.env.DEBUG_EXTEND_LOOP === 'true' && debugThisFile) {
            syncLog({
              sessionId: 'debug-session',
              runId: process.env.DEBUG_RUN_ID || 'pre-fix',
              hypothesisId: 'H3',
              location: 'extend-roots.ts:processExtend',
              message: 'tryExtendSelector-exit',
              data: {
                ok: !!result && !result.error,
                changed: !!result && !result.error && result.value.valueOf() !== originalSelector.valueOf(),
                out: result && !result.error ? result.value.valueOf() : null,
                errType: result?.error?.type || null
              },
              timestamp: Date.now()
            });
          }
          // #endregion

          if (result && !result.error) {
            const extendedSelector = result.value;
            // Only update if selector actually changed
            if (extendedSelector.valueOf() !== originalSelector.valueOf()) {
              // #region agent log
              __agentExtendTrace('extend-roots.ts:processExtend', 'extend-selector-changed', {
                ctxId: __agentTraceContextId(context as unknown as object),
                partial,
                target: singleTarget.valueOf(),
                extendWith: selectorWithExtend.valueOf(),
                from: originalSelector.valueOf(),
                to: extendedSelector.valueOf(),
                hoistToRoot: !!extendedSelector.hoistToRoot
              });
              // #endregion
              if (debugThisFile) {
                syncLog({
                  kind: 'extend:apply',
                  phase: 1,
                  target: singleTarget.valueOf(),
                  extendWith: selectorWithExtend.valueOf(),
                  partial,
                  from: originalSelector.valueOf(),
                  to: extendedSelector.valueOf()
                });
              }
              // Mark that this extend has transformed this ruleset
              transformsForRuleset.add(extendKey);

              const shouldHoist = !!extendedSelector.hoistToRoot;
              // CRITICAL: Clone the selector to avoid object reference issues
              const clonedSelector = extendedSelector.clone(true);
              // #region agent log
              __agentExtendTrace('extend-roots.ts:processExtend', 'clone-selector', {
                ctxId: __agentTraceContextId(context as unknown as object),
                reason: 'phase1-ruleset-selector-update',
                partial,
                from: extendedSelector.valueOf(),
                hoistToRoot: !!extendedSelector.hoistToRoot
              });
              // #endregion
              if (shouldHoist) {
                // NOTE: Node.clone()/inherit() does not currently copy hoistToRoot.
                clonedSelector.hoistToRoot = true;
              }

              // If this ruleset selector has a `sourceNode` used for re-serialization,
              // extend that too so nested selector output matches Less expectations.
              const sourceSelector = originalSelector.sourceNode;
              if (sourceSelector instanceof Selector) {
                const sourceResult = tryExtendSelector(sourceSelector, singleTarget, selectorWithExtend, partial);
                if (sourceResult && !sourceResult.error) {
                  const nextSource = sourceResult.value;
                  if (nextSource.valueOf() !== sourceSelector.valueOf()) {
                    clonedSelector.sourceNode = nextSource.clone(true);
                    // #region agent log
                    __agentExtendTrace('extend-roots.ts:processExtend', 'clone-selector', {
                      ctxId: __agentTraceContextId(context as unknown as object),
                      reason: 'phase1-ruleset-selector-sourceNode-update',
                      partial,
                      from: nextSource.valueOf(),
                      hoistToRoot: !!nextSource.hoistToRoot
                    });
                    // #endregion
                  }
                }
              }

              // Update the ruleset's selector directly
              const hoisted = maybeHoistMixedNestingSelectorList(ruleset, clonedSelector as Selector, partial);
              if (debugThisFile) {
                syncLog({
                  kind: 'extend:selector-update',
                  phase: 1,
                  partial,
                  before: (clonedSelector as Selector).valueOf(),
                  after: hoisted.valueOf(),
                  hoistToRoot: !!(hoisted as any).hoistToRoot,
                  afterType: (hoisted as any).type ?? null
                });
              }
              // #region agent log
              __agentExtendTrace('extend-roots.ts:processExtend', 'after-maybeHoistMixedNestingSelectorList', {
                ctxId: __agentTraceContextId(context as unknown as object),
                partial,
                before: (clonedSelector as Selector).valueOf(),
                after: hoisted.valueOf(),
                hoistToRoot: !!hoisted.hoistToRoot,
                afterType: hoisted.type
              });
              // #endregion
              // Normalize selectors after extend so generated :is() wrappers can be unwrapped/merged
              // when they are the only simple selector in a selector-list item (Less expectations).
              const normalized = createProcessedSelector(hoisted, true);
              let normalizedSelector: Selector;
              if (Array.isArray(normalized)) {
                normalizedSelector = SelectorList.create(normalized.map(s => s.clone(true))).inherit(hoisted);
              } else {
                normalizedSelector = normalized as Selector;
              }
              // NOTE: Node.clone()/inherit() does not currently copy hoistToRoot.
              if (hoisted.hoistToRoot) {
                normalizedSelector.hoistToRoot = true;
              }
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
  // #region agent log
  if (process.env.DEBUG_EXTEND_BOOT === 'true') {
    try {
      const filePath = context.treeContext?.file?.fullPath ?? '';
      if (typeof filePath === 'string' && filePath.includes('extend-media')) {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H43',
          location: 'extend-roots.ts:processExtends',
          message: 'allExtends-order',
          data: {
            count: allExtends.length,
            extends: allExtends.map(([target, extendWith, partial, root], idx) => ({
              index: idx,
              target: target.valueOf(),
              extendWith: extendWith.valueOf(),
              partial,
              rootId: root ? String(root) : null
            }))
          },
          timestamp: Date.now()
        });
      }
    } catch {}
  }
  // #endregion
  for (const [target, selectorWithExtend, partial, extendRoot, extendNode] of allExtends) {
    // #region agent log
    const targetV = target.valueOf();
    if (process.env.DEBUG_EXTEND_BOOT === 'true' && targetV.includes('ext1')) {
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'run',
        hypothesisId: 'H46',
        location: 'extend-roots.ts:processExtends',
        message: 'about-to-process-extend',
        data: {
          target: targetV,
          extendWith: selectorWithExtend.valueOf(),
          partial: partial ? 'true' : 'false',
          allExtendsCount: allExtends.length,
          debugThisFile: String(debugThisFile),
          debugFilePath: String(debugFilePath).substring(0, 150)
        },
        timestamp: Date.now()
      });
    }
    // #endregion
    processExtend(target, selectorWithExtend, partial, extendRoot, extendNode);
  }

  // Phase 2: Iterative multi-pass on extended rulesets
  let rulesetsToCheck = new Set<Ruleset>(extendedRulesets);
  const seenSelectorStates = new Map<Ruleset, Set<string>>(); // Track selector states per ruleset to detect loops
  const maxIterations = 100; // Prevent infinite loops
  let iteration = 0;

  while (rulesetsToCheck.size > 0 && iteration < maxIterations) {
    iteration++;
    let __agentPhase2LogCount = 0;
    let __agentPhase2DeepYzCount = 0;
    let __agentPhase2RulesetLoopCount = 0;
    // #region agent log
    if (process.env.DEBUG_EXTEND_PHASE2_RULESETS === 'true' && debugThisFile) {
      try {
        if (iteration <= 2) {
          const selectors: (string | null)[] = [];
          let i = 0;
          for (const rs of rulesetsToCheck) {
            if (i++ >= 50) break;
            const sel: any = (rs as any).selector;
            selectors.push(typeof sel?.valueOf === 'function' ? sel.valueOf() : null);
          }
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'run',
            hypothesisId: 'H27',
            location: 'extend-roots.ts:phase2',
            message: 'phase2-rulesetsToCheck-snapshot',
            data: { iteration, size: rulesetsToCheck.size, selectors },
            timestamp: Date.now()
          });
        }
      } catch {}
    }
    // #endregion
    // #region agent log
    __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-iteration-start', {
      ctxId: __agentTraceContextId(context as unknown as object),
      iteration,
      rulesetsToCheck: rulesetsToCheck.size
    });
    // #endregion
    // #region agent log
    if (process.env.DEBUG_EXTEND_LOOP === 'true' && debugThisFile) {
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
        hypothesisId: 'H4',
        location: 'extend-roots.ts:processExtends',
        message: 'phase2-iteration-start',
        data: { iteration, rulesetsToCheck: rulesetsToCheck.size },
        timestamp: Date.now()
      });
    }
    // #endregion
    const nextIteration = new Set<Ruleset>();

    // Initialize seen states for new rulesets
    for (const ruleset of rulesetsToCheck) {
      if (!seenSelectorStates.has(ruleset)) {
        seenSelectorStates.set(ruleset, new Set<string>());
      }
    }

    for (const ruleset of rulesetsToCheck) {
      __agentPhase2RulesetLoopCount++;
      const currentSelector = ruleset.selector as Selector;
      const currentSelectorValue = currentSelector.valueOf();
      const seenStates = seenSelectorStates.get(ruleset)!;
      let phase2ConsideredTargets = 0;
      let phase2SkipKeySet = 0;
      let phase2SkipInaccessible = 0;
      let phase2SkipAlreadyTransformed = 0;
      let phase2TryExtendSelector = 0;
      let phase2SelectorChanged = 0;
      // #region agent log
      if (process.env.DEBUG_EXTEND_PHASE2_RULESETS === 'true' && debugThisFile) {
        try {
          const cap = 60;
          if (__agentPhase2LogCount < cap) {
            __agentPhase2LogCount++;
            syncLog({
              sessionId: 'debug-session',
              runId: process.env.DEBUG_RUN_ID || 'run',
              hypothesisId: 'H26',
              location: 'extend-roots.ts:phase2',
              message: 'phase2-ruleset-candidate',
              data: { iteration, selector: currentSelectorValue },
              timestamp: Date.now()
            });
          }
        } catch {}
      }
      // #endregion
      // #region agent log
      __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-ruleset-check', {
        ctxId: __agentTraceContextId(context as unknown as object),
        iteration,
        selector: currentSelectorValue,
        hoistToRoot: !!(currentSelector as any).hoistToRoot,
        location: (ruleset as any).location ?? null
      });
      // #endregion

      // Check if we've seen this selector state before (infinite loop detection)
      if (seenStates.has(currentSelectorValue)) {
        // #region agent log
        __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-skip-seen-selector-state', {
          ctxId: __agentTraceContextId(context as unknown as object),
          iteration,
          selector: currentSelectorValue
        });
        // #endregion
        // #region agent log
        if (process.env.DEBUG_EXTEND_LOOP === 'true' && debugThisFile) {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'pre-fix',
            hypothesisId: 'H4',
            location: 'extend-roots.ts:processExtends',
            message: 'phase2-skip-seen-state',
            data: { iteration, selector: currentSelectorValue },
            timestamp: Date.now()
          });
        }
        // #endregion
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
          // #region agent log
          if (process.env.DEBUG_EXTEND_PHASE2_DEEP === 'true' && debugThisFile) {
            try {
              if (iteration === 1 && currentSelectorValue === '.y,.z') {
                if (__agentPhase2DeepYzCount < 12) {
                  __agentPhase2DeepYzCount++;
                  syncLog({
                    sessionId: 'debug-session',
                    runId: process.env.DEBUG_RUN_ID || 'run',
                    hypothesisId: 'H29',
                    location: 'extend-roots.ts:phase2',
                    message: 'phase2-yz-consider',
                    data: { iteration, from: currentSelectorValue, phase2ExtendKey },
                    timestamp: Date.now()
                  });
                }
              }
            } catch {}
          }
          // #endregion
          if (attemptedPhase2ExtendKeys.has(phase2ExtendKey)) {
            // #region agent log
            __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-skip-duplicate-attempt', {
              ctxId: __agentTraceContextId(context as unknown as object),
              iteration,
              partial,
              extendKey: phase2ExtendKey,
              from: currentSelectorValue
            });
            // #endregion
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
          // #region agent log
          if (process.env.DEBUG_EXTEND_PHASE2_FOCUS === 'true' && debugThisFile) {
            try {
              if (phase2ExtendKey === '.z:.x:false') {
                const selCount = currentSelectors.length;
                let anyHasZ = false;
                let minSize: number | null = null;
                let maxSize: number | null = null;
                for (const s of currentSelectors) {
                  const ks = s.keySet;
                  anyHasZ ||= ks.has('.z');
                  const sz = ks.size;
                  minSize = minSize === null ? sz : Math.min(minSize, sz);
                  maxSize = maxSize === null ? sz : Math.max(maxSize, sz);
                }
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'run',
                  hypothesisId: 'H24',
                  location: 'extend-roots.ts:phase2',
                  message: 'phase2-keyset-overlaps-check',
                  data: {
                    iteration,
                    from: currentSelectorValue,
                    selCount,
                    anyHasZ,
                    minKeySetSize: minSize,
                    maxKeySetSize: maxSize,
                    keySetOverlaps
                  },
                  timestamp: Date.now()
                });
              }
              if (
                process.env.DEBUG_EXTEND_PHASE2_DEEP === 'true'
                && (currentSelectorValue === '.y,.z' || currentSelectorValue === '.md,.ma')
                && (phase2ExtendKey === '.z:.x:false' || phase2ExtendKey === '.ma:.mb:false' || phase2ExtendKey === '.mb:.mc:false')
              ) {
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'run',
                  hypothesisId: 'H28',
                  location: 'extend-roots.ts:phase2',
                  message: 'phase2-gate-keyset',
                  data: { iteration, from: currentSelectorValue, phase2ExtendKey, keySetOverlaps },
                  timestamp: Date.now()
                });
              }
            } catch {}
          }
          // #endregion

          if (!keySetOverlaps) {
            phase2SkipKeySet++;
            // #region agent log
            if (process.env.DEBUG_EXTEND_PHASE2_FOCUS === 'true' && debugThisFile) {
              try {
                if (
                  phase2ExtendKey.startsWith('.z:')
                  || phase2ExtendKey.startsWith('.mb:')
                  || phase2ExtendKey.startsWith('.ma:')
                ) {
                  syncLog({
                    sessionId: 'debug-session',
                    runId: process.env.DEBUG_RUN_ID || 'run',
                    hypothesisId: 'H23',
                    location: 'extend-roots.ts:phase2',
                    message: 'phase2-skip-keyset',
                    data: { iteration, from: currentSelectorValue, phase2ExtendKey },
                    timestamp: Date.now()
                  });
                }
              } catch {}
            }
            // #endregion
            // #region agent log
            __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-skip-keyset', {
              ctxId: __agentTraceContextId(context as unknown as object),
              iteration,
              partial,
              extendKey: phase2ExtendKey,
              from: currentSelectorValue
            });
            // #endregion
            continue; // Fast rejection - keys don't overlap
          }

          // Mark as attempted only once we know it's plausible to match.
          attemptedPhase2ExtendKeys.add(phase2ExtendKey);
          phase2ConsideredTargets++;

          // Check if ruleset is accessible for this extend
          const accessibleRoots = context.extendRoots.getAccessibleRoots(extendRoot);
          let foundRuleset = false;

          for (const searchRoot of accessibleRoots) {
            const found = searchRoot.find('ruleset', singleTarget.keySet);
            if (found && found.includes(ruleset)) {
              foundRuleset = true;
              break;
            }
          }
          // #region agent log
          if (
            process.env.DEBUG_EXTEND_PHASE2_DEEP === 'true'
            && debugThisFile
            && (currentSelectorValue === '.y,.z' || currentSelectorValue === '.md,.ma')
            && (phase2ExtendKey === '.z:.x:false' || phase2ExtendKey === '.ma:.mb:false' || phase2ExtendKey === '.mb:.mc:false')
          ) {
            try {
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H28',
                location: 'extend-roots.ts:phase2',
                message: 'phase2-gate-accessible',
                data: { iteration, from: currentSelectorValue, phase2ExtendKey, foundRuleset, accessibleRootsCount: accessibleRoots.size },
                timestamp: Date.now()
              });
            } catch {}
          }
          // #endregion

          if (!foundRuleset) {
            phase2SkipInaccessible++;
            // #region agent log
            if (process.env.DEBUG_EXTEND_PHASE2_FOCUS === 'true' && debugThisFile) {
              try {
                if (
                  phase2ExtendKey.startsWith('.z:')
                  || phase2ExtendKey.startsWith('.mb:')
                  || phase2ExtendKey.startsWith('.ma:')
                ) {
                  syncLog({
                    sessionId: 'debug-session',
                    runId: process.env.DEBUG_RUN_ID || 'run',
                    hypothesisId: 'H23',
                    location: 'extend-roots.ts:phase2',
                    message: 'phase2-skip-inaccessible',
                    data: { iteration, from: currentSelectorValue, phase2ExtendKey },
                    timestamp: Date.now()
                  });
                }
              } catch {}
            }
            // #endregion
            // #region agent log
            __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-skip-inaccessible', {
              ctxId: __agentTraceContextId(context as unknown as object),
              iteration,
              partial,
              extendKey: phase2ExtendKey,
              from: currentSelectorValue
            });
            // #endregion
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
            // #region agent log
            __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-skip-already-transformed', {
              ctxId: __agentTraceContextId(context as unknown as object),
              iteration,
              partial,
              extendKey: phase2ExtendKey,
              from: currentSelectorValue
            });
            // #endregion
            continue; // This extend already transformed this ruleset - skip
          }

          // Try to extend - tryExtendSelector will check for actual matches (including combinators)
          // and return an error if there's no match
          phase2TryExtendSelector++;
          // #region agent log
          if (process.env.DEBUG_EXTEND_PHASE2_FOCUS === 'true' && debugThisFile) {
            try {
              if (
                phase2ExtendKey.startsWith('.z:')
                || phase2ExtendKey.startsWith('.mb:')
                || phase2ExtendKey.startsWith('.ma:')
              ) {
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'run',
                  hypothesisId: 'H23',
                  location: 'extend-roots.ts:phase2',
                  message: 'phase2-tryExtendSelector',
                  data: { iteration, from: currentSelectorValue, phase2ExtendKey },
                  timestamp: Date.now()
                });
              }
            } catch {}
          }
          // #endregion
          // #region agent log
          __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-tryExtendSelector', {
            ctxId: __agentTraceContextId(context as unknown as object),
            iteration,
            partial,
            extendKey: phase2ExtendKey,
            from: currentSelectorValue
          });
          // #endregion
          const result = tryExtendSelector(currentSelector, singleTarget, selectorWithExtend, partial);
          // #region agent log
          if (process.env.DEBUG_EXTEND_PHASE2_FOCUS === 'true' && debugThisFile) {
            try {
              if (
                phase2ExtendKey.startsWith('.z:')
                || phase2ExtendKey.startsWith('.mb:')
                || phase2ExtendKey.startsWith('.ma:')
              ) {
                syncLog({
                  sessionId: 'debug-session',
                  runId: process.env.DEBUG_RUN_ID || 'run',
                  hypothesisId: 'H23',
                  location: 'extend-roots.ts:phase2',
                  message: 'phase2-tryExtendSelector-result',
                  data: {
                    iteration,
                    from: currentSelectorValue,
                    phase2ExtendKey,
                    ok: !!result && !result.error,
                    changed: !!result && !result.error && result.value.valueOf() !== currentSelectorValue,
                    errType: result?.error?.type ?? null
                  },
                  timestamp: Date.now()
                });
              }
            } catch {}
          }
          // #endregion
          // #region agent log
          if (
            process.env.DEBUG_EXTEND_PHASE2_DEEP === 'true'
            && debugThisFile
            && (currentSelectorValue === '.y,.z' || currentSelectorValue === '.md,.ma')
            && (phase2ExtendKey === '.z:.x:false' || phase2ExtendKey === '.ma:.mb:false' || phase2ExtendKey === '.mb:.mc:false')
          ) {
            try {
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H28',
                location: 'extend-roots.ts:phase2',
                message: 'phase2-result-deep',
                data: {
                  iteration,
                  from: currentSelectorValue,
                  phase2ExtendKey,
                  ok: !!result && !result.error,
                  changed: !!result && !result.error && result.value.valueOf() !== currentSelectorValue,
                  errType: result?.error?.type ?? null,
                  out: result && !result.error ? result.value.valueOf() : null
                },
                timestamp: Date.now()
              });
            } catch {}
          }
          // #endregion

          if (result && !result.error) {
            const extendedSelector = result.value;

            // Only update if selector actually changed
            if (extendedSelector.valueOf() !== currentSelectorValue) {
              phase2SelectorChanged++;
              // #region agent log
              __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-extend-changed', {
                ctxId: __agentTraceContextId(context as unknown as object),
                iteration,
                partial,
                extendKey: phase2ExtendKey,
                from: currentSelectorValue,
                to: extendedSelector.valueOf(),
                hoistToRoot: !!extendedSelector.hoistToRoot
              });
              // #endregion
              if (debugThisFile) {
                syncLog({
                  kind: 'extend:apply',
                  phase: 2,
                  target: singleTarget.valueOf(),
                  extendWith: selectorWithExtend.valueOf(),
                  partial,
                  from: currentSelectorValue,
                  to: extendedSelector.valueOf()
                });
              }
              // Mark that this extend has transformed this ruleset
              transformsForRuleset.add(extendKey);

              const shouldHoist = !!extendedSelector.hoistToRoot;
              // CRITICAL: Clone the selector to avoid object reference issues
              const clonedSelector = extendedSelector.clone(true);
              // #region agent log
              __agentExtendTrace('extend-roots.ts:processExtends', 'clone-selector', {
                ctxId: __agentTraceContextId(context as unknown as object),
                reason: 'phase2-ruleset-selector-update',
                partial,
                from: extendedSelector.valueOf(),
                hoistToRoot: !!extendedSelector.hoistToRoot
              });
              // #endregion
              if (shouldHoist) {
                // NOTE: Node.clone()/inherit() does not currently copy hoistToRoot.
                clonedSelector.hoistToRoot = true;
              }

              const sourceSelector = currentSelector.sourceNode;
              if (sourceSelector instanceof Selector) {
                const sourceResult = tryExtendSelector(sourceSelector, singleTarget, selectorWithExtend, partial);
                if (sourceResult && !sourceResult.error) {
                  const nextSource = sourceResult.value;
                  if (nextSource.valueOf() !== sourceSelector.valueOf()) {
                    clonedSelector.sourceNode = nextSource.clone(true);
                    // #region agent log
                    __agentExtendTrace('extend-roots.ts:processExtends', 'clone-selector', {
                      ctxId: __agentTraceContextId(context as unknown as object),
                      reason: 'phase2-ruleset-selector-sourceNode-update',
                      partial,
                      from: nextSource.valueOf(),
                      hoistToRoot: !!nextSource.hoistToRoot
                    });
                    // #endregion
                  }
                }
              }
              // Normalize selectors after extend so generated :is() wrappers can be unwrapped/merged
              // when they are the only simple selector in a selector-list item (Less expectations).
              const normalized = createProcessedSelector(clonedSelector, true);
              let normalizedSelector: Selector;
              if (Array.isArray(normalized)) {
                normalizedSelector = SelectorList.create(normalized.map(s => s.clone(true))).inherit(clonedSelector);
              } else {
                normalizedSelector = normalized as Selector;
              }
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

      // #region agent log
      __agentExtendTrace('extend-roots.ts:processExtends', 'phase2-ruleset-summary', {
        ctxId: __agentTraceContextId(context as unknown as object),
        iteration,
        selector: currentSelectorValue,
        hoistToRoot: !!(currentSelector as any).hoistToRoot,
        consideredTargets: phase2ConsideredTargets,
        skipKeySet: phase2SkipKeySet,
        skipInaccessible: phase2SkipInaccessible,
        skipAlreadyTransformed: phase2SkipAlreadyTransformed,
        tryExtendSelector: phase2TryExtendSelector,
        selectorChanged: phase2SelectorChanged
      });
      // #endregion
    }

    rulesetsToCheck = nextIteration;
    // #region agent log
    if (process.env.DEBUG_EXTEND_PHASE2_RULESETS === 'true' && debugThisFile) {
      try {
        syncLog({
          sessionId: 'debug-session',
          runId: process.env.DEBUG_RUN_ID || 'run',
          hypothesisId: 'H30',
          location: 'extend-roots.ts:phase2',
          message: 'phase2-iteration-end',
          data: {
            iteration,
            processedRulesets: __agentPhase2RulesetLoopCount,
            nextIterationSize: nextIteration.size
          },
          timestamp: Date.now()
        });
      } catch {}
    }
    // #endregion
  }

  if (iteration >= maxIterations) {
    throw new Error(`Extend chaining exceeded maximum iterations (${maxIterations}). Possible infinite loop.`);
  }
  
  // Clear the extend order map after processing
  setExtendOrderMap(null);
}
