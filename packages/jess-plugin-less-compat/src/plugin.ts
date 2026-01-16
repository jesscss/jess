import { AbstractPlugin, type Plugin, type Visitor, type Node } from '@jesscss/core';
import { toLessNode, fromLessNode } from './transform';
import { getJessNodeFromProxy } from './transform/proxy';
import type { LessVisitor } from './types';
import { filterPlugins } from './plugin-utils';
import { LessVisitor as LessVisitorClass, LessPluginManager, LessTreeConstructors, createLessMock } from './less-compat-structures';

// Debug logging helper (only in debug mode)
const syncLog = process.env.DEBUG ? (data: object) => {
  try {
    // eslint-disable-next-line no-console
    console.log('[LessCompatPlugin]', JSON.stringify(data, null, 2));
  } catch {
    // Ignore errors
  }
} : () => {};

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
  /**
   * Plugin registry for @plugin directive support.
   * Maps plugin names/paths to plugin instances or factory functions.
   * Used when processing @plugin directives in the source.
   */
  pluginRegistry?: Record<string, any>;
  /**
   * Enable auto-loading of plugins by name (Less.js 4.x CLI behavior).
   * When true (default), @plugin directives will attempt to require/import
   * plugins by their npm package name (e.g., "less-plugin-autoprefix").
   * Set to false to disable and only use pluginRegistry.
   */
  autoLoadPlugins?: boolean;
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
   * Return the visitor as a preEval visitor so it runs before evaluation.
   * This ensures @plugin directives are processed early, allowing their visitors
   * to run on subsequent nodes during the preEval phase.
   *
   * Less plugins can register visitors via:
   * - addVisitor() - these will run during preEval (default)
   * - addPreProcessor() - these will run during preEval
   * - addPostProcessor() - these will run during postEval (after evaluation)
   */
  get preEvalVisitor() {
    // The main visitor processes @plugin directives and runs Less visitors
    // We mark it as preEval so it runs before node.eval()
    return this.visitor;
  }

  /**
   * Return postEval visitors from Less plugins that registered via addPostProcessor.
   * These visitors will run after node.eval() completes.
   */
  get postEvalVisitor() {
    // Collect post-processors from Less plugins
    // These are registered via pluginManager.addPostProcessor()
    // We'll need to track these and create visitors for them
    // For now, return undefined - postEval visitor support can be added later
    return undefined;
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
  get visitor(): Visitor | Visitor[] | undefined {
    const cache = this.opts.cache !== false;
    const cacheMap = cache ? new WeakMap() : undefined;

    // Use our own Less.js-compatible structures (no dependency on actual Less.js library)
    const LessVisitor = LessVisitorClass;
    const LessPluginManagerClass = LessPluginManager;

    // Collect all Less visitors
    // Use an array that we'll iterate as an iterator to allow dynamic insertion
    const lessVisitorInstances: any[] = [];

    // References for @plugin processing - initialized early so visitor can access them
    let pluginManagerRef: any = null;
    let mockLessRef: any = null;

    // Create an iterator function that allows dynamic visitor insertion
    // This matches Less.js behavior where @plugin can add visitors during traversal
    function* createVisitorIterator() {
      let index = 0;
      while (index < lessVisitorInstances.length) {
        yield lessVisitorInstances[index];
        index++;
        // Check again after incrementing - new visitors might have been added
        // This allows @plugin to insert visitors that will be processed on subsequent nodes
      }
    }

    // Always create mockLess and pluginManager for @plugin processing
    // Even if there are no initial plugins, @plugin directives might load plugins
    const createFunctionRegistry = (realRegistry?: any) => {
      // Internal storage (matching Less.js _data structure)
      const _data: Record<string, any> = {};
      let _base: any = null;

      const registry = {
        _data,

        // Less.js API methods
        add(name: string, func: any): void {
          // Convert to lowercase for Less.js compatibility
          name = name.toLowerCase();
          _data[name] = func;

          // If we have a real Jess registry, also add to it
          if (realRegistry) {
            try {
              realRegistry.add(name, func);
            } catch (e) {
              // Ignore errors - real registry might not be available
            }
          }
        },

        addMultiple(functions: Record<string, any>): void {
          Object.keys(functions).forEach((name) => {
            this.add(name, functions[name]);
          });
        },

        get(name: string): any {
          name = name.toLowerCase();
          // Check local first
          if (_data[name]) {
            return _data[name];
          }
          // Then check base (for inheritance)
          if (_base) {
            return _base.get(name);
          }
          // If we have a real Jess registry, try that
          if (realRegistry) {
            try {
              return realRegistry.get(name);
            } catch (e) {
              // Ignore errors
            }
          }
          return undefined;
        },

        getLocalFunctions(): Record<string, any> {
          return { ..._data };
        },

        inherit(): any {
          const child = createFunctionRegistry(realRegistry) as any;
          child._base = this;
          return child;
        },

        create(base: any): any {
          const newRegistry = createFunctionRegistry(realRegistry) as any;
          newRegistry._base = base;
          return newRegistry;
        }
      };

      // Wrap with Proxy to handle edge cases (like 'Call' constructor access)
      return new Proxy(registry, {
        get(target, prop) {
          // First check if it's a method on the registry
          if (prop in target) {
            return target[prop as keyof typeof target];
          }

          // Handle Less.js tree constructors that plugins might access
          // These are typically accessed as functionRegistry.Call, functionRegistry.Variable, etc.
          if (typeof prop === 'string' && /^[A-Z]/.test(prop)) {
            // Try to get the constructor from our Less.js-compatible structures
            if (LessTreeConstructors[prop]) {
              return LessTreeConstructors[prop];
            }
            // Fallback: return a no-op constructor that matches Less.js structure
            return function(...args: any[]) {
              return {
                value: null,
                type: prop,
                name: args[0] || '',
                args: args.slice(1) || [],
                index: 0,
                fileInfo: {},
                accept: function(visitor: any) {
                  return visitor.visit(this);
                }
              };
            };
          }

          // For any other property, return a no-op function
          return function() { return { value: null }; };
        }
      });
    };

    const functionRegistry = createFunctionRegistry();
    const mockLess = createLessMock(functionRegistry);
    const pluginManager = new LessPluginManagerClass(mockLess, true);

    // Initialize references for @plugin processing
    pluginManagerRef = pluginManager;
    mockLessRef = mockLess;

    // Handle Less plugins - call their install() method
    if (this.opts.plugins?.length) {
      // Separate Less plugins from Jess plugins
      // Jess plugins are ignored here - they should be handled by the main plugin system
      const { lessPlugins } = filterPlugins(this.opts.plugins);

      if (lessPlugins.length > 0) {
        // Track visitors before installation
        const visitorsBefore = pluginManager.visitors ? [...pluginManager.visitors] : [];

        // Process plugins - handle functions that need to be instantiated
        // In JavaScript, you can call any function with 'new', so we always try that first
        const processedPlugins: any[] = [];
        lessPlugins.forEach((plugin: any) => {
          if (!plugin) {
            // Skip undefined/null plugins
            return;
          }

          // If plugin is a function, try calling it with 'new' first
          // This handles both constructors and regular functions
          if (typeof plugin === 'function') {
            try {
              const pluginInstance = new plugin({});
              if (pluginInstance) {
                processedPlugins.push(pluginInstance);
              } else {
                // If new returns undefined/null, try calling as function
                try {
                  const pluginInstance2 = plugin({});
                  if (pluginInstance2) {
                    processedPlugins.push(pluginInstance2);
                  } else {
                    // If both fail, use the function itself
                    processedPlugins.push(plugin);
                  }
                } catch (_e2) {
                  // If function call fails, use the function itself
                  processedPlugins.push(plugin);
                }
              }
            } catch (e) {
              // If 'new' fails, try calling as function
              try {
                const pluginInstance = plugin({});
                if (pluginInstance) {
                  processedPlugins.push(pluginInstance);
                } else {
                  // If function call returns undefined, use the function itself
                  processedPlugins.push(plugin);
                }
              } catch (_e2) {
                // If both fail, use the function itself
                processedPlugins.push(plugin);
              }
            }
          } else {
            // Not a function, use as-is
            processedPlugins.push(plugin);
          }
        });

        processedPlugins.forEach((plugin: any) => {
          if (!plugin) {
            return;
          }

          // CRITICAL: Many Less plugins (like autoprefix, clean-css) are BOTH plugins AND visitors
          // We should ALWAYS try to wrap the plugin instance as a visitor FIRST
          // because the plugin instance itself IS the visitor, regardless of install()
          let wrappedAsVisitor = false;
          try {
            const wrappedVisitor = new LessVisitor(plugin);
            lessVisitorInstances.push(wrappedVisitor);
            wrappedAsVisitor = true;
          } catch (e: any) {
            // If wrapping fails, log for debugging but continue
            // The error might be expected if the plugin doesn't have visit* methods
            // We'll try other methods below
            if (process.env.DEBUG) {
              console.warn('Failed to wrap plugin as LessVisitor:', e?.message);
            }
          }

          // Check if it's a plugin with install method (most common case)
          if (typeof plugin.install === 'function') {
            // Call the plugin's install method directly
            // This might add additional visitors via pluginManager.addVisitor()
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
        // Some plugins add visitors during install() via pluginManager.addVisitor()
        if (pluginManager.visitors && pluginManager.visitors.length > visitorsBefore.length) {
          const newVisitors = pluginManager.visitors.slice(visitorsBefore.length);
          // Wrap raw visitors in LessVisitor instances
          lessVisitorInstances.push(...newVisitors.map((v: any) => {
            // If it's already a LessVisitor, use it directly
            if (v instanceof LessVisitor) {
              return v;
            }
            // Otherwise, wrap it
            return new LessVisitor(v);
          }));
        }

        // References are already set above (before the if block)
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

    // Don't return undefined even if there are no initial visitors
    // @plugin directives might add visitors during traversal
    // We'll create a visitor that can handle @plugin processing
    // If there are truly no visitors and no @plugin directives, the visitor will just pass through

    // Track nodes currently being processed to prevent infinite loops
    // This set persists for the entire visitor lifetime to prevent re-processing
    const processing = new WeakSet<Node>();
    // Track if we're currently inside a Less visitor traversal
    // This prevents the plugin visitor from being triggered when visitArray calls visit()
    let insideLessTraversal = false;
    // Track plugins loaded via @plugin directives
    const loadedPlugins = new Set<any>();

    // Create a visitor object that implements the Visitor interface
    const visitor: Visitor = {
      // Handle @plugin at-rules - these should be processed early (like Less.js preEval)
      // In Less.js, @plugin is processed in preEval phase before the tree is evaluated
      // This ensures plugins loaded via @plugin have their visitors available for subsequent nodes
      atRule: (node: any, _ctx?: any): any => {
        syncLog({
          location: 'LessCompatPlugin.visitor.atRule',
          action: 'atRule called',
          nodeType: node?.type,
          hasValue: !!node?.value,
          valueName: node?.value?.name
        });
        // Check if this is a @plugin directive
        // In Less.js, @plugin syntax is: @plugin "plugin-name";
        // Handle both AtRule (modern) and Directive (v2) node types
        if (node && (node.type === 'AtRule' || node.type === 'Directive')) {
          const atRuleName = node.value?.name;
          let nameValue: string | undefined;

          // Extract name value (could be string or node)
          if (typeof atRuleName === 'string') {
            nameValue = atRuleName;
          } else if (atRuleName?.value) {
            nameValue = atRuleName.value;
          } else if (atRuleName?.type === 'Any' && atRuleName.value) {
            nameValue = atRuleName.value;
          }

          if (nameValue === 'plugin') {
            // Extract plugin path/name from prelude
            // Handle both AtRule (value.prelude) and Directive (value.value) structures
            const prelude = node.value?.prelude || node.value?.value;
            let pluginPath: string | undefined;

            if (prelude) {
              // Prelude might be a Quoted string, Expression, or already evaluated
              if (typeof prelude === 'string') {
                pluginPath = prelude;
              } else if (prelude.value && typeof prelude.value === 'string') {
                pluginPath = prelude.value;
              } else if (prelude.type === 'Quoted' && prelude.value) {
                pluginPath = prelude.value;
              } else if (prelude.type === 'Expression' && prelude.value) {
                // Expression might contain a Quoted string
                const firstValue = Array.isArray(prelude.value) ? prelude.value[0] : prelude.value;
                if (firstValue && firstValue.type === 'Quoted' && firstValue.value) {
                  pluginPath = firstValue.value;
                }
              }
            }

            if (pluginPath) {
              // Remove quotes if present
              pluginPath = pluginPath.replace(/^["']|["']$/g, '');

              syncLog({
                location: 'LessCompatPlugin.visitor.atRule',
                action: 'Processing @plugin',
                pluginPath,
                alreadyLoaded: loadedPlugins.has(pluginPath),
                hasPluginManagerRef: !!pluginManagerRef,
                hasMockLessRef: !!mockLessRef,
                hasPluginRegistry: !!this.opts.pluginRegistry,
                inRegistry: this.opts.pluginRegistry ? pluginPath in this.opts.pluginRegistry : false
              });

              // Check if plugin is already loaded
              if (!loadedPlugins.has(pluginPath) && pluginManagerRef && mockLessRef) {
                loadedPlugins.add(pluginPath);

                try {
                  // Try to load plugin from registry (for testing and explicit registration)
                  let pluginInstance: any = null;

                  if (this.opts.pluginRegistry && this.opts.pluginRegistry[pluginPath]) {
                    const pluginFactory = this.opts.pluginRegistry[pluginPath];
                    pluginInstance = typeof pluginFactory === 'function' ? pluginFactory() : pluginFactory;
                  } else if (this.opts.autoLoadPlugins !== false) {
                    // Try to auto-load plugin by name (Less.js 4.x CLI behavior)
                    // Attempt to require the plugin module (synchronous only - visitors are sync)
                    // Try as npm package name (e.g., "less-plugin-autoprefix")
                    // First try with "less-plugin-" prefix if not already present
                    let moduleName = pluginPath;
                    if (!pluginPath.startsWith('less-plugin-') && !pluginPath.startsWith('@')) {
                      moduleName = `less-plugin-${pluginPath}`;
                    }

                    try {
                      // Use require (CommonJS) - synchronous loading only
                      // Note: Dynamic import() is async and cannot be used in sync visitor
                      if (typeof require !== 'undefined') {
                        const pluginModule = require(moduleName);
                        pluginInstance = pluginModule.default || pluginModule;
                        // If it's a function, call it
                        if (typeof pluginInstance === 'function') {
                          pluginInstance = pluginInstance();
                        }
                      }
                    } catch (loadError: any) {
                      // Plugin not found - log warning if debug mode
                      if (process.env.DEBUG) {
                        // eslint-disable-next-line no-console
                        console.warn(`Plugin "${pluginPath}" not found. Tried: "${moduleName}". Add it to pluginRegistry option or install the package.`, loadError?.message);
                      }
                    }
                  } else {
                    // Auto-loading disabled - skip
                    if (process.env.DEBUG) {
                      console.warn(`Plugin "${pluginPath}" not found in registry and auto-loading is disabled. Add it to pluginRegistry option.`);
                    }
                  }

                  // If we have a plugin instance, register it synchronously
                  // This allows the plugin's visitors to be added to the iterator
                  // and they will be processed on subsequent nodes (Less.js behavior)
                  if (pluginInstance) {
                    syncLog({
                      location: 'LessCompatPlugin.visitor.atRule',
                      action: 'Registering plugin',
                      pluginPath,
                      hasInstall: typeof pluginInstance.install === 'function'
                    });
                    const visitorsBefore = pluginManagerRef.visitors.length;
                    pluginManagerRef.registerPlugin(pluginInstance);

                    syncLog({
                      location: 'LessCompatPlugin.visitor.atRule',
                      action: 'Plugin registered',
                      pluginPath,
                      visitorsBefore,
                      visitorsAfter: pluginManagerRef.visitors.length,
                      newVisitors: pluginManagerRef.visitors.length - visitorsBefore
                    });

                    // Collect any new visitors added by this plugin
                    // These will be automatically included in the iterator via .next() calls
                    if (pluginManagerRef.visitors.length > visitorsBefore) {
                      const newVisitors = pluginManagerRef.visitors.slice(visitorsBefore);
                      // Wrap raw visitors in LessVisitor instances
                      lessVisitorInstances.push(...newVisitors.map((v: any) => {
                        // If it's already a LessVisitor, use it directly
                        if (v instanceof LessVisitor) {
                          return v;
                        }
                        // Otherwise, wrap it
                        return new LessVisitor(v);
                      }));
                    }
                  }
                } catch (e) {
                  // Plugin loading failed - continue without it
                  if (process.env.DEBUG) {
                    console.warn(`Failed to process @plugin directive: ${pluginPath}`, e);
                  }
                }
              }
            }
          }
        }

        // After processing @plugin, we still need to run Less visitors on this node
        // But we'll let visit() handle that - atRule() just processes @plugin directives
        // The visit() method will be called separately and will run the Less visitors
        return node;
      },

      visit: (node: Node): Node => {
        // #region agent log
        fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'plugin.ts:603',message:'Plugin visitor.visit() entry',data:{nodeType:node?.type,insideLessTraversal,processingSize:processing.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        if (!node) {
          return node;
        }

        // Get underlying Jess node if this is a Less proxy
        // This allows us to check the processing WeakSet correctly
        const jessNode = getJessNodeFromProxy(node) || node;

        // If we're already inside a Less visitor traversal, don't process again
        // This prevents infinite loops when visitArray calls visit() on child nodes
        if (insideLessTraversal) {
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'plugin.ts:614',message:'Skipping - insideLessTraversal=true',data:{nodeType:node?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          return node;
        }

        // Prevent recursion - if we're already processing this node, skip
        // This prevents infinite loops when visitArray calls visit() on nodes that are already being processed
        if (processing.has(jessNode)) {
          // #region agent log
          fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'plugin.ts:620',message:'Skipping - already processing',data:{nodeType:node?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          return node;
        }

        // Mark as processing (keep in set for entire visitor lifetime)
        processing.add(jessNode);

        try {
          // Convert Jess node to Less format (use underlying node if proxy)
          const lessNode = toLessNode(jessNode, { cache: cacheMap });

          // Mark that we're inside Less visitor traversal
          // This prevents child nodes from triggering the plugin visitor again
          insideLessTraversal = true;

          try {
            // Run all Less visitors using iterator pattern
            // This allows new visitors to be added during iteration (e.g., from @plugin)
            // and they will automatically be processed via .next() calls
            let result = lessNode;

            // Use iterator pattern - visitors can be inserted during iteration
            // This matches Less.js behavior where @plugin-loaded visitors are inserted
            // into the visitor chain and processed on subsequent nodes
            // Only run visitors if we have any (including those added via @plugin)
            if (lessVisitorInstances.length > 0) {
              // #region agent log
              fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'plugin.ts:645',message:'Starting Less visitor iteration',data:{visitorCount:lessVisitorInstances.length,nodeType:lessNode?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
              // #endregion
              const visitorIterator = createVisitorIterator();
              let iteratorResult = visitorIterator.next();
              let iterationCount = 0;

              while (!iteratorResult.done) {
                iterationCount++;
                // #region agent log
                if (iterationCount > 100) {
                  fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'plugin.ts:649',message:'POSSIBLE INFINITE LOOP - iteration count > 100',data:{iterationCount,nodeType:lessNode?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                  break;
                }
                // #endregion
                const lessVisitor = iteratorResult.value;

                // Less Visitor.visit() calls the appropriate visit* method
                // Less.js Visitor class handles isReplacing internally:
                // - If isReplacing=false: return value is ignored, node modified in place, returns original node
                // - If isReplacing=true: return value replaces node (undefined = remove)
                // @deprecated Less.js Visitor API - Using Less.js visitor pattern for compatibility
                //
                // Handle Less.js v2 "Directive" nodes - if node is Directive type,
                // LessVisitor.visit() will route to visitDirective() which maps to visitAtRule()
                // #region agent log
                fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'plugin.ts:660',message:'Calling lessVisitor.visit()',data:{iterationCount,nodeType:result?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                // #endregion
                result = lessVisitor.visit(result);
                // #region agent log
                fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'plugin.ts:661',message:'After lessVisitor.visit()',data:{iterationCount,nodeType:result?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                // #endregion

                // If result is undefined, a replacing visitor wants to remove this node
                // (Non-replacing visitors can't return undefined - Less.js ignores their return value)
                if (result === undefined) {
                  return undefined as any;
                }

                // Get next visitor - if new visitors were added during this iteration,
                // they will be included in subsequent .next() calls
                // This allows @plugin-loaded visitors to be processed immediately
                iteratorResult = visitorIterator.next();
              }
            }

            // If visitor returned a different node, convert back to Jess
            if (result !== lessNode) {
              const converted = fromLessNode(result, { cache: cacheMap });
              // Return converted node if it's different, otherwise return original
              return converted !== jessNode ? converted : jessNode;
            }

            return jessNode;
          } finally {
            // Unmark when Less visitor traversal is complete
            insideLessTraversal = false;
          }
        } finally {
          // Keep node in processing set - don't delete it
          // This ensures we never process the same node twice during the entire visitor run
          // The WeakSet will be garbage collected when the visitor is done
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
