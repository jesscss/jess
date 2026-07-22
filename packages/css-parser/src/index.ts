export { cssGrammar } from './grammar.js';
export {
  cssCstBuildHost, parseCst, parseDocCst, parseCssCst, parseCssDoc,
  type CssCstChild, type CssCstError, type CssCstLeaf, type CssCstNode, type CssCstParseOptions, type CssCstParseResult, type CssCstType, type ParseDoc
} from './cst-css.js';
import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { cssAstGrammar } from './ast/grammar.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

/** Parse CSS directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const result = run(cssAstGrammar.CssAstDocument, input, { trivia: cssAstGrammar.whitespace });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    throw new SyntaxError('CSS parse did not produce a complete Stylesheet document.');
  }
  return result.value;
}
