import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst';
import { grammarFor, scssDiagnosticCstGrammar } from './grammar.js';

/* The SCSS grammar labels its trivia arms `whitespace` and `comment`: a
 * statement-level block comment is a `Comment` node rather than trivia, so the
 * comment category covers document line comments and the block comments the
 * custom-value scope strips out of the value. */
export const commentTriviaLabels = ['comment'] as const;

export function parseScssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    grammarFor({ cst: true, trackLines: options?.trackLines }) as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

export function parseScssDiagnosticCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    scssDiagnosticCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options,
    commentTriviaLabels
  );
}

/** Incremental (`.edit()`-able) SCSS document — see `parseDocCst`. */
export function parseScssDoc(
  input: string,
  startRule = 'Stylesheet',
  options?: Pick<CssCstParseOptions, 'trackLines'>
): ParseDoc<CssCstNode> {
  return parseDocCst(
    grammarFor({ cst: true, trackLines: options?.trackLines }) as Record<string, unknown>,
    input,
    startRule
  );
}

export function parseScssDiagnosticDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(
    scssDiagnosticCstGrammar as Record<string, unknown>,
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
} from '@jesscss/css-parser/cst';
