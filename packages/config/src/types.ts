/**
 * Math processing modes
 */
export type MathMode = 'always' | 'parens-division' | 'parens' | 'strict';

/**
 * Unit conversion modes
 */
export type UnitMode = 'loose' | 'preserve' | 'strict';

export interface JavaScriptSandboxConfig {
  /**
   * Allow network access for script execution runtime.
   * @default false
   */
  allowHttp?: boolean;
  /**
   * Optional host allowlist when `allowHttp` is enabled.
   */
  allowNetHosts?: string[];
  /**
   * Optional explicit filesystem root for script reads.
   * If omitted, compiler resolves using entry/config roots.
   */
  jsReadRoot?: string;
}

export type CompileJavaScriptOption = true | JavaScriptSandboxConfig;

/**
 * Less compiler options
 * Based on less.js default-options.js and bin/lessc
 */
export interface LessOptions {
  /**
   * Inline Javascript - @plugin still allowed
   * @default false
   */
  javascriptEnabled?: boolean;

  /**
   * Outputs a makefile import dependency list to stdout.
   * @default false
   */
  depends?: boolean;

  /**
   * @deprecated Compress using less built-in compression.
   * This does an okay job but does not utilise all the tricks of
   * dedicated css compression.
   * @default false
   */
  compress?: boolean;

  /**
   * Runs the less parser and just reports errors without any output.
   * @default false
   */
  lint?: boolean;

  /**
   * Sets available include paths.
   * If the file in an @import rule does not exist at that exact location,
   * less will look for it at the location(s) passed to this option.
   * @default []
   */
  paths?: string[];

  /**
   * Color output in the terminal
   * @default true
   */
  color?: boolean;

  /**
   * @deprecated This option has confusing behavior and may be removed in a future version.
   *
   * Controls how @import statements for .less files are handled inside selector blocks (rulesets).
   *
   * Behavior:
   * - @import at root level: Always processed
   * - @import inside @-rules (@media, @supports, etc.): Processed (these are not selector blocks)
   * - @import inside selector blocks (.class, #id, etc.): Behavior depends on this option
   *
   * Options:
   * - `false` (default): All @import statements are processed regardless of context.
   * - `true`: @import statements inside selector blocks are silently ignored and not output.
   * - `'error'`: @import statements inside selector blocks will throw an error instead of being silently ignored.
   *
   * Note: Only affects .less file imports. CSS imports (url(...) or .css files) are
   * always output as CSS @import statements regardless of this setting.
   *
   * @see https://github.com/less/less.js/issues/656
   * @default false
   */
  strictImports?: boolean | 'error';

  /**
   * Allow Imports from Insecure HTTPS Hosts
   * @default false
   */
  insecure?: boolean;

  /**
   * Allows you to add a path to every generated import and url in your css.
   * This does not affect less import statements that are processed, just ones
   * that are left in the output css.
   * @default ''
   */
  rootpath?: string;

  /**
   * By default URLs are kept as-is, so if you import a file in a sub-directory
   * that references an image, exactly the same URL will be output in the css.
   * This option allows you to re-write URL's in imported files so that the
   * URL is always relative to the base imported file
   * @default false
   */
  rewriteUrls?: boolean | 'all' | 'local' | 'off';

  /**
   * How to process math operations
   * - 'always': eagerly try to solve all operations
   * - 'parens-division': require parens for division "/"
   * - 'parens' or 'strict': require parens for all operations
   * @default 'parens-division'
   */
  mathMode?: MathMode;

  /**
   * How to handle unit conversions in math operations
   * - 'loose': Less's default 1.x-4.x behavior
   * - 'preserve': Create calc() expressions for unit errors
   * - 'strict': strict unit mode
   * @default 'preserve'
   */
  unitMode?: UnitMode;

  /**
   * @deprecated Use `mathMode` instead. This option maps to `mathMode` as follows:
   * - 0 or 'always' → 'always'
   * - 1 or 'parens-division' → 'parens-division'
   * - 2 or 'parens' or 'strict' → 'parens'
   * - 3 or 'strict-legacy' → 'parens' (removed, will default to 'strict)
   * @default undefined (uses mathMode if provided, otherwise 'parens-division')
   */
  math?: 0 | 1 | 2 | 3 | MathMode | 'strict-legacy';

  /**
   * @deprecated Use `unitMode` instead. If `true`, sets `unitMode` to 'strict'.
   * If `false`, sets the unitMode to 'loose.
   * If undefined, uses the `unitMode` value (defaults to 'preserve').
   * @default false
   */
  strictUnits?: boolean;

  /**
   * Effectively the declaration is put at the top of your base Less file,
   * meaning it can be used but it also can be overridden if this variable
   * is defined in the file.
   * @default null
   */
  globalVars?: Record<string, string> | null;

  /**
   * As opposed to the global variable option, this puts the declaration at the
   * end of your base file, meaning it will override anything defined in your Less file.
   * @default null
   */
  modifyVars?: Record<string, string> | null;

  /**
   * This option allows you to specify a argument to go on to every URL.
   * @default ''
   */
  urlArgs?: string;

  /**
   * @removed The dumpLineNumbers option is not useful nor supported in browsers. Use sourcemaps instead.
   *
   * @default undefined
   */
  dumpLineNumbers?: string;

  /**
   * Source map options
   * @default undefined
   */
  sourceMap?: boolean | {
    sourceMapFullFilename?: string;
    sourceMapRootpath?: string;
    sourceMapBasepath?: string;
    sourceMapURL?: string;
    sourceMapFileInline?: boolean;
    outputSourceFiles?: boolean;
    disableSourcemapAnnotation?: boolean;
    sourceMapOutputFilename?: string;
    sourceMapFilename?: string;
  };

  /**
   * Verbose output
   * @default false
   */
  verbose?: boolean;

  /**
   * Silent mode (suppress errors)
   * @default false
   */
  silent?: boolean;

  /**
   * Quiet mode (suppress warnings)
   * @default false
   */
  quiet?: boolean;

  /**
   * @deprecated This is legacy Less behavior.
   *
   * Controls whether mixins and detached rulesets "leak" their inner rules.
   * When true:
   * - Mixins: Mixin and VarDeclaration nodes are 'public' and 'optional' respectively
   * - Detached rulesets: Mixin and VarDeclaration nodes are 'public' and 'private' respectively
   * When false:
   * - Both mixins and detached rulesets: Mixin and VarDeclaration nodes are 'private'
   * @default true
   */
  leakyRules?: boolean;

  /**
   * Whether to collapse nested selectors (Less 1.x-4.x style flattening)
   * When true, nested selectors like `.parent { .child { } }` are flattened to `.parent .child { }`
   * @default false
   */
  collapseNesting?: boolean;

  /**
   * @deprecated This is legacy Less behavior.
   *
   * Whether to bubble root-only at-rules (@font-face, @keyframes, etc.) to the root
   * when they are nested inside rulesets. Modern CSS supports nesting these at-rules.
   * @default true
   */
  bubbleRootAtRules?: boolean;
}

/**
 * Base interface for file-matching options
 */
export interface FileMatchOptions {
  /**
   * File path, relative path, or glob pattern for matching.
   * If omitted, the options serve as defaults.
   */
  file?: string;
}

/**
 * Input file options - can override compile and language settings per input file
 */
export interface InputOptions extends FileMatchOptions {
  // Compile-level options that can be overridden per-input
  mathMode?: MathMode;
  unitMode?: UnitMode;
  searchPaths?: string[];
  enableJavaScript?: boolean;

  // Less-specific options that can be overridden per-input
  javascriptEnabled?: boolean;
  paths?: string[];
  globalVars?: Record<string, string> | null;
  modifyVars?: Record<string, string> | null;
  strictImports?: boolean | 'error';
  rewriteUrls?: boolean | 'all' | 'local' | 'off';
  rootpath?: string;
  leakyRules?: boolean;
  collapseNesting?: boolean;
  bubbleRootAtRules?: boolean;

  /** Allow additional language-specific options */
  [key: string]: any;
}

/**
 * Output file options - can override output settings per output file
 */
export interface OutputOptions extends FileMatchOptions {
  collapseNesting?: boolean;
  compress?: boolean;
  sourceMap?: boolean | {
    sourceMapFullFilename?: string;
    sourceMapRootpath?: string;
    sourceMapBasepath?: string;
    sourceMapURL?: string;
    sourceMapFileInline?: boolean;
    outputSourceFiles?: boolean;
    disableSourcemapAnnotation?: boolean;
    sourceMapOutputFilename?: string;
    sourceMapFilename?: string;
  };

  /** Allow additional options */
  [key: string]: any;
}

export interface StylesConfig {
  compile?: {
    /**
     * Plugins can be specified as:
     * - Plugin instances (PluginInterface from @jesscss/core)
     * - String keys (plugin names that get resolved elsewhere)
     *
     * @note - Using `any` here to avoid circular dependency with @jesscss/core.
     *         The actual type is PluginInterface from @jesscss/core.
     */
    plugins?: Array<any | string>;
    searchPaths?: string[];
    enableJavaScript?: boolean;
    javascript?: CompileJavaScriptOption;
    mathMode?: MathMode;
    unitMode?: UnitMode;
  };
  /**
   * Input file options. Can be a single object for defaults, or an array
   * where entries can have a `file` property (path or glob) to match specific inputs.
   * Entries without a `file` property serve as defaults.
   */
  input?: InputOptions | InputOptions[];
  /**
   * Output file options. Can be a single object for defaults, or an array
   * where entries can have a `file` property (path or glob) to match specific outputs.
   * Entries without a `file` property serve as defaults.
   */
  output?: OutputOptions | OutputOptions[];
  language?: {
    less?: LessOptions;
    scss?: Record<string, any>;
    css?: Record<string, any>;
    jess?: Record<string, any>;
    [key: string]: LessOptions | Record<string, any> | undefined;
  };
}
