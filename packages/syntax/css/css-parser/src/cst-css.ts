import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult } from './cst.js';
import { cssCstGrammar, cssDiagnosticCstGrammar } from './grammar.js';
import type { ParseDoc } from 'parseman';

export type { ParseDoc } from 'parseman';

export function parseCssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    cssCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

export function parseCssDiagnosticCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  return parseCst(
    cssDiagnosticCstGrammar as Record<string, unknown>,
    input,
    startRule,
    options
  );
}

/** Incremental (`.edit()`-able) CSS document — see {@link parseDocCst}. */
export function parseCssDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(
    cssCstGrammar as Record<string, unknown>,
    input,
    startRule
  );
}

export function parseCssDiagnosticDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(
    cssDiagnosticCstGrammar as Record<string, unknown>,
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
