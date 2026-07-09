import { parseCst, type CssCstParseOptions, type CssCstParseResult } from '@jesscss/css-parser';
import { scssGrammar } from './grammar.js';

export function parseScssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(scssGrammar as Record<string, unknown>, input, startRule, options);
}

export type {
  CssCstChild as ScssCstChild,
  CssCstError as ScssCstError,
  CssCstLeaf as ScssCstLeaf,
  CssCstNode as ScssCstNode,
  CssCstParseOptions as ScssCstParseOptions,
  CssCstParseResult as ScssCstParseResult,
  CssCstType as ScssCstType
} from '@jesscss/css-parser';
