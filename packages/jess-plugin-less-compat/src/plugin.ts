import { AbstractPlugin, type Plugin, type Visitor, type Node } from '@jesscss/core';
import { toLessNode, fromLessNode } from './transform';
import type { LessVisitor } from './types';
import { filterPlugins } from './plugin-utils';

export interface LessCompatPluginOptions {
  /** 
   * Less.js plugins - these will have their install() method called to extract visitors.
   * Can be mixed with Jess plugins - Less plugins will be handled by this compat layer,
   * Jess plugins will be passed through.
   */
  plugins?: any[];
  /** 
   * @deprecated Less.js Visitor API - Less.js visitor implementations (advanced - use plugins instead).
   * This is for compatibility with Less.js visitor patterns. Prefer using Jess's native Visitor interface.
   */
  visitors?: LessVisitor[];
  /** Enable conversion caching (default: true) */
  cache?: boolean;
}

/**
 * Plugin that enables Less.js compatibility by transforming
 * Jess nodes to Less-compatible format for visitor processing.
 */
export class LessCompatPlugin extends AbstractPlugin {
  name = 'less-compat';

  constructor(public opts: LessCompatPluginOptions = {}) {
    super();
  }

  /**
   * Filter and separate Less plugins from Jess plugins
   * This allows mixed plugin arrays to be handled correctly
   * 
   * @deprecated Use filterPlugins from './plugin-utils' instead
   */
  static filterLessPlugins(plugins: any[]) {
    return filterPlugins(plugins);
  }

  /**
   * Return a visitor that wraps Less visitors
   * 
   * This visitor intercepts each node, converts it to Less format,
   * runs the Less visitors, and converts back if modified.
   */
  get visitor(): Visitor | undefined {
    const cache = this.opts.cache !== false;
    const cacheMap = cache ? new WeakMap() : undefined;

    // Import Less modules dynamically
    /** @deprecated Less.js Visitor API - Using Less.js Visitor class for compatibility */
    let LessVisitor: any;
    /** @deprecated Less.js API - Using Less.js PluginManager for compatibility */
    let LessPluginManager: any;
    try {
      const lessModule = require('less');
      LessVisitor = lessModule.visitors?.Visitor || require('less/lib/less/visitors/visitor').default;
      // Try to get PluginManager - it might be a factory function
      const pmModule = require('less/lib/less/plugin-manager');
      LessPluginManager = pmModule.default || pmModule;
    } catch (e) {
      console.warn('Less.js not available:', e);
      return undefined;
    }

    // Collect all Less visitors
    const lessVisitorInstances: any[] = [];

    // Handle Less plugins - call their install() method
    if (this.opts.plugins?.length) {
      // Separate Less plugins from Jess plugins
      // Jess plugins are ignored here - they should be handled by the main plugin system
      const { lessPlugins } = filterPlugins(this.opts.plugins);
      
      if (lessPlugins.length > 0) {
        // Create a mock Less instance for plugin installation
        /** @deprecated Less.js API - Mock Less instance for plugin compatibility */
        const mockLess = {
          visitors: { Visitor: LessVisitor },
          functions: { functionRegistry: {} },
          PluginLoader: class {}
        };
        
        // Create a PluginManager using the factory function
        // The factory takes (less, newFactory) where newFactory=true creates a new instance
        /** @deprecated Less.js API - Using Less.js PluginManager for compatibility */
        const pluginManager = typeof LessPluginManager === 'function' 
          ? LessPluginManager(mockLess, true)
          : new LessPluginManager(mockLess, true);
        
        // Track visitors before installation
        const visitorsBefore = pluginManager.visitors ? [...pluginManager.visitors] : [];
        
        lessPlugins.forEach((plugin: any) => {
          if (!plugin) {
            return;
          }

          // Check if it's a plugin with install method
          if (typeof plugin.install === 'function') {
            // Call the plugin's install method directly
            plugin.install(mockLess, pluginManager, mockLess.functions.functionRegistry);
          } else if (typeof plugin === 'function') {
            // Some plugins are constructor functions (like autoprefix, CleanCSS)
            // Check if the constructor's prototype has install
            if (plugin.prototype && typeof plugin.prototype.install === 'function') {
              // It's a constructor - instantiate it
              try {
                const pluginInstance = new plugin({});
                if (pluginInstance && typeof pluginInstance.install === 'function') {
                  pluginInstance.install(mockLess, pluginManager, mockLess.functions.functionRegistry);
                }
              } catch (e) {
                // If constructor fails, try calling as a function
                try {
                  const pluginInstance = plugin({});
                  if (pluginInstance && typeof pluginInstance.install === 'function') {
                    pluginInstance.install(mockLess, pluginManager, mockLess.functions.functionRegistry);
                  } else if (pluginInstance) {
                    // Might be a visitor implementation directly
                    lessVisitorInstances.push(new LessVisitor(pluginInstance));
                  }
                } catch (e2) {
                  // If all else fails, try wrapping it as a visitor
                  lessVisitorInstances.push(new LessVisitor(plugin));
                }
              }
            } else {
              // Try calling as a function that returns a plugin instance
              try {
                const pluginInstance = plugin({});
                if (pluginInstance && typeof pluginInstance.install === 'function') {
                  pluginInstance.install(mockLess, pluginManager, mockLess.functions.functionRegistry);
                } else if (pluginInstance) {
                  lessVisitorInstances.push(new LessVisitor(pluginInstance));
                }
              } catch (e2) {
                // If all else fails, try wrapping it as a visitor
                lessVisitorInstances.push(new LessVisitor(plugin));
              }
            }
          } else {
            // Plugin might be a visitor implementation directly
            lessVisitorInstances.push(new LessVisitor(plugin));
          }
        });

        // Collect visitors added by plugins via addVisitor
        if (pluginManager.visitors && pluginManager.visitors.length > visitorsBefore.length) {
          const newVisitors = pluginManager.visitors.slice(visitorsBefore.length);
          lessVisitorInstances.push(...newVisitors);
        }
      }
    }

    // Handle direct visitors (advanced usage)
    /** @deprecated Less.js Visitor API - Direct visitor support for Less.js compatibility */
    if (this.opts.visitors?.length) {
      const lessVisitors = this.opts.visitors;
      lessVisitors.forEach((visitorImpl: any) => {
        // If it's already a Visitor instance, use it
        if (visitorImpl instanceof LessVisitor) {
          lessVisitorInstances.push(visitorImpl);
        } else {
          // Otherwise, wrap the implementation in a Visitor
          lessVisitorInstances.push(new LessVisitor(visitorImpl));
        }
      });
    }

    if (lessVisitorInstances.length === 0) {
      return undefined;
    }

    // Track if we're currently in a conversion to prevent recursion
    const converting = new WeakSet();

    // Create a visitor object that implements the Visitor interface
    const visitor: Visitor = {
      visit: (node: Node): Node => {
        if (!node) {
          return node;
        }

        // Prevent recursion - if we're already converting this node, skip
        if (converting.has(node)) {
          return node;
        }

        // Mark as converting
        converting.add(node);

        try {
          // Convert Jess node to Less format
          const lessNode = toLessNode(node, { cache: cacheMap });
          
          // Run all Less visitors
          let result = lessNode;
          for (const lessVisitor of lessVisitorInstances) {
            // Less Visitor.visit() calls the appropriate visit* method
            // @deprecated Less.js Visitor API - Using Less.js visitor pattern for compatibility
            result = lessVisitor.visit(result);
          }
          
          // If visitor returned a different node, convert back to Jess
          if (result !== lessNode) {
            const converted = fromLessNode(result, { cache: cacheMap });
            // Return converted node if it's different, otherwise return original
            return converted !== node ? converted : node;
          }
          
          return node;
        } finally {
          // Unmark when done
          converting.delete(node);
        }
      }
    } as Visitor;

    return visitor;
  }
}

/**
 * Create a Less.js compatibility plugin
 */
const lessCompatPlugin: Plugin = ((opts?: LessCompatPluginOptions) => {
  return new LessCompatPlugin(opts);
}) as Plugin;

export default lessCompatPlugin;
export { lessCompatPlugin };
