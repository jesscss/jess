export { jessGrammar } from './grammar.js';
export { parseJessCst, parseJessDoc } from './cst.js';
export type {
  JessCstChild, JessCstError, JessCstLeaf, JessCstNode, JessCstParseResult, JessCstType
} from './cst.js';

import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { jessAstGrammar } from './ast/grammar.js';

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

/** Parse Jess directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const result = run(jessAstGrammar.JessAstDocument, input, { trivia: jessAstGrammar.whitespace });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    throw new SyntaxError('Jess parse did not produce a complete Stylesheet document.');
  }
  return result.value;
}
