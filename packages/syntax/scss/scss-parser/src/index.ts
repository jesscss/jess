import type { Stylesheet } from '@jesscss/core/ast';
import { scssGrammar } from './grammar/ast.js';
import { parseRecoveringWith, parseSelectorWith, parseWith, type ScssParsed } from './parse-with.js';

export type { ScssParsed } from './parse-with.js';
export { ScssImportPostludeError, ScssParseError, type ScssRecoveredError } from './parse-error.js';

/**
 * Parse SCSS directly into the canonical AST v2 document.
 *
 * Spans carry offsets only. For `startLine`/`startColumn` facts import `parse`
 * from `@jesscss/scss-parser/positions` — the same function bound to the
 * line-aware compiled table. This entry never loads that table.
 */
export function parse(input: string): Stylesheet {
  return parseWith(scssGrammar, input);
}

/**
 * Parse SCSS, keeping the located errors the grammar recovered from (ledger
 * P45) beside the document instead of raising the first.
 */
export function parseRecovering(input: string): ScssParsed {
  return parseRecoveringWith(scssGrammar, input);
}

/**
 * Read a selector string as Sass's `selector.parse()` does, with this
 * grammar's `SelectorList`: each branch's compound selectors and combinators.
 * Throws when the text is not a selector list.
 */
export function parseSelector(text: string): string[][] {
  return parseSelectorWith(scssGrammar, text);
}
