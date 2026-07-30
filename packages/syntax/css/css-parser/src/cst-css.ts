import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult } from './cst.js';
import { cssGrammarFor } from './grammar.js';
import type { ParseDoc } from 'parseman';

export type { ParseDoc } from 'parseman';

export function parseCssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  const grammar = cssGrammarFor({ cst: true, trackLines: options?.trackLines });
  return parseCst(
    grammar as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

/** Incremental (`.edit()`-able) CSS document — see {@link parseDocCst}. */
export function parseCssDoc(
  input: string,
  startRule = 'Stylesheet',
  options?: Pick<CssCstParseOptions, 'trackLines'>
): ParseDoc<CssCstNode> {
  return parseDocCst(
    cssGrammarFor({ cst: true, trackLines: options?.trackLines }) as Record<string, unknown>,
    input,
    startRule
  );
}

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
} from './cst.js';
