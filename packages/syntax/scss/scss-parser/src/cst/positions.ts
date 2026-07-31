/**
 * The line-aware SCSS CST entry: the `./cst` functions bound to the compiled
 * table that tracks lines and columns. Tolerant error recovery is a property of
 * the CST runner, not of the table, so `result.errors` is collected here
 * exactly as it is on `./cst` — this entry adds line/column facts and nothing
 * else. It never loads the offsets-only table.
 */
import { commentTriviaLabels } from '../trivia-labels.js';
import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst-host';
import { scssCstPositionsGrammar } from '../grammar/cst/positions.js';

export { commentTriviaLabels } from '../trivia-labels.js';

/** Parse SCSS to a CST whose spans carry line and column facts. */
export function parseScssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    scssCstPositionsGrammar as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

/** Incremental (`.edit()`-able) SCSS document with line and column facts. */
export function parseScssDoc(
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  return parseDocCst(
    scssCstPositionsGrammar as Record<string, unknown>,
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
