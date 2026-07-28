import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type ParseDoc } from '@jesscss/css-parser/cst';
import { scssCstGrammar } from './grammar.js';

export function parseScssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    scssCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

/** Incremental (`.edit()`-able) SCSS document — see `parseDocCst`. */
export function parseScssDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(
    scssCstGrammar as Record<string, unknown>,
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
