import type { ISafeParseResult } from '@jesscss/core';
import type { Stylesheet } from '@jesscss/core/ast';
import { lessGrammar } from './grammar/ast.js';
import { parseWith, safeParseWith, type LessParseOptions } from './parse-with.js';

export type { LessParseOptions } from './parse-with.js';

export {
  LessBareVariableInterpolationError,
  LessDynamicCharsetError,
  LessImportPostludeError,
  LessInlineJavaScriptError,
  LessParseError,
  LessUnparenthesizedMixinGuardError,
  LessUnsupportedMixinNameError,
  LessUnsupportedVariableNameError
} from './parse-error.js';

/**
 * Parse Less directly into the canonical AST v2 document.
 *
 * Spans carry offsets only. For `startLine`/`startColumn` facts import `parse`
 * from `@jesscss/less-parser/positions` — the same function bound to the
 * line-aware compiled table. This entry never loads that table.
 */
export function parse(input: string, options: LessParseOptions = {}): Stylesheet {
  return parseWith(lessGrammar, input, options);
}

/**
 * Parse Less for the product plugin path. Parser packages own recognition
 * facts; this boundary attaches file/source context once and returns
 * normalized diagnostics for compiler and CLI consumers to render.
 */
export function safeParse(
  filePath: string,
  input: string,
  options: LessParseOptions = {}
): ISafeParseResult {
  return safeParseWith(lessGrammar, filePath, input, options);
}
