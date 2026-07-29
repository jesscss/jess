import type { Stylesheet } from './ast/nodes.js';
import type { ImportOptions } from './import-options.js';
export type { ImportOptions } from './import-options.js';
import type { Context, ContextOptions } from './context.js';
import { join, isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { type ErrorDiagnostic, type WarningDiagnostic } from './jess-error.js';
import type { ApplySelectorKind, ExtendSelectorKind } from './types/config.js';

export type ISafeParseResult = {
  /** Canonical parser document on successful parsing. */
  document?: Stylesheet;

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

/** The single parser-result contract carried by Context during the cutover. */
export type ParsedDocument = Stylesheet;

export type SafeParseOptions = {
  /**
   * The compile-level option bag threaded to a plugin's `safeParse` (the caller
   * passes the render {@link Context}'s `opts`). Includes `allowExtendSelectors`,
   * which lives on the per-tree {@link TreeContextOptions} rather than the base.
   */
  compilerOptions?: ContextOptions & {
    /** Extend-selector kinds a plugin permits; consumed when building the TreeContext. */
    allowExtendSelectors?: ExtendSelectorKind[];

    /** Jess `$apply` selector kinds a plugin permits. Defaults to class-only. */
    allowApplySelectors?: ApplySelectorKind[];
  };
  importOptions?: ImportOptions;
};

/**
 * A rendered URL target together with the source identities needed by a
 * dialect-owned transform. Context supplies these facts from the active
 * document; plugins must not resolve or re-read either file to rewrite a URL.
 */
export interface UrlTransformRequest {
  /** The unquoted URL target after value evaluation. */
  value: string;

  /** Whether the target was authored as a quoted URL token. */
  quoted: boolean;

  /** The document that authored this URL. */
  fromFilePath?: string;

  /** The entry document currently being rendered. */
  entryFilePath?: string;
}

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
   * Explicit opt-in for an external import identifier (a URL or
   * protocol-relative specifier). Context asks this before it enters the normal
   * resolve → locate → source → parse pipeline. A positive result does not
   * fetch: this plugin must still resolve and locate the source through those
   * ordinary capabilities. Absent means external imports remain CSS terminals.
   */
  canResolveImport?(specifier: string, currentDir: string, searchPaths: string[]): boolean | Promise<boolean>;

  /**
   * Pick the first one that exists. Return null to let another plugin handle the path.
   */
  locate?(pathCandidates: string[], currentDir: string): null | string | Promise<string | null>;

  /**
   * Get the source code for the file.
   */
  getSource?(absoluteFilePath: string): Promise<string>;

  /** No errors thrown; successful parser plugins return `document: Stylesheet`. */
  safeParse?(filePath: string, source: string, options?: SafeParseOptions): ISafeParseResult;

  /**
   * Optionally transform a rendered URL target owned by this plugin's active
   * document. This is intentionally not import resolution: Context already
   * owns source identity and imports have been parsed before rendering.
   */
  transformUrl?(request: UrlTransformRequest): string | undefined;

  /** If this method exists, then the plugin can return a JS module / object */
  import?(absoluteFilePath: string): Promise<Record<string, any>>;

  /**
   * Optional executable-plugin loader. Context selects this capability by file
   * extension just like ordinary module import; the dialect adapter owns the
   * returned module ABI. Kept distinct from `import()` because a legacy plugin
   * runtime may require a constrained execution environment.
   */
  importPlugin?(absoluteFilePath: string, options?: string | null): Promise<unknown>;

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

  /** Implement using the JS plugin w/ Deno */
  /*
   * import(absoluteFilePath: string): Promise<Record<string, any>> {
   * return import(absoluteFilePath);
   * }
   */
}

export type Plugin = <T extends Record<string, any>>(opts?: T) => PluginInterface;
