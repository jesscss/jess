import { parseCst, type CssCstParseOptions, type CssCstParseResult } from '@jesscss/css-parser/cst';
import { jessGrammar } from './grammar.js';

export function parseJessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(jessGrammar as Record<string, unknown>, input, startRule, options);
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
