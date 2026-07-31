import { commentTriviaLabels } from './trivia-labels.js';
import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst-host';
import { lessCstGrammar } from './grammar/cst.js';

export { commentTriviaLabels } from './trivia-labels.js';

/**
 * Parse Less to a CST. Spans carry offsets only; for line/column facts import
 * the same functions from `@jesscss/less-parser/cst/positions`, which binds the
 * line-aware compiled table. This entry never loads that table.
 */
export function parseLessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    lessCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

/** Incremental (`.edit()`-able) Less document — see `parseDocCst`. */
export function parseLessDoc(
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  return parseDocCst(
    lessCstGrammar as Record<string, unknown>,
    input,
    startRule
  );
}

export type {
  CssCstChild as LessCstChild,
  CssCstError as LessCstError,
  CssCstLeaf as LessCstLeaf,
  CssCstNode as LessCstNode,
  CssCstParseOptions as LessCstParseOptions,
  CssCstParseResult as LessCstParseResult,
  CssCstType as LessCstType
} from '@jesscss/css-parser/cst-host';
