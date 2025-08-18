import type { Rules } from './tree/rules';
import { join, isAbsolute, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Visitor } from './visitor';

export interface PluginObject {
  /**
   * e.g. 'less-plugin'
   */
  name: string;

  /**
   * Queryable filter if we have resolved the extension
   * no dots e.g. `['less', 'scss']`
  */
  supportedExtensions?: string[];

  /**
   * Expand an import path into a set of paths to try.
   * e.g.
   *   `@import 'foo'` -> `['./foo.less']`
   *   `@import 'foo'` -> `['./foo.scss', './_foo.scss']`
   */
  expandImport?(filePath: string, currentDir: string): string[];

  /**
   * e.g.
   *   `./foo` -> `/Users/foo/bar/foo`
   *   `@/alias` -> `/Users/foo/bar/src/alias`
   *   `one/two` -> `/Users/foo/node_modules/one/two`
   *
   * Does not attempt to check if the path exists.
   * Note: paths may already be absolute.
   */
  resolve?(filePath: string, currentDir: string, searchPaths: string[]): string[] | Promise<string[]>;

  /**
   * Pick the first one that exists. Return null to let another plugin handle the path.
   */
  locate?(candidates: string[], currentDir: string): null | string | Promise<string | null>;

  /**
   * If we have the extension in `supportedExtensions`, and this method exists,
   * then this plugin is assumed to be able to parse the file.
   */
  parse?(absoluteFilePath: string): Promise<Rules>;

  /** If this method exists, then the plugin can return a JS object */
  load?(absoluteFilePath: string): Promise<Record<string, any>>;

  /** Post-parse or post-eval visitor(s) */
  visitor?: Visitor | Visitor[];
}

export type Plugin = <T extends Record<string, any>>(opts?: T) => PluginObject;

// export abstract class FileManager<O extends Record<string, any> = Record<string, any>> {
//   abstract supportedExtensions?: string[];

//   constructor(
//     public opts: Partial<O> = {}
//   ) {}

//   /**
//    * Turns relative paths into absolute paths.
//    * e.g.
//    *   `./foo` -> `/Users/foo/bar/foo`
//    *   `@/alias` -> `/Users/foo/bar/src/alias`
//    *   `one/two` -> `/Users/foo/node_modules/one/two`
//    *
//    * Does not attempt to check if the path exists.
//    * Note: paths may already be absolute.
//    */
//   abstract resolver?(paths: Set<string>, currentDir: string): Set<string>;

//   /**
//    * e.g.
//    *   Less file manager: `@import 'foo'` -> `['./foo.less']`
//    *   Sass file manager: `@import 'foo'` -> `['./foo.scss', './_foo.scss']`
//    */
//   abstract getPathsToTry?(filePath: string, currentDir: string, paths: string[], options: PathOptions): Set<string>;

//   /**
//    * Get the final resolved path.
//    *
//    * @param filePath Will be a partial path
//    * @param paths The paths to search. This should always contain
//    * the directory context where the file was imported. Can be
//    * a fully-qualified path or a glob. Relative paths
//    * will be resolved relative to process.cwd(). Plugins
//    * may alter the paths array and return false to let another
//    * plugin handle the path resolution.
//    * @param options Determined by the file manager
//    */
//   resolvePath(
//     filePath: string,
//     currentDir: string,
//     paths: string[],
//     options: PathOptions
//   ): string | string[] {
//     filePath = this.opts.resolver(filePath);
//     const pathsTried: string[] = [];
//     if (isAbsolute(filePath)) {
//       pathsTried.push(filePath);
//       if (existsSync(filePath)) {
//         return filePath;
//       }
//     }
//     let isRelative = filePath.startsWith('.');
//     let tryPath: string | undefined;
//     if (options.allowBareRelative || isRelative) {
//       tryPath = join(currentDir, filePath);
//       pathsTried.push(tryPath);
//       if (existsSync(tryPath)) {
//         return tryPath;
//       }
//     }

//     if (!isRelative) {
//       try {
//         tryPath = require.resolve(filePath);
//         if (existsSync(tryPath)) {
//           return tryPath;
//         }
//       } catch (err) {
//         // ignore
//       }
//     }

//     for (let i = 0; i < paths.length; i++) {
//       tryPath = join(paths[i]!, filePath);
//       pathsTried.push(tryPath);
//       if (existsSync(tryPath)) {
//         return tryPath;
//       }
//     }
//     return pathsTried;
//   }

//   async loadFile(fullPath: string) {
//     return await readFile(fullPath, 'utf8');
//   }

//   /**
//    * Can override this instead of `getTree` if we want
//    * to preserve extension-checking logic.
//    */
//   protected async _getTree(fullPath: string, options?: Record<string, any>): Promise<Rules | false> {
//     return false;
//   }

//   /**
//    * @param fullPath The fully resolved path
//    */
//   async getTree(fullPath: string, options?: Record<string, any>): Promise<Rules | false> {
//     const supported = this.supportedExtensions;
//     if (supported && !supported.includes(extname(fullPath))) {
//       return false;
//     }
//     return await this._getTree(fullPath, options);
//   }
// }