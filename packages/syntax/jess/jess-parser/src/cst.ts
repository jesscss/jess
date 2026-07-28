import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst';
import { jessCstGrammar } from './grammar.js';

export function parseJessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    jessCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

/** Incremental (`.edit()`-able) Jess document — mirrors `parseLessDoc`/`parseScssDoc`. */
export function parseJessDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(
    jessCstGrammar as Record<string, unknown>,
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
