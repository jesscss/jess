/**
 * The line-aware Jess AST entry.
 *
 * `parse` here is the `.` entry's function bound to the compiled table that
 * tracks lines and columns, so every span carries `startLine`/`startColumn`.
 * The choice is an import rather than an option because Node executes every
 * statically imported module: a single `parse` that named both tables would
 * cost every caller both, and the tables are multiple megabytes each.
 */
import type { Stylesheet } from '@jesscss/core/ast';
import { jessPositionsGrammar } from './grammar/ast/positions.js';
import { parseRecoveringWith, parseWith, type JessParsed, type JessParseOptions } from './parse-with.js';

export type { JessParseOptions, JessParsed } from './parse-with.js';
export { JessArithmeticOutsideExpressionError, JessParseError, JessSelectorCaptureArgumentError, type JessRecoveredError } from './parse-error.js';

/** Parse Jess into the canonical AST v2 document with line/column facts. */
export function parse(input: string, options: JessParseOptions = {}): Stylesheet {
  return parseWith(jessPositionsGrammar, input, options);
}

/**
 * Parse Jess, keeping the located errors the grammar recovered from (ledger
 * P45) beside the document instead of raising the first.
 */
export function parseRecovering(input: string, options: JessParseOptions = {}): JessParsed {
  return parseRecoveringWith(jessPositionsGrammar, input, options);
}
