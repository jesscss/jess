import type { StylesConfig, FileMatchOptions } from './types.js';
import picomatch from 'picomatch';
import path from 'path';

/**
 * Options bag the `strict` preset can expand. Any bag carrying a `strict` flag
 * plus the semantic modes it governs.
 */
export interface StrictPresetOptions {
  strict?: boolean;
  unitMode?: 'loose' | 'preserve' | 'strict';
  allowLeakyScope?: boolean;

  /** @deprecated Use `unitMode`. */
  strictUnits?: boolean;

  /** @deprecated Use `allowLeakyScope`. */
  leakyScope?: boolean;
  allowCallerScope?: boolean;
  allowOverloadedImport?: boolean;
}

/**
 * Expand the `strict` convenience preset. When `strict` is truthy, fills the
 * strict bundle for any governed option left `undefined` — an explicitly set
 * option always wins. Modeled after `tsconfig`'s `strict`: it only *sets*
 * semantic options, it is not itself a mode. Sets the strictest value of each
 * governed axis.
 *
 * Returns a new object (never mutates the input); a no-op when `strict` is falsy.
 */
export function applyStrictPreset<T extends StrictPresetOptions>(opts: T): T {
  if (!opts?.strict) {
    return opts;
  }
  const filled = { ...opts };

  /* A deprecated spelling set counts as set: fill the canonical name only when neither is. */
  if (filled.strictUnits === undefined) {
    filled.unitMode ??= 'strict';
  }
  if (filled.leakyScope === undefined) {
    filled.allowLeakyScope ??= false;
  }
  filled.allowCallerScope ??= false;
  filled.allowOverloadedImport ??= false;
  return filled;
}

/** Each mode with its deprecated spellings ({@link layerOptions}). */
const MODE_SPELLINGS: ReadonlyArray<readonly string[]> = [
  ['unitMode', 'strictUnits'],
  ['mathMode', 'math', 'strictMath'],
  ['allowLeakyScope', 'leakyScope']
];

/**
 * `upper`'s settings over `lower`'s; a value `upper` leaves undefined keeps
 * `lower`'s. A mode `upper` sets in any spelling replaces every spelling of it
 * in `lower`, so a deprecated spelling keeps the precedence of the place it is
 * written in (`language.less.strictUnits` wins over `compile.unitMode`).
 */
export function layerOptions(lower: object, upper: object): Record<string, any> {
  const layered: Record<string, unknown> = { ...lower };
  const set = Object.entries(upper).filter(([, value]) => value !== undefined);
  for (const spellings of MODE_SPELLINGS) {
    if (set.some(([name]) => spellings.includes(name))) {
      for (const name of spellings) {
        delete layered[name];
      }
    }
  }
  for (const [name, value] of set) {
    layered[name] = value;
  }
  return layered;
}

/**
 * Options for retrieving merged configuration
 */
export interface GetOptionsParams {
  /**
   * Language key to get options for (e.g., 'less', 'scss', 'jess').
   * If omitted but `input` is provided, language is inferred from the file extension.
   */
  language?: string;

  /**
   * Input file path to match against input options.
   * Also used to infer language if `language` is not specified.
   */
  input?: string;

  /**
   * Output file path to match against output options
   */
  output?: string;
}

/**
 * Map of file extensions to language keys
 */
const extensionToLanguage = new Map<string, string>([
  ['.less', 'less'],
  ['.scss', 'scss'],
  ['.sass', 'scss'],
  ['.jess', 'jess'],
  ['.css', 'css']
]);

/**
 * Infer language from a file path's extension. Exported so a consumer that has
 * to route by dialect (built-in function set, plugin choice) reads the SAME
 * extension map the option resolution uses instead of keeping its own copy.
 */
export function inferLanguage(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const ext = path.extname(filePath).toLowerCase();
  return extensionToLanguage.get(ext);
}

/**
 * Check if a file path matches a pattern (exact path, relative path, or glob)
 */
function matchesFile(pattern: string | undefined, filePath: string | undefined): boolean {
  if (!pattern || !filePath) {
    return false;
  }

  // Normalize paths for comparison
  const normalizedPattern = path.normalize(pattern);
  const normalizedFile = path.normalize(filePath);

  // Try exact match first
  if (normalizedPattern === normalizedFile) {
    return true;
  }

  // Try basename match (e.g., pattern "styles.less" matches "/path/to/styles.less")
  if (path.basename(normalizedFile) === normalizedPattern) {
    return true;
  }

  // Try glob/pattern match using picomatch
  const isMatch = picomatch(pattern, { dot: true });
  return isMatch(filePath) || isMatch(normalizedFile);
}

/**
 * Get matching options from an array of file-based options.
 * Returns merged options from:
 * 1. All entries without a `file` property (defaults)
 * 2. All entries whose `file` pattern matches the given path
 *
 * Later entries override earlier ones.
 */
function getMatchingOptions<T extends FileMatchOptions>(
  options: T | T[] | undefined,
  filePath?: string
): Partial<T> {
  if (!options) {
    return {};
  }

  const optionsArray = Array.isArray(options) ? options : [options];
  let result: Partial<T> = {};

  for (const opt of optionsArray) {
    // Include if: no file pattern (default), or file pattern matches
    if (!opt.file || (filePath && matchesFile(opt.file, filePath))) {
      // Merge this entry's options, excluding the 'file' property
      const { file, ...rest } = opt;
      void file;
      result = { ...result, ...rest };
    }
  }

  return result;
}

/** The compile settings that reach a file's options ({@link getOptions}). */
function compileOptions(compile: NonNullable<StylesConfig['compile']>): StrictPresetOptions & Record<string, unknown> {
  return {
    strict: compile.strict,
    mathMode: compile.mathMode,
    unitMode: compile.unitMode,
    functionMode: compile.functionMode,
    allowLeakyScope: compile.allowLeakyScope,
    leakyScope: compile.leakyScope,
    allowCallerScope: compile.allowCallerScope,
    allowExtendSelectors: compile.allowExtendSelectors,
    allowApplySelectors: compile.allowApplySelectors,
    processImports: compile.processImports,
    disableScriptModules: compile.disableScriptModules ?? compile.disablePluginRule,
    paths: compile.searchPaths
  };
}

/**
 * Get one file's options from its config (DESIGN-DECISIONS C19).
 *
 * Several configs (`[styles.config, options passed in]`) are merged first, field
 * by field, a later config over an earlier one: each `compile` setting, each
 * `language.<lang>` setting, and the `input`/`output` entries (concatenated). A
 * mode a later config sets in any spelling replaces every spelling of it at the
 * same place in an earlier one ({@link layerOptions}).
 *
 * On the merged config, the options are computed for the file's language
 * (later wins):
 * 1. compile options
 * 2. language-specific options (inferred from input extension or explicitly specified)
 * 3. matched input options (if input path provided and matches)
 * 4. matched output options (if output path provided and matches)
 *
 * The language's own defaults sit below all of these, where a file's modes are
 * resolved. The `strict` preset is not itself a mode: the most specific place
 * that sets `strict` decides it, and when true it fills the modes that place
 * leaves unset, so `language.less.strict` wins over `compile.unitMode` for
 * `.less` files and `language.less.unitMode` wins over it.
 *
 * @param config - The styles configuration object, or the configs to merge, earliest first
 * @param params - Options specifying language, input file, and output file
 * @returns Merged options object
 *
 * @example
 * // Get Less options for a specific input/output (language inferred from .less extension)
 * const options = getOptions(config, {
 *   input: 'src/styles/main.less',
 *   output: 'dist/main.css'
 * });
 *
 * @example
 * // A styles.config under the options passed in
 * const options = getOptions([fileConfig, passedConfig], { language: 'less' });
 *
 * @example
 * // Get base options without language-specific settings
 * const options = getOptions(config);
 */
export function getOptions(
  config: StylesConfig | readonly StylesConfig[] = {},
  params: GetOptionsParams = {}
): Record<string, any> {
  const configs: readonly StylesConfig[] = Array.isArray(config) ? config : [config];
  const { input: inputFile, output: outputFile } = params;

  // Determine language: explicit param > inferred from input extension
  const language = params.language ?? inferLanguage(inputFile);

  let compile: Record<string, unknown> = {};
  let languageOptions: Record<string, unknown> = {};
  for (const { compile: compileConfig, language: languageConfig } of configs) {
    compile = layerOptions(compile, compileOptions(compileConfig ?? {}));
    if (language) {
      languageOptions = layerOptions(languageOptions, languageConfig?.[language] ?? {});
    }
  }
  const tiers: ReadonlyArray<StrictPresetOptions & Record<string, unknown>> = [
    compile,
    languageOptions,
    getMatchingOptions(configs.flatMap(c => c.input ?? []), inputFile),
    getMatchingOptions(configs.flatMap(c => c.output ?? []), outputFile)
  ];
  const decides = tiers.findLastIndex(tier => tier.strict !== undefined);
  return tiers.reduce<Record<string, any>>((options, tier, index) => {
    const { strict, ...filled } = applyStrictPreset({ ...tier, strict: index === decides && tier.strict === true });
    void strict;
    return layerOptions(options, filled);
  }, {});
}
