import { commentTriviaLabels } from './trivia-labels.js';
import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst-host';
import { scssCstGrammar } from './grammar/cst.js';

export { commentTriviaLabels } from './trivia-labels.js';

/**
 * Parse SCSS to a CST. Spans carry offsets only; for line/column facts import
 * the same functions from `@jesscss/scss-parser/cst/positions`, which binds the
 * line-aware compiled table. This entry never loads that table.
 */
export function parseScssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    scssCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

/** Incremental (`.edit()`-able) SCSS document — see `parseDocCst`. */
export function parseScssDoc(
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  return parseDocCst(
    scssCstGrammar as Record<string, unknown>,
    input,
    startRule
  );
}

export type {
  CssCstChild as ScssCstChild,
  CssCstError as ScssCstError,
  CssCstLeaf as ScssCstLeaf,
  CssCstNode as ScssCstNode,
  CssCstParseOptions as ScssCstParseOptions,
  CssCstParseResult as ScssCstParseResult,
  CssCstType as ScssCstType
} from '@jesscss/css-parser/cst-host';
