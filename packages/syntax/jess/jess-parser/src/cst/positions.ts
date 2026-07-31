/**
 * The line-aware Jess CST entry: the `./cst` functions bound to the compiled
 * table that tracks lines and columns. Tolerant error recovery is a property of
 * the CST runner, not of the table, so `result.errors` is collected here
 * exactly as it is on `./cst` — this entry adds line/column facts and nothing
 * else. It never loads the offsets-only table.
 */
import { commentTriviaLabels } from '../trivia-labels.js';
import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst-host';
import { jessCstPositionsGrammar } from '../grammar/cst/positions.js';

export { commentTriviaLabels } from '../trivia-labels.js';

/** Parse Jess to a CST whose spans carry line and column facts. */
export function parseJessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    jessCstPositionsGrammar as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

/** Incremental (`.edit()`-able) Jess document with line and column facts. */
export function parseJessDoc(
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  return parseDocCst(
    jessCstPositionsGrammar as Record<string, unknown>,
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
