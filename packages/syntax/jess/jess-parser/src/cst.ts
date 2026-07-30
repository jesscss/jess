import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst';
import { jessDiagnosticCstGrammar, jessGrammarFor } from './grammar.js';

export function parseJessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    jessGrammarFor({ cst: true, trackLines: options?.trackLines }) as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

export function parseJessDiagnosticCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    jessDiagnosticCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

/** Incremental (`.edit()`-able) Jess document — mirrors `parseLessDoc`/`parseScssDoc`. */
export function parseJessDoc(
  input: string,
  startRule = 'Stylesheet',
  options?: Pick<CssCstParseOptions, 'trackLines'>
): ParseDoc<CssCstNode> {
  return parseDocCst(
    jessGrammarFor({ cst: true, trackLines: options?.trackLines }) as Record<string, unknown>,
    input,
    startRule
  );
}

export function parseJessDiagnosticDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(
    jessDiagnosticCstGrammar as Record<string, unknown>,
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
