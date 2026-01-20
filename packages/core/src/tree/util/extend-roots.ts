import type { Rules } from '../rules.js';
import type { AtRule } from '../at-rule.js';
import { isNode } from './is-node.js';
import type { Context } from '../../context.js';
import type { Ruleset } from '../ruleset.js';
import type { Selector } from '../selector.js';
import type { Node } from '../node.js';
import { SelectorList } from '../selector-list.js';
import { ComplexSelector } from '../selector-complex.js';
import { Combinator } from '../combinator.js';
import { is as isSelectorPseudo } from '../selector-pseudo.js';
import { tryExtendSelector, findChainedExtends } from './extend.js';
import { WARN, toDiagnostic } from '../../jess-error.js';
import { syncLog } from './__tests__/debug-log.js';

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
  const parentRules = (ruleset as any).parent as Node | undefined;
  const parentRuleset = parentRules ? ((parentRules as any).parent as Node | undefined) : undefined;
  if (!parentRuleset || !isNode(parentRuleset, 'Ruleset')) {
    return selector;
  }
  if (!isNode(selector, 'SelectorList')) {
    return selector;
  }
  const parentSel = (parentRuleset as any).selector as Selector;
  if (!parentSel || isNode(parentSel, 'Nil') || isNode(parentSel, 'SelectorList')) {
    return selector;
  }

  const items = (selector as SelectorList).value;
  if (!Array.isArray(items) || items.length < 2) {
    return selector;
  }

  // Heuristic: if we have a mix of "relative" selectors (no descendant combinator)
  // and "absolute" selectors (has descendant combinator), hoist and materialize parent.
  const hasDescendantCombinator = (s: Selector) =>
    isNode(s, 'ComplexSelector') && (s as ComplexSelector).value.some((c) => isNode(c, 'Combinator') && c.value === ' ');
  const anyAbsolute = items.some(hasDescendantCombinator);
  const anyRelative = items.some((s) => !hasDescendantCombinator(s));
  const parentPrefix = typeof (parentSel as any)?.valueOf === 'function' ? `${(parentSel as any).valueOf()} ` : '';
  const anyPrefixedByParent = parentPrefix
    ? items.some((s) => typeof (s as any)?.valueOf === 'function' && String((s as any).valueOf()).startsWith(parentPrefix))
    : false;
  const anyNotPrefixedByParent = parentPrefix
    ? items.some((s) => typeof (s as any)?.valueOf === 'function' && !String((s as any).valueOf()).startsWith(parentPrefix))
    : false;
  // #region agent log
  if (process.env.DEBUG_HOIST_HEADER === 'true') {
    syncLog({
      sessionId: 'debug-session',
      runId: process.env.DEBUG_RUN_ID || 'post-fix',
      hypothesisId: 'H16',
      location: 'extend-roots.ts:maybeHoistMixedNestingSelectorList',
      message: 'maybe-hoist-check',
      data: {
        partial,
        parentSel: typeof (parentSel as any)?.valueOf === 'function' ? (parentSel as any).valueOf() : null,
        selector: typeof (selector as any)?.valueOf === 'function' ? (selector as any).valueOf() : null,
        anyAbsolute,
        anyRelative,
        itemTypes: items.map((s) => (s as any)?.type ?? null),
        itemVals: items.map((s) => (typeof (s as any)?.valueOf === 'function' ? (s as any).valueOf() : null))
      },
      timestamp: Date.now()
    });
  }
  // #endregion
  // If the selector list mixes selectors that are under the parent prefix and selectors that are not,
  // hoist to root so we don't serialize them inside the parent's frame (which would strip the prefix
  // from the prefixed selectors, producing `.header-nav, .footer .footer-nav`).
  if (anyPrefixedByParent && anyNotPrefixedByParent) {
    const list = SelectorList.create(items.map((s) => s.clone(true)));
    if (partial) {
      const wrapper = isSelectorPseudo(list as any);
      wrapper.generated = false;
      (wrapper as any).hoistToRoot = true;
      (ruleset as any).hoistToRoot = true;
      return wrapper as any as Selector;
    }
    (list as any).hoistToRoot = true;
    (ruleset as any).hoistToRoot = true;
    return list as any as Selector;
  }

  if (!anyAbsolute || !anyRelative) {
    return selector;
  }

  const rewritten = items.map((s) => {
    if (hasDescendantCombinator(s)) {
      return s;
    }
    // Prefix the nested parent selector.
    const out = ComplexSelector.create([parentSel.copy(true) as any, Combinator.create(' '), s.copy(true) as any]).inherit(s);
    return out as any as Selector;
  });

  const list = SelectorList.create(rewritten);
  if (partial) {
    const wrapper = isSelectorPseudo(list as any);
    wrapper.generated = false;
    (wrapper as any).hoistToRoot = true;
    (ruleset as any).hoistToRoot = true;
    return wrapper as any as Selector;
  }
  (list as any).hoistToRoot = true;
  (ruleset as any).hoistToRoot = true;
  return list as any as Selector;
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
    options?: { layerName?: string; isProtected?: boolean; isCompose?: boolean }
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
  const processedExtends = new Set<string>(); // Track processed extends to avoid duplicates
  const extendedRulesets = new Set<Ruleset>(); // Track rulesets that were extended
  // Track which extends have already transformed which rulesets: Map<rulesetId, Set<extendKey>>
  // Each extend can only transform a particular ruleset's selector once
  const transformedByExtend = new Map<Ruleset, Set<string>>();
  const allRoots = context.extendRoots.getAlts();
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
    );
  // Debug marker to confirm this code path is running in Jess tests.
  if (process.env.DEBUG) {
    syncLog({ kind: 'processExtends', file: debugFilePath || null, count: allExtends.length, debugThisFile });
  }

  /**
   * Helper to re-index a ruleset's registry after selector update
   * Simply adds the ruleset back to the registry - it will be indexed automatically
   * when searched. Since the ruleset object is the same, existing keys remain,
   * and new keys from the updated selector will be added automatically.
   */
  const reindexRuleset = (ruleset: Ruleset): void => {
    // Find which extend root this ruleset is registered to and add it back
    for (const root of allRoots) {
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

    // Create a unique key for this extend to avoid processing duplicates
    const extendKey = `${target.valueOf()}:${selectorWithExtend.valueOf()}:${partial}:${extendRoot === context.root ? 'root' : 'nested'}`;
    if (processedExtends.has(extendKey)) {
      return; // Already processed
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

    // Get accessible roots for this extend's root
    const accessibleRoots = context.extendRoots.getAccessibleRoots(extendRoot);

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
        const found = searchRoot.find('ruleset', searchKeySet);
        if (found) {
          if (rulesetSet) {
            rulesetSet.push(...found);
          } else {
            rulesetSet = found;
          }
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

      // Handle warnings for Less compatibility (only on first processing)
      if (!rulesetSet || rulesetSet.length === 0) {
        // Check if target exists anywhere (not just in accessible roots)
        const allRootsForWarning = context.extendRoots.getAlts();
        let targetExistsElsewhere = false;

        for (const searchRoot of allRootsForWarning) {
          if (!accessibleRoots.has(searchRoot)) {
            const found = searchRoot.find('ruleset', singleTarget.keySet);
            if (found && found.length > 0) {
              targetExistsElsewhere = true;
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
              if (shouldHoist) {
                // NOTE: Node.clone()/inherit() does not currently copy hoistToRoot.
                clonedSelector.hoistToRoot = true;
              }

              // If this ruleset selector has a `sourceNode` used for re-serialization,
              // extend that too so nested selector output matches Less expectations.
              const sourceSelector = (originalSelector as any).sourceNode as Selector | undefined;
              if (sourceSelector && typeof sourceSelector === 'object' && (sourceSelector as any).isSelector === true) {
                const sourceResult = tryExtendSelector(sourceSelector, singleTarget, selectorWithExtend, partial);
                if (sourceResult && !sourceResult.error) {
                  const nextSource = sourceResult.value;
                  if (nextSource.valueOf() !== sourceSelector.valueOf()) {
                    (clonedSelector as any).sourceNode = nextSource.clone(true);
                  }
                }
              }

              // Update the ruleset's selector directly
              ruleset.value.selector = maybeHoistMixedNestingSelectorList(ruleset, clonedSelector as any, partial) as any;
              ruleset.invalidateSelectorValueCache();
              if (clonedSelector.hoistToRoot) {
                ruleset.hoistToRoot = true;
              }

              extendedRulesets.add(ruleset); // Track that this ruleset was extended
              reindexRuleset(ruleset);

              // EXTEND CHAINING: Check if the extended selector matches any other extend targets
              // and process those extends immediately (depth-first)
              // Only chain extends that target selectors that were in the original ruleset
              const chainedExtends = findChainedExtends(extendedSelector, allExtends, singleTarget, selectorWithExtend, originalSelector);
              for (const [chainedTarget, chainedSelectorWithExtend, chainedPartial, chainedExtendRoot, chainedExtendNode] of chainedExtends) {
                const newExtendKey = `${chainedTarget.valueOf()}:${chainedSelectorWithExtend.valueOf()}:${chainedPartial}:${chainedExtendRoot === context.root ? 'root' : 'nested'}`;
                if (!processedExtends.has(newExtendKey)) {
                  processExtend(chainedTarget, chainedSelectorWithExtend, chainedPartial, chainedExtendRoot, chainedExtendNode, depth + 1);
                }
              }
            } else {
            }
          } else {
          }
        });
      }
    }
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
      const currentSelector = ruleset.selector as Selector;
      const currentSelectorValue = currentSelector.valueOf();
      const seenStates = seenSelectorStates.get(ruleset)!;

      // Check if we've seen this selector state before (infinite loop detection)
      if (seenStates.has(currentSelectorValue)) {
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

      // Check each selector in the current ruleset against all extend targets
      for (const currentSel of currentSelectors) {
        // Check against all original extends
        for (const [target, selectorWithExtend, partial, extendRoot, extendNode] of allExtends) {
          if (shouldSkipRuleset(ruleset, extendNode)) {
            continue; // Skip this extend for this ruleset
          }

          const targetSelectors: Selector[] = isNode(target, 'SelectorList')
            ? target.value
            : [target];

          for (const singleTarget of targetSelectors) {
            // Fast rejection: use keySet to check if ruleset might match (performance optimization)
            // This avoids calling tryExtendSelector on rulesets that definitely can't match
            const targetKeySet = singleTarget.keySet;
            const currentSelKeySet = currentSel.keySet;

            // For partial: target keys must be subset of current
            // For exact: keySets must have same size and target must be subset
            const keySetOverlaps = partial
              ? targetKeySet.isSubsetOf(currentSelKeySet)
              : targetKeySet.size === currentSelKeySet.size && targetKeySet.isSubsetOf(currentSelKeySet);

            if (!keySetOverlaps) {
              continue; // Fast rejection - keys don't overlap
            }

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

            if (!foundRuleset) {
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
              continue; // This extend already transformed this ruleset - skip
            }

            // Try to extend - tryExtendSelector will check for actual matches (including combinators)
            // and return an error if there's no match
            // Track object identity and structure to detect transformations

            const result = tryExtendSelector(currentSelector, singleTarget, selectorWithExtend, partial);

            if (result && !result.error) {
              const extendedSelector = result.value;

              // Only update if selector actually changed
              if (extendedSelector.valueOf() !== currentSelectorValue) {
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
                if (shouldHoist) {
                  // NOTE: Node.clone()/inherit() does not currently copy hoistToRoot.
                  clonedSelector.hoistToRoot = true;
                }

                const sourceSelector = (currentSelector as any).sourceNode as Selector | undefined;
                if (sourceSelector && typeof sourceSelector === 'object' && (sourceSelector as any).isSelector === true) {
                  const sourceResult = tryExtendSelector(sourceSelector, singleTarget, selectorWithExtend, partial);
                  if (sourceResult && !sourceResult.error) {
                    const nextSource = sourceResult.value;
                    if (nextSource.valueOf() !== sourceSelector.valueOf()) {
                      (clonedSelector as any).sourceNode = nextSource.clone(true);
                    }
                  }
                }
                ruleset.value.selector = clonedSelector;
                ruleset.invalidateSelectorValueCache();
                if (clonedSelector.hoistToRoot) {
                  ruleset.hoistToRoot = true;
                }

                reindexRuleset(ruleset);
                nextIteration.add(ruleset); // Keep in next iteration
                break; // Found a match, no need to check other targets
              } else {
              }
            } else {
            }
          }
        }

        // If we added to nextIteration, break out of outer loop
        if (nextIteration.has(ruleset)) {
          break;
        }
      }
    }

    rulesetsToCheck = nextIteration;
  }

  if (iteration >= maxIterations) {
    throw new Error(`Extend chaining exceeded maximum iterations (${maxIterations}). Possible infinite loop.`);
  }
}
