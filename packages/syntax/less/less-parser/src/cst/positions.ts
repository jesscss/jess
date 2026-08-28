/**
 * The line-aware Less CST entry: the `./cst` functions bound to the compiled
 * table that tracks lines and columns. Tolerant error recovery is a property of
 * the CST runner, not of the table, so `result.errors` is collected here
 * exactly as it is on `./cst` — this entry adds line/column facts and nothing
 * else. It never loads the offsets-only table.
 */
import { commentTriviaLabels } from '../trivia-labels.js';
import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst-host';
import { lessCstPositionsGrammar } from '../grammar/cst/positions.js';

export { commentTriviaLabels } from '../trivia-labels.js';

/** Parse Less to a CST whose spans carry line and column facts. */
export function parseLessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    lessCstPositionsGrammar as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

/** Incremental (`.edit()`-able) Less document with line and column facts. */
export function parseLessDoc(
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  return parseDocCst(
    lessCstPositionsGrammar as Record<string, unknown>,
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
