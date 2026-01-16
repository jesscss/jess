import type { Rules } from '../rules';
import type { AtRule } from '../at-rule';
import { isNode } from './is-node';
import type { Context } from '../../context';
import type { Ruleset } from '../ruleset';
import type { Selector } from '../selector';
import type { Node } from '../node';
import { tryExtendSelector, findChainedExtends } from './extend';
import { WARN, toDiagnostic } from '../../jess-error';
import { syncLog } from './__tests__/debug-log';
import { serializeTypes } from './serialize-types';

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
  private layerNames = new WeakMap<import('../at-rule').AtRule, string>();

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
      // Only add non-protected, non-compose children
      // - Protected roots block access
      // - Compose roots create boundaries and are not accessible as children (only import type shares parent's root)
      const children = this.childrenRoots.get(currentRoot);
      if (children) {
        for (const child of children) {
          // Skip protected children - they should not be accessible
          if (this.isProtected.get(child)) {
            continue;
          }
          // Skip compose children - compose roots create boundaries and are not accessible as children
          // Only import type roots are accessible as children (they share the parent's root)
          if (this.isCompose.get(child)) {
            continue;
          }
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
  setLayerName(atRule: import('../at-rule').AtRule, layerName: string): void {
    this.layerNames.set(atRule, layerName);
  }

  /**
   * Get layer name for an AtRule (stored during preEval, retrieved in evalNode)
   * Does NOT delete - use takeLayerName to get and delete
   */
  getLayerName(atRule: import('../at-rule').AtRule): string | undefined {
    return this.layerNames.get(atRule);
  }

  /**
   * Get and delete layer name for an AtRule (used when registering the root)
   */
  takeLayerName(atRule: import('../at-rule').AtRule): string | undefined {
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

  // DEBUG: Log initial state of all extends and rulesets - LOG EVERYTHING
  // Check if combinator is present in extend targets
  syncLog({
    location: 'processExtends',
    action: 'START',
    totalExtends: allExtends.length,
    allExtends: allExtends.map(([target, selectorWithExtend, partial]) => ({
      target: target.valueOf(),
      targetType: target.type,
      extendWith: selectorWithExtend.valueOf(),
      extendWithType: selectorWithExtend.type,
      partial,
      // Check if target contains combinators
      hasPlus: target.valueOf().includes('+'),
      hasGreater: target.valueOf().includes('>'),
      hasSpace: target.valueOf().includes(' ') && !target.valueOf().includes('+') && !target.valueOf().includes('>')
    }))
  });

  // DEBUG: Log initial state of all rulesets in all roots
  for (const root of allRoots) {
    const registry = root.getRegistry('ruleset');
    registry.indexPendingItems();
    const allRulesets: string[] = [];
    for (const [key, rulesetSet] of registry.index.entries()) {
      for (const ruleset of rulesetSet) {
        const selectorStr = ruleset.selector?.valueOf();
        allRulesets.push(selectorStr || 'nil');
        // Log all rulesets
        syncLog({ location: 'processExtends', action: 'Initial ruleset state', root: root === context.root ? 'root' : 'nested', key, selector: selectorStr, selectorType: ruleset.selector?.type, isSelectorList: ruleset.selector?.type === 'SelectorList', selectorListItems: ruleset.selector?.type === 'SelectorList' ? (ruleset.selector as any).value?.map((s: any) => s.valueOf()) : undefined });
      }
    }
    syncLog({ location: 'processExtends', action: 'Total rulesets in registry', root: root === context.root ? 'root' : 'nested', count: allRulesets.length, sample: allRulesets.slice(0, 10) });
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

    // Get accessible roots for this extend's root
    const accessibleRoots = context.extendRoots.getAccessibleRoots(extendRoot);

    // If target is a SelectorList (e.g., .aa, .bb), process each selector separately
    const targetSelectors: Selector[] = isNode(target, 'SelectorList')
      ? target.value
      : [target];

    // DEBUG: Log target extraction to track combinator preservation
    syncLog({
      location: 'processExtend',
      action: 'Extracting singleTarget from target',
      originalTarget: target?.valueOf(),
      originalTargetType: target?.type,
      originalTargetSExpr: serializeTypes(target),
      isSelectorList: isNode(target, 'SelectorList'),
      targetSelectorsCount: targetSelectors.length,
      targetSelectors: targetSelectors.map(t => ({ valueOf: t.valueOf(), type: t.type, sExpr: serializeTypes(t) }))
    });

    for (const singleTarget of targetSelectors) {
      // Skip self-referencing extends for individual selectors too
      if (singleTarget.valueOf() === selectorWithExtend.valueOf()) {
        continue;
      }

      // Find rulesets matching this single target in accessible roots
      let rulesetSet: Ruleset[] | undefined;

      // DEBUG: Log what we're searching for
      const targetStr = singleTarget?.valueOf();
      const extendWithStr = selectorWithExtend?.valueOf();
      syncLog({
        location: 'processExtend',
        action: 'Searching for rulesets',
        target: targetStr,
        targetSExpr: serializeTypes(singleTarget),
        extendWith: extendWithStr,
        partial,
        accessibleRootsCount: accessibleRoots.size
      });

      for (const searchRoot of accessibleRoots) {
        const searchKeySet = singleTarget.keySet;
        const searchKeysArray = Array.from(searchKeySet);
        // DEBUG: Log ALL registry lookups with detailed keySet info
        syncLog({ location: 'processExtend', action: 'Registry lookup', target: targetStr, targetType: singleTarget.type, keySet: searchKeysArray, keySetSize: searchKeySet.size, foundCount: 0 }); // Log before search
        const found = searchRoot.find('ruleset', searchKeySet);
        syncLog({ location: 'processExtend', action: 'Registry lookup result', target: targetStr, keySet: searchKeysArray, foundCount: found?.length ?? 0, foundSelectors: found?.map(rs => rs.selector?.valueOf()).filter(Boolean).slice(0, 3) });
        if (found) {
          // DEBUG: Log found rulesets
          for (const rs of found) {
            const rsSelector = rs.selector?.valueOf();
            syncLog({ location: 'processExtend', action: 'Found ruleset via registry', target: targetStr, rulesetSelector: rsSelector, rulesetSelectorType: rs.selector?.type });
          }
          if (rulesetSet) {
            rulesetSet.push(...found);
          } else {
            rulesetSet = found;
          }
        } else {
          syncLog({ location: 'processExtend', action: 'No rulesets found in registry', target: targetStr, keySet: Array.from(singleTarget.keySet) });
        }
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

          // DEBUG: Log selector state before extend - LOG EVERYTHING
          const selectorStr = originalSelector?.valueOf();
          const targetStr = singleTarget?.valueOf();
          const extendWithStr = selectorWithExtend?.valueOf();

          syncLog({
            phase: 'Phase 1',
            action: 'Processing extend - BEFORE',
            target: targetStr,
            targetType: singleTarget?.type,
            extendWith: extendWithStr,
            extendWithType: selectorWithExtend?.type,
            partial,
            rulesetSelector: selectorStr,
            rulesetSelectorType: originalSelector?.type,
            isSelectorList: originalSelector?.type === 'SelectorList',
            selectorListItems: originalSelector?.type === 'SelectorList' ? (originalSelector as any).value?.map((s: any) => s.valueOf()) : undefined
          });

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

          // DEBUG: Log what we're passing to tryExtendSelector - LOG EVERYTHING
          // Track object identity and structure to detect transformations
          syncLog({
            phase: 'Phase 1',
            action: 'Calling tryExtendSelector',
            originalSelector: originalSelector?.valueOf(),
            originalSelectorType: originalSelector?.type,
            originalSelectorSExpr: serializeTypes(originalSelector),
            originalSelectorObjectId: originalSelector ? Object.prototype.toString.call(originalSelector) : null,
            find: singleTarget?.valueOf(),
            findType: singleTarget?.type,
            findSExpr: serializeTypes(singleTarget),
            findObjectId: singleTarget ? Object.prototype.toString.call(singleTarget) : null,
            extendWith: selectorWithExtend?.valueOf(),
            extendWithType: selectorWithExtend?.type,
            extendWithSExpr: serializeTypes(selectorWithExtend),
            partial
          });

          let result = tryExtendSelector(originalSelector, singleTarget, selectorWithExtend, partial);

          // DEBUG: Log result from tryExtendSelector - LOG EVERYTHING
          if (result && !result.error) {
            const extendedSelector = result.value;

            syncLog({
              phase: 'Phase 1',
              action: 'tryExtendSelector SUCCESS',
              extendedSelector: extendedSelector?.valueOf(),
              extendedType: extendedSelector?.type,
              extendedSelectorSExpr: serializeTypes(extendedSelector),
              originalSelector: originalSelector?.valueOf(),
              originalSelectorSExpr: serializeTypes(originalSelector),
              changed: extendedSelector.valueOf() !== originalSelector.valueOf(),
              sameObject: extendedSelector === originalSelector
            });

            // Only update if selector actually changed
            if (extendedSelector.valueOf() !== originalSelector.valueOf()) {
              // Mark that this extend has transformed this ruleset
              transformsForRuleset.add(extendKey);

              // DEBUG: Log before updating
              syncLog({ phase: 'Phase 1', action: 'Updating ruleset selector', before: ruleset.value.selector?.valueOf(), after: extendedSelector?.valueOf(), cloning: true });

              // CRITICAL: Clone the selector to avoid object reference issues
              const clonedSelector = extendedSelector.clone(true);

              // Update the ruleset's selector directly
              ruleset.value.selector = clonedSelector;

              // DEBUG: Log after assignment - LOG EVERYTHING
              syncLog({
                phase: 'Phase 1',
                action: 'After assignment - ruleset selector updated',
                rulesetSelector: ruleset.value.selector?.valueOf(),
                rulesetSelectorType: ruleset.value.selector?.type,
                sameAsExtended: ruleset.value.selector === extendedSelector,
                sameAsCloned: ruleset.value.selector === clonedSelector
              });

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
              syncLog({ phase: 'Phase 1', action: 'Selector did not change, skipping update', originalSelector: originalSelector?.valueOf(), extendedSelector: extendedSelector?.valueOf() });
            }
          } else {
            syncLog({ phase: 'Phase 1', action: 'tryExtendSelector ERROR', errorType: result?.error?.type, errorMessage: result?.error?.message, originalSelector: originalSelector?.valueOf(), find: singleTarget?.valueOf(), extendWith: selectorWithExtend?.valueOf() });
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

            // DEBUG: Log Phase 2 processing - LOG EVERYTHING
            const currentSelectorStr = currentSelector?.valueOf();
            const targetStr = singleTarget?.valueOf();
            const extendWithStr = selectorWithExtend?.valueOf();

            syncLog({
              phase: 'Phase 2',
              action: 'Iterative processing - BEFORE',
              iteration,
              target: targetStr,
              targetType: singleTarget?.type,
              extendWith: extendWithStr,
              extendWithType: selectorWithExtend?.type,
              partial,
              currentSelector: currentSelectorStr,
              currentType: currentSelector?.type,
              rulesetSelector: ruleset.value.selector?.valueOf(),
              rulesetType: ruleset.value.selector?.type,
              sameObject: currentSelector === ruleset.value.selector
            });

            // Try to extend - tryExtendSelector will check for actual matches (including combinators)
            // and return an error if there's no match
            // DEBUG: Log what we're passing to tryExtendSelector - LOG EVERYTHING
            // Track object identity and structure to detect transformations
            syncLog({
              phase: 'Phase 2',
              action: 'Calling tryExtendSelector',
              currentSelector: currentSelector?.valueOf(),
              currentSelectorType: currentSelector?.type,
              currentSelectorSExpr: serializeTypes(currentSelector),
              currentSelectorObjectId: currentSelector ? Object.prototype.toString.call(currentSelector) : null,
              find: singleTarget?.valueOf(),
              findType: singleTarget?.type,
              findSExpr: serializeTypes(singleTarget),
              findObjectId: singleTarget ? Object.prototype.toString.call(singleTarget) : null,
              extendWith: selectorWithExtend?.valueOf(),
              extendWithType: selectorWithExtend?.type,
              extendWithSExpr: serializeTypes(selectorWithExtend),
              partial
            });

            const result = tryExtendSelector(currentSelector, singleTarget, selectorWithExtend, partial);

            // DEBUG: Log result from tryExtendSelector - LOG EVERYTHING
            if (result && !result.error) {
              const extendedSelector = result.value;

              syncLog({
                phase: 'Phase 2',
                action: 'tryExtendSelector SUCCESS',
                extendedSelector: extendedSelector?.valueOf(),
                extendedType: extendedSelector?.type,
                extendedSelectorSExpr: serializeTypes(extendedSelector),
                originalSelector: currentSelector?.valueOf(),
                originalSelectorSExpr: serializeTypes(currentSelector),
                changed: extendedSelector.valueOf() !== currentSelectorValue,
                sameObject: extendedSelector === currentSelector
              });

              // Only update if selector actually changed
              if (extendedSelector.valueOf() !== currentSelectorValue) {
                // Mark that this extend has transformed this ruleset
                transformsForRuleset.add(extendKey);

                // CRITICAL: Clone the selector to avoid object reference issues
                const clonedSelector = extendedSelector.clone(true);
                ruleset.value.selector = clonedSelector;

                // DEBUG: Log after assignment - LOG EVERYTHING
                syncLog({
                  phase: 'Phase 2',
                  action: 'After assignment - ruleset selector updated',
                  rulesetSelector: ruleset.value.selector?.valueOf(),
                  rulesetSelectorType: ruleset.value.selector?.type,
                  sameAsExtended: ruleset.value.selector === extendedSelector,
                  sameAsCloned: ruleset.value.selector === clonedSelector
                });

                reindexRuleset(ruleset);
                nextIteration.add(ruleset); // Keep in next iteration
                break; // Found a match, no need to check other targets
              } else {
                // DEBUG: Log when selector didn't change - LOG EVERYTHING
                syncLog({
                  phase: 'Phase 2',
                  action: 'Selector did not change, skipping update',
                  originalSelector: currentSelector?.valueOf(),
                  extendedSelector: extendedSelector?.valueOf(),
                  same: extendedSelector.valueOf() === currentSelectorValue
                });
              }
            } else {
              // DEBUG: Log error - LOG EVERYTHING
              syncLog({
                phase: 'Phase 2',
                action: 'tryExtendSelector ERROR',
                errorType: result?.error?.type,
                errorMessage: result?.error?.message,
                originalSelector: currentSelector?.valueOf(),
                find: singleTarget?.valueOf(),
                extendWith: selectorWithExtend?.valueOf()
              });
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
