import type { Rules } from './tree/rules.js';
import type { ImportOptions } from './tree/import-style.js';
import type { Context } from './context.js';
import { join, isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Visitor } from './visitor/index.js';
import type { Node } from './tree/node.js';
import { type ErrorDiagnostic, type WarningDiagnostic, makeJessErrorFromDiagnostic } from './jess-error.js';
import type { ContextOptions } from './context.js';
import type { ExtendSelectorKind } from './types/config.js';

export type PluginVisitor = Partial<Omit<Visitor, 'visit'>> & {
  visit?: (node: Node) => unknown;
};

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

export type SafeParseOptions = {
  /**
   * The compile-level option bag threaded to a plugin's `safeParse` (the caller
   * passes the render {@link Context}'s `opts`). Includes `allowExtendSelectors`,
   * which lives on the per-tree {@link TreeContextOptions} rather than the base.
   */
  compilerOptions?: ContextOptions & {
    /** Extend-selector kinds a plugin permits; consumed when building the TreeContext. */
    allowExtendSelectors?: ExtendSelectorKind[];
  };
  importOptions?: ImportOptions;
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
  safeParse?(filePath: string, source: string, options?: SafeParseOptions): ISafeParseResult;

  /** If this method exists, then the plugin can return a JS module / object */
  import?(absoluteFilePath: string): Promise<Record<string, any>>;

  /** Post-parse or post-eval visitor(s) */
  visitor?: PluginVisitor | PluginVisitor[];
  /** Early visitor(s), called before eval for compatibility with Less-style plugins. */
  beforeEvalVisitor?: PluginVisitor | PluginVisitor[];
  /**
   * Optional tree-aware early visitor hook. Use this when a compatibility layer
   * can cheaply prove that a parsed tree needs no early traversal.
   */
  beforeEvalVisitorForTree?(tree: Rules, filePath?: string): PluginVisitor | PluginVisitor[] | undefined;
  /**
   * Visitors that run after eval and immediately before render serialization.
   */
  preRenderVisitor?: PluginVisitor | PluginVisitor[];
  /**
   * Compatibility hook name for visitors that run after eval and immediately
   * before render serialization.
   */
  postEvalVisitor?: PluginVisitor | PluginVisitor[];

  /** Optional lifecycle hooks used by lazy plugin loading. */
  prewarm?(): void | Promise<void>;
  dispose?(): void | Promise<void>;

  /** Optional compiler hooks used by compatibility plugins. */
  setContext?(context: Context): void;
  setCurrentFilePath?(filePath: string): void;
  runPostProcessors?(css: string, opts: Record<string, unknown>): string;
  postProcessCss?(css: string, context: Context): string;
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
    return readFile(absoluteFilePath, 'utf8');
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
    const safeParse = (this as PluginInterface).safeParse;
    if (!safeParse) {
      throw new Error(`Plugin "${this.name}" does not support parsing`);
    }
    const { tree, errors } = safeParse.call(this, filePath, source);
    if (errors.length > 0) {
      const firstError = errors[0]!;
      throw makeJessErrorFromDiagnostic(firstError);
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
