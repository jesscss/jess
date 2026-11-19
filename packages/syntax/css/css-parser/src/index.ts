/*
 * CST parsing lives behind the `./cst` subpath, and the shared CST runtime
 * behind `./cst-host`. Re-exporting the parse functions here would put the two
 * compiled CST grammar tables on the static import graph of the package entry,
 * where Node executes them for every consumer that only wants `parse`. The
 * types are erased at build time, so they stay.
 */
export type {
  CssCstChild, CssCstError, CssCstLeaf, CssCstNode, CssCstParseOptions, CssCstParseResult, CssCstType, ParseDoc
} from './cst-host.js';
import type { Stylesheet } from '@jesscss/core/ast';
import { cssGrammar } from './grammar/ast.js';
import { parseRecoveringWith, parseWith, type CssParsed } from './parse-with.js';

export { CssParseError } from './parse-error.js';
export type { CssParsed, CssRecoveredError } from './parse-with.js';

/**
 * Parse CSS directly into the canonical AST v2 document.
 *
 * Spans carry offsets only. For `startLine`/`startColumn` facts import `parse`
 * from `@jesscss/css-parser/positions` — the same function bound to the
 * line-aware compiled table. This entry never loads that table.
 */
export function parse(input: string): Stylesheet {
  return parseWith(cssGrammar, input);
}

/**
 * Parse CSS, keeping the located errors the grammar recovered from (ledger
 * P45) beside the document instead of raising the first.
 */
export function parseRecovering(input: string): CssParsed {
  return parseRecoveringWith(cssGrammar, input);
}
