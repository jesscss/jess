import type { Statement, Stylesheet } from './ast/nodes.js';
import { type ImportOptions, EXTERNAL_IMPORT_SPECIFIER } from './import-options.js';
export type { ImportOptions } from './import-options.js';
import type { Context, ContextOptions, ResolvedOptions, SourceOptions, SourceSettings } from './context.js';
import { join, isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { type ErrorDiagnostic, type WarningDiagnostic } from './jess-error.js';
import type { ApplySelectorKind, ExtendSelectorKind } from './types/config.js';
import type { ValueEvaluator } from './ast/value-eval.js';
import type { EmitJessOptions } from './ast/emit-jess.js';

export type ISafeParseResult = {
  /** Canonical parser document on successful parsing. */
  document?: Stylesheet;

  /**
   * This document's dialect defaults: the parsing plugin's own settings over its
   * language's implicit defaults. Context resolves the document's policy from
   * them once, under the settings scoped to the source and the Context's
   * explicit options (DESIGN-DECISIONS C19), so a document keeps its own
   * language's defaults whichever document imported it.
   */
  dialectDefaults?: Readonly<Partial<ResolvedOptions>>;

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
  /*
   * There is no `trackLines` here. Line-aware parsing is a property of the
   * compiled grammar table a parser package loads, chosen by importing that
   * package's `./positions` entry; an option would force one module to name
   * both tables, and Node executes every module it statically imports.
   */

  /**
   * The compile-level option bag threaded to a plugin's `safeParse` (the caller
   * passes the render {@link Context}'s `opts`). Includes `allowExtendSelectors`,
   * which is not a {@link ContextOptions} field.
   */
  compilerOptions?: ContextOptions & {
    /** Extend-selector kinds a plugin permits. */
    allowExtendSelectors?: ExtendSelectorKind[];

    /** Jess `$apply` selector kinds a plugin permits. Defaults to class-only. */
    allowApplySelectors?: ApplySelectorKind[];
  };
  importOptions?: ImportOptions;

  /**
   * The settings that cover this source (its folder's `styles.config`, then its
   * language's settings, then the compile's own), when the host supplies them.
   * A plugin reads the settings for this document from them in place of
   * `compilerOptions`, and over its own constructor options, so a setting
   * reaches only the files it covers.
   */
  sourceOptions?: SourceOptions;

  /** The `styles.config` file `sourceOptions` were read from ({@link SourceSettings.configFile}). */
  sourceConfigFile?: SourceSettings['configFile'];
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

  /**
   * The typed syntax that owns the path. Direct quoted imports use import-path
   * rewriting, while `url(...)` keeps URL-only policy such as query arguments.
   * Context always supplies this fact so plugin implementations do not need to
   * reconstruct it from target bytes. Omission by an older direct caller keeps
   * ordinary URL behavior.
   */
  kind?: 'url' | 'import';

  /** The document that authored this URL. */
  fromFilePath?: string;

  /** The entry document currently being rendered. */
  entryFilePath?: string;
}

/**
 * A module-configuration request handed to the PROVIDING plugin (the plugin that
 * supplies the configured module, chosen by extension). Spec R6 Part E §E.4: the
 * provider's dialect owns "what a value does" — it decides whether a configured
 * name is a valid knob and may reject. Core owns the actual scope write (it owns
 * the eval frame) and the `with`/`set` propagation (§E.2); the provider only
 * validates the NAMES against the module's own declarations.
 */
export interface ModuleConfigRequest {
  /** `with` = this import edge only; `set` = persists onward (§E.2). */
  kind: 'with' | 'set';

  /** The module's own top-level statements, so a provider can see which names it declares as knobs (`!default`, `?:`). */
  moduleRules: readonly Statement[];

  /** The configured names supplied by the importer. */
  bindings: readonly { name: string }[];
}

/** One rejected configuration name plus a human-facing reason. */
export interface ModuleConfigRejection {
  name: string;
  message: string;
}

/**
 * Where a plugin instance came from: the module, its export (a factory) and
 * the arguments the factory was called with. A compile that runs in the
 * `@jesscss/plugin-js` sandbox recreates the plugin from this; the instance
 * itself never crosses.
 */
export interface PluginModuleIdentity {
  module: string;
  exportName: string;
  args: readonly unknown[];
}

/**
 * Records on `plugin` the factory that made it ({@link PluginModuleIdentity}).
 * A plugin factory (a Jess plugin, or a Less plugin object passed in options)
 * calls this with its own `import.meta.url`, its export name and its arguments. Trailing `undefined` arguments are dropped, so the factory
 * sees its own defaults when it runs again.
 */
export const recordPluginModule = <P extends object>(
  plugin: P,
  module: string,
  exportName: string,
  args: readonly unknown[]
): P => {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) {
    end--;
  }
  Object.defineProperty(plugin, 'pluginModule', {
    value: { module, exportName, args: args.slice(0, end) },
    configurable: true
  });
  return plugin;
};

/**
 * What a script plugin is told about the render that reaches a script: how to
 * move that render into the sandbox. Set by the compiler per render.
 */
export interface ScriptSandboxRoute {
  /**
   * Abandons this render where it is and runs it again, whole, in the sandbox.
   * The returned promise never settles.
   */
  reroute(): Promise<never>;
}

/**
 * Moves a render into the script sandbox as soon as import planning places a
 * document (the root, or one reached through placed imports, outside any
 * at-rule, reference import or module) whose top level has a `@plugin` the
 * sandbox runs: evaluation is certain to reach that `@plugin` and make the
 * same move, after this process had parsed the rest of the import graph for
 * nothing (`docs/design/DENO-SANDBOX-COMPILE.md` §2). `rules` is null for a
 * document whose evaluation is not certain. Only a target written as a plain
 * string, which is what evaluation loads, and only when the plugin that loads
 * it runs every script in the sandbox. Loads nothing; a `@plugin` that does
 * not load, or a compile with scripts disabled, is left to evaluation.
 */
export const rerouteForPlacedPlugins = async (rules: readonly Statement[] | null, context: Context | undefined): Promise<void> => {
  if (rules === null || context === undefined) {
    return;
  }
  const route = context.opts.scriptSandbox;
  if (route === undefined || context.opts.disableScriptModules || context.opts.disablePluginRule) {
    return;
  }
  for (const statement of rules) {
    if (statement.type !== 'Plugin') {
      continue;
    }
    const target = statement.target.type === 'Url' ? statement.target.value : statement.target;
    if (target.type === 'Quoted' && target.interp === null && await context.sandboxesPluginScript(target.value)) {
      await route.reroute();
    }
  }
};

export interface PluginInterface {
  /**
   * e.g. 'less-plugin'
   */
  name: string;

  /** The factory that made this instance; see {@link recordPluginModule}. */
  readonly pluginModule?: PluginModuleIdentity;

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
   * protocol-relative specifier). Context asks this before an `@import` (an
   * `(inline)` one included) enters the normal resolve → locate → source → parse
   * pipeline. A positive result does not
   * fetch: this plugin must still resolve and locate the source through those
   * ordinary capabilities. Unclaimed, an external import stays a CSS terminal.
   * An import written inside a remote document is rebased onto that document's
   * URL first, so it is asked here too. Throwing rejects the import as an error.
   *
   * `mustLoad` is true when the import can never stay a CSS `@import` —
   * `(inline)`, `(reference)`, `(less)`, `@-import`, `@compose`. Unclaimed, such
   * an import is an error; a plugin that will not load it may throw first to
   * give its own reason.
   */
  canResolveImport?(specifier: string, currentDir: string, searchPaths: string[], mustLoad: boolean): boolean | Promise<boolean>;

  /**
   * Pick the first one that exists. Return null to let another plugin handle the path.
   */
  locate?(pathCandidates: string[], currentDir: string): null | string | Promise<string | null>;

  /**
   * Get the source code for the file. Context asks the plugin whose `locate`
   * returned the path, falling back to the first plugin with this capability.
   */
  getSource?(absoluteFilePath: string): Promise<string>;

  /** No errors thrown; successful parser plugins return `document: Stylesheet`. */
  safeParse?(filePath: string, source: string, options?: SafeParseOptions): ISafeParseResult;

  /**
   * Loads what `safeParse` needs, for a plugin that defers loading its parser
   * until a document of its language is parsed. Context awaits it before every
   * `safeParse` call; once the parser is loaded it returns nothing.
   */
  loadParser?(): void | Promise<void>;

  /**
   * Optionally transform a rendered URL or direct quoted import target owned by
   * this plugin's active document. This is intentionally not import resolution:
   * Context already owns source identity and imports have been parsed before
   * rendering.
   */
  transformUrl?(request: UrlTransformRequest): string | undefined;

  /**
   * The URL option {@link transformUrl} would add to `request` that an escaped
   * `url()` body does not get, since no URL option changes an escaped string
   * (ledger V3), or `undefined`. Less names `urlArgs`: the author loses the
   * argument Less 4 added, so it is reported where the `url()` is written.
   */
  escapedUrlSkips?(request: UrlTransformRequest): string | undefined;

  /**
   * If this method exists, then the plugin can return a JS module / object.
   * `route` is the render's {@link ScriptSandboxRoute}, when it has one.
   */
  import?(absoluteFilePath: string, route?: ScriptSandboxRoute): Promise<Record<string, any>>;

  /**
   * Claim a resolved module path before extension-based executable-module
   * selection. This is for trusted package-owned modules whose file extension
   * is also used by sandboxed user scripts.
   */
  canImportModule?(absoluteFilePath: string): boolean;

  /**
   * Optional executable-plugin loader. Context selects this capability by file
   * extension just like ordinary module import; the dialect adapter owns the
   * returned module ABI. Kept distinct from `import()` because a legacy plugin
   * runtime may require a constrained execution environment.
   */
  importPlugin?(absoluteFilePath: string, options?: string | null, route?: ScriptSandboxRoute): Promise<unknown>;

  /**
   * True when `importPlugin` runs every script in the sandbox: given a render's
   * {@link ScriptSandboxRoute}, it moves the render there instead of loading
   * the script. A render reaching a `@plugin` this plugin serves can then move
   * as soon as the `@plugin` is planned, before evaluation reaches it.
   */
  readonly sandboxesScripts?: boolean;

  /** Optional lifecycle hooks used by lazy plugin loading. */
  prewarm?(): void | Promise<void>;
  dispose?(): void | Promise<void>;

  /**
   * Validate a `@compose "m" with { … }` / `set { … }` configuration for a module
   * this plugin provides (spec R6 Part E §E.4). Return the rejected names (a name
   * that is not a knob / not declared / a typo), or nothing / an empty array to
   * accept. `plugin-less` is permissive (no implementation — every name is
   * accepted); `plugin-scss` rejects a name not declared `!default`, `plugin-jess`
   * a name not declared `?:`. Core applies the accepted bindings to the module's
   * outer scope and owns `with`/`set` propagation.
   */
  applyModuleConfig?(request: ModuleConfigRequest): readonly ModuleConfigRejection[] | void;

  /**
   * The value evaluator for the documents this plugin parses: its language's
   * built-in functions and value semantics. A document is evaluated with its
   * own plugin's evaluator, whichever document imported it (DESIGN-DECISIONS C19).
   */
  readonly valueEvaluator?: ValueEvaluator;

  /**
   * The module and export names a `.jess` file converted from this plugin's
   * documents imports their built-in functions from (`emitJess`'s `functions`).
   * A plugin without it parses no document a converter turns into `.jess`.
   */
  jessFunctions?(): NonNullable<EmitJessOptions['functions']>;

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
   * Does a basic path resolution. Node resolution is in other plugins. A URL is
   * not a path, so it passes through for the plugin that claims it.
   */
  resolve(filePath: string | string[], currentDir: string, searchPaths: string[]) {
    const bases = [currentDir, ...searchPaths];
    const out: string[] = [];
    const seen = new Set<string>();
    filePath = isArray(filePath) ? filePath : [filePath];
    for (const base of bases) {
      const baseDir = isAbsolute(base) ? base : join(currentDir, base);
      for (const path of filePath) {
        const abs = EXTERNAL_IMPORT_SPECIFIER.test(path) ? path : resolve(baseDir, path);
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

  /** Gets the first match from the filesystem that exists. A URL is not a file, so it is left to the plugin that claims it. */
  locate(pathCandidates: string[], currentDir: string): null | string {
    for (const candidate of pathCandidates) {
      if (EXTERNAL_IMPORT_SPECIFIER.test(candidate)) {
        continue;
      }
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
