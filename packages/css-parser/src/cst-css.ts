import { parseCst, type CssCstParseOptions, type CssCstParseResult } from './cst.js';
import { cssGrammar } from './grammar.js';

export function parseCss(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(cssGrammar as Record<string, unknown>, input, startRule, options);
}

export const parseCssCst = parseCss;

export {
  cssCstBuildHost,
  parseCst,
  type CssCstChild,
  type CssCstError,
  type CssCstLeaf,
  type CssCstNode, type CssCstParseOptions,
  type CssCstParseResult,
  type CssCstType
} from './cst.js';
