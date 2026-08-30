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
import { parseWith, type JessParseOptions } from './parse-with.js';

export type { JessParseOptions } from './parse-with.js';
export { JessParseError } from './parse-error.js';

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
