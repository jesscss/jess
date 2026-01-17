import type { Rules } from '../rules';
import type { AtRule } from '../at-rule';
import { isNode } from './is-node';
import type { Context } from '../../context';
import type { Ruleset } from '../ruleset';
import type { Selector } from '../selector';
import type { Node } from '../node';
import { tryExtendSelector, findChainedExtends } from './extend';
import { WARN, toDiagnostic } from '../../jess-error';

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

  // Check if combinator is present in extend targets

  for (const root of allRoots) {
    const registry = root.getRegistry('ruleset');
    registry.indexPendingItems();
    const allRulesets: string[] = [];
    for (const [key, rulesetSet] of registry.index.entries()) {
      for (const ruleset of rulesetSet) {
        const selectorStr = ruleset.selector?.valueOf();
        allRulesets.push(selectorStr || 'nil');
        // Log all rulesets
      }
    }
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
    // DEBUG: Log extend processing for .ext target
    const targetStr = target.valueOf();
    if (targetStr && targetStr.includes('.ext')) {
      console.log('processExtend (.ext):', {
        target: targetStr,
        selectorWithExtend: selectorWithExtend.valueOf(),
        selectorWithExtendType: selectorWithExtend.type,
        partial,
        depth
      });
    }
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


    for (const singleTarget of targetSelectors) {
      // Skip self-referencing extends for individual selectors too
      if (singleTarget.valueOf() === selectorWithExtend.valueOf()) {
        continue;
      }

      // Find rulesets matching this single target in accessible roots
      let rulesetSet: Ruleset[] | undefined;

      const targetStr = singleTarget?.valueOf();
      const extendWithStr = selectorWithExtend?.valueOf();

      for (const searchRoot of accessibleRoots) {
        // Ensure registry is indexed for this root before searching
        const registry = searchRoot.getRegistry('ruleset');
        registry.indexPendingItems();

        const allRulesetsInRoot: string[] = [];
        for (const [key, rulesetSet] of registry.index.entries()) {
          for (const ruleset of rulesetSet) {
            allRulesetsInRoot.push(ruleset.selector?.valueOf() || 'nil');
          }
        }

        const searchKeySet = singleTarget.keySet;
        const searchKeysArray = Array.from(searchKeySet);
        const found = searchRoot.find('ruleset', searchKeySet);
        if (found) {
          for (const rs of found) {
            const rsSelector = rs.selector?.valueOf();
          }
          if (rulesetSet) {
            rulesetSet.push(...found);
          } else {
            rulesetSet = found;
          }
        } else {
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
          
          // DEBUG: Check for .ext extends
          const debugTargetStr = singleTarget?.valueOf();
          if (debugTargetStr && debugTargetStr.includes('.ext')) {
            const checkStructure = (s: any): any => {
              if (!s) return null;
              if (s.value && Array.isArray(s.value)) {
                return {
                  type: s.type,
                  components: s.value.map((c: any, idx: number) => {
                    const comp: any = {
                      index: idx,
                      type: c.type,
                      isAmpersand: c.constructor.name === 'Ampersand',
                      toString: c.toString()
                    };
                    if (comp.isAmpersand) {
                      comp.storedSelector = c.value?.selector?.toString();
                      comp.storedSelectorType = c.value?.selector?.type;
                    }
                    return comp;
                  })
                };
              }
              return { type: s.type, toString: s.toString() };
            };
            console.log('processExtend - applying to ruleset:', JSON.stringify({
              target: debugTargetStr,
              originalSelectorStructure: checkStructure(originalSelector),
              extendWithStructure: checkStructure(selectorWithExtend),
              partial
            }, null, 2));
          }

          const selectorStr = originalSelector?.valueOf();
          const targetStr = singleTarget?.valueOf();
          const extendWithStr = selectorWithExtend?.valueOf();


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
            
            // DEBUG: Check actual node structure after extend for .ext
            if (debugTargetStr && debugTargetStr.includes('.ext')) {
              const checkStructure = (s: any): any => {
                if (!s) return null;
                if (s.value && Array.isArray(s.value)) {
                  // ComplexSelector or SelectorList
                  const components = s.value.map((c: any, idx: number) => {
                    const comp: any = {
                      index: idx,
                      type: c.type,
                      isAmpersand: c.constructor.name === 'Ampersand',
                      toString: c.toString()
                    };
                    if (comp.isAmpersand) {
                      comp.storedSelector = c.value?.selector?.toString();
                      comp.storedSelectorType = c.value?.selector?.type;
                    }
                    // If it's a ComplexSelector, check its components too
                    if (c.value && Array.isArray(c.value)) {
                      comp.components = c.value.map((subC: any, subIdx: number) => {
                        const subComp: any = {
                          index: subIdx,
                          type: subC.type,
                          isAmpersand: subC.constructor.name === 'Ampersand',
                          toString: subC.toString()
                        };
                        if (subComp.isAmpersand) {
                          subComp.storedSelector = subC.value?.selector?.toString();
                          subComp.storedSelectorType = subC.value?.selector?.type;
                        }
                        return subComp;
                      });
                    }
                    return comp;
                  });
                  return {
                    type: s.type,
                    components: components
                  };
                }
                return { type: s.type, toString: s.toString() };
              };
              console.log('processExtend - after tryExtendSelector (first path):', JSON.stringify({
                target: debugTargetStr,
                extendedSelectorStructure: checkStructure(extendedSelector),
                extendedSelectorToString: extendedSelector?.toString()
              }, null, 2));
            }


            // Only update if selector actually changed
            if (extendedSelector.valueOf() !== originalSelector.valueOf()) {
              // Mark that this extend has transformed this ruleset
              transformsForRuleset.add(extendKey);


              // CRITICAL: Clone the selector to avoid object reference issues
              const clonedSelector = extendedSelector.clone(true);

              // Update the ruleset's selector directly
              ruleset.value.selector = clonedSelector;


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
    // DEBUG: Log all extends with .ext in target
    const targetStr = target.valueOf();
    if (targetStr && targetStr.includes('.ext')) {
      console.log('processExtends calling processExtend:', {
        target: targetStr,
        selectorWithExtend: selectorWithExtend.valueOf(),
        selectorWithExtendType: selectorWithExtend.type,
        partial
      });
    }
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

            const currentSelectorStr = currentSelector?.valueOf();
            const extendTargetStr = singleTarget?.valueOf();
            const extendWithStr = selectorWithExtend?.valueOf();
            
            // DEBUG: Check actual node structure for .ext extends
            if (extendTargetStr && extendTargetStr.includes('.ext')) {
              const checkStructure = (s: any): any => {
                if (!s) return null;
                if (s.value && Array.isArray(s.value)) {
                  // ComplexSelector
                  return {
                    type: s.type,
                    components: s.value.map((c: any, idx: number) => {
                      const comp: any = {
                        index: idx,
                        type: c.type,
                        isAmpersand: c.constructor.name === 'Ampersand',
                        toString: c.toString()
                      };
                      if (comp.isAmpersand) {
                        comp.storedSelector = c.value?.selector?.toString();
                        comp.storedSelectorType = c.value?.selector?.type;
                      }
                      return comp;
                    })
                  };
                }
                return { type: s.type, toString: s.toString() };
              };
              console.log('processExtend - before tryExtendSelector:', {
                target: extendTargetStr,
                currentSelectorStructure: checkStructure(currentSelector),
                extendWithStructure: checkStructure(selectorWithExtend)
              });
            }


            // Try to extend - tryExtendSelector will check for actual matches (including combinators)
            // and return an error if there's no match
            // Track object identity and structure to detect transformations

            const result = tryExtendSelector(currentSelector, singleTarget, selectorWithExtend, partial);

            if (result && !result.error) {
              const extendedSelector = result.value;
              
              // DEBUG: Check actual node structure after extend for .ext
              if (extendTargetStr && extendTargetStr.includes('.ext')) {
                const checkStructure = (s: any): any => {
                  if (!s) return null;
                  if (s.value && Array.isArray(s.value)) {
                    // ComplexSelector
                    return {
                      type: s.type,
                      components: s.value.map((c: any, idx: number) => {
                        const comp: any = {
                          index: idx,
                          type: c.type,
                          isAmpersand: c.constructor.name === 'Ampersand',
                          toString: c.toString()
                        };
                        if (comp.isAmpersand) {
                          comp.storedSelector = c.value?.selector?.toString();
                          comp.storedSelectorType = c.value?.selector?.type;
                        }
                        return comp;
                      })
                    };
                  }
                  return { type: s.type, toString: s.toString() };
                };
                console.log('processExtend - after tryExtendSelector:', {
                  target: extendTargetStr,
                  extendedSelectorStructure: checkStructure(extendedSelector),
                  extendedSelectorToString: extendedSelector?.toString()
                });
              }


              // Only update if selector actually changed
              if (extendedSelector.valueOf() !== currentSelectorValue) {
                // Mark that this extend has transformed this ruleset
                transformsForRuleset.add(extendKey);

                // CRITICAL: Clone the selector to avoid object reference issues
                const clonedSelector = extendedSelector.clone(true);

                // TEMP: Debug .zap bug - log when selector is assigned in Phase 2
                if (clonedSelector?.valueOf()?.includes('.zap') && (currentSelectorValue?.includes('.ext8 .ext9') && currentSelectorValue?.includes('.buu'))) {
                  console.log('=== PHASE 2 ASSIGNING SELECTOR WITH .zap ===');
                  console.log('  BEFORE:', currentSelectorValue);
                  console.log('  AFTER:', clonedSelector?.valueOf());
                  console.log('  find:', singleTarget?.valueOf());
                  console.log('  extendWith:', selectorWithExtend?.valueOf());
                  console.log('  STACK TRACE:');
                  console.log(new Error().stack);
                }

                ruleset.value.selector = clonedSelector;
                
                // DEBUG: Check actual node structure after assignment for .ext
                if (extendTargetStr && extendTargetStr.includes('.ext')) {
                  const checkStructure = (s: any): any => {
                    if (!s) return null;
                    if (s.value && Array.isArray(s.value)) {
                      // ComplexSelector
                      return {
                        type: s.type,
                        components: s.value.map((c: any, idx: number) => {
                          const comp: any = {
                            index: idx,
                            type: c.type,
                            isAmpersand: c.constructor.name === 'Ampersand',
                            toString: c.toString()
                          };
                          if (comp.isAmpersand) {
                            comp.storedSelector = c.value?.selector?.toString();
                            comp.storedSelectorType = c.value?.selector?.type;
                          }
                          return comp;
                        })
                      };
                    }
                    return { type: s.type, toString: s.toString() };
                  };
                  console.log('processExtend - after assignment to ruleset:', JSON.stringify({
                    target: extendTargetStr,
                    rulesetSelectorStructure: checkStructure(ruleset.value.selector),
                    rulesetSelectorToString: ruleset.value.selector?.toString()
                  }, null, 2));
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
