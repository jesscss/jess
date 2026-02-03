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
  // Use materialized form so relative selectors (e.g. .header-nav with implicit &) count as prefixed
  const anyPrefixedByParent = parentPrefix
    ? items.some(s => String(materializeImplicitAmpersand(s).valueOf()).startsWith(parentPrefix))
    : false;
  const anyNotPrefixedByParent = parentPrefix
    ? items.some(s => !String(materializeImplicitAmpersand(s).valueOf()).startsWith(parentPrefix))
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
 * Manages extend root relationships and visibility (like ruleset .frames).
 * Uses Rules node object identity (no wrapper class needed).
 *
 * Data architecture (mirrors ruleset frames):
 * - Tree: each extend root has a parent (except document root) and children.
 *   parentRoot: Rules -> parent Rules, childrenRoots: Rules -> Set<Rules>.
 * - Visible roots: for a given extend root, the set of roots that are VISIBLE to it —
 *   i.e. where we can look up rulesets for extend targets. Same idea as context.frames
 *   for rulesets: ancestors + self + descendants (stop at protected boundaries).
 *   So when we're inside @media, document root IS visible; when at root, @media blocks
 *   (children) are visible.
 * - Mergeable roots: we may only MERGE (add selector) into rulesets whose root is
 *   extendRoot or a descendant (isSameOrDescendantRoot). We must NOT merge into
 *   ancestor roots. When target is found in a visible-but-ancestor root, we should
 *   copy that target's declarations into the extending ruleset in extendRoot (Less
 *   behavior); that step is not yet implemented.
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
   * - Ancestor roots (parent, grandparent, ... up to document root; stop at protected)
   * - Children roots (recursively, if not protected)
   * - Roots with same layer name (for @layer, if accessible)
   *
   * Excludes:
   * - Roots behind protected boundaries (stop traversal at protected roots when going up or down)
   * - Siblings (other children of ancestors, unless same layer)
   *
   * Note: @import type uses parent's root, so extends inside @import
   * can reach the parent. @compose type creates its own root and may be protected.
   *
   * Less compatibility: Extends INSIDE @media must see rules OUTSIDE (ancestor roots),
   * and extends OUTSIDE must see rules INSIDE (child roots). So we include both
   * ancestors (when not protected) and descendants.
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

    // Traverse down from self to add self and descendants (extends OUTSIDE see rules INSIDE @media).
    traverseChildren(root);

    // Add ancestor chain (parent, grandparent, ... up to document root; stop at protected).
    // Required so extends inside nested @media can find targets in outer @media or document
    // (each root's registry only contains rulesets that registered to that root).
    let current: Rules | undefined = this.parentRoot.get(root);
    while (current) {
      if (visited.has(current)) break;
      visited.add(current);
      if (this.isProtected.get(current)) break;
      accessible.add(current);
      current = this.parentRoot.get(current);
    }

    // If the registry has a document root and it wasn't reached by the parent chain (e.g. jess
    // flow where root wasn't pushed before nested at-rules), include it so extends inside
    // @media can still find root-level rulesets.
    if (this.root && !accessible.has(this.root)) {
      accessible.add(this.root);
    }

    return accessible;
  }

  /**
   * True if rulesetRoot is extendRoot or any descendant of extendRoot.
   * Used to only merge extend into rulesets in the same or a child root (not ancestor).
   */
  isSameOrDescendantRoot(rulesetRoot: Rules, extendRoot: Rules): boolean {
    if (rulesetRoot === extendRoot) return true;
    // Same-layer roots share extend scope (e.g. two @layer one { } blocks merge).
    const layerA = this.layerName.get(rulesetRoot);
    const layerB = this.layerName.get(extendRoot);
    if (layerA && layerB && layerA === layerB) return true;
    const children = this.childrenRoots.get(extendRoot);
    if (!children) return false;
    for (const child of children) {
      if (this.isSameOrDescendantRoot(rulesetRoot, child)) return true;
    }
    return false;
  }

  /**
   * True if possibleAncestor is an ancestor of root (walking parentRoot up from root).
   * Used to detect when a target ruleset is in an ancestor root so we copy its declarations
   * into the extending ruleset (Less behavior) instead of merging.
   */
  isAncestorRoot(possibleAncestor: Rules, root: Rules): boolean {
    let current: Rules | undefined = this.parentRoot.get(root);
    while (current) {
      if (current === possibleAncestor) return true;
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
  /** Walk up from a ruleset to the nearest Rules that is a registered extend root. */
  const getEffectiveExtendRoot = (ruleset: Ruleset): Rules | undefined => {
    let n: Node | undefined = ruleset;
    while (n) {
      const p: Node | undefined = n.parent;
      if (p && isNode(p, 'Rules') && allRoots.has(p)) return p;
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
    // Ensure we search those inner Rules: add them from any registered root with wrapper structure,
    // so extend finds targets (e.g. .ma inside @media for .mb:extend(.ma)) even if the wrapper
    // is not in accessibleRoots due to registration order.
    const rootsToSearch = new Set(accessibleRoots);
    for (const r of allRootsArr) {
      if (!accessibleRoots.has(r)) {
        continue;
      }
      if (r.value?.length === 1) {
        const first = r.value[0];
        if (isNode(first, 'Ruleset') && first.value.rules && isNode(first.value.rules, 'Rules')) {
          rootsToSearch.add(first.value.rules);
        }
      }
    }
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

      // Find rulesets matching this single target in accessible roots
      let rulesetSet: Ruleset[] | undefined;

      for (const searchRoot of accessibleRoots) {
        const searchKeySet = singleTarget.keySet;
        let found = searchRoot.find('ruleset', searchKeySet);
        // When collapseNesting wraps at-rule rules in Ruleset(&), rulesets register to the inner
        // Rules; always search that too so extend finds them (e.g. .ma inside @media for .mb:extend(.ma)).
        if (searchRoot.value?.length === 1) {
          const first = searchRoot.value[0];
          if (isNode(first, 'Ruleset') && first.value.rules && isNode(first.value.rules, 'Rules')) {
            const innerFound = first.value.rules.find('ruleset', searchKeySet);
            if (innerFound) {
              found = found ? [...found, ...innerFound] : innerFound;
            }
          }
        }
        if (found) {
          // Only merge into rulesets in extendRoot or in a descendant root of extendRoot.
          // Do NOT merge into rulesets in an ancestor root (e.g. .ma in @media extending .a at root
          // must not add .ma to the root .a ruleset; .tv-lowres in @media must not add to root).
          // Root .all:extend(.ext1) may add .all to .ext1 rulesets in root and in nested @media (descendants).
          const sameOrDescendantRoot = found.filter((rs: Ruleset) => {
            const effectiveRoot = getEffectiveExtendRoot(rs);
            if (!effectiveRoot) return true;
            if (
              context.extendRoots.isAncestorRoot(effectiveRoot, extendRoot)
              && effectiveRoot !== extendRoot
            ) {
              return false;
            }
            // Same or descendant: merge into rulesets in extendRoot or its descendants.
            if (context.extendRoots.isSameOrDescendantRoot(effectiveRoot, extendRoot)) return true;
            // When collapseNesting wraps at-rule body in a wrapper, rulesets can live in a clone that's
            // not in allRoots, so getEffectiveExtendRoot walks up to the wrapper. Allow merge only when
            // effectiveRoot is that wrapper (one child Ruleset with inner Rules), not any ancestor.
            const isAncestor = context.extendRoots.isAncestorRoot(effectiveRoot, extendRoot);
            const isDocRoot = effectiveRoot === context.root;
            const effIsWrapper =
              effectiveRoot.value?.length === 1 &&
              effectiveRoot.value[0] != null &&
              isNode(effectiveRoot.value[0], 'Ruleset') &&
              (effectiveRoot.value[0] as Ruleset).value?.rules != null &&
              isNode((effectiveRoot.value[0] as Ruleset).value!.rules, 'Rules');
            if (isAncestor && !isDocRoot && effIsWrapper) return true;
            const effectiveParent = context.extendRoots.getParentRoot(effectiveRoot);
            const extendParent = context.extendRoots.getParentRoot(extendRoot);
            if (effectiveParent && extendParent && effectiveParent === extendParent) return true;
            // Same AST parent: two inner Rules (e.g. clone A vs clone B) under the same wrapper.
            if (effectiveRoot.parent === extendRoot.parent) return true;
            // Same wrapper (grandparent): inner Rules may have different Ruleset parents after eval.
            const ep = effectiveRoot.parent;
            const xp = extendRoot.parent;
            if (
              ep &&
              xp &&
              ep !== xp &&
              isNode(ep, 'Ruleset') &&
              isNode(xp, 'Ruleset') &&
              ep.parent === xp.parent
            ) {
              return true;
            }
            // extendRoot is detached (preEval clone never attached after eval); target is in inner Rules under wrapper.
            const effectiveIsInner =
              ep &&
              isNode(ep, 'Ruleset') &&
              ep.parent &&
              isNode(ep.parent, 'Rules') &&
              (ep.parent as Rules).value?.length === 1;
            if (!extendRoot.parent && effectiveIsInner) return true;
            // Target's root has no parent (detached inner Rules); allow. Exclude document root.
            if (!effectiveRoot.parent && effectiveRoot !== context.root) return true;
            // Target ruleset's direct parent (inner Rules) not in allRoots; getEffectiveExtendRoot walked to doc root.
            const targetInner = rs.parent;
            const targetWrapper =
              targetInner?.parent?.parent &&
              isNode(targetInner.parent, 'Ruleset') &&
              isNode(targetInner.parent.parent, 'Rules')
                ? (targetInner.parent.parent as Rules)
                : undefined;
            const extendWrapper =
              xp?.parent && isNode(xp.parent, 'Rules') ? (xp.parent as Rules) : undefined;
            if (
              targetWrapper &&
              extendWrapper &&
              targetWrapper === extendWrapper &&
              targetInner &&
              isNode(targetInner, 'Rules') &&
              !allRoots.has(targetInner)
            ) {
              return true;
            }
            // effectiveRoot === context.root but target is nested; extendRoot is nested. Only when target's parent Rules is not in allRoots (collapseNesting inner clone).
            if (
              effectiveRoot === context.root &&
              rs.parent !== context.root &&
              extendRoot.parent?.parent != null &&
              rs.parent &&
              isNode(rs.parent, 'Rules') &&
              !allRoots.has(rs.parent)
            ) {
              return true;
            }
            return false;
          });
          if (sameOrDescendantRoot.length > 0) {
            if (rulesetSet) {
              rulesetSet.push(...sameOrDescendantRoot);
            } else {
              rulesetSet = sameOrDescendantRoot;
            }
          }
        }
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

          let result = tryExtendSelector(originalSelector, singleTarget, selectorWithExtend, partial);


          if (result && !result.error) {
            const extendedSelector = result.value;
            // Only update if selector actually changed
            if (extendedSelector.valueOf() !== originalSelector.valueOf()) {
              // Mark that this extend has transformed this ruleset
              transformsForRuleset.add(extendKey);

              const shouldHoist = !!extendedSelector.hoistToRoot;
              // CRITICAL: Clone the selector to avoid object reference issues
              const clonedSelector = extendedSelector.clone(true);
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
                  }
                }
              }

              // Update the ruleset's selector directly
              const hoisted = maybeHoistMixedNestingSelectorList(ruleset, clonedSelector as Selector, partial);
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
              const leadingIsResult = processLeadingIs(normalizedSelector);
              normalizedSelector = Array.isArray(leadingIsResult)
                ? SelectorList.create(leadingIsResult.map(s => s.copy(true) as Selector)).inherit(normalizedSelector) as Selector
                : leadingIsResult;
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

          // Check if ruleset is accessible for this extend and in same/child root (not ancestor)
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
    }

    rulesetsToCheck = nextIteration;
  }

  if (iteration >= maxIterations) {
    throw new Error(`Extend chaining exceeded maximum iterations (${maxIterations}). Possible infinite loop.`);
  }
  setExtendOrderMap(null);
}
