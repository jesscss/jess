import type { Rules } from '../rules';
import type { AtRule } from '../at-rule';
import { isNode } from './is-node';

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

  // Map layer name -> Set of Rules with that name
  private rootsByLayerName = new Map<string, Set<Rules>>();

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
    options?: { layerName?: string; isProtected?: boolean }
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
      const children = this.childrenRoots.get(currentRoot);
      if (children) {
        for (const child of children) {
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
   * Get layer name for a root
   */
  getLayerName(root: Rules): string | undefined {
    return this.layerName.get(root);
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
