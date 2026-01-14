import type { Rules } from './tree/rules';
import { join, isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Visitor } from './visitor';
import type { IParseResult } from './types';
import type { ILexingResult } from 'chevrotain';
import { getErrorFromParser, type ErrorDiagnostic, type WarningDiagnostic, toDiagnostic, JessError } from './jess-error';

export type ISafeParseResult = {
  /**
   * The parsed tree, if parsing succeeded
   */
  tree?: Rules;
  /**
   * Normalized errors from parsing.
   * This should include ALL errors from lexing, parsing, and any plugin-level issues.
   * Plugins should convert all errors to normalized ErrorDiagnostic format.
   * Always an array (empty if no errors).
   */
  errors: ErrorDiagnostic[];
  /**
   * Normalized warnings from parsing.
   * This should include ALL warnings from lexing, parsing, and any plugin-level issues.
   * Plugins should convert all warnings to normalized WarningDiagnostic format.
   * Always an array (empty if no warnings).
   */
  warnings: WarningDiagnostic[];
};

export interface PluginInterface {
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
  expandImport?(importPath: string, currentDir: string): string[];

  /**
   * e.g.
   *   `./foo` -> `/Users/foo/bar/foo`
   *   `@/alias` -> `/Users/foo/bar/src/alias`
   *   `one/two` -> `/Users/foo/node_modules/one/two`
   *
   * Does not attempt to check if the path exists.
   * Note: paths may already be absolute.
   *
   * If the plugin has nothing to change, return `null` or return the array as-is.
   *
   * @note - I suppose a plugin doesn't have to resolve to an absolute path, if it's
   *         using some other method to handle the resolved paths in `locate()`.
   *         To that end, `locate()` shouldn't presume that the paths are absolute.
   */
  resolve?(path: string | string[], currentDir: string, searchPaths: string[]): null | string[] | Promise<null | string[]>;

  /**
   * Pick the first one that exists. Return null to let another plugin handle the path.
   */
  locate?(pathCandidates: string[], currentDir: string): null | string | Promise<string | null>;

  /**
   * Get the source code for the file.
   */
  getSource?(absoluteFilePath: string): Promise<string>;

  /**
   * If we have the extension in `supportedExtensions`, and this method exists,
   * then this plugin is assumed to be able to parse the file.
   */
  parse?(filePath: string, source: string): Rules;

  /** No errors thrown; instead will return errors in the result */
  safeParse?(filePath: string, source: string): ISafeParseResult;

  /** If this method exists, then the plugin can return a JS module / object */
  import?(absoluteFilePath: string): Promise<Record<string, any>>;

  /** Post-parse or post-eval visitor(s) */
  visitor?: Visitor | Visitor[];
}

const { isArray } = Array;

export abstract class AbstractPlugin implements PluginInterface {
  abstract name: string;

  /**
   * Does a basic path resolution. Node resolution is in other plugins.
   */
  resolve(filePath: string | string[], currentDir: string, searchPaths: string[]) {
    const bases = [currentDir, ...searchPaths];
    const out: string[] = [];
    const seen = new Set<string>();
    filePath = isArray(filePath) ? filePath : [filePath];
    for (const base of bases) {
      const baseDir = isAbsolute(base) ? base : join(currentDir, base);
      for (const path of filePath) {
        const abs = resolve(baseDir, path);
        if (abs && !seen.has(abs)) {
          seen.add(abs);
          out.push(abs);
        }
      }
    }
    return out;
  }

  /** Default source getter */
  async getSource(absoluteFilePath: string): Promise<string> {
    try {
      const result = await readFile(absoluteFilePath, 'utf8');
      return result;
    } catch (error: any) {
      throw error;
    }
  }

  /** Gets the first match using from the filesystem that exists */
  locate(pathCandidates: string[], currentDir: string): null | string {
    for (const candidate of pathCandidates) {
      const absolutePath = isAbsolute(candidate) ? candidate : join(currentDir, candidate);
      if (existsSync(absolutePath)) {
        return absolutePath;
      }
    }
    return null;
  }

  parse(filePath: string, source: string): Rules {
    const safeParse: PluginInterface['safeParse'] = (this as any).safeParse;
    if (!safeParse) {
      throw new Error(`Plugin "${this.name}" does not support parsing`);
    }
    const { tree, errors } = safeParse.call(this, filePath, source);
    if (errors.length > 0) {
      const firstError = errors[0]!;
      throw new JessError({
        code: firstError.code as any,
        phase: firstError.phase,
        severity: 'error',
        ctx: firstError.file ? { file: firstError.file } : undefined,
        filePath: firstError.filePath,
        source: firstError.file?.source,
        line: firstError.line,
        column: firstError.column,
        reason: firstError.reason,
        fix: firstError.fix,
        note: firstError.note,
        errors: firstError.errors,
        lexerErrors: firstError.lexerErrors
      });
    }
    if (!tree) {
      throw new Error(`Plugin "${this.name}" failed to parse "${filePath}"`);
    }
    return tree;
  }

  /** Implement using the JS plugin w/ Deno */
  // import(absoluteFilePath: string): Promise<Record<string, any>> {
  //   return import(absoluteFilePath);
  // }
}

export type Plugin = <T extends Record<string, any>>(opts?: T) => PluginInterface;

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