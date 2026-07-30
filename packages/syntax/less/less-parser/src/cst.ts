import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst';
import { lessDiagnosticCstGrammar, lessGrammarFor } from './grammar.js';

export function parseLessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    lessGrammarFor({ cst: true, trackLines: options?.trackLines }) as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

export function parseLessDiagnosticCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(lessDiagnosticCstGrammar as Record<string, unknown>, input, startRule, options);
}

/** Incremental (`.edit()`-able) Less document — see `parseDocCst`. */
export function parseLessDoc(
  input: string,
  startRule = 'Stylesheet',
  options?: Pick<CssCstParseOptions, 'trackLines'>
): ParseDoc<CssCstNode> {
  return parseDocCst(
    lessGrammarFor({ cst: true, trackLines: options?.trackLines }) as Record<string, unknown>,
    input,
    startRule
  );
}

export function parseLessDiagnosticDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(lessDiagnosticCstGrammar as Record<string, unknown>, input, startRule);
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
