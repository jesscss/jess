import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { AbstractPlugin, Any, Collection, Declaration, Dimension, type Plugin, type Visitor, type Node, F_VISIBLE } from '@jesscss/core';
import { toLessNode, fromLessNode, fromLessPluginReturnValue } from './transform/index.js';
import { getJessNodeFromProxy } from './transform/proxy.js';
import type { LessVisitor } from './types.js';
import { filterPlugins } from './plugin-utils.js';
import { LessVisitor as LessVisitorClass, LessPluginManager, LessTreeConstructors, createLessMock } from './less-compat-structures.js';
import { NodeModulesPlugin } from '@jesscss/plugin-node-modules';

/** Global key set by @jesscss/plugin-js when loaded. @plugin scripts require plugin-js (Deno) to be present. */
const JESS_PLUGIN_JS_GLOBAL = '__JESS_PLUGIN_JS_AVAILABLE__';

function assertPluginJsPresent(): void {
  if (typeof globalThis === 'undefined' || !(globalThis as Record<string, unknown>)[JESS_PLUGIN_JS_GLOBAL]) {
    throw new Error('@plugin script execution requires @jesscss/plugin-js (scripts must be run via Deno). Install @jesscss/plugin-js.');
  }
}

const isThenable = (v: any): v is PromiseLike<any> =>
  !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as any).then === 'function';

/**
 * Wrap a Less plugin function and add it to a Jess function registry.
 * Used so that @plugin-loaded functions register into the Rules that contain the @plugin.
 * Conversion of Less return values to Jess uses the shared fromLessPluginReturnValue.
 */
function addToJessRegistry(jessRegistry: any, name: string, func: any): void {
  if (!jessRegistry || typeof jessRegistry.add !== 'function') {
    return;
  }
  try {
    name = name.toLowerCase();
    const wrapped = function(this: any, ...args: any[]) {
      const maybeEvaldArgs = args.map((arg) => {
        if (arg instanceof Any || arg instanceof Declaration || arg instanceof Dimension) {
          // Fast path for common nodes that are safe to eval normally via .eval
        }
        if (arg instanceof Object && arg && typeof (arg as any).eval === 'function' && (arg as any).evaluated !== true) {
          try {
            return (arg as any).eval(this);
          } catch {
            return arg;
          }
        }
        return arg;
      });

      const call = (finalArgs: any[]) => func.apply(this, finalArgs);

      const maybeNeedsAwait = maybeEvaldArgs.some(isThenable);
      const result = maybeNeedsAwait
        ? Promise.all(maybeEvaldArgs.map(a => isThenable(a) ? a : Promise.resolve(a))).then(call)
        : call(maybeEvaldArgs);

      const statementContext = this?.caller?.parent?.type === 'Rules';
      const convertResult = (r: unknown) =>
        fromLessPluginReturnValue(r, { statementContext });

      return isThenable(result) ? (result as Promise<unknown>).then(convertResult) : convertResult(result);
    };
    Object.assign(wrapped, func);
    jessRegistry.add(name, wrapped);
  } catch (e) {
    void e;
  }
}

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
  /**
   * Reference to the node-modules plugin for npm package resolution.
   * If provided, will be used to resolve npm packages.
   * If not provided, will try to use require() directly.
   */
  nodeModulesPlugin?: NodeModulesPlugin;
}

/**
 * Plugin that enables Less.js compatibility by transforming
 * Jess nodes to Less-compatible format for visitor processing.
 */
export class LessCompatPlugin extends AbstractPlugin {
  name = 'less-compat';

  // Cache the visitor instance so it's reused across multiple calls
  // This ensures that visitors added via @plugin are available for subsequent nodes
  private _cachedVisitor: Visitor | Visitor[] | undefined;
  private _lessPluginManager?: LessPluginManager;
  private _currentFilePath?: string;
  private _jessFunctionRegistry?: any;

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
    // Cache the visitor instance so it's reused across multiple calls
    // This ensures that visitors added via @plugin are available for subsequent nodes
    if (!this._cachedVisitor) {
      this._cachedVisitor = this.visitor;
    }
    return this._cachedVisitor;
  }

  /**
   * Return postEval visitors from Less plugins that registered via addPostProcessor.
   * These visitors will run after node.eval() completes.
   */
  get postEvalVisitor() {
    // Not used yet - post processors run via runPostProcessors()
    return undefined;
  }

  runPostProcessors(css: string, extra: Record<string, any> = {}): string {
    const processors = this._lessPluginManager?.getPostProcessors() || [];
    return processors.reduce((current: string, processor: any) => {
      if (!processor || typeof processor.process !== 'function') {
        return current;
      }

      try {
        const output = processor.process(current, extra);
        return typeof output === 'string' ? output : current;
      } catch (error) {
        throw error;
      }
    }, css);
  }

  setCurrentFilePath(filePath: string) {
    this._currentFilePath = filePath;
  }

  setContext(context: any) {
    try {
      const root = context?.root;
      if (root && typeof root.getRegistry === 'function') {
        this._jessFunctionRegistry = root.getRegistry('function');
      }
    } catch {
      // ignore
    }
  }

  /**
   * Filter and separate Less plugins from Jess plugins
   * This allows mixed plugin arrays to be handled correctly
   *
   * @deprecated Use filterPlugins from './plugin-utils.js' instead
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
    let currentRealRegistry: any = this._jessFunctionRegistry;

    const createFunctionRegistry = () => {
      // Internal storage (matching Less.js _data structure)
      const data: Record<string, any> = {};
      let base: any = null;

      const registry = {
        get _data() {
          return data;
        },
        get _base() {
          return base;
        },
        set _base(v: any) {
          base = v;
        },

        // Less.js API methods
        add(name: string, func: any): void {
          name = name.toLowerCase();
          data[name] = func;
          if (currentRealRegistry) {
            addToJessRegistry(currentRealRegistry, name, func);
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
          if (data[name]) {
            return data[name];
          }
          // Then check base (for inheritance)
          if (base) {
            return base.get(name);
          }
          // If we have a real Jess registry, try that
          if (currentRealRegistry) {
            try {
              return currentRealRegistry.get(name);
            } catch (_e) {
              // Ignore errors
            }
          }
          return undefined;
        },

        getLocalFunctions(): Record<string, any> {
          return { ...data };
        },

        inherit(): any {
          const child = createFunctionRegistry() as any;
          child._base = this;
          return child;
        },

        create(base: any): any {
          const newRegistry = createFunctionRegistry() as any;
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
          return function() {
            return { value: null };
          };
        }
      });
    };

    /**
     * Create a mock function registry that forwards add/addMultiple/get to the given
     * Jess registry. Used when loading @plugin scripts so functions register into the
     * Rules that contain the @plugin directive.
     */
    const createScopedFunctionRegistry = (jessRegistry: any) => {
      const data: Record<string, any> = {};
      const registry = {
        add(name: string, func: any): void {
          name = name.toLowerCase();
          data[name] = func;
          addToJessRegistry(jessRegistry, name, func);
        },
        addMultiple(functions: Record<string, any>): void {
          Object.keys(functions).forEach((name) => {
            this.add(name, functions[name]);
          });
        },
        get(name: string): any {
          name = name.toLowerCase();
          if (data[name]) {
            return data[name];
          }
          try {
            return jessRegistry?.get?.(name);
          } catch {
            return undefined;
          }
        }
      };
      return new Proxy(registry, {
        get(target, prop) {
          if (prop in target) {
            return target[prop as keyof typeof target];
          }
          if (typeof prop === 'string' && /^[A-Z]/.test(prop)) {
            if (LessTreeConstructors[prop]) {
              return LessTreeConstructors[prop];
            }
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
          return function() {
            return { value: null };
          };
        }
      });
    };

    const functionRegistry = createFunctionRegistry();
    const mockLess = createLessMock(functionRegistry);
    const pluginManager = new LessPluginManagerClass(mockLess, true);
    this._lessPluginManager = pluginManager;

    const loadPluginSource = (fullPath: string, registerPlugin: (plugin: any) => void, targetJessRegistry?: any) => {
      assertPluginJsPresent();
      const contents = fs.readFileSync(fullPath, 'utf8');
      const localModule = { exports: {} as any };
      // When loading from an @plugin directive, pass a mock that registers to the Rules containing that @plugin
      const functions = targetJessRegistry != null
        ? createScopedFunctionRegistry(targetJessRegistry)
        : functionRegistry;
      const loader = new Function(
        'module',
        'require',
        'registerPlugin',
        'functions',
        'tree',
        'less',
        'fileInfo',
        contents
      );
      loader(
        localModule,
        createRequire(fullPath),
        registerPlugin,
        functions,
        LessTreeConstructors,
        mockLess,
        { filename: fullPath }
      );
      return {
        module: localModule.exports,
        registered: null
      };
    };

    const requirePluginFile = (fullPath: string, targetJessRegistry?: any) => {
      const registeredPlugins: any[] = [];
      const registerPlugin = (plugin: any) => {
        registeredPlugins.push(plugin);
      };
      const loaded = loadPluginSource(fullPath, registerPlugin, targetJessRegistry);
      return {
        module: loaded.module,
        registered: registeredPlugins.length > 0 ? registeredPlugins[registeredPlugins.length - 1] : loaded.registered
      };
    };

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
            } catch (_e) {
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
          try {
            const wrappedVisitor = new LessVisitor(plugin);
            lessVisitorInstances.push(wrappedVisitor);
          } catch (e: any) {
            // If wrapping fails, log for debugging but continue
            // The error might be expected if the plugin doesn't have visit* methods
            // We'll try other methods below
            void e;
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
              } catch (_e) {
                // If constructor fails, try calling as a function
                try {
                  const pluginInstance = plugin({});
                  if (pluginInstance && typeof pluginInstance.install === 'function') {
                    pluginInstance.install(mockLess, pluginManager, mockLess.functions.functionRegistry);
                  } else if (pluginInstance) {
                    // Might be a visitor implementation directly
                    lessVisitorInstances.push(new LessVisitor(pluginInstance));
                  }
                } catch (_e2) {
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
              } catch (_e2) {
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
    // Jess runs pre-eval visitors in two passes; ensure we only process each @plugin directive once.
    const processedPluginDirectives = new WeakSet<object>();

    // Create a visitor object that implements the Visitor interface
    const visitor: Visitor = {
      // Handle @plugin at-rules - these should be processed early (like Less.js preEval)
      // In Less.js, @plugin is processed in preEval phase before the tree is evaluated
      // This ensures plugins loaded via @plugin have their visitors available for subsequent nodes
      atRule: (node: any, _ctx?: any): any => {
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

          // Check if this is a @plugin directive
          // The name will be '@plugin' (with @ prefix) or 'plugin' (without)
          // Less.js uses '@plugin' but we should handle both
          const isPlugin = nameValue === 'plugin' || nameValue === '@plugin';

          if (isPlugin) {
            const pluginDirectiveNode = (getJessNodeFromProxy(node) || node) as object;
            if (processedPluginDirectives.has(pluginDirectiveNode)) {
              return node;
            }
            processedPluginDirectives.add(pluginDirectiveNode);
            const baseDir = this._currentFilePath ? path.dirname(this._currentFilePath) : undefined;
            // Extract plugin path/name and options from prelude
            // Handle both AtRule (value.prelude) and Directive (value.value) structures
            // Less.js syntax: @plugin (options) "path"
            const prelude = node.value?.prelude || node.value?.value;
            let pluginPath: string | undefined;
            let pluginOptions: string | undefined;

            if (prelude) {
              // Helper to extract string value from a node (Quoted, Url, or string)
              const extractStringValue = (node: any): string | undefined => {
                if (!node) {
                  return undefined;
                }
                if (typeof node === 'string') {
                  return node;
                }
                if (node.type === 'Quoted' && node.value) {
                  // Quoted.value can be string | Any | Interpolated
                  if (typeof node.value === 'string') {
                    return node.value;
                  }
                  if (node.value?.value && typeof node.value.value === 'string') {
                    return node.value.value;
                  }
                  // Try valueOf() for Any nodes
                  if (typeof node.valueOf === 'function') {
                    const val = node.valueOf();
                    if (typeof val === 'string') {
                      return val;
                    }
                  }
                }
                if (node.type === 'Url' && node.value) {
                  // Url.value can be Quoted, string, or other
                  if (typeof node.value === 'string') {
                    return node.value;
                  }
                  if (node.value.type === 'Quoted' && node.value.value) {
                    if (typeof node.value.value === 'string') {
                      return node.value.value;
                    }
                    if (node.value.value?.value && typeof node.value.value.value === 'string') {
                      return node.value.value.value;
                    }
                  }
                  // Try valueOf() for Url nodes
                  if (typeof node.valueOf === 'function') {
                    const val = node.valueOf();
                    if (typeof val === 'string') {
                      return val;
                    }
                  }
                }
                return undefined;
              };

              // Prelude might contain options in parentheses followed by the plugin path
              // Less.js syntax: @plugin (options) "path"
              // The prelude might be a Sequence with options and path, or just the path
              if (typeof prelude === 'string') {
                pluginPath = prelude;
              } else if (prelude.type === 'Quoted' || prelude.type === 'Url') {
                pluginPath = extractStringValue(prelude);
              } else if (prelude.type === 'Sequence' && Array.isArray(prelude.value)) {
                // Sequence might contain: [options in parens, quoted path]
                // Look for Quoted or Url (the path) and any preceding options
                for (let i = 0; i < prelude.value.length; i++) {
                  const item = prelude.value[i];
                  if (item && (item.type === 'Quoted' || item.type === 'Url')) {
                    pluginPath = extractStringValue(item);
                    // Check if there's an options node before this (e.g., in parentheses)
                    if (i > 0) {
                      const prevItem = prelude.value[i - 1];
                      // Options might be in a Paren node or as a string
                      if (prevItem && prevItem.type === 'Paren' && prevItem.value) {
                        const optionsValue = prevItem.value.valueOf ? prevItem.value.valueOf() : prevItem.value.toString();
                        if (typeof optionsValue === 'string') {
                          pluginOptions = optionsValue.trim();
                        }
                      } else if (prevItem && typeof prevItem.valueOf === 'function') {
                        const optionsValue = prevItem.valueOf();
                        if (typeof optionsValue === 'string' && optionsValue.includes('=')) {
                          pluginOptions = optionsValue.trim();
                        }
                      }
                    }
                    if (pluginPath) {
                      break;
                    }
                  }
                }
              } else if (prelude.type === 'Expression' && prelude.value) {
                // Expression might contain options and a Quoted or Url node
                const values = Array.isArray(prelude.value) ? prelude.value : [prelude.value];
                for (let i = 0; i < values.length; i++) {
                  const item = values[i];
                  if (item && (item.type === 'Quoted' || item.type === 'Url')) {
                    pluginPath = extractStringValue(item);
                    // Check for options before the path
                    if (i > 0) {
                      const prevItem = values[i - 1];
                      if (prevItem && prevItem.type === 'Paren' && prevItem.value) {
                        const optionsValue = prevItem.value.valueOf ? prevItem.value.valueOf() : prevItem.value.toString();
                        if (typeof optionsValue === 'string') {
                          pluginOptions = optionsValue.trim();
                        }
                      }
                    }
                    if (pluginPath) {
                      break;
                    }
                  }
                }
              } else if (prelude.type === 'List' && prelude.value) {
                // List might contain options and path
                const items = Array.isArray(prelude.value) ? prelude.value : [prelude.value];
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  if (item && (item.type === 'Quoted' || item.type === 'Url')) {
                    pluginPath = extractStringValue(item);
                    // Check for options before the path
                    if (i > 0) {
                      const prevItem = items[i - 1];
                      if (prevItem && prevItem.type === 'Paren' && prevItem.value) {
                        const optionsValue = prevItem.value.valueOf ? prevItem.value.valueOf() : prevItem.value.toString();
                        if (typeof optionsValue === 'string') {
                          pluginOptions = optionsValue.trim();
                        }
                      }
                    }
                    if (pluginPath) {
                      break;
                    }
                  }
                }
              } else if (prelude.value && typeof prelude.value === 'string') {
                // Fallback: direct string value
                pluginPath = prelude.value;
              }
            }

            if (pluginPath) {
              // Ensure pluginPath is a string and remove quotes if present
              if (typeof pluginPath === 'string') {
                pluginPath = pluginPath.replace(/^["']|["']$/g, '');
              } else {
                // If it's not a string, try to convert it
                pluginPath = String(pluginPath).replace(/^["']|["']$/g, '');
              }

              const isExplicitLocalPath =
                pluginPath.startsWith('.')
                || pluginPath.startsWith('/')
                || pluginPath.includes('/')
                || pluginPath.includes(path.sep);

              // Less.js will also resolve bare plugin names as local files relative to the current file,
              // before falling back to npm package resolution. (Needed for test-data `plugin-transitive`.)
              const localBasePath =
                (baseDir && !path.isAbsolute(pluginPath))
                  ? path.resolve(baseDir, pluginPath)
                  : (path.isAbsolute(pluginPath) ? pluginPath : undefined);

              let resolvedLocalPluginFile: string | undefined;
              if (localBasePath) {
                const candidates = [
                  localBasePath,
                  `${localBasePath}.js`,
                  `${localBasePath}.cjs`,
                  `${localBasePath}.mjs`
                ];
                resolvedLocalPluginFile = candidates.find(p => fs.existsSync(p));
              }

              const isLocalPath = isExplicitLocalPath || !!resolvedLocalPluginFile;

              // IMPORTANT: Less allows @plugin to be loaded multiple times in different scopes.
              // Do NOT globally dedupe by pluginPath; this breaks Less's scoping rules.
              if (pluginManagerRef && mockLessRef) {
                try {
                  // Scope: register Less plugin functions into the nearest Rules scope,
                  // so nested @plugin shadowing matches Less.js behavior.
                  const scopeNode = getJessNodeFromProxy(node) || node;
                  let scopeRules: any = scopeNode;
                  while (scopeRules && scopeRules.type !== 'Rules') {
                    scopeRules = scopeRules.parent;
                  }
                  if (scopeRules && typeof scopeRules.getRegistry === 'function') {
                    // Root-level @plugin should behave as global registration (Less.js behavior),
                    // even when encountered in an imported file.
                    if (!scopeRules.parent) {
                      currentRealRegistry = this._jessFunctionRegistry;
                    } else {
                      currentRealRegistry = scopeRules.getRegistry('function');
                    }
                  } else {
                    currentRealRegistry = this._jessFunctionRegistry;
                  }

                  // Try to load plugin from registry (for testing and explicit registration)
                  let pluginInstance: any = null;

                  if (this.opts.pluginRegistry && this.opts.pluginRegistry[pluginPath]) {
                    const pluginFactory = this.opts.pluginRegistry[pluginPath];
                    pluginInstance = typeof pluginFactory === 'function' ? pluginFactory() : pluginFactory;
                  } else if (isLocalPath && resolvedLocalPluginFile) {
                    const { module: pluginModule, registered } = requirePluginFile(resolvedLocalPluginFile, currentRealRegistry);
                    const PluginClass = pluginModule.default || pluginModule;
                    pluginInstance = registered || PluginClass;
                  } else if (!isLocalPath && this.opts.autoLoadPlugins !== false) {
                    // Auto-load plugins from npm/node_modules (Less.js behavior)
                    // Expand plugin name to try multiple variations (e.g., "clean-css" -> ["clean-css", "less-plugin-clean-css"])
                    // Less.js tries prefixes: 'less-plugin-{name}' and '{name}'
                    const prefixes = ['less-plugin-', ''];
                    const packageNamesToTry = prefixes.map(prefix => prefix + pluginPath);

                    let loaded = false;

                    // Try to use node-modules plugin if available (synchronous resolution)
                    if (this.opts.nodeModulesPlugin) {
                      for (const packageName of packageNamesToTry) {
                        const resolvedPath = this.opts.nodeModulesPlugin.resolvePackage(packageName);
                        if (resolvedPath) {
                          try {
                            // Load the module using require
                            const { module: pluginModule, registered } = requirePluginFile(resolvedPath, currentRealRegistry);
                            // Get the plugin - could be default export or direct export
                            let PluginClass = pluginModule.default || pluginModule;
                            pluginInstance = registered || PluginClass;

                            loaded = true;
                            break;
                          } catch {}
                        }
                      }
                    }

                    // Fallback to direct require() if node-modules plugin not available or didn't find it
                    if (!loaded) {
                      for (const fullName of packageNamesToTry) {
                        try {
                          // Try to require the plugin from node_modules
                          // This uses Node's module resolution (similar to Less.js)
                          if (typeof require !== 'undefined') {
                            const { module: pluginModule, registered } = requirePluginFile(fullName, currentRealRegistry);
                            // Get the plugin - could be default export or direct export
                            let PluginClass = pluginModule.default || pluginModule;
                            // Less.js pattern: if plugin is a function, instantiate it with new (no args)
                            // This matches Less.js's validatePlugin() behavior (line 138)
                            pluginInstance = registered || PluginClass;

                            loaded = true;
                            break;
                          }
                        } catch (e: any) {
                          // Module not found - try next name
                          if (e.code !== 'MODULE_NOT_FOUND') {
                            // Some other error - continue trying alternative names.
                          }
                        }
                      }
                    }
                  } else {
                    // Auto-loading disabled - skip
                  }

                  // If we have a plugin instance, register it synchronously
                  // This allows the plugin's visitors to be added to the iterator
                  // and they will be processed on subsequent nodes (Less.js behavior)
                  if (pluginInstance) {
                    // Less.js pattern: if plugin is a constructor function, instantiate it with `new` (no args)
                    if (typeof pluginInstance === 'function') {
                      try {
                        pluginInstance = new (pluginInstance as any)();
                      } catch {
                        // ignore, fall back to using the function itself
                      }
                    }

                    // Set options if provided (Less.js pattern - see abstract-plugin-loader.js trySetOptions)
                    // Less.js calls setOptions both before and after addPlugin
                    if (pluginOptions && typeof pluginInstance.setOptions === 'function') {
                      try {
                        pluginInstance.setOptions(pluginOptions);
                      } catch {}
                    }

                    const visitorsBefore = pluginManagerRef.visitors.length;
                    pluginManagerRef.registerPlugin(pluginInstance);

                    // Set options again after registration (Less.js pattern - plugin might have functions now)
                    if (pluginOptions && typeof pluginInstance.setOptions === 'function') {
                      try {
                        pluginInstance.setOptions(pluginOptions);
                      } catch {}
                    }

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
                  void e;
                }
              }
            }

            // After processing @plugin directive (whether pluginPath was found or not),
            // mark it as invisible so it doesn't appear in output
            // This must happen for ALL @plugin directives, not just ones that successfully load
            const jessNode = getJessNodeFromProxy(node) || node;
            if (jessNode && typeof (jessNode as any).removeFlag === 'function') {
              (jessNode as any).removeFlag(F_VISIBLE);
            }
          }
        }

        // Continue normal processing for all AtRules
        return node;
      },

      visit: (node: Node): Node => {
        if (!node) {
          return node;
        }

        // Get underlying Jess node if this is a Less proxy
        // This allows us to check the processing WeakSet correctly
        const jessNode = getJessNodeFromProxy(node) || node;

        // CRITICAL: For AtRule nodes, we need to call atRule() FIRST to process @plugin directives
        // before running Less visitors. Since our visitor is a plain object (not a class extending Visitor),
        // visit() doesn't automatically call atRule() via _visit(). We need to call it manually.
        if ((node.type === 'AtRule' || node.type === 'Directive') && visitor.atRule) {
          // Call atRule() to process @plugin directives and add visitors
          // This must happen before we run Less visitors, so that newly added visitors
          // are available for subsequent nodes
          const atRuleResult = visitor.atRule(node as any, undefined);
          // Use the result if atRule() returned a different node (and it's not a symbol)
          if (atRuleResult && typeof atRuleResult !== 'symbol' && atRuleResult !== node) {
            node = atRuleResult;
            // Update jessNode if node was replaced
            const newJessNode = getJessNodeFromProxy(node) || node;
            if (newJessNode !== jessNode) {
              // If node was replaced, we need to update our reference
              // But we'll continue with the original jessNode for processing tracking
            }
          }
        }

        // If we're already inside a Less visitor traversal, don't process again
        // This prevents infinite loops when visitArray calls visit() on child nodes
        if (insideLessTraversal) {
          return node;
        }

        // Prevent recursion - if we're already processing this node, skip
        // This prevents infinite loops when visitArray calls visit() on nodes that are already being processed
        if (processing.has(jessNode)) {
          return node;
        }

        // Mark as processing (keep in set for entire visitor lifetime)
        processing.add(jessNode);

        try {
          // CRITICAL: For AtRule nodes, ensure @plugin is processed BEFORE running Less visitors
          // In Jess's visitor system, atRule() is called as part of visit() via _visit(),
          // but we need to ensure @plugin processing happens before Less visitors run.
          // Since atRule() is a separate method that's called by the visitor system,
          // we need to check if this is a @plugin directive and process it here too
          // (as a fallback, in case atRule() hasn't been called yet).
          // However, the normal flow should be: atRule() is called first, then visit().
          // So we'll rely on atRule() to process @plugin, and visit() will run Less visitors.

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
              const visitorIterator = createVisitorIterator();
              let iteratorResult = visitorIterator.next();
              let iterationCount = 0;

              while (!iteratorResult.done) {
                iterationCount++;
                if (iterationCount > 100) {
                  break;
                }
                const lessVisitor = iteratorResult.value;

                // Less Visitor.visit() calls the appropriate visit* method
                // Less.js Visitor class handles isReplacing internally:
                // - If isReplacing=false: return value is ignored, node modified in place, returns original node
                // - If isReplacing=true: return value replaces node (undefined = remove)
                // @deprecated Less.js Visitor API - Using Less.js visitor pattern for compatibility
                //
                // Handle Less.js v2 "Directive" nodes - if node is Directive type,
                // LessVisitor.visit() will route to visitDirective() which maps to visitAtRule()
                result = lessVisitor.visit(result);

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
