import {
  type Plugin,
  type PluginInterface,
  AbstractPlugin
} from '@jesscss/core';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

interface NodeModulesPluginOptions {
  /**
   * Whether to enable auto-resolution of npm packages.
   * Default: true
   */
  enabled?: boolean;
}

export type { NodeModulesPluginOptions };

/**
 * Plugin that provides npm/node_modules resolution and loading capabilities.
 * 
 * This plugin implements the `import()` method to resolve and load npm packages
 * using Node's module resolution algorithm (require.resolve).
 * 
 * It can be used by other plugins (like jess-plugin-less-compat) to load
 * npm packages when processing directives like `@plugin "package-name"`.
 */
export class NodeModulesPlugin extends AbstractPlugin {
  name = 'node-modules';
  
  private _require: NodeRequire;
  
  constructor(public opts: NodeModulesPluginOptions = {}) {
    super();
    
    // Create a require function that can resolve modules
    // Use createRequire to get a require function in ES module contexts
    try {
      // Try to use the current file's directory as the base for resolution
      let currentDir: string;
      if (typeof __filename !== 'undefined') {
        currentDir = path.dirname(__filename);
      } else {
        // In ES module contexts, try to use import.meta.url
        // This will only work if the module system supports it
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const url = (globalThis as any).import?.meta?.url;
          if (url) {
            currentDir = path.dirname(fileURLToPath(url));
          } else {
            throw new Error('import.meta not available');
          }
        } catch {
          // Fallback to process.cwd()
          currentDir = process.cwd();
        }
      }
      this._require = createRequire(currentDir + '/');
    } catch {
      // Fallback to global require if available
      this._require = typeof require !== 'undefined' ? require : (() => {
        throw new Error('require is not available');
      }) as any;
    }
  }

  /**
   * Resolve an npm package name to its absolute path.
   * Uses Node's module resolution algorithm (same as require.resolve).
   * 
   * @param packageName - The npm package name (e.g., "less-plugin-clean-css")
   * @returns The absolute path to the package, or null if not found
   */
  resolvePackage(packageName: string): string | null {
    if (this.opts.enabled === false) {
      return null;
    }

    try {
      // Use require.resolve to find the package
      // This will search node_modules using Node's resolution algorithm
      const resolved = this._require.resolve(packageName);
      return resolved;
    } catch (e: any) {
      // MODULE_NOT_FOUND is expected when package doesn't exist
      if (e.code === 'MODULE_NOT_FOUND') {
        return null;
      }
      // Re-throw other errors
      throw e;
    }
  }

  /**
   * Load an npm package module.
   * 
   * @param packageName - The npm package name (e.g., "less-plugin-clean-css")
   * @returns The loaded module, or null if not found
   */
  async loadPackage(packageName: string): Promise<Record<string, any> | null> {
    const resolvedPath = this.resolvePackage(packageName);
    if (!resolvedPath) {
      return null;
    }

    try {
      // Load the module using require
      const module = this._require(resolvedPath) as Record<string, any>;
      return module || null;
    } catch (e: any) {
      // If loading fails, return null
      return null;
    }
  }

  /**
   * Try to resolve a package name with multiple possible names.
   * Useful for plugins that want to try different variations
   * (e.g., "clean-css" and "less-plugin-clean-css").
   * 
   * @param packageNames - Array of package names to try in order
   * @returns The first successfully resolved package, or null if none found
   */
  async tryResolvePackages(packageNames: string[]): Promise<{ name: string; module: Record<string, any> } | null> {
    for (const name of packageNames) {
      const module = await this.loadPackage(name);
      if (module !== null) {
        return { name, module: module as Record<string, any> };
      }
    }
    return null;
  }

  /**
   * Import method for loading JavaScript modules from npm.
   * This is called by the context when importing modules.
   * 
   * @param absoluteFilePath - The absolute path to the module
   * @returns The loaded module, or throws if this plugin can't handle it
   */
  async import(absoluteFilePath: string): Promise<Record<string, any>> {
    if (this.opts.enabled === false) {
      throw new Error(`Plugin "${this.name}" cannot import "${absoluteFilePath}" (disabled)`);
    }

    // Check if this looks like a node_modules path
    // We can't directly resolve from absolute paths, but we can try to require it
    if (absoluteFilePath.includes('node_modules')) {
      try {
        const module = this._require(absoluteFilePath) as Record<string, any>;
        return module;
      } catch (e: any) {
        throw new Error(`Failed to import "${absoluteFilePath}": ${e.message}`);
      }
    }

    // For non-node_modules paths, throw to let other plugins handle it
    throw new Error(`Plugin "${this.name}" cannot import "${absoluteFilePath}" (not a node_modules path)`);
  }
}

const nodeModulesPlugin = ((opts?: NodeModulesPluginOptions) => {
  return new NodeModulesPlugin(opts);
}) satisfies Plugin;

export default nodeModulesPlugin;
