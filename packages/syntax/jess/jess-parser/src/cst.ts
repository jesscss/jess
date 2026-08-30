import { commentTriviaLabels } from './trivia-labels.js';
import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst-host';
import { jessCstGrammar } from './grammar/cst.js';

export { commentTriviaLabels } from './trivia-labels.js';

/**
 * Parse Jess to a CST. Spans carry offsets only; for line/column facts import
 * the same functions from `@jesscss/jess-parser/cst/positions`, which binds the
 * line-aware compiled table. This entry never loads that table.
 */
export function parseJessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    jessCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

/** Incremental (`.edit()`-able) Jess document — see `parseDocCst`. */
export function parseJessDoc(
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  return parseDocCst(
    jessCstGrammar as Record<string, unknown>,
    input,
    startRule
  );
}

export type {
  CssCstChild as JessCstChild,
  CssCstError as JessCstError,
  CssCstLeaf as JessCstLeaf,
  CssCstNode as JessCstNode,
  CssCstParseOptions as JessCstParseOptions,
  CssCstParseResult as JessCstParseResult,
  CssCstType as JessCstType
} from '@jesscss/css-parser/cst-host';
