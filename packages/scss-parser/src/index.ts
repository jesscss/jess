// The legacy Chevrotain parser has been removed — the functional macro parser
// (ScssParser / scssGrammar) IS the parser now.

export { ScssGrammar } from './builders.js';
export { scssGrammar } from './grammar.js';

import { ScssParser } from './functional-parser.js';
export { ScssParser, parseScssFn, type ScssFnParseResult, type ScssFnParseOptions } from './functional-parser.js';

export const Parser = ScssParser;
export { parseScssCst, parseScssDoc } from './cst.js';
export type {
  ScssCstChild, ScssCstError, ScssCstLeaf, ScssCstNode, ScssCstParseResult, ScssCstType
} from './cst.js';
