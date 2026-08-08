/**
 * The line-aware Less AST entry.
 *
 * `parse`/`safeParse` here are the `.` entry's functions bound to the compiled
 * table that tracks lines and columns, so every span carries
 * `startLine`/`startColumn` and a `LessParseError` reports a real line. The
 * choice is an import rather than an option because Node executes every
 * statically imported module: a single `parse` that named both tables would
 * cost every caller both, and the tables are multiple megabytes each.
 */
import type { ISafeParseResult } from '@jesscss/core';
import type { Stylesheet } from '@jesscss/core/ast';
import { lessPositionsGrammar } from './grammar/ast/positions.js';
import { parseWith, safeParseWith } from './parse-with.js';

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

/** Parse Less into the canonical AST v2 document with line/column facts. */
export function parse(input: string): Stylesheet {
  return parseWith(lessPositionsGrammar, input);
}

/** `safeParse` over the line-aware table: diagnostics carry parser line facts. */
export function safeParse(filePath: string, input: string): ISafeParseResult {
  return safeParseWith(lessPositionsGrammar, filePath, input);
}
