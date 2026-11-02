import {
  type Plugin,
  AbstractPlugin,
  recordPluginModule
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

  /**
   * Directory to anchor Node's module resolution at. When set, `require.resolve`
   * walks `node_modules` starting from this directory (instead of the plugin's own
   * location). Used to resolve packages relative to a consuming project or a
   * fixture tree rather than where the plugin is installed.
   * Default: the plugin file's directory (falling back to `process.cwd()`).
   */
  basePath?: string;
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

    /*
     * Create a require function that can resolve modules
     * Use createRequire to get a require function in ES module contexts
     */
    try {
      // Try to use the current file's directory as the base for resolution
      let currentDir: string;
      if (opts.basePath !== undefined) {
        /*
         * An explicit anchor: resolve packages relative to a consuming project or
         * fixture tree rather than the plugin's own install location.
         */
        currentDir = opts.basePath;
      } else if (typeof __filename !== 'undefined') {
        currentDir = path.dirname(__filename);
      } else {
        /*
         * In ES module contexts, try to use import.meta.url
         * This will only work if the module system supports it
         */
        try {
          const url = import.meta.url;
          currentDir = path.dirname(fileURLToPath(url));
        } catch {
          // Fallback to process.cwd()
          currentDir = process.cwd();
        }
      }
      this._require = createRequire(currentDir + '/');
    } catch {
      // Fallback to global require if available
      this._require = typeof require !== 'undefined'
        ? require
        : createRequire(process.cwd() + '/');
    }
  }

  /**
   * Resolve an npm package name to its absolute path.
   * Uses Node's module resolution algorithm (same as require.resolve).
   *
   * @param packageName - The npm package name (e.g., "less-plugin-clean-css")
   * @param fromDir - Optional directory to start `node_modules` resolution from
   *   (walked up per Node's algorithm). When given it takes precedence over the
   *   plugin's `basePath`; used to resolve a package relative to the importing
   *   file (e.g. an `@import "pkg/x"` resolving against the importer's directory).
   * @returns The absolute path to the package, or null if not found
   */
  resolvePackage(packageName: string, fromDir?: string): string | null {
    if (this.opts.enabled === false) {
      return null;
    }

    try {
      /*
       * Use require.resolve to find the package
       * This will search node_modules using Node's resolution algorithm
       */
      const resolved = fromDir !== undefined
        ? this._require.resolve(packageName, { paths: [fromDir] })
        : this._require.resolve(packageName);
      return resolved;
    } catch (e: unknown) {
      // MODULE_NOT_FOUND is expected when package doesn't exist
      if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        return null;
      }

      // Re-throw other errors
      throw e;
    }
  }

  /**
   * Context resolution hook for bare package specifiers. Core owns only the
   * resolver-plugin pipeline; this plugin owns Node's module-resolution policy.
   */
  override resolve(filePath: string | string[], currentDir: string, searchPaths: string[]): string[] {
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    const bases = [currentDir, ...searchPaths];
    const resolved: string[] = [];

    for (const candidate of paths) {
      if (!isBareModuleSpecifier(candidate)) {
        resolved.push(candidate);
        continue;
      }

      let modulePath: string | null = null;
      for (const base of bases) {
        modulePath = this.resolvePackage(candidate, base) ?? this.resolvePackage(`${candidate}.less`, base);
        if (modulePath) {
          break;
        }
      }
      modulePath ??= this.resolvePackage(candidate) ?? this.resolvePackage(`${candidate}.less`);
      resolved.push(modulePath ?? candidate);
    }

    return resolved;
  }
}

function isBareModuleSpecifier(candidate: string): boolean {
  return !path.isAbsolute(candidate)
    && !candidate.startsWith('./')
    && !candidate.startsWith('../')
    && !candidate.startsWith('/')
    && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate);
}

const nodeModulesPlugin = ((opts?: NodeModulesPluginOptions) =>
  recordPluginModule(new NodeModulesPlugin(opts), import.meta.url, 'default', [opts])) satisfies Plugin;

export { nodeModulesPlugin };
export default nodeModulesPlugin;
