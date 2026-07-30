import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst';
import { jessCstGrammar } from './grammar/cst.js';
import { jessCstPositionsGrammar } from './grammar/cst/positions.js';

/* The Jess grammar labels its document trivia arms `whitespace` and `comment`;
 * only the comment arm needs a root entry. */
export const commentTriviaLabels = ['comment'] as const;

export function parseJessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    (options?.trackLines ? jessCstPositionsGrammar : jessCstGrammar) as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

export function parseJessDiagnosticCst(
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

/** Incremental (`.edit()`-able) Jess document — mirrors `parseLessDoc`/`parseScssDoc`. */
export function parseJessDoc(
  input: string,
  startRule = 'Stylesheet',
  options?: Pick<CssCstParseOptions, 'trackLines'>
): ParseDoc<CssCstNode> {
  return parseDocCst(
    (options?.trackLines ? jessCstPositionsGrammar : jessCstGrammar) as Record<string, unknown>,
    input,
    startRule
  );
}

export function parseJessDiagnosticDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
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
} from '@jesscss/css-parser/cst';
