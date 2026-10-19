/*
 * CST parsing lives behind the `./cst` subpath. Re-exporting the parse
 * functions here would put the two compiled CST grammar tables on the static
 * import graph of the package entry, where Node executes them for every
 * consumer that only wants `parse`. The types are erased at build time, so
 * they stay.
 */
export type {
  JessCstChild, JessCstError, JessCstLeaf, JessCstNode, JessCstParseResult, JessCstType
} from './cst.js';

import type { Stylesheet } from '@jesscss/core/ast';
import { jessGrammar } from './grammar/ast.js';
import { parseRecoveringWith, parseWith, type JessParsed, type JessParseOptions } from './parse-with.js';

export type { JessParseOptions, JessParsed } from './parse-with.js';
export { JessArithmeticOutsideExpressionError, JessParseError, JessSelectorCaptureArgumentError, type JessRecoveredError } from './parse-error.js';

/**
 * Parse Jess directly into the canonical AST v2 document.
 *
 * Spans carry offsets only. For `startLine`/`startColumn` facts import `parse`
 * from `@jesscss/jess-parser/positions` — the same function bound to the
 * line-aware compiled table. This entry never loads that table.
 */
export function parse(input: string, options: JessParseOptions = {}): Stylesheet {
  return parseWith(jessGrammar, input, options);
}

/**
 * Parse Jess, keeping the located errors the grammar recovered from (ledger
 * P45) beside the document instead of raising the first.
 */
export function parseRecovering(input: string, options: JessParseOptions = {}): JessParsed {
  return parseRecoveringWith(jessGrammar, input, options);
}
