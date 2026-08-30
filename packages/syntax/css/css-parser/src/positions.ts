/**
 * The line-aware CSS AST entry.
 *
 * `parse` here is the `.` entry's function bound to the compiled table that
 * tracks lines and columns, so every span carries `startLine`/`startColumn`.
 * The choice is an import rather than an option because Node executes every
 * statically imported module: a single `parse` that named both tables would
 * cost every caller both, and the tables are multiple megabytes each.
 */
import type { Stylesheet } from '@jesscss/core/ast';
import { cssPositionsGrammar } from './grammar/ast/positions.js';
import { parseWith } from './parse-with.js';

export { CssParseError } from './parse-error.js';

/** Parse CSS into the canonical AST v2 document with line/column facts. */
export function parse(input: string): Stylesheet {
  return parseWith(cssPositionsGrammar, input);
}
