import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst';
import { lessCstGrammar } from './grammar/cst.js';
import { lessCstPositionsGrammar } from './grammar/cst/positions.js';

/* The Less grammar labels its document trivia arms `whitespace`,
 * `lineComment`, and `blockComment`; only the comment arms need a root entry. */
export const commentTriviaLabels = ['lineComment', 'blockComment'] as const;

export function parseLessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    (options?.trackLines ? lessCstPositionsGrammar : lessCstGrammar) as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

export function parseLessDiagnosticCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(lessCstPositionsGrammar as Record<string, unknown>, input, startRule, options, commentTriviaLabels);
}

/** Incremental (`.edit()`-able) Less document — see `parseDocCst`. */
export function parseLessDoc(
  input: string,
  startRule = 'Stylesheet',
  options?: Pick<CssCstParseOptions, 'trackLines'>
): ParseDoc<CssCstNode> {
  return parseDocCst(
    (options?.trackLines ? lessCstPositionsGrammar : lessCstGrammar) as Record<string, unknown>,
    input,
    startRule
  );
}

export function parseLessDiagnosticDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(lessCstPositionsGrammar as Record<string, unknown>, input, startRule);
}

export type {
  CssCstChild as LessCstChild,
  CssCstError as LessCstError,
  CssCstLeaf as LessCstLeaf,
  CssCstNode as LessCstNode,
  CssCstParseOptions as LessCstParseOptions,
  CssCstParseResult as LessCstParseResult,
  CssCstType as LessCstType
} from '@jesscss/css-parser/cst';
