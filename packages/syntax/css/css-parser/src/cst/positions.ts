/**
 * The line-aware CSS CST entry: the `./cst` functions bound to the compiled
 * table that tracks lines and columns. Tolerant error recovery is a property of
 * the CST runner, not of the table, so `result.errors` is collected here
 * exactly as it is on `./cst` — this entry adds line/column facts and nothing
 * else. It never loads the offsets-only table.
 */
import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult } from '../cst-host.js';
import { cssCstPositionsGrammar } from '../grammar/cst/positions.js';
import type { ParseDoc } from 'parseman';

export type { ParseDoc } from 'parseman';

/** Parse CSS to a CST whose spans carry line and column facts. */
export function parseCssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    cssCstPositionsGrammar as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

/** Incremental (`.edit()`-able) CSS document with line and column facts. */
export function parseCssDoc(
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  return parseDocCst(
    cssCstPositionsGrammar as Record<string, unknown>,
    input,
    startRule
  );
}

export { commentTriviaLabels } from '../trivia-labels.js';

export type {
  CssCstChild,
  CssCstError,
  CssCstLeaf,
  CssCstNode,
  CssCstParseOptions,
  CssCstParseResult,
  CssCstType
} from '../cst-host.js';
