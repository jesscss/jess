import { parseCst, parseDocCst, type CssCstNode, type CssCstParseOptions, type CssCstParseResult } from './cst-host.js';
import { cssCstGrammar } from './grammar/cst.js';
import { cssCstPositionsGrammar } from './grammar/cst/positions.js';
import type { ParseDoc } from 'parseman';

export type { ParseDoc } from 'parseman';

export function parseCssCst(
  input: string,
  startRule = 'Stylesheet',
  options?: CssCstParseOptions
): CssCstParseResult {
  const grammar = (options?.trackLines ? cssCstPositionsGrammar : cssCstGrammar);
  return parseCst(
    grammar as Record<string, unknown>,
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
    cssCstPositionsGrammar as Record<string, unknown>,
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
    (options?.trackLines ? cssCstPositionsGrammar : cssCstGrammar) as Record<string, unknown>,
    input,
    startRule
  );
}

export function parseCssDiagnosticDoc(input: string, startRule = 'Stylesheet'): ParseDoc<CssCstNode> {
  return parseDocCst(
    cssCstPositionsGrammar as Record<string, unknown>,
    input,
    startRule
  );
}

/* Every dialect's `./cst` surface carries the labels; CSS is not the exception. */
export { commentTriviaLabels } from './trivia-labels.js';

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
} from './cst-host.js';
