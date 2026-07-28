import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst';
import { lessCstGrammar } from './grammar.js';

export function parseLessCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(lessCstGrammar as Record<string, unknown>, input, startRule, options);
}

/** Incremental (`.edit()`-able) Less document — see `parseDocCst`. */
export function parseLessDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(lessCstGrammar as Record<string, unknown>, input, startRule);
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
