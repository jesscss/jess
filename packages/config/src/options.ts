import type { StylesConfig, FileMatchOptions } from './types.js';
import picomatch from 'picomatch';
import path from 'path';

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
const extensionToLanguage: Record<string, string> = {
  '.less': 'less',
  '.scss': 'scss',
  '.sass': 'scss',
  '.jess': 'jess',
  '.css': 'css'
};

/**
 * Infer language from a file path's extension
 */
function inferLanguage(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const ext = path.extname(filePath).toLowerCase();
  return extensionToLanguage[ext];
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
      result = { ...result, ...rest };
    }
  }

  return result;
}

/**
 * Get merged options by combining compile, language, input, and output settings.
 *
 * Merge priority (later wins):
 * 1. compile options (base)
 * 2. language-specific options (inferred from input extension or explicitly specified)
 * 3. matched input options (if input path provided and matches)
 * 4. matched output options (if output path provided and matches)
 *
 * @param config - The styles configuration object
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
 * // Explicitly specify language
 * const options = getOptions(config, { language: 'less' });
 *
 * @example
 * // Get base options without language-specific settings
 * const options = getOptions(config);
 */
export function getOptions(
  config: StylesConfig = {},
  params: GetOptionsParams = {}
): Record<string, any> {
  const { input: inputFile, output: outputFile } = params;
  const { compile = {}, input, output, language: languageConfig = {} } = config;

  // Determine language: explicit param > inferred from input extension
  const language = params.language ?? inferLanguage(inputFile);

  // Get language-specific options if language is determined
  const languageOptions = language ? (languageConfig[language] ?? {}) : {};

  // Get matched input and output options
  const matchedInput = getMatchingOptions(input, inputFile);
  const matchedOutput = getMatchingOptions(output, outputFile);

  // Build result with proper merge priority:
  // 1. compile (base)
  // 2. language-specific
  // 3. matched input
  // 4. matched output
  return {
    // Start with compile-level settings
    mathMode: compile.mathMode,
    unitMode: compile.unitMode,
    paths: compile.searchPaths,
    javascriptEnabled: compile.enableJavaScript,

    // Override with language-specific settings
    ...languageOptions,

    // Override with matched input settings
    ...matchedInput,

    // Override with matched output settings
    ...matchedOutput
  };
}

