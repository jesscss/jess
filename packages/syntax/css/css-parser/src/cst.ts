import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult } from './cst-host.js';
import { cssCstGrammar } from './grammar/cst.js';
import type { ParseDoc } from 'parseman';

export type { ParseDoc } from 'parseman';

/**
 * Parse CSS to a CST. Spans carry offsets only; for line/column facts import
 * the same functions from `@jesscss/css-parser/cst/positions`, which binds the
 * line-aware compiled table. This entry never loads that table.
 */
export function parseCssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    cssCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

/** Incremental (`.edit()`-able) CSS document — see {@link parseDocCst}. */
export function parseCssDoc(
  input: string,
  startRule = 'Stylesheet'
): ParseDoc<CssCstNode> {
  return parseDocCst(
    cssCstGrammar as Record<string, unknown>,
    input,
    startRule
  );
}

/* Every dialect's `./cst` surface carries the labels; CSS is not the exception. */
export { commentTriviaLabels } from './trivia-labels.js';

export {
  cssCstBuildHost,
  parseCst,
  parseDocCst,
  type CssCstChild,
  type CssCstError,
  type CssCstLeaf,
  type CssCstNode, type CssCstParseOptions,
  type CssCstParseResult,
  type CssCstType
} from './cst-host.js';
